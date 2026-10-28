# Trazador en el navegador

Página sin build que convierte una imagen local en SVG con el wasm de vtracer. Todo pasa en el
cliente: no se sube nada, no hay API, no hay estado guardado entre visitas. Son tres ficheros —
`index.html`, `app.mjs`, `vtracer-web.mjs`— y ninguno se compila.

## Abrirla

```bash
npm run bench:serve
# → http://127.0.0.1:8787/web/index.html
```

Si el puerto está ocupado: `PORT=8789 npm run bench:serve` (el servidor imprime sus URLs al
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
   → binario con el Otsu de la propia imagen (`lineArtOptions`). Color → cuantizar en OKLab
   (`bench/lib/quantize.mjs`) y trazar con la paleta explícita. El selector permite forzar
   cualquiera de los dos caminos para comparar; el modo por defecto es el que deciden los números.
3. Muestra nodos, rellenos, subpaths, tamaño, milisegundos, tamaño del lienzo y el motivo de la
   decisión (neutros, tinta, Otsu, separabilidad, aristas).
4. Descarga el SVG y una copia con unidades físicas. El motor emite `width`/`height` en píxeles y
   ningún `viewBox`, así que la versión en mm lo añade —`viewBox="0 0 3000 1200"`,
   `width="200mm"`, `height="80mm"`— sin tocar un solo comando del `d`.

Que la página decida en vez de preguntar no es un adorno: en K1 el preset binario da 17 738 nodos y
1 relleno, y forzar la paleta da 178 246 nodos y 28 rellenos. Diez veces más trabajo y veinte veces
más peso para el mismo dibujo.

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
(que resuelve a binario), servidor en `PORT=8789` porque el 8787 estaba ocupado:

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

## Pendiente

- **Firefox y Safari sin probar.** La página depende de `createImageBitmap` (Safari 15+), de
  `import()` sobre una URL de Blob y de `WebAssembly.instantiate`; todo es estándar, pero estándar
  no es lo mismo que probado.
- **El trazado bloquea el hilo principal** mientras el wasm trabaja: K1 en binario son ~0,3 s y en
  paleta 6,7 s. No hay Worker todavía; el aviso de estado se pinta antes con dos `requestAnimationFrame`.
- **La diferencia de 11 nodos con Node no se puede quitar** sin meter un decodificador de JPEG
  propio (jpeg-js en el navegador), que es una dependencia nueva y va contra la regla de esta
  página: cero dependencias, cero build.
- **Imágenes enormes**: todo el pipeline es de memoria (3,6 Mpx son 14 MB de RGBA más las copias del
  cuantizado). Por encima de ~20 Mpx conviene redimensionar antes.
