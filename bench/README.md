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
npm run bench:auto     # decide por imagen (line art o color) y traza con el preset que toca
npm test               # pruebas de geometría de corte
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
  lib/oklab.mjs        sRGB ↔ OKLab y ΔE
  lib/quantize.mjs     cuantización ponderada por área
  lib/image-io.mjs     decodificar JPG/PNG a RGBA y escribir PNG
  quantize.mjs         CLI: paleta de N colores + informe de ΔE
  pipeline.mjs         CLI: cuantizar → trazar y comparar con el trazado directo
  pipeline-sweep.mjs   CLI: barrido maxColors × simplify
  geometry-sweep.mjs   CLI: barrido cornerThreshold × spliceThreshold × lengthThreshold
  knobs-sweep.mjs      CLI: barrido pathPrecision × filterSpeckle × layerDifference
  bw-sweep.mjs         CLI: barrido del modo binario (umbral fijo, Bradley–Roth, simplify)
  auto-trace.mjs       CLI: decisión line art / color y trazado con el preset
  cut.mjs              CLI: informe + SVG cortable (`npm run bench:cut`)
  test/                pruebas de la geometría de corte (`node --test`)
  run.mjs  sweep.mjs  merge-metrics.mjs  serve.mjs
  compare.html  metrics.html  vmdiff.html
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
Sobre el escaneo K1 el preset (`clustering: 'bw'`, umbral de Otsu de la imagen, `simplify` 0,8) pasa de
**174 451 nodos y 28 rellenos** a **17 749 nodos y 1 relleno**, con **+0,032 de F1 de tinta** y 20×
menos tiempo. El adaptativo de Bradley–Roth pierde 0,019 de F1: con el fondo uniforme de un escaneo,
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

## Resultado

Ver [`../docs/experimento-01-vtracer-vs-vectormagic.md`](../docs/experimento-01-vtracer-vs-vectormagic.md).
