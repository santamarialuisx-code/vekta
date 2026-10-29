# Trazador en el navegador

Página sin build que convierte una imagen local en SVG con el wasm de vtracer. Todo pasa en el
cliente: no se sube nada, no hay API, no hay estado guardado entre visitas. Son tres ficheros —
`index.html`, `app.mjs`, `vtracer-web.mjs`— y ninguno se compila. Encima del trazado hay dos cosas
que el usuario toca sin volver a trazar: **quitar el fondo** (alfa del PNG, o varita desde el borde
si el lienzo es opaco) y **borrar piezas del SVG** con el ratón, que es la edición que Vector Magic
hace sobre su mapa de segmentos y aquí se hace sobre los `path` que el motor ya emite. El modo por
defecto de color es **plano**: la paleta se poda para que un dibujo de seis colores salga con seis
(experimento 16).

## Abrirla

```bash
pnpm bench:serve
# → http://127.0.0.1:8787/web/index.html
```

Si el puerto está ocupado: `PORT=8789 pnpm bench:serve` (el servidor imprime sus URLs al
arrancar).

`bench/serve.mjs` reparte cuatro raíces y nada más:

| ruta | de dónde sale |
| --- | --- |
| `/` | `bench/` (las páginas de medición, como siempre) |
| `/web/` | esta carpeta |
| `/bench/` | `bench/` otra vez, para que los imports de `app.mjs` (`../bench/lib/lineart.mjs`) se lean igual que en el repo |
| `/pkg/` | `node_modules/@visioncortex/vtracer/pkg/` — el glue y el `.wasm` del trazador |

## Qué hace la página

1. Arrastrar o elegir una imagen → `createImageBitmap` → canvas → `getImageData`.
2. `bench/lib/lineart.mjs` mide la imagen (`lineArtSignals`) y decide (`looksLikeLineArt`). Line art
   → binario con el Otsu de la propia imagen (`lineArtOptions`), trazado a 3× (`LINE_ART_SCALE`) y
   devuelto a la rejilla original, así que el motor ve un borde suave y no un escalón de píxel.
   Color → cuantizar en OKLab (`bench/lib/quantize.mjs`) y trazar con la paleta explícita a 1×. El
   selector permite forzar cualquiera de los caminos para comparar; el modo por defecto es el que
   deciden los números: line art → binario, color → `refit` (píxel + curvas). `curvas` es el perfil
   de corte. `fidelidad` usa el modo píxel del experimento 14 (sigue la frontera del
   raster en vez de ajustar curvas): en Gum Tree da 64 036 nodos, 167 KB y SSIM 0,9776 frente a
   0,9351 de las curvas, que es el 0,9808 de Vector Magic. `refit` ajusta curvas sobre esas mismas
   etiquetas (experimento 15): 11 527 nodos, 295 KB y 0,9766, verificado en Chromium en 1 216 ms.
3. Muestra nodos, rellenos, subpaths, tamaño, milisegundos, tamaño del lienzo y el motivo de la
   decisión (neutros, tinta, Otsu, separabilidad, aristas).
4. Descarga el SVG y una copia con unidades físicas. El motor emite `width`/`height` en píxeles y
   ningún `viewBox`, así que la versión en mm lo añade —`viewBox="0 0 3000 1200"`,
   `width="200mm"`, `height="80mm"`— sin tocar un solo comando del `d`.
5. Si se pide **quitar fondo**, la máscara entra antes de medir: el alfa de un PNG ya es la silueta
   y el motor la respeta; en un lienzo opaco la deduce `bench/lib/background.mjs` con un rellenado
   desde el borde (4-conexo, color semilla = moda del borde, tolerancia euclídea en sRGB).
6. El SVG se pinta **en línea** en el DOM y se puede editar: clic en una pieza → resaltado →
   **Borrar pieza** o **Borrar color** (todas las del mismo `fill`) → **Deshacer**. Las descargas
   salen ya editadas, y la versión en mm también.

Que la página decida en vez de preguntar no es un adorno: en K1 el preset binario da 31 490 nodos y
982 KB, y forzar la paleta da 178 246 nodos y 28 rellenos. Casi seis veces más nodos, y 28 rellenos en
vez de 1, para el mismo dibujo.

## Por qué hace falta `vtracer-web.mjs`

