# Experimento 14 — el hueco de color es el ajuste de curvas, no el muestreo

> Fecha: 2026-10-28 · Gum Tree (ilustración, 1400×775), Cityscape (póster, 1400×980) y Ángel (foto,
> 1050×700). SSIM y PSNR sobre luminancia, ventanas 8×8, stride 8, medidos en `bench/bw.html` sobre
> los SVG emitidos; la referencia del competidor son los renders de Vector Magic del experimento 13.
> Todo reproducible con `pnpm bench:fidelity` y `bench/color-subpixel.mjs`.

---

## 1. Veredicto corto

**El hueco de color no era de muestreo ni de paleta: era el ajuste de curvas.** Trazando píxel a píxel
(`mode: pixel`, sin Béziers) el SSIM pasa de **0,9351 a 0,9776** en ilustración y de **0,9518 a
0,9631** en póster —a 0,0032 y 0,0041 del render de Vector Magic (0,9808 / 0,9672)— y en foto de
**0,6693 a 0,8365**, por encima del competidor (0,8267). El precio es geométrico, no de fidelidad:
los bordes son escalones de píxel y el archivo tiene muchos más segmentos (aunque pesa menos).

Las otras tres palancas se midieron y **no** cierran el hueco:

- **Subpíxel en color** (el hallazgo del experimento 12 en line art): empeora el SSIM en las tres
  variantes (−0,014 a −0,021). El borde de color no está cuantizado al píxel como el de tinta.
- **Profundidad de paleta**: 96 colores dan +0,0045 en ilustración y +0,0012 en póster; en foto bajan
  el SSIM en modo curvas. La ilustración no tiene más regiones que gastar.
- **Perillas de segmentación y curvatura**: `watershed` pierde, `polygon` pierde, `cornerThreshold` y
  `colorPrecision` no mueven nada. El mejor modo curvas posible queda en 0,9577 con 18 561 nodos.

---

## 2. Qué se midió y con qué vara

Tres modos de entrega sobre el mismo pipeline (`quantize` OKLab → `renderQuantized` → trazado con la
paleta explícita):

| Modo | Qué hace | Para qué sirve |
|---|---|---|
| `curvas` | `mode: spline` + `hierarchical: cutout` | cortar y escalar: pocos nodos, bordes limpios |
| `fidelidad` | `mode: pixel` (sin ajuste de curvas) | reproducir el raster: grabado, impresión, referencia |
| — | `mode: polygon`, `watershed`, `simplify 0`, `filterSpeckle 0`, `cornerThreshold 45` | barridos de control |

`pnpm bench:fidelity` emite los SVG y el JSON que `bw.html` rasteriza y compara contra el original
con la misma implementación de los experimentos 01–13.

### Resultado

| Imagen | Modo | Paleta | Rellenos | Nodos | Tamaño | SSIM vs original | PSNR | Vector Magic |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Gum Tree (ilustración) | `curvas` | 12 | 11 | 7 083 | 181 KB | 0,9351 | 31,04 | 0,9808 |
| Gum Tree (ilustración) | **`fidelidad`** | 12 | 11 | 64 036 | **167 KB** | **0,9776** | **34,43** | 0,9808 |
| Cityscape (póster) | `curvas` | 16 | 16 | 8 055 | 171 KB | 0,9518 | 31,07 | 0,9672 |
| Cityscape (póster) | **`fidelidad`** | 16 | 16 | 21 614 | **63 KB** | **0,9631** | 31,73 | 0,9672 |
| Ángel (foto) | `curvas` | 12 | 12 | 43 214 | 856 KB | 0,6693 | 25,31 | 0,8267 |
| Ángel (foto) | **`fidelidad`** | 24 | 23 | 367 032 | 1 153 KB | **0,8365** | 29,22 | 0,8267 |

Lectura: en ilustración y póster el modo fidelidad queda **por debajo del competidor por menos de
medio punto de SSIM** y con archivos más pequeños. En foto lo supera por casi un punto. La foto paga
el precio en nodos (367 032) porque el detalle tonal que Vector Magic consigue con su presupuesto
adaptativo aquí se compra con muchas regiones pequeñas.

