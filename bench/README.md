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
npm run bench:cut      # informe de doble corte y SVG cortable
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

## Salida cortable

`npm run bench:cut` mide las cuatro longitudes y emite dos SVG por entrada en `out/cut/`:

- `<nombre>--layers.svg`: un path por color, ya unificado. Es la salida para vinilo y DTF.
- `<nombre>--silhouette.svg`: un único path con la unión de todo. Es la pieza recortada.

El informe queda en `out/cut-report.json` e incluye el perímetro de **lo emitido**, releído del
archivo, para que la cifra no sea una promesa. Ver
[`../docs/experimento-02-salida-cortable.md`](../docs/experimento-02-salida-cortable.md).

## Resultado

Ver [`../docs/experimento-01-vtracer-vs-vectormagic.md`](../docs/experimento-01-vtracer-vs-vectormagic.md).
