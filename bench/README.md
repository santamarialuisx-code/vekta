# Banco de pruebas — vtracer vs Vector Magic

Mide si `vtracer` puede sostener un producto frente a Vector Magic en el nicho de
corte/grabado: fidelidad, economía de nodos y limpieza de formas.

## Uso

```bash
npm install
npm run bench          # barrido principal: 4 imágenes × 8 variantes
npm run bench:sweep    # barrido fino de parámetros sobre Gum Tree
npm run bench:merge    # añade el barrido a metrics.json
npm run bench:serve    # servidor en http://127.0.0.1:8787/
npm run bench:cut      # informe de doble corte y geometría cortable (SVG/DXF, mm, kerf)
npm run bench:quantize # cuantización perceptiva en OKLab (antes de trazar)
npm run bench:pipeline # cuantizar → trazar, contra el trazado directo
npm run bench:sweep2   # barrido colores × simplify (calibración)
npm run bench:geometry # barrido de esquinas, splicing y longitud
npm run bench:knobs    # barrido de pathPrecision, filterSpeckle y layerDifference
npm run bench:bw       # barrido del modo binario (umbral fijo y adaptativo) para line art
npm run bench:auto     # decide la categoría por imagen y traza con su preset
npm run bench:classify # categoría, señales y preset por imagen, sin trazar
npm run bench:alpha    # silueta desde el alfa de un PNG (fixture: dona 400×400)
npm run bench:stroke   # línea central para grabado y plotter (esqueleto + RDP)
npm run bench:subpixel # muestreo subpíxel: barrido escala × simplify (1× y 3×)
npm test               # pruebas de geometría de corte, clasificación, alfa y línea central
```

El servidor es necesario porque el cálculo de SSIM/PSNR lee píxeles de `<canvas>`, y
`file://` marca el canvas como contaminado (CORS). Con `http://127.0.0.1` funciona.

## Páginas

| URL | Qué hace |
|---|---|
| `/compare.html?a=…&b=…` | Comparador lado a lado: vista completa + recorte ampliado |
| `/metrics.html` | SSIM/PSNR de cada SVG contra la imagen original |
| `/vmdiff.html` | SSIM/PSNR contra la salida real de Vector Magic |
| `/bw.html` | Modo binario: SSIM contra el original y F1 de la máscara de tinta |

`a` y `b` aceptan `orig`, `vm` o una ruta relativa a `bench/out/`
(p. ej. `sweep/stacked_cp6_ld16_sp4.svg`).

## Estructura

