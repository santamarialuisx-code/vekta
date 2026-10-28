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
  run.mjs  sweep.mjs  merge-metrics.mjs  serve.mjs
  compare.html  metrics.html  vmdiff.html
```

## Cómo se cuenta un «nodo»

Comandos de dibujo en el atributo `d` de cada `<path>`, excluyendo `Z`
(el cierre de subpath no es un punto que el usuario tenga que tocar). Un `C` de Bézier
cúbica cuenta como 1. Es la misma unidad que usa Vector Magic cuando presume de
«la cantidad correcta de nodos».

## Resultado

Ver [`../docs/experimento-01-vtracer-vs-vectormagic.md`](../docs/experimento-01-vtracer-vs-vectormagic.md).