---

## 3. Lo que se probó y no funcionó

### 3.1 Subpíxel en color (Gum Tree, 3×)

| Variante | Nodos | Tamaño | SSIM | PSNR |
|---|---:|---:|---:|---:|
| `baseline` 1× (control) | 7 083 | 181 KB | **0,9351** | **31,04** |
| `render` 3× (ampliar el render cuantizado) | 66 408 | 1 991 KB | 0,9215 | 28,41 |
| `source` 3× (ampliar la imagen y asignar la paleta 1×) | 52 493 | 1 649 KB | 0,9139 | 29,29 |
| `full` 3× (cuantizar también a 3×) | 53 637 | 1 698 KB | 0,9202 | 29,54 |

En line art el subpíxel compró +0,026 porque el motor decidía tinta/papel sobre una rejilla y el borde
real caía entre píxeles. En color la decisión es «¿a qué color de la paleta pertenece este píxel?»: al
ampliar, la rampa interpolada se vuelve a cuantizar en bandas de un tercio de píxel, y el trazado
persigue esas bandas. Se gana colocación y se pierde limpieza: el PSNR cae 2,6 dB. **El borde de color
no estaba cuantizado al píxel**, así que la palanca no aplica.

### 3.2 Profundidad de paleta (1×, modo curvas)

| Imagen | 12 col | 24 col | 48 col | 96 col |
|---|---:|---:|---:|---:|
| Gum Tree | 0,9351 (11 rell.) | 0,9382 (20) | 0,9396 (21) | 0,9396 (21) |
| Cityscape | 0,9496 (12) | 0,9491 (20) | 0,9504 (24) | 0,9508 (25) |
| Ángel | 0,6693 (12) | 0,6576 (23) | 0,6517 (49) | 0,6438 (85) |

La ilustración **no tiene** más de ~21 regiones que gastar (el cuantizador descarta clústeres sin
área); en foto, más colores con curvas incluso empeoran el SSIM. Coincide con el experimento 13:
Vector Magic usa *menos* colores distintos que nosotros en ilustración y aun así gana.

### 3.3 Perillas de vtracer (Gum Tree, 12 colores, `simplify` 0,6)

| Configuración | Nodos | SSIM | PSNR |
|---|---:|---:|---:|
| `cutout` + spline (preset, control) | 7 083 | 0,9351 | 31,04 |
| `stacked` + spline | 5 842 | 0,9452 | 30,16 |
| `cutout` + `polygon` | 16 073 | 0,9391 | 24,48 |
| `cutout` + `filterSpeckle 0` | 85 661 | 0,9545 | 32,98 |
| `stacked` + `filterSpeckle 0` | 14 316 | 0,9526 | 30,57 |
| `watershed` (detalle 128) | 4 261 | 0,8843 | 24,01 |
| `watershed` 256 | 7 072 | 0,9376 | 31,23 |
| `stacked` + `filterSpeckle 0` + `simplify 0` + `cornerThreshold 45` | 18 561 | **0,9577** | 31,01 |
| `colorPrecision 8` | 5 842 | 0,9452 | 30,16 |

`stacked` es una mejora gratis en ilustración (−17 % nodos y +0,0101 SSIM) pero **pierde en póster**
(0,9442 frente a 0,9518), así que no se adopta como preset. `colorPrecision` no cambia nada, igual que
`pathPrecision` en el experimento 05. El techo del modo curvas, juntando todo lo que suma, es 0,9577:
**0,023 por debajo de Vector Magic y con 2,6× los nodos del preset.**

### 3.4 Modo píxel con variantes

| Variante (Gum Tree) | Nodos | SSIM |
|---|---:|---:|
| `pixel` | 59 519 | 0,9774 |
| `pixel` + `filterSpeckle 2` (lo que se entrega) | 64 036 | **0,9776** |
| `pixel` + `filterSpeckle 0` | 134 296 | 0,9939 |

`filterSpeckle 0` **supera** a Vector Magic (0,9939) pero duplica los nodos y el peso: no compensa como
entrega. El punto que se queda es `pixel` con el filtro por defecto suavizado a 2.

---