`@visioncortex/vtracer` publica el glue de `wasm-pack --target nodejs`. Ese fichero es universal
—`TextEncoder`, `TextDecoder`, `DataView`, `WebAssembly`, reflexión sobre objetos JS— salvo su
arranque, donde lee el `.wasm` del disco con `require('fs')` y `__dirname`. Importarlo tal cual en el
navegador no arranca, y reescribir sus 36 funciones `__wbg_*` sería duplicar el paquete entero.

El cargador descarga el glue, le corta el arranque de Node por la costura (`const wasmPath =`), lo
evalúa como módulo propio (Blob + `import`) para quedarse con `__wbg_get_imports` —el import object
que el `.wasm` pide: un módulo, `./vtracer_wasm_bg.js`, 36 funciones—, descarga
`vtracer_wasm_bg.wasm` e instancia con `WebAssembly.instantiate`. El `instantiate` asíncrono no es
una preferencia: `new WebAssembly.Module` sobre un buffer de más de 4 KB está prohibido en el hilo
principal de Chrome, y el motor pesa 653 KB, así que el camino síncrono del glue de Node no sirve
aquí. Después enlaza la instancia, llama a `__wbindgen_start()` y expone `vectorize_rgba` /
`vectorize_bytes` con las firmas de `index.d.ts`.

El paquete no se toca en disco: se lee tal cual se instaló. Si el glue cambia de forma y ya no tiene
la costura, el cargador falla con un mensaje explícito en vez de devolver un SVG a medias.

## Cero servidor

No hay backend, ni base de datos, ni red: el trazado ocurre en el wasm del navegador y la descarga
sale de un `Blob` en memoria. El servidor estático existe por dos motivos concretos:

- `file://` no permite `getImageData` sobre una imagen local (taint de CORS), así que la página
  necesita un origen http aunque sea local;
- el glue y el `.wasm` se cargan con `fetch` desde `/pkg/`.

CORS no aparece en ningún sitio: el glue y el `.wasm` son del mismo origen que la página, y los
píxeles salen de un canvas mismo-origen con una imagen que eligió el usuario.

## Verificación

Medido el 2026-10-28 con `ego-browser` (Chromium) sobre `bench/inputs/K1_drawing.jpg`, modo auto
(que resuelve a binario), servidor en `PORT=8789` porque el 8787 estaba ocupado. Los números de la
tabla son de la ronda del preset 1× anterior; con el preset actual (3× con `simplify` 1,2) el
navegador da **31 490 nodos, 982 KB y 3 323 ms**, y Node (`auto-trace.mjs`, mismo preset) 31 500
nodos y 982 KB.

| | nodos | rellenos | subpaths | tamaño | traza | lienzo |
| --- | --- | --- | --- | --- | --- | --- |
| **Navegador** (auto → binario) | **17 738** | 1 | 2 178 | 366 KB | 316–426 ms | 3000 × 1200 |
| **Node** (`auto-trace.mjs`, mismo preset) | **17 749** | 1 | 2 179 | 366 KB | 431 ms | 3000 × 1200 |

Los dos números no coinciden, y la causa está medida, no supuesta:

- El wasm, el preset y el umbral son idénticos (Otsu 135 → corte en 136 en ambos) y los dos caminos
  llaman a `vectorize_rgba`.
- Lo que cambia es el **decodificador de JPEG**. Los píxeles no son los mismos: hash FNV-1a del RGBA
  en el navegador `360 514 586`, en Node (jpeg-js) `43 761 062`; píxeles bajo el umbral, `466 868`
  en el navegador y `466 770` en Node. Esos 98 píxeles de 3 600 000 (0,003 %) están justo en el
  borde del umbral y mueven 11 nodos (0,06 %) y un subpath (2 178 frente a 2 179).
- `createImageBitmap` con `{ colorSpaceConversion: "none" }` y el camino de `<img>` dan exactamente
  los mismos píxeles que `createImageBitmap` a secas: no es gestión de color, es el decodificador.
- **Prueba de que el pipeline es el mismo**: un recorte de 700 × 500 de K1 guardado como PNG sin
  pérdida (píxeles idénticos para los dos) da, en Node y en el navegador, umbral 133, 67 958 píxeles
  de tinta, **2 705 nodos**, 1 relleno y 57 468 bytes. Con la misma entrada, el navegador y Node
  calculan lo mismo; lo único que cambia es lo que entrega el decodificador de JPEG.

Repetir el trazado devuelve el mismo número (17 738 dos veces, en binario), así que la página no
tiene ruido propio.