```
bench/
  inputs/              imágenes de prueba
  out/svg/             SVGs del barrido principal
  out/sweep/           SVGs del barrido fino
  out/metrics.json     métricas estructurales de todos
  out/vectormagic-gumtree.png   referencia: salida real de Vector Magic (1400×775)
  lib/variants.mjs     definición de imágenes y variantes
  lib/svg-metrics.mjs  nodos, paths, colores, tamaño
  lib/path-to-polyline.mjs  `d` → polilíneas con aplanado adaptativo de Bézier
  lib/svg-shapes.mjs   formas rellenas con herencia de `fill` y `fill-rule`
  lib/union.mjs        unión booleana y medición del doble corte
  lib/cut-svg.mjs      emisión de SVG de silueta y de capas
  lib/units.mjs        escala píxeles → milímetros
  lib/kerf.mjs         compensación de ancho de corte (ClipperOffset)
  lib/dxf.mjs          escritor DXF R2000 con unidades en mm
  lib/lineart.mjs      señales de imagen, umbral de Otsu y preset de line art
  lib/category.mjs     señales de categoría, cascada de decisión y presets por categoría
  lib/oklab.mjs        sRGB ↔ OKLab y ΔE
  lib/quantize.mjs     cuantización ponderada por área
  lib/image-io.mjs     decodificar JPG/PNG a RGBA y escribir PNG
  lib/lead.mjs         entrada y salida de herramienta (lead-in/out) sobre el anillo
  lib/nest.mjs         anidado por estantes en una hoja, con hueco y giro de 90°
  lib/spot.mjs         tintas: una capa por color, área y orden de impresión
  lib/alpha.mjs        alfa → máscara del sujeto → imagen binaria para el motor
  lib/skeleton.mjs     máscara de tinta, adelgazado Zhang–Suen y traza de la cresta
  lib/subpixel-transform.mjs  geometría pura: ampliado bilineal, reescalado del `d` y del SVG
  lib/subpixel.mjs     trazado subpíxel con el motor (`traceSubpixel`, `subpixelOptions`)
  quantize.mjs         CLI: paleta de N colores + informe de ΔE
  pipeline.mjs         CLI: cuantizar → trazar y comparar con el trazado directo
  pipeline-sweep.mjs   CLI: barrido maxColors × simplify
  geometry-sweep.mjs   CLI: barrido cornerThreshold × spliceThreshold × lengthThreshold
  knobs-sweep.mjs      CLI: barrido pathPrecision × filterSpeckle × layerDifference
  bw-sweep.mjs         CLI: barrido del modo binario (umbral fijo, Bradley–Roth, simplify)
  auto-trace.mjs       CLI: decisión por categoría y trazado con el preset que toca
  classify.mjs         CLI: tabla de decisión por imagen, sin trazar
  alpha-cut.mjs        CLI: silueta y DXF desde el alfa de un PNG
  stroke.mjs           CLI: línea central (`--tolerance`, `--only`, `--inputs`)
  subpixel-sweep.mjs   CLI: barrido escala × simplify del muestreo subpíxel
  cut.mjs              CLI: informe + SVG/DXF cortable (`npm run bench:cut`)
  test/                pruebas de geometría, corte, clasificación, alfa y línea central (`node --test`)
  run.mjs  sweep.mjs  merge-metrics.mjs  serve.mjs
  compare.html  metrics.html  vmdiff.html  bw.html
```

## Cómo se cuenta un «nodo»

Comandos de dibujo en el atributo `d` de cada `<path>`, excluyendo `Z`
(el cierre de subpath no es un punto que el usuario tenga que tocar). Un `C` de Bézier
cúbica cuenta como 1. Es la misma unidad que usa Vector Magic cuando presume de
«la cantidad correcta de nodos».

## Doble corte

Una salida por colores es **teselada**: cada borde interno pertenece a dos formas, así que la
máquina lo recorre dos veces. Vector Magic lo reconoce por escrito en su página de formatos.

- `outlineLength` (`R`): suma de todos los contornos tal como vienen en el SVG.
- `layerLength` (`L`): suma de los perímetros de la unión de cada capa de color. Es el recorrido
  real si se corta por capas (vinilo, DTF), donde cada color va en su propia lámina.
- `silhouetteLength` (`E`): perímetro de la unión de todas las formas, sin distinguir color.
  Es el mínimo para recortar la pieza.
- `uniqueCutLength` (`U = (E + L) / 2`): recorrido de una sola pasada con cada borde de color
  trazado una única vez.
- `redundancy = R / L` y `singlePassRedundancy = R / U`.

En una teselación perfecta `singlePassRedundancy → 2`,0: la mitad de los bordes se cortan dos
veces. El kernel es Clipper (`clipper-lib`): los ports JS del algoritmo de Martinez fallan con
los bordes casi coincidentes de un trazador real.

## Cuantización

`npm run bench:quantize` reemplaza el agrupamiento jerárquico por umbral de vtracer por **k-means
ponderado por área en OKLab**. La diferencia es decisiva: un color que ocupa 0,2 % o más de los
píxeles puede gastar una ranura; el ruido de un píxel no. Sobre Gum Tree con 16 colores, las
nubes (65 436 px casi blancos) quedan **98,5 % intactas**; con 8 colores se las come la paleta.

```
ΔE medio · p95 · colores de entrada
```

El informe queda en `out/quantize-report.json` y los PNG en `out/quantized/`.

## Calibración

`npm run bench:sweep2` barre `maxColors` × `simplify` sobre las 4 imágenes y mide SSIM en el
navegador. Regla de selección: el mayor `simplify` cuya caída de SSIM no pase de 0,005 respecto de
`simplify 0`, con la misma paleta. Resultado:

| Categoría | Paleta | `simplify` | Δ nodos |
|---|---:|---:|---:|
| Ilustración | 12 | 0,6 | −52 % |
| Poster | 16 | 0,8 | −53 % |
| Fotografía | 12 | 0,8 | −33 % |
| Line art | 16 | 1,2 | −27 % |

Ver [`../docs/experimento-04-calibracion.md`](../docs/experimento-04-calibracion.md).

## Geometría

`bench:geometry` y `bench:knobs` barren la superficie de parámetros geométricos. Resultado: los
umbrales mueven el SSIM **+0,0001 a +0,0002** — ruido. `cornerThreshold: 45` compra +0,0037 a cambio
de +3 % de nodos en ilustración y queda como opción, no como default. `filterSpeckle: 0` gana +0,018
con **19× nodos**, que ya no es vectorizar. El hueco de 0,032 frente a Vector Magic es de motor.

Ver [`../docs/experimento-05-geometria.md`](../docs/experimento-05-geometria.md).

## Line art y modo binario

`npm run bench:bw` barre el modo binario del motor, que hasta el experimento 07 estaba sin tocar.
Sobre el escaneo K1 el preset de aquel experimento (`clustering: 'bw'`, umbral de Otsu de la imagen,
`simplify` 0,8, trazado a 1×) pasa de
**174 451 nodos y 28 rellenos** a **17 749 nodos y 1 relleno**, con **+0,032 de F1 de tinta** y 20×
menos tiempo. El que se entrega hoy es el mismo preset muestreado a 3× (ver «Muestreo subpíxel»). El
adaptativo de Bradley–Roth pierde 0,019 de F1: con el fondo uniforme de un escaneo,
la media local ensucia el corte.

`bench/bw.html` mide con dos varas: SSIM contra el original (comparable con el resto de experimentos)
y **F1 de la máscara de tinta** al umbral de Otsu (la que describe un grabado). En una imagen de color
el F1 no avisa —Gum Tree da 0,9965 con el SSIM en 0,41—, así que la decisión la toma `lib/lineart.mjs`
con dos condiciones sobre la imagen: **≥ 90 % de píxeles neutros** y **≤ 40 % de tinta**.

```bash
npm run bench:auto
# gum-tree-vector    color     nodos= 6083  rellenos=15  ...  color: 24 % de píxeles neutros, mínimo 90 %
# k1-drawing         line-art  nodos=17749  rellenos= 1  ...  neutro (100 %) con 13 % de tinta
```

Ver [`../docs/experimento-07-bw-adaptativo.md`](../docs/experimento-07-bw-adaptativo.md).

## Pipeline

`npm run bench:pipeline` cuantiza y traza en la misma corrida, comparando contra el trazado
directo con las mismas opciones. Sobre las 4 imágenes: **−8 % a −37 % de nodos** con SSIM igual o
mejor, y las nubes del Gum Tree vuelven. La paleta se le pasa explícita a vtracer: si se le deja
agrupar de nuevo, deriva los colores y fragmenta el SVG.

Ver [`../docs/experimento-03-cuantizacion.md`](../docs/experimento-03-cuantizacion.md).

## Unidades, kerf y DXF

```bash
node bench/cut.mjs --width-mm 100 --kerf-mm 0.2 --format svg,dxf
```

Con `--width-mm` el SVG declara `width="100mm"` de verdad y las coordenadas pasan a mm. Con
`--kerf-mm` la trayectoria se compensa al radio de la herramienta: exteriores hacia fuera, agujeros
hacia dentro. `--format dxf` escribe DXF R2000 (`$INSUNITS = 4`) con una capa `CUT`, listo para
LightBurn/Inkscape/LibreCAD. Sin `--width-mm` se mantiene el modo en píxeles de siempre.

Ver [`../docs/experimento-06-dxf-kerf.md`](../docs/experimento-06-dxf-kerf.md).

## Salida cortable

`npm run bench:cut` mide las cuatro longitudes y emite dos SVG por entrada en `out/cut/`:

