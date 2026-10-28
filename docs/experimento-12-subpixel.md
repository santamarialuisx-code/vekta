# Experimento 12 — muestreo subpíxel: estimar el borde donde está, no donde cae el píxel

> Fecha: 2026-10-28 · 4 escalas (1×, 2×, 3×, 4×) sobre `K1_drawing.jpg` con `simplify` 0,8, y
> después la malla escala × `simplify` (1× y 3× × 0 / 0,4 / 0,8 / 1 / 1,2), 10 SVGs.
> Nodos, tamaño, tiempo, **SSIM y F1 de tinta** medidos en `bench/bw.html` sobre los SVG emitidos.

---

## 1. Veredicto corto

**La hipótesis se confirma: el borde estaba cuantizado al píxel.** Trazar a 3× y devolver las
coordenadas a la rejilla original compra **+0,0286 de F1 de tinta** (0,9436 → 0,9722) y **+0,0256 de
SSIM**, con 2,4× nodos. La escala 4× ya no paga: +0,0004 de F1 por +22 % de nodos y +74 % de tiempo.
La [sección 9](#9-interacción-escala--simplify-el-preset-se-queda-en-3--12) cierra la interacción con
`simplify` y deja el preset en **3× con `simplify` 1,2**: F1 0,9670 con 31 500 nodos, que sigue por
encima del 1× sin simplificar y con menos nodos que él.

El montaje es honesto: la escala 1× reproduce el preset del experimento 07 **con la geometría
idéntica byte a byte** (17 749 nodos, el mismo `d`), así que lo que cambia a 2×, 3× y 4× es el
muestreo y nada más.

| K1 (3000×1200) | Nodos | Subpaths | Tamaño | Tiempo | SSIM | F1 de tinta |
|---|---:|---:|---:|---:|---:|---:|
| Escala 1× (preset, referencia) | 17 749 | 926 | 366 KB | 520 ms | 0,8103 | 0,9436 |
| Escala 2× | 28 891 | 1 061 | 875 KB | 1 493 ms | 0,8291 | 0,9545 |
| **Escala 3× (entregable)** | 41 918 | 1 111 | 1 325 KB | 3 742 ms | **0,8359** | **0,9722** |
| Escala 4× | 51 206 | 1 111 | 1 648 KB | 6 509 ms | 0,8369 | 0,9726 |

Los números que deciden son dos, y solo dos:

- **F1 de tinta** contra el umbral de Otsu de K1 (135). Referencia a batir: **0,9436**, el preset del
  experimento 07. Techo conocido del motor: **0,9957**, el modo `pixel`, que no ajusta curvas.
- **SSIM** contra el escaneo. Referencia: **0,8103**. Aquí el SSIM es una vara secundaria: premia
  reproducir el tono del papel y el gris del lápiz, que el modo binario tira a propósito.

Las tres lecturas posibles están redactadas en la sección 6; solo faltan los números.

---

## 2. Lo que **no** se barre aquí: los decimales

El experimento 05 ya cerró esa puerta y merece la pena repetirlo para que nadie la vuelva a abrir:

| `pathPrecision` | 2 | 3 | 5 | 8 |
|---|---|---|---|---|
| SSIM (Gum Tree) | 0,9373 | 0,9373 | 0,9373 | 0,9373 |

Salida **idéntica**. El `d` que emite el motor ya lleva sus decimales; subirlos no cambia nada
porque el error no está en cómo se escribe el número, está en **qué número se escribe**. El motor
decide «esto es tinta / esto es papel» sobre la rejilla de píxeles original, y de esa decisión sale
un vértice en el centro del píxel: un trazo de 1,5 px de ancho se convierte en un contorno de 2 px y
el antialiasing del escaneo se pierde.

Por eso este experimento ataca el **muestreo**: se amplía la imagen antes de decidir y la geometría
se devuelve a la rejilla original después. Los decimales de salida se quedan en 2 (`FIXED_DECIMALS`),
que a escala 4 representa el paso de 0,25 px con error ≤ 0,005 px: suficiente y barato en bytes.

---

## 3. Qué se ha construido

`bench/lib/subpixel-transform.mjs` (geometría pura, sin motor: la importa también `web/app.mjs`):

- **`upsampleLuminance(gray, width, height, scale)`** — interpolación bilineal con mapeo por centros
  de píxel (`origen = (destino + 0,5) / scale − 0,5`). El detalle no es cosmético: con ese mapeo la
  imagen ampliada ocupa exactamente el mismo rectángulo que la original, así que dividir la
  geometría por `scale` la devuelve al marco original **sin medio píxel de desplazamiento**. Los
  bordes se replican, para no inventar un marco oscuro en los extremos.
- **`subpixelFrame(signals, scale)`** — la imagen que ve el motor: la luminancia ampliada en RGBA
  gris opaco. Es el único paso que comparten el banco y el navegador.
- **`scalePathData(d, factor)`** — reescala todas las longitudes de un `d`: `M L H V C S Q T A`,
  absolutos y relativos, con las repeticiones implícitas (`M0 0 10 10`) expandidas al parsear. En
  `A` se multiplican **solo los radios y el punto final**: la rotación es un ángulo y `large-arc` /
  `sweep` son booleanos; multiplicarlos rompería el arco sin que el SVG dejara de ser válido.
  La salida va con redondeo fijo a 2 decimales, sin ceros de relleno y sin `-0`.
- **`rescaleSvg(svg, width, height, factor)`** — `viewBox`, `width` y `height` de la imagen de
  entrada y todos los `d` divididos por el factor.

`bench/lib/subpixel.mjs` (la mitad que necesita el motor):

- **`traceSubpixel(trace, signals, { scale, simplify })`** — amplía, traza con el trazador inyectado
  y devuelve la geometría al marco original. El trazador entra como argumento para que el mismo
  camino corra en Node y en el navegador.
- **`subpixelOptions(signals, { scale, simplify })`** — `traceSubpixel` con `vtracer.convertPixels` y
  el **umbral de Otsu de la imagen original** (la interpolación es lineal en intensidad, así que la
  rampa cruza el mismo nivel que cruzaba el borde duro).

`bench/subpixel-sweep.mjs`: el CLI, con el mismo modelo que `bw-sweep.mjs`. Barre escala × `simplify`
(`--scale 1,3 --simplify 0,0.4,0.8,1,1.2` por defecto) y por defecto solo las imágenes que el banco
clasifica como line art; `--all` fuerza las cuatro, que es una decisión explícita y no un accidente
del barrido.

---

## 4. El barrido sobre K1

`node bench/subpixel-sweep.mjs --only K1`. Preset del experimento 07 en todas las filas
(`mode: spline`, `hierarchical: cutout`, `optimize: 2`, `clustering: bw`, Otsu de la imagen,
`simplify: 0,8`). Lo único que cambia es la escala de muestreo. El barrido se corrió con
`--simplify 0.8` fijo porque era el preset entonces; la malla completa escala × `simplify` está en la
sección 9.

| Escala | Píxeles trazados | Nodos | Subpaths | Bytes | Tiempo |
|---:|---:|---:|---:|---:|---:|
| 1× | 3,60 Mpx | 17 749 | 926 | 374 774 | 520 ms |
| 2× | 14,40 Mpx | 28 891 | 1 061 | 896 277 | 1 493 ms |
| 3× | 32,40 Mpx | 41 918 | 1 111 | 1 356 458 | 3 742 ms |
| 4× | 57,60 Mpx | 51 206 | 1 111 | 1 687 457 | 6 509 ms |

Lectura de los números que ya se pueden leer:

- **La escala 1× no toca nada.** Comparado con `bw-sweep/k1-drawing__bw-otsu-simplify-0.8.svg`, el
  `d` es **idéntico** (misma longitud, mismo contenido) y los nodos también. Los 24 bytes de
  diferencia son el `viewBox="0 0 3000 1200"` que se añade para poder comparar contra el original.
  Es el control que faltaba: si el transform estuviera mal, la escala 1× lo delataría.
- **Los nodos crecen bastante menos que los píxeles.** A 2× hay 4× píxeles y 1,63× nodos; a 4× hay
  16× píxeles y 2,89× nodos. El motor no está calcando el mapa de bits ampliado: está encontrando un
  contorno y ajustándolo. Si la hipótesis es correcta, ese contorno es el mismo trazo pero colocado
  en su sitio; si es falsa, es el mismo trazo con más ondulación.
- **Los subpaths se estabilizan** (926 → 1 061 → 1 111 → 1 111). A partir de 3× no aparecen islas
  nuevas: lo que crece es la resolución del mismo contorno, no el número de trazos. Eso descarta de
  entrada una de las formas de fallar (inventar motas por interpolar el grano del papel).
- **El coste es cuadrático en píxeles y se nota**: 4× cuesta 12,5× tiempo y 4,5× bytes. Cualquier
  veredicto favorable a 4× tiene que venir acompañado de una escala menor que casi lo consiga, o el
  preset no es entregable.

---

## 5. Cómo se completa la medición

El JSON (`bench/out/subpixel-sweep.json`) lleva una fila por combinación con la misma forma que las
de `bw-sweep.mjs` (`imgSlug`, `config`, `kind`, `lineArt`, `fills`, `nodes`, `bytes`, `ms`…) más
`scale` y `simplify`, para que `bw.html` mida las dos mallas sin cambios. Con `npm run bench:serve` y
`/bw.html?json=out/subpixel-sweep.json`:

1. Cargar el original de K1 y cada SVG del barrido.
2. **F1 de tinta** con el corte en el Otsu de K1 (**135**), el mismo de la tabla del experimento 07.
3. **SSIM** contra el escaneo, con la misma ventana que los experimentos 01–11.

Referencias para leer el resultado sin equivocarse de vara:

| Referencia | SSIM | F1 de tinta |
|---|---:|---:|
| Preset line art (escala 1×, experimento 07) | 0,8103 | 0,9436 |
| Umbral fijo 144 (el mejor F1 del barrido del 07) | 0,8102 | 0,9549 |
| Modo `pixel` (techo del motor, sin curvas) | — | 0,9957 |
| Pipeline de color, 16 colores (lo que hacía antes) | 0,8591 | 0,9112 |

---

## 6. Veredicto: A, y se entrega a 3×

El umbral de la lectura A estaba en F1 > 0,9486. A 2× ya se supera (0,9545) y a 3× se dispara
(0,9722), con el SSIM subiendo en vez de cayendo (0,8103 → 0,8359). **El borde estaba cuantizado al
píxel: dónde cae la rejilla decidía el contorno.**

| Escala | Nodos | SSIM | F1 | Precisión | Exhaustividad | Bytes | Tiempo |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1× | 17 749 | 0,8103 | 0,9436 | 0,942 | 0,945 | 366 KB | 520 ms |
| 2× | 28 891 | 0,8291 | 0,9545 | 0,930 | 0,980 | 875 KB | 1 493 ms |
| **3×** | 41 918 | **0,8359** | **0,9722** | 0,957 | 0,988 | 1 325 KB | 3 742 ms |
| 4× | 51 206 | 0,8369 | 0,9726 | 0,955 | 0,991 | 1 648 KB | 6 509 ms |

La fila 3× de esta tabla es con `simplify` 0,8, heredado del preset del experimento 07: mide la escala
sola. El preset que se entrega lo fija la sección 9, en 3× con `simplify` 1,2.

**Se entrega 3×**, que es donde se cruzan las tres lecturas:

- **Fidelidad**: 3× → 4× gana 0,0010 de SSIM y 0,0004 de F1 por +22 % de nodos, +24 % de bytes y
  +74 % de tiempo. No se paga.
- **Equilibrio precisión/exhaustividad**: a 2× el trazo se afina de más (precisión 0,930 con
  exhaustividad 0,980: se pierde tinta donde el original la tiene); a 3× se recuperan las dos
  (0,957 / 0,988). 2× no es solo más barato: es peor.
- **Contra el resto del banco**: 3× da más F1 (0,9722) que el modo binario sin simplificar (0,9595) y
  que el mejor umbral fijo (0,9549), con 41 918 nodos — cuatro veces menos que el pipeline de color
  (174 451) y bastante mejor fidelidad de tinta que él (0,9112).

Leído contra el hueco del experimento 05: **el muestreo vale 0,026 de SSIM en line art**, el mismo
orden de magnitud que los 0,0325 que separaban al pipeline de color de Vector Magic en la ilustración.
No es la misma imagen ni la misma categoría, así que no se puede decir que «se cierra el hueco»: se
puede decir que **la primera palanca real que aparece en todo el banco para ese hueco es el muestreo,
no los parámetros ni la curva.** Falta probarlo en color, que es donde el 0,032 está medido contra el
render real del competidor.

## 7. Limitaciones

- **Medido en una sola imagen.** K1 es el único line art del banco y el único caso de esta tabla. Las
  otras tres (Gum Tree, Cityscape, Ángel) están en el CLI (`--all`) pero **no se han corrido por
  coste y porque el barrido subpíxel solo tiene sentido donde el borde es tinta sobre papel**.
- **El SSIM y el F1 se midieron una sola vez por escala**, con la misma implementación de canvas que
  los experimentos 01–07 (ventanas 8×8). La diferencia 3× → 4× (0,001) está dentro del ruido de esa
  varilla; la de 1× → 3× (0,026) no lo está.
- **La interpolación bilineal suaviza el grano del papel.** Sobre un escaneo con textura, la rampa
  de gris puede mover el corte dentro del grano. El barrido no lo mide; el F1 lo dirá, porque una
  máscara de tinta inventada baja la precisión.
- **El techo de 0,9957 del modo `pixel` no es alcanzable con curvas.** Aunque la hipótesis se
  confirme, el hueco hasta 1,0 es el precio de convertir píxeles en curvas, no un defecto.
- **Medido en un solo hilo y una sola máquina.** Los tiempos son comparables entre filas (misma
  sesión, una detrás de otra) pero no con los de otros experimentos: el 520 ms de la escala 1× es el
  mismo trabajo que los 330 ms del experimento 07, no un empeoramiento.
- **El 3× multiplica nodos, bytes y memoria.** Frente al preset de 1× cuesta +77 % de nodos y +168 %
  de bytes (sección 9). En K1 son 32,4 Mpx de RGBA ampliado, unos 130 MB, más la luminancia
  intermedia que se calcula para llegar ahí. Con imágenes grandes el presupuesto de memoria es la
  primera pared, antes que el tiempo.
- **El barrido sigue midiendo un solo line art del banco.** La malla escala × `simplify` de la
  sección 9 son diez filas de K1, no diez imágenes: el resto del banco está en el CLI (`--all`) pero
  no se ha corrido.

---

## 8. Siguiente

1. **Probar el muestreo en el pipeline de color** (Gum Tree), que es donde el hueco de 0,032 está
   medido contra el render real de Vector Magic. Es la prueba que decide si esto es una palanca
   general o solo de line art. Sigue pendiente: el 3× se entregó para line art.
2. **Conseguir más line arts reales.** La decisión de la sección 9 se sostiene con una sola imagen;
   hacen falta escaneos con otro trazo, otro papel y otro ruido para saber si el codo en 3× / 1,2 se
   mueve con la imagen o es del motor.

---

## 9. Interacción escala × `simplify`: el preset se queda en 3× / 1,2

La sección 6 fijó la escala con el `simplify` 0,8 que venía del experimento 07, sin barrer las dos
perillas a la vez. `bench/subpixel-sweep.mjs` ya barre escala × `simplify`
(`--scale 1,3 --simplify 0,0.4,0.8,1,1.2` por defecto) y emite una fila por combinación con la forma
que usa `bw-sweep.mjs`, así que `bench/bw.html` mide la malla entera sin cambios. Diez filas sobre K1
(3000×1200, Otsu 135), con SSIM y F1 de tinta medidos sobre los SVG emitidos; el JSON está en
`bench/out/subpixel-sweep.json`.

| Escala | `simplify` | Nodos | Tamaño | Tiempo | SSIM | F1 de tinta | Precisión | Exhaustividad |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1× | 0 | 34 592 | 751 KB | 478 ms | 0,8116 | 0,9595 | 0,9572 | 0,9619 |
| 1× | 0,4 | 22 854 | 491 KB | 450 ms | 0,8124 | 0,9566 | 0,9542 | 0,9590 |
| 1× | 0,8 | 17 749 | 366 KB | 380 ms | 0,8103 | 0,9436 | 0,9423 | 0,9449 |
| 1× | 1 | 16 314 | 328 KB | 361 ms | 0,8086 | 0,9375 | 0,9374 | 0,9377 |
| 1× | 1,2 | 15 582 | 309 KB | 353 ms | 0,8060 | 0,9326 | 0,9326 | 0,9325 |
| 3× | 0 | 100 983 | 3 128 KB | 2 893 ms | 0,8363 | 0,9773 | 0,9633 | 0,9918 |
| 3× | 0,4 | 61 671 | 1 975 KB | 3 119 ms | 0,8362 | 0,9754 | 0,9609 | 0,9904 |
| 3× | 0,8 | 41 918 | 1 325 KB | 2 733 ms | 0,8359 | 0,9722 | 0,9571 | 0,9878 |
| 3× | 1 | 35 862 | 1 125 KB | 2 594 ms | 0,8354 | 0,9697 | 0,9544 | 0,9855 |
| **3×** | **1,2** | **31 500** | **982 KB** | **2 549 ms** | 0,8348 | 0,9670 | 0,9510 | 0,9836 |

Lectura de la malla:

- **La curva de `simplify` no es la misma en las dos escalas, y no se pueden comparar sin decirlo.**
  A 1× cada paso de `simplify` cuesta F1 casi linealmente: 1,2 da 0,9326, que es peor que el preset
  0,8 del experimento 07 (0,9436) y por eso aquel preset se quedó en 0,8. A 3× la curva es mucho más
  plana: el mismo 1,2 da 0,9670 porque el contorno viene de un muestreo más fino y pierde menos al
  simplificarse.
- **Entre 0,8 y 1,2 a 3× se cambia −0,0052 de F1 por −25 % de nodos.** De 41 918 a 31 500 nodos, sin
  SSIM apreciable de por medio (0,8359 → 0,8348).
- **El techo de la malla está en 3× sin simplificar** (F1 0,9773, 100 983 nodos). Es el mejor número
  de tinta de todo el experimento y también el más caro: 2 893 ms y 3 128 KB.
- **El 3× no regala nada a 1×.** La mejor fila de 1× (0,9595 sin simplificar) queda por debajo de la
  fila que se entrega, y con más nodos: 34 592 frente a 31 500.

**Decisión: 3× con `simplify` 1,2.** Se aplica la regla del experimento 07 —pocos nodos, con el F1
como restricción, no como objetivo—: el mejor F1 de la malla es 0,9773, el suelo queda en 0,9613
(0,016 por debajo) y 1,2 da 0,9670, que es la fila con menos nodos que lo cumple.

Los argumentos, con el coste al lado:

- **Contra la referencia de fidelidad equivalente, el 3× se paga solo en nodos.** 3× con 1,2 supera
  al 1× sin simplificar en F1 (0,9670 frente a 0,9595) y a la vez usa menos nodos que él (31 500
  frente a 34 592). Frente a esa referencia, el muestreo no cuesta nada que no sea el tiempo y el
  tamaño del archivo.
- **Contra el preset viejo, sí cuesta.** Frente a 1× con 0,8 —que era una elección de economía de
  nodos— el preset entregado cuesta +77 % de nodos y +168 % de bytes para +0,0234 de F1
  (0,9436 → 0,9670) y +0,0245 de SSIM (0,8103 → 0,8348). Es el precio real del entregable y no se
  esconde: quien quiera el archivo más pequeño que se quede en 1× 0,8 y sepa qué F1 está dejando.
- **El 4× sigue fuera.** La sección 6 midió que 4× añade 0,0004 de F1 por +22 % de nodos y +74 % de
  tiempo; con `simplify` 1,2 a 3× el F1 ya está a 0,0103 del techo de la malla (0,9773) y con menos
  de un tercio de sus nodos, así que no hay razón para pagar esa escala.

Las dos perillas están en el preset: `LINE_ART_SCALE = 3` y `LINE_ART_PRESET.simplify = 1,2` en
`bench/lib/lineart.mjs`. De ahí las toman los CLI —`bench/auto-trace.mjs`, que anota `subpixelScale`
en el informe, y `bench/classify.mjs`, que imprime `bw / 1,2 @3×`— y la demo (`web/app.mjs`, que traza
el line art a 3× importando solo la parte pura, `bench/lib/subpixel-transform.mjs`). La escala no viaja
dentro de las opciones del motor, que no la conoce: la compone `bench/lib/subpixel.mjs`.