La otra rama, `bench/inputs/Gum Tree Vector.jpg` (ilustración):

| modo | nodos | rellenos | tamaño | traza |
| --- | --- | --- | --- | --- |
| auto → paleta (16 colores) | 6 093 | 14 | 155 KB | 479 ms |
| forzado binario | 1 151 | 1 | 27 KB | 117 ms |

Descargas comprobadas leyendo los ficheros guardados:

| fichero | `width` | `height` | `viewBox` | nodos |
| --- | --- | --- | --- | --- |
| `K1_drawing.svg` | `3000` | `1200` | — | 17 738 |
| `K1_drawing-200mm.svg` | `200mm` | `80mm` | `0 0 3000 1200` | 17 738 |

Capturas de esa ronda (fuera del repo, para no versionar binarios) en
`C:/Users/luis/ego/vekta-web-20261028-1720/`:

| fichero | qué enseña |
| --- | --- |
| `k1-trazado.png` | K1 con el preset binario: 17 738 nodos, 1 relleno, 366 KB, la decisión y la vista previa |
| `k1-descargas.png` | el mismo estado después de descargar el SVG y el SVG en mm |
| `gumtree-auto-paleta.png` | ilustración de color: auto → paleta, 6 093 nodos, 14 rellenos |
| `gumtree-binario-forzado.png` | la misma imagen con el modo binario forzado: 1 151 nodos, 1 relleno |

Los guiones de la ronda (`round-01.mjs` … `round-06.mjs`) están en esa misma carpeta; se lanzan con
`ego-browser nodejs < round-06.mjs`.

## Quitar el fondo

Hay dos casos y el código los trata distinto, porque son problemas distintos:

- **El PNG trae alfa de verdad.** No hay nada que decidir: `alphaHasTransparency` lo detecta, el
  selector de fondo se desactiva y el pipeline sigue con el alfa puesto. `quantize` ignora los
  píxeles con alfa bajo, `renderQuantized` los deja transparentes y vtracer **no genera geometría
  para ellos** (medido: una dona recortada da un `path`, no un rectángulo de lienzo). En la rama
  binaria el fondo transparente se compone sobre **papel blanco** en `lineArtSignals`, así que
  tampoco entra como tinta.
- **El lienzo es opaco** (JPG, PNG con fondo blanco). `backgroundMask` hace un rellenado desde los
  cuatro bordes con el color más frecuente del perímetro como semilla y una tolerancia euclídea en
  sRGB; `applyBackgroundMask` convierte esa máscara en alfa 0 y el resto del pipeline no cambia. La
  máscara se descarta si es una mota (< 0,5 % del lienzo) o si es la imagen entera (> 99,5 %): en
  los dos casos no hay sujeto que recortar, y es más honesto no quitar nada.

Esto es una **varita**, no un matte: elige un color de borde y lo propaga por conectividad. En un
fondo con degradado o en una foto con bokeh quita una parte y deja el resto, que es exactamente lo
que hace el balde de un editor de píxeles. Un recorte por IA es otro producto (Clipping Magic, el
hermano de Vector Magic) y no está en esta página.

## Editar el SVG

El motor ya entrega **una pieza por región**: un `<path fill="#rrggbb">` por cada segmento, en orden
de pintado. O sea que el mapa de segmentos que edita Vector Magic ya está en nuestro archivo, solo
que a nivel de path y no de píxel. Lo que faltaba era la vista:

- El SVG se pinta **en línea** (`innerHTML`), no en un `<img src=blob>`. Un `<img>` no expone sus
  paths al ratón, y sin eso no se puede saber qué pieza se tocó. El SVG lo genera nuestro wasm, no
  la red, así que `innerHTML` no abre ninguna puerta.
- `event.target.closest("path")` devuelve la pieza **de arriba** en ese punto: el hit-test del SVG
  respeta el orden de pintado, que es el mismo que usa el editor de la competencia.
- **Rellenar** con cualquier color que ya esté en el dibujo: un `<select>` con los colores y cuántas
  piezas tiene cada uno, y el botón aplica `fill` sobre la pieza seleccionada. Es la herramienta
  *Rellenar* de Vector Magic, y el selector se rehace después de cada edición (borrar un color lo
  saca de la lista).
- Al serializar se quitan los `<g>` que se quedaron **sin piezas**: si no, borrar un color deja un
  `fill` fantasma que las métricas cuentan como relleno y que aparece en el selector.