- `<nombre>--layers.svg`: un path por color, ya unificado. Es la salida para vinilo y DTF.
- `<nombre>--silhouette.svg`: un único path con la unión de todo. Es la pieza recortada.

El informe queda en `out/cut-report.json` e incluye el perímetro de **lo emitido**, releído del
archivo, para que la cifra no sea una promesa. Ver
[`../docs/experimento-02-salida-cortable.md`](../docs/experimento-02-salida-cortable.md).

## Clasificación por categoría

`npm run bench:classify` imprime categoría, señales y preset sin escribir un SVG; `bench:auto` decide y
traza. Las cuatro imágenes del banco caen donde las midió el experimento 04: ilustración 12 col / 0,6
(7 083 nodos), póster 16 / 0,8 (8 055), foto 12 / 0,8 (43 214) y line art en binario a 3× / 1,2
(31 500).

La regla es una **cascada de umbrales con motivo**, no un clasificador: line art por neutro ≥ 90 % y
tinta ≤ 40 %, foto por > 2 000 colores, entropía > 0,85 o gris sin ser line art, póster por croma medio
≥ 0,07, y el resto ilustración. Con cuatro imágenes no se calibra nada; el orden es la mitad de la
regla y cualquier cifra de acierto sobre estas cuatro sería circular.

Ver [`../docs/experimento-08-clasificacion.md`](../docs/experimento-08-clasificacion.md).

## Línea central

`npm run bench:stroke` adelgaza la máscara de tinta (Zhang–Suen), corta en los nodos y simplifica con
RDP. En K1 el mismo trazado pasa de **196 796 px de contorno a 114 956 px de cresta (−41,6 %)** con
**0 rellenos** (`stroke`, `fill="none"`), 21 621 nodos y 205 KB. A `--tolerance 2` los nodos bajan a
18 852 manteniendo el −42,4 % de recorrido.

El contorno de comparación se mide con el preset que se entrega (3× / 1,2), no con un trazado a 1× que
ya no sale del producto: por eso el contorno son 31 500 nodos y 982 KB, y no los 17 749 de antes. Se
gana en recorrido y también en nodos, y el precio está dicho: 8 587 polilíneas —un plotter levanta la
pluma 8 587 veces—, 19 % de espuelas de menos de 3 px, y sin eje medial: un bloque macizo colapsa a un
punto. SSIM y F1 quedan pendientes de una vara propia.

Ver [`../docs/experimento-09-linea-central.md`](../docs/experimento-09-linea-central.md).

## Archivo de producción

Banderas nuevas de `cut.mjs`: `--lead-mm` y `--lead-angle` (entrada y salida de herramienta),
`--nest` con `--sheet` y `--gap-mm`, y `--spot-names` para nombrar tintas en orden de impresión.
`--lead-mm` y `--nest` exigen `--width-mm`, y con ellas la silueta sale solo en DXF (una trayectoria
abierta no es un SVG relleno).

```bash
node bench/cut.mjs --only gum-tree-vector__cutout-opt --width-mm 100 --kerf-mm 0.2 \
    --lead-mm 2 --lead-angle 45 --format dxf
# recorrido 315,326 mm sobre 311,326 mm nominales: +4 mm = 2 × 2 mm de entrada
```

Dos piezas de 100×50 con 5 mm de hueco ocupan el 37,88 % de una hoja de 220×120. Sin las banderas
nuevas, el SVG y el DXF salen **idénticos byte a byte** a la versión anterior.

Ver [`../docs/experimento-10-produccion.md`](../docs/experimento-10-produccion.md).

## Alfa como línea de corte

`npm run bench:alpha` (o `node bench/alpha-cut.mjs --in pieza.png --width-mm 100 --kerf-mm 0.2`) emite
silueta SVG y DXF desde el alfa del PNG. Sobre la dona de 400×400: perímetro **1 573,32 px** contra
1 570,80 esperados (**+0,16 %**) y **70 672 px² de pieza frente a 160 000 del lienzo**, el 44,2 %.

