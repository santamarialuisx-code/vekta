# Experimento 02 — ¿se puede entregar una salida cortable?

> Fecha: 2026-10-28 · Banco: 4 imágenes × 8 variantes de vtracer (32 SVG) ·
> Método: `bench/cut.mjs` · Verificación: `pnpm test` + navegador (ego-browser).

---

## 1. Veredicto corto

**El doble corte es real, medible y no se arregla cortando mejor los mismos bordes: se arregla
eligiendo qué cortar.**

- Si se corta **cada borde de color en una sola pasada**, casi la mitad del recorrido es
  repetido: `R/U = 1,90–2,19` en 32 de 32 archivos. Es exactamente lo que Vector Magic admite
  por escrito en su página de formatos y no corrige.
- Si se corta **por capas de color** (vinilo, DTF: cada color en su lámina), el desperdicio es
  del **0–7 %**, porque el trazador ya fusiona las regiones del mismo color. No había nada que
  arreglar ahí.
- La unión por color se puede **emitir**. En las variantes de mosaico (`cutout*`) conserva la
  imagen —diferencia media 0,12–0,75 sobre 255— y no deja ni un contorno duplicado dentro de la
  capa. En las variantes apiladas (`default`, `poster`, `spline-stacked`) fusionar por color
  cambia el orden de capas: útil para cortar, no para reproducir la imagen.
- El corte de **silueta** (unión de todo) baja el recorrido un 94–100 %. Con una advertencia que
  el banco no puede evitar: las cuatro imágenes cubren el lienzo, así que su silueta es el
  rectángulo del lienzo. El caso interesante —fondo transparente— no está en el banco.

---

## 2. Método

Cuatro longitudes, todas en píxeles de imagen:

| Símbolo | Qué mide | Cómo |
|---|---|---|
| `R` | lo que trae el SVG, sin tocar | suma de todos los contornos de todos los `path` |
| `L` | cortar por capas de color | suma de los perímetros de la unión de cada color |
| `E` | cortar la pieza | perímetro de la unión de todas las formas |
| `U` | óptimo de una pasada | `(E + L) / 2` |

`U` sale de contar bordes, no de una intuición. En una teselación, `R = E + 2·S_c + 2·S_s`
(cada borde interior aparece en dos formas), `L = E + 2·S_c` (un borde entre colores distintos
sigue presente en las dos capas; uno entre formas del mismo color desaparece) y el recorrido
único de una pasada es `E + S_c`. Despejando: `U = (E + L) / 2`.

En una teselación perfecta `R/U → 2,0`: la mitad de lo que recorre la máquina es repetido.

Decisiones de implementación que cambian los números:

- **Kernel: Clipper** (`clipper-lib`, aritmética entera). Los ports JS del algoritmo de Martinez
  (`polygon-clipping`, `polyclip-ts`) **abortan** con esta entrada: `Unable to find segment …
  in SweepLine tree`. La causa es real, no un caso raro: dos regiones contiguas comparten borde,
  pero cada una lo aproxima con su propio Bézier, así que los bordes son *casi* coincidentes.
- **Cierre morfológico de 0,5 px** (±0,25 px) antes de medir cualquier unión. Sin él quedan
  rendijas de centésimas de píxel entre regiones que Clipper devuelve como anillos-hairline: en
  `cutout-opt` inflaban `E` de 4 350 a 7 273 px, un 67 % de ruido que no es diseño ni se puede
  cortar. 0,5 px es 2× la tolerancia de aplanado y muy inferior a cualquier kerf.
- El aplanado de Bézier es adaptativo con cota de error (0,25 px), no un número fijo de
  segmentos: si no, la longitud depende del zoom.

Comando:

```bash
pnpm bench:cut
```

Escribe `bench/out/cut-report.json` y dos SVG por entrada en `bench/out/cut/`.

---

## 3. Referencia: Gum Tree (1400×775)

| Variante | `R` | `L` | `E` | `U` | `R/U` | ahorro de silueta |
|---|---:|---:|---:|---:|---:|---:|
| `default` | 101 102 | 99 775 | 4 350 | 52 063 | 1,94 | 96 % |
| `cutout` | 89 468 | 89 160 | 4 350 | 46 755 | 1,91 | 95 % |
| `cutout-opt` | 88 772 | 88 340 | 4 350 | 46 345 | 1,92 | 95 % |
| `cutout-opt-hard` | 88 474 | 87 873 | 4 350 | 46 112 | 1,92 | 95 % |
| `cutout-pal12` | 68 110 | 67 511 | 4 350 | 35 930 | 1,90 | 94 % |
| `poster` | 145 796 | 136 443 | 4 350 | 70 397 | 2,07 | 97 % |
| `poster-cutout` | 108 503 | 107 827 | 4 350 | 56 088 | 1,94 | 96 % |
| `spline-stacked` | 101 102 | 99 775 | 4 350 | 52 063 | 1,94 | 96 % |

`R/L` va de **1,003** (`cutout`) a **1,069** (`poster`): entre el 0,3 % y el 7 % del recorrido por
capas es redundante. Ese es todo el botín que queda dentro de una capa.

`E = 4 350` es exactamente `2·(1400 + 775)`: el perímetro del lienzo. La imagen cubre el lienzo
entero, así que «cortar la pieza» es cortar el rectángulo. `R/E = 23,2`: cortar todos los bordes
de color recorre 23 veces más que recortar la pieza.

---

## 4. Las otras tres imágenes

`default` y `cutout-opt`, que son las variantes que se usarían en producto:

| Imagen · variante | `R` | `L` | `E` | `U` | `R/U` |
|---|---:|---:|---:|---:|---:|
| Cityscape · `default` | 135 727 | 133 847 | 4 760 | 69 304 | 1,96 |
| Cityscape · `cutout-opt` | 147 709 | 147 625 | 4 760 | 76 192 | 1,94 |
| Ángel · `default` | 554 887 | 554 083 | 3 501 | 278 792 | 1,99 |
| Ángel · `cutout-opt` | 346 469 | 345 091 | 3 500 | 174 296 | 1,99 |
| K1 · `default` | 1 752 438 | 1 630 075 | 8 400 | 819 238 | **2,14** |
| K1 · `cutout-opt` | 1 074 817 | 1 065 978 | 8 400 | 537 189 | **2,00** |

Dos hallazgos que no estaban en el plan:

1. **K1 `cutout-opt` da 2,00 exacto**, la predicción teórica de una teselación perfecta. Es la
   validación del método: cuando la entrada es de verdad un mosaico, el modelo acierta al dígito.
2. **El modo apilado (`stacked`) puede pasar de 2,0**, y eso significa algo peor que duplicar:
   `R/U = 2,14` en K1 y 2,19 en K1 `poster`. Parte de esos contornos quedan **debajo de otra
   capa**: la máquina cortaría líneas que no se ven. K1 `default` trae un 63 % más de contorno
   crudo que K1 `cutout-opt` (1 752 438 vs 1 074 817) y su unión por capa también es mayor
   (1 630 075 vs 1 065 978). No es ruido de medición: es geometría oculta.

---

## 5. Qué significa para el producto

El «rellenar y trazar» de Vector Magic produce exactamente esto, y ellos lo dicen: *«aún podría
cortar dos veces por borde ya que la mayoría de los bordes están formados por dos figuras»*. La
medición pone número a esa frase: **el 48 % del recorrido de una pasada es repetido**.

La conclusión de producto no es «unir los bordes mejor», es **preguntar para qué se corta**:

| Trabajo | Qué se emite | Recorrido | Estado |
|---|---|---|---|
| Vinilo / DTF, un color por lámina | un `path` por color, ya unificado | `L` (0–7 % de exceso) | **resuelto** (usar variantes `cutout`) |
| Recortar la pieza | un `path` con la unión de todo | `E` (94–100 % menos) | **resuelto**, útil con fondo transparente |
| Grabar todos los bordes de color | los bordes una sola vez | `U` (óptimo) | **no emitido**: exige un kernel de intersección de líneas |

Lo que sí se puede afirmar ya: nuestra salida por capas está garantizada sin contornos
duplicados, y la apariencia no cambia (medido abajo). Eso es una ventaja concreta frente a un
flujo que te obliga a cortar dos veces.

---

## 6. Verificación

- **31 pruebas** (`pnpm test`): tokenizador de `d` (incluye `S`/`T`/arcos y relativos), herencia
  de `fill`, anidado de agujeros, factor de redundancia en cinco geometrías conocidas y
  verificación de que **lo emitido mide lo medido**.
- **Error máximo de lo emitido: 0,00 %** en los 32 archivos, medido volviendo a leer el SVG
  escrito, no el que se quiso escribir.
- **Navegador (ego-browser)**: se rasterizaron original y salida por capas en `<canvas>` y se
  compararon píxel a píxel los 32 archivos. Diferencia media sobre 255:

| Familia | Rango | Peor caso |
|---|---:|---:|
| `cutout*` (mosaico) | 0,12 – 0,75 | K1 `poster-cutout` (0,75) |
| `default` / `spline-stacked` | 0,19 – 8,26 | K1 `default` (8,26) |
| `poster` | 0,68 – 8,51 | K1 `poster` (8,51) |

  En el mosaico la diferencia es solo el borde de antialiasing movido por el cierre de 0,5 px:
  visualmente indistinguible. En las apiladas el residuo no es ruido: al fusionar por color, un
  mismo color que el SVG original pintaba en dos planos distintos pasa a pintarse en uno, y
  cambia lo que queda encima. Para cortar por capas da igual (cada color va en su lámina), pero
  confirma que **la familia `cutout` es la correcta para el flujo cortable**, y no por
  casualidad: es la única que da `R/U = 2,00` exacto.

---

## 7. Limitaciones

- **`U` no se emite.** Es una cota, no un archivo: producir los bordes una sola vez requiere
  intersecar líneas, no áreas. Queda como trabajo futuro; para eso hace falta un kernel de
  overlay 1D, no Clipper.
- **La silueta no se pudo probar en su caso real.** Ninguna de las cuatro imágenes tiene fondo
  transparente, así que `E` es siempre el rectángulo del lienzo. El mecanismo está probado
  (pruebas con dona y con dos cuadrados), pero falta una imagen con alfa en el banco.
- **Cierre de 0,5 px.** Necesario para no medir rendijas de aplanado; mueve los bordes una
  fracción de píxel. Está por debajo de cualquier kerf, pero es una decisión, no un dato.
- **Vector Magic no se puede medir.** Su SVG está detrás del muro de pago. Solo se cita su
  admisión textual; no se inventan cifras suyas.

---

## 8. Siguiente

1. **Limpieza (experimento 03)**: cuantización en OKLab → limpieza de regiones → suavizado con
   preservación de esquinas. Es el hueco que dejó abierto el experimento 01.
2. **Una imagen con fondo transparente** en el banco, para medir la silueta en su caso real.
3. **DXF + kerf**: la salida cortable sin compensación de radio de herramienta sigue siendo
   incompleta para láser.