- **Borrar color** agrupa por el `fill` **efectivo**: en `refit`/`fidelidad` está en cada `path`, y
  en `curvas` en un `<g fill="#…">` (58 grupos en Gum Tree), así que se hereda hacia arriba. Sin
  eso todas las piezas de un grupo parecerían negras y «Borrar color» se llevaría el SVG entero.
  La comparación normaliza mayúsculas: `#DC1E1E` y `#dc1e1e` son el mismo color.
- El resaltado es un atributo `data-vk-sel` + CSS, y `serialize()` lo quita al clonar: lo que se
  descarga no lleva nada de la edición.
- Deshacer guarda SVG completos, con techo de 20 estados **y** 12 M caracteres: un trazado de foto
  ronda los 3,4 MB y veinte copias serían 68 MB de RAM en un móvil.

Una diferencia que conviene saber: en `refit`/`fidelidad` (stacked, el modo por defecto de color)
borrar **revela la capa de abajo**; en `curvas` (cutout, mosaico sin costuras) deja **agujero**
transparente. Las dos son correctas, pero para editar conviene stacked.

## Colores planos

Un dibujo plano guardado como JPEG trae, además de sus colores, la **rampa de antialiasing** de cada
contorno: una docena de tonos intermedios que la cuantización compra como colores propios. Con el
presupuesto gastado ahí, el blanco y el amarillo se funden en crema y el contorno sale tembloroso.

`bench/lib/quantize.mjs: flatPalette()` lo arregla en tres pasos: cuantiza fino (24), fusiona
duplicados y **absorbe los colores que son mezcla lineal de otros dos** (distancia a la recta en
OKLab). Un color plano pequeño no cae sobre esa recta y sobrevive; una rampa, sí. Devuelve además
`residual` —el error medio contra los píxeles visibles—, que es la señal que separa arte plano de
foto: 0,013–0,039 en plano, 0,083–0,093 en foto y degradado. El umbral es **0,06**
(`FLAT_RULES.maxResidual`).

El selector «colores» pasa a ser un **tope** que se aplica después de la poda (los colores vienen
ordenados por área), así que subirlo no inventa colores y bajarlo funde los más pequeños.

**El damero de transparencia se detecta solo.** Si el borde del lienzo reparte su superficie entre
dos tonos neutros (el damero que un JPEG guarda quemado), la página marca «quitar fondo» por su
cuenta, usa **dos semillas** y **crece la máscara 1 px** para comerse el fleco de mezcla del borde —
sin ese píxel, el fleco se convierte en 2 061 piezas de más (2 085 paths frente a 24).

## Borde blanco (die-cut)

La varita se lleva el damero y, con él, el borde blanco de la pegatina: es el mismo color que los
cuadros claros y está conectado al fondo. Para recuperarlo hay una casilla **borde blanco** y un
ancho en píxeles. El truco es un trazo, no geometría booleana (la unión vive en Clipper, que es de
Node): se clona cada pieza en un grupo blanco **por detrás** con un trazo centrado del doble del
ancho pedido, así que la mitad exterior del trazo es el margen y la interior queda tapada por el
dibujo que se pinta encima. Las esquinas salen redondeadas, como una pegatina troquelada.

**Lo que hay que saber**: el margen se pinta detrás de todo, así que un hueco —una pieza borrada o un
agujero del dibujo— se ve **blanco, no transparente**. Es el material de la pegatina; si lo que se
quiere es un agujero de verdad, el borde va apagado.

El borde no forma parte del dibujo editable: `state.svg` y el historial lo guardan sin él, y se
compone al descargar (el marcador `data-vk-diecut` no viaja al archivo). En las métricas tampoco
cuenta.

## Verificación del fondo y de la edición

Medido el 2026-10-28 con `ego-browser` (Chromium) sobre el servidor estático, con las imágenes del
banco. Todo lo de abajo es de la página real, no del banco:

| caso | qué se hizo | resultado |
| --- | --- | --- |
| `Gum Tree Vector.jpg` | sin tocar el fondo | 276 paths, 11 039 nodos, 14 rellenos, 277 KB, 1 078 ms |
| `Gum Tree Vector.jpg` | quitar fondo (`#f1dae0`, 31 %) | 296 paths, 11 003 nodos, 16 rellenos, 273 KB, 943 ms |
| `Gum Tree Vector.jpg` | borrar color `#f59495` (49 piezas) | 276 → **227 paths**, 11 039 → 9 920 nodos, 248 KB |
| `Gum Tree Vector.jpg` | modo `curvas`, borrar color `#f9eaed` (5 piezas en un `<g>`) | 279 → **274 paths**; deshacer vuelve a 279 |
| `alpha-donut.png` | PNG con alfa | 1 path, 83 nodos, 3 KB, 38 ms, «el PNG ya trae 55 % transparente» |
| anillo gris sobre PNG transparente | auto → binario | **1 path**, 431 nodos, 12 KB; caja 188 × 188 dentro de 240 × 240 |
| `K1_drawing.jpg` | auto → binario, con 1 061 paths en línea | listo en 3 648 ms; seleccionar 1 ms, borrar 5 ms, deshacer 7 ms |
| `yoshi.jpg` (JPEG con damero quemado) | auto → **plano**, fondo detectado solo | 24 paths, 863 nodos, 6 colores, 25 KB, 94 ms; fondo 49 % |
| `yoshi.jpg` | borrar la silla roja (pieza 15 de 24) | 24 → 23 paths, hueco transparente; deshacer vuelve |
| `yoshi.jpg` | rellenar la barriga (pieza 9 de 24) con el verde | `#fafbfa` → `#03a704`; deshacer vuelve |
| `yoshi.jpg` | borrar el rojo y descargar | 24 → 20 paths, 5 rellenos, **0** `#f03a1f`, 24 KB |
| `yoshi.jpg` | borde blanco 8 px | 24 piezas editables + 24 copias del halo; descarga con 48 paths y `stroke-width="16"` |
| `yoshi.jpg` | borde 20 px + borrar una pieza | el halo se recompone (23 + 23); el hueco queda blanco |
| `Gum Tree Vector.jpg` | auto → plano | 157 paths, 4 932 nodos, 129 KB (antes 276 / 11 039 / 277 KB) |
| `Gum Tree Vector.jpg` | plano + quitar fondo | 182 paths, 4 784 nodos, 125 KB, fondo 43 % |
| descargas tras editar | SVG y SVG en mm | 227 paths, **un solo `viewBox`**, 0 `data-vk-sel`, `200mm × 110.71mm` |

El anillo gris es la prueba del bug que se arregló: antes de componer el alfa sobre papel, ese mismo
PNG se clasificaba como «foto» (72 % de tinta, porque el fondo transparente es negro) y forzado a
binario trazaba el **rectángulo negro del lienzo completo**. Ahora se clasifica como line art y
emite un solo contorno.

Los tests nuevos son `bench/test/background.test.mjs` y `bench/test/lineart-alpha.test.mjs`; el
resto del banco sigue verde (164 → 176 tests).

## Pendiente

- **La varita no es un matte.** Fondo con degradado, bokeh o un marco de otro color: quita una
  parte y deja el resto. Se ve en `Cityscape Sunset_DFM3-01.jpg`, donde el color del borde es el
  marco rojo (9,3 % del lienzo) y no el cielo.
- **Borrar en modo `curvas` deja agujero**, no revela la capa de abajo: el cutout es un mosaico sin
  costuras. Si la edición es el flujo principal, conviene arrancar en `refit`.
- **Firefox y Safari sin probar.** La página depende de `createImageBitmap` (Safari 15+), de
  `import()` sobre una URL de Blob y de `WebAssembly.instantiate`; todo es estándar, pero estándar
  no es lo mismo que probado.
- **El trazado bloquea el hilo principal** mientras el wasm trabaja: K1 en binario son ~3,3 s (traza
  a 3×) y en paleta 6,7 s. No hay Worker todavía; el aviso de estado se pinta antes con dos
  `requestAnimationFrame`.
- **La diferencia de nodos con Node no se puede quitar** (11 con el preset 1× anterior, 10 con el
  3×) sin meter un decodificador de JPEG propio (jpeg-js en el navegador), que es una dependencia
  nueva y va contra la regla de esta página: cero dependencias, cero build.
- **La memoria del 3×**: el line art se traza sobre la imagen ampliada, así que 3,6 Mpx piden 32,4 Mpx
  de RGBA, unos 130 MB, más la luminancia intermedia. Por encima de ~8–10 Mpx conviene redimensionar
  antes de trazar; el color sigue a 1×.
- **Imágenes enormes en color**: todo el pipeline es de memoria (3,6 Mpx son 14 MB de RGBA más las
  copias del cuantizado). A 1×, por encima de ~20 Mpx conviene redimensionar antes.