Con fondo transparente la silueta deja de ser el rectángulo del lienzo, que era la limitación que el
experimento 02 no podía resolver. Un PNG con el 99,5 % o más de píxeles opacos no aporta forma y el CLI
sale con código 1 en vez de emitir el marco.

Ver [`../docs/experimento-11-alfa.md`](../docs/experimento-11-alfa.md).

## Muestreo subpíxel

`npm run bench:subpixel` amplía la imagen antes de decidir la tinta y devuelve la geometría a la
rejilla original. La escala y el `simplify` se barren por separado: el control del montaje es la fila
1× con `simplify` 0,8, que reproduce el SVG de `bw-sweep` del experimento 07 con el `d` idéntico.

El barrido cruza escala × `simplify` (`--scale 1,3` y `--simplify 0,0.4,0.8,1,1.2` por defecto;
`--all` para las cuatro imágenes en vez de solo las que el banco clasifica como line art). El JSON
tiene la forma de `bw-sweep.mjs` más `scale` y `simplify`, así que `/bw.html?json=out/subpixel-sweep.json`
lo mide sin cambios.

| K1 | Nodos | Tamaño | SSIM | F1 de tinta | Tiempo |
|---|---:|---:|---:|---:|---:|
| 1× con `simplify` 0,8 (preset anterior, referencia) | 17 749 | 366 KB | 0,8103 | 0,9436 | 380 ms |
| 1× sin simplificar (referencia de fidelidad) | 34 592 | 751 KB | 0,8116 | 0,9595 | 478 ms |
| **3× con `simplify` 1,2 (preset entregado)** | **31 500** | **982 KB** | **0,8348** | **0,9670** | **2 549 ms** |
| 3× sin simplificar (techo de F1 a 3×) | 100 983 | 3 128 KB | 0,8363 | 0,9773 | 2 893 ms |

El preset se queda en **3× con `simplify` 1,2**: con la regla del experimento 07 (F1 dentro de 0,016
del mejor de la malla) es la fila con menos nodos que cumple, y supera al 1× sin simplificar con menos
nodos que él. Frente al preset anterior cuesta +77 % de nodos y +168 % de bytes para +0,0234 de F1.

La escala y el `simplify` ya están cableados en `lib/lineart.mjs` (`LINE_ART_SCALE` y
`LINE_ART_PRESET.simplify`): de ahí los toman `auto-trace.mjs` (el informe lleva `subpixelScale`),
`classify.mjs` (lo imprime como `bw / 1,2 @3×`) y la demo del navegador. La escala es del muestreo, no
del motor: no viaja dentro de las opciones de `vtracer`.

Ver [`../docs/experimento-12-subpixel.md`](../docs/experimento-12-subpixel.md).

## Paridad en foto y póster

Dos renders nuevos de Vector Magic, extraídos de su visor a 1:1, permiten medir el hueco por categoría
con la misma vara de los experimentos 01–07:

| Categoría | Vekta vs original | Vector Magic vs original | Hueco |
|---|---:|---:|---:|
| Ilustración (Gum Tree) | 0,9351 | 0,9808 | 0,0457 |
| Póster (Cityscape) | 0,9518 | 0,9672 | 0,0154 |
| Foto (Ángel) | 0,6693 | 0,8267 | **0,1574** |

El 0,0325 del experimento 05 se reproduce exactamente y no es una constante: en póster es 0,015 y en
foto se multiplica por cinco. En foto el fallo es de modelo —el fondo desenfocado da 0,676 nuestro
contra 0,918 suyo, con 13 307 colores frente a 52 353— y no se arregla subiendo colores: 16 dieron
0,6658 y 12 dan 0,6693. Los nodos de Vector Magic no se pueden medir; su visor no los publica.

Ver [`../docs/experimento-13-vectormagic-foto.md`](../docs/experimento-13-vectormagic-foto.md).

## Resultado

Ver [`../docs/experimento-01-vtracer-vs-vectormagic.md`](../docs/experimento-01-vtracer-vs-vectormagic.md).
El índice de los trece experimentos está en [`../docs/README.md`](../docs/README.md).
