# Experimento 15 — reajuste de curvas: la fidelidad del píxel, con curvas

> Fecha: 2026-10-28 · Gum Tree (ilustración, 1400×775), Cityscape (póster, 1400×980) y Ángel (foto,
> 1050×700). SSIM y PSNR sobre luminancia, ventanas 8×8, stride 8, medidos en `bench/bw.html` sobre
> los SVG emitidos. Referencia del competidor: los renders de Vector Magic del experimento 13.
> Reproducible con `npm run bench:refit`.

---

## 1. Veredicto corto

**La última milla era el ajuste de curvas, y se cierra.** El experimento 14 dejó dos mitades: el modo
`pixel` alcanza a Vector Magic en fidelidad (0,9776) pero entrega una escalera de 64 036 nodos, y el
modo `spline` entrega curvas limpias pero se queda en 0,9351. Trazando en `pixel` y ajustando Béziers
subpíxel sobre esas etiquetas —la arquitectura de Vector Magic— el resultado es **0,9766 con 11 527
nodos**: la fidelidad del píxel con **5,6× menos nodos** y a **0,0042 del competidor**.

| Imagen | `curvas` | `fidelidad` (píxel) | **`refit`** | Vector Magic |
|---|---:|---:|---:|---:|
| Gum Tree (ilustración) | 0,9351 · 7 083 nodos | 0,9776 · 64 036 | **0,9766 · 11 527** | 0,9808 |
| Cityscape (póster) | 0,9518 · 8 055 | 0,9631 · 21 614 | **0,9642 · 6 313** | 0,9672 |
| Ángel (foto) | 0,6693 · 43 214 | 0,8365 · 367 032 | **0,8418 · 153 641** | 0,8267 |

En póster y foto el reajuste **supera al modo píxel** (0,9642 > 0,9631; 0,8418 > 0,8365) con una
fracción de los nodos: suavizar la escalera acerca la geometría al borde real del antialiasing.
En ilustración queda 0,0010 por debajo del píxel, que es el precio de la curva.

---

## 2. El método

`bench/lib/curve-fit.mjs`, geometría pura (sin motor, sin Node), el clásico de Potrace/Schneider
adaptado a lo que ya teníamos:

1. **Anillos** — se lee el `d` del modo píxel (`M/H/V/L/Z`, absolutos y relativos, con las
   repeticiones implícitas). Los comandos de curva se rechazan: si el `d` no es una etiqueta de
   píxel, el error que se mide después no significa nada.
2. **Suavizado con esquinas a salvo** — media móvil (1,2,1) para quitar el zigzag de la rejilla.
   Los vértices que giran más de 60° en una ventana de dos píxeles **no se tocan**: son esquinas de
   verdad y promediarlas encogería la figura (el primer intento convirtió el fondo de 1400×775 en un
   rombo de 350×193). En un escalón de un píxel el giro neto de la ventana es pequeño, así que esa
   zona sí se suaviza.
3. **Simplificación** — Ramer–Douglas–Peucker con tolerancia declarada, empezando por la esquina más
   aguda para no cortar una esquina por la mitad.
4. **Esquinas** — giro con ventana de dos vértices: un escalón no es una esquina; una caja sí.
5. **Ajuste** — entre esquinas, una Bézier cúbica por mínimos cuadrados (tangentes de cuerda,
   `generateBezier` de Schneider); si el error supera `fitError` se parte por el punto peor y se
   repite. El error se mide contra el anillo **suavizado** (el centro de la rampa de antialiasing):
   contra la escalera, una curva correcta se separa medio píxel por construcción.
6. **Rectas** — un tramo de dos puntos se emite como `L`: las cajas y los lados rectos no se
   convierten en curvas.

**Coste.** Medir el error contra el anillo completo era O(segmentos × muestras × intentos): 17,2 s
por ilustración. Un índice de rejilla (celdas de 4 px con los segmentos que las cruzan) lo deja en
**1,2 s** sin cambiar la geometría (11 527 nodos), porque el error tolerado es menor que el lado de
celda y el segmento más cercano siempre está en la celda del punto o al lado.

---

## 3. La frontera de tolerancia (Gum Tree, `--configs`)

| `rdp` = `fit` | Nodos | Tamaño | SSIM | PSNR |
|---:|---:|---:|---:|---:|
| 0,20 | 12 573 | 333 KB | 0,9774 | 34,48 |
| **0,25 (entregado)** | **11 527** | **295 KB** | **0,9766** | **34,27** |
| 0,30 | 10 756 | 269 KB | 0,9757 | 34,08 |
| 0,50 | 9 482 | 209 KB | 0,9722 | 33,36 |
| 0,90 | 6 442 | 151 KB | 0,9619 | 31,66 |

Bajar a 0,20 compra +0,0008 de SSIM por +9 % de nodos; subir a 0,30 ahorra un 7 % por −0,0009. Se
entrega **0,25**: la fidelidad del modo píxel (0,9776) a 0,0010 de distancia y con 5,6× menos nodos.
El ángulo de esquina (45°, 60°, 75°) mueve ±0,0002: no es una perilla.

---

## 4. Lo que cuesta

- **Bytes.** Las curvas llevan dos decimales: en ilustración el refit pesa 295 KB frente a los 167 KB
  del modo píxel y los 181 KB de `curvas`; en póster, 108 KB frente a 63 KB del píxel y 171 KB de
  `curvas`. Gana en peso a `curvas` y pierde contra el píxel: el precio de la curva son los decimales
  de los puntos de control.
- **Foto.** 153 641 nodos y 2,7 MB: es fiel y supera al competidor, pero no es un archivo de taller.
  Para foto sigue faltando el presupuesto tonal adaptativo.
- **Depende de la etiqueta.** El reajuste no inventa regiones: si la paleta fusionó dos tonos, la
  curva los mantiene fusionados. La fidelidad de la segmentación sigue siendo la del experimento 14.
- **Sin juicio a escala.** Falta el recorte 3× de los tres modos para ver el escalón del píxel, el
  temblor de `curvas` y el resultado del reajuste ampliado.

---

## 5. Lo que se entrega

- `bench/lib/curve-fit.mjs`: anillos → Béziers, con error declarado y puro (lo puede usar el navegador).
- `bench/lib/color-refit.mjs`: `refitSvg(svg, settings)` reescribe los `d` de un SVG del modo píxel
  conservando formas, rellenos y orden; `REFIT_DEFAULTS` = 0,25 / 0,25 / 60°.
- `bench/lib/color-presets.mjs`: tercer modo `refit` (traza en píxel, pide reajuste) y `usesRefit`.
- `bench/curve-refit.mjs` (`npm run bench:refit`): reproduce las tablas.
- `bench/auto-trace.mjs --refit` y la demo del navegador: el modo llega al producto.
- El preset por defecto **no cambia**: `curvas` sigue siendo la salida para cortar y escalar; `refit`
  es el modo de fidelidad con curvas.

---

## 6. Siguiente

1. **Juicio a escala 3×**: recortes de follaje, ventanas y agua para los tres modos. Es la prueba que
   dice si el reajuste se ve tan bien como puntúa.
2. **Foto en modo refit sin 153 000 nodos**: presupuesto tonal adaptativo + reajuste, que es lo que
   hace Vector Magic con su modo foto («as many colors as the algorithm deems necessary»).
3. **Encaje de esquinas al 50 % de cobertura** del antialiasing: hoy la esquina se conserva donde la
   ve el modo píxel; el centro de la rampa puede estar medio píxel más allá.