## 4. Por qué Vector Magic gana donde gana

Recopilado de sus propias páginas y del análisis del experimento 13:

- **Su diferencial declarado es el borde subpíxel a través del antialiasing**: «slicing each edge pixel
  at precisely the right spot» (portada) y «the edges in the vector image slice right through the
  anti-aliasing in the original bitmap» (`/support/tutorials/artwork-logos`).
- **Segmentación alineada al píxel, suavizado después**: su editor trabaja sobre «a coarse,
  pixel-aligned version of the vector image» que luego se suaviza. Es exactamente la arquitectura que
  nuestros números piden: etiquetas fieles al píxel + curvas encima. Nosotros tenemos la primera
  (`pixel`) y la segunda (`spline`) por separado.
- **En foto, presupuesto de color dirigido por error**: «as many colors as the algorithm deems
  necessary to achieve a certain approximate error» (`/support/tutorials/photos`). Eso explica sus
  52 353 colores distintos en el render del Ángel y por qué nuestro 24 fijo se queda corto en nodos.
- **No hay patente localizable** del método (búsqueda negativa en Google Patents para la empresa y los
  inventores) ni gradientes en su vocabulario de producto: «shape-based artwork», relleno plano.

No hay magia inalcanzable: hay dos etapas bien hechas y una de ellas (ajustar curvas sobre etiquetas
de píxel) es la que nos falta.

---

## 5. Lo que se entrega

- `bench/lib/color-presets.mjs`: dos modos con nombre —`curvas` (spline, el de siempre) y `fidelidad`
  (píxel)— y la paleta del modo fidelidad por categoría (ilustración 12, póster 16, **foto 24**).
- `bench/color-fidelity.mjs` (`pnpm bench:fidelity`): reproduce la tabla de la sección 2.
- `bench/auto-trace.mjs --fidelity`: el camino de producto puede entregar el modo fidelidad; el
  informe lleva `mode` y el line art no cambia.
- `web/app.mjs`: el selector gana «fidelidad (píxel a píxel)»; el modo por defecto sigue decidiéndose
  por la imagen.
- **El preset por defecto no cambia**: `curvas`. El modo fidelidad es para grabado, impresión y
  comparación con el raster; para cortar y escalar, las curvas de siempre.

---

## 6. Limitaciones

- **El SSIM premia reproducir el raster**, no la calidad vectorial: un borde escalonado que sigue el
  antialiasing puntúa más que una curva limpia que se separa medio píxel. Este experimento mide
  fidelidad de píxel, y por eso el veredicto se publica junto al número de nodos y al uso previsto.
- **Ningún modo se juzgó a escala.** Falta un recorte 3× de los dos modos para ver el escalón del modo
  píxel y el temblor del modo curvas al ampliar. Es la prueba que decide cuál es el defecto visible.
- **Tres imágenes**, las mismas del banco: una ilustración, un póster y una foto. La conclusión de
  ilustración no se generaliza con una sola imagen.
- **La foto en modo fidelidad cuesta 367 032 nodos.** Es fiel, pero un DXF de ese tamaño no es de
  taller: para foto sigue faltando el presupuesto tonal adaptativo del competidor.
- **El modo fidelidad no es cortable.** Segmentos de píxel y escalones: sirve para grabado e
  impresión, no para cuchilla ni para ampliar sin pérdida visible.

---

## 7. Siguiente

1. **Reajuste de curvas sobre las etiquetas de píxel**: la arquitectura de Vector Magic. Trazar en
   `pixel` y encajar Béziers subpíxel sobre esas fronteras, con esquinas conservadas, apuntando a
   ≥0,97 de SSIM con ≤20 000 nodos en Gum Tree (hoy: 0,9776 con 64 036 y 0,9577 con 18 561). La vara
   es doble: SSIM y nodos.
2. **Juicio a escala**: recortes 3× de `curvas` y `fidelidad` sobre follaje, ventanas y agua, para
   decidir el modo por uso y detectar el escalón del modo píxel.
3. **Presupuesto tonal para foto**: subir colores solo donde el error local lo pida (por teselas o
   bandas), en vez de una paleta global fija.
