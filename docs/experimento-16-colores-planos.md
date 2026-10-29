# Experimento 16 — Colores planos: el Yoshi que se ve hermoso

> Fecha: 2026-10-28 · Caso: `C:/Users/luis/Downloads/yoshi.jpg` (728 × 971, JPEG con el damero de
> transparencia **quemado en píxeles**, sin alfa) · Método: Node con el pipeline real de la página
> (`quantize` → `renderQuantized` → `vtracer`) + comparación visual a 1× y 2× en Chromium.
> Evidencia en `C:/Users/luis/ego/vekta-yoshi-20261028/invest/` (SVG, HTML comparadores, capturas).

---

## 1. Veredicto corto

**El motor no era el problema: era la paleta.** El Yoshi de la página hoy sale con 766 paths,
22 476 nodos y 381 KB, contorno tembloroso y la barriga color crema. Con **6 colores planos, 24
piezas, 887 nodos y 26 KB** el dibujo se ve *más* limpio que el JPEG de origen: 25× menos nodos y
15× menos peso.

La causa tiene nombre: la paleta gastaba **18 de 24 ranuras en la rampa de antialiasing del
contorno** (18 clusters casi negros), y con el presupuesto agotado fundía blanco + amarillo en crema
(`#f7f2ca`). Los colores reales del dibujo son seis y estaban ahí todo el tiempo.

| | página actual | propuesta |
|---|---:|---:|
| colores | 15 (5 casi negros, sin amarillo) | **6** (blanco, negro, verde, naranja, rojo, amarillo) |
| piezas (`<path>`) | 766 | **24** |
| nodos | 22 476 | **887** |
| peso | 381 KB | **26 KB** |
| barriga / mofletes | crema `#f7f2ca` | blanco `#fbfafb` |
| suela amarilla | perdida | presente `#f8dd0e` |
| damero de fondo | fuera (varita 120) | fuera (multi-semilla + crecer 1 px) |

---

## 2. El caso, medido

### 2.1 Los colores reales

Muestreo directo del JPEG y top de colores exactos por área (707 k px):

| zona | color | área |
|---|---|---:|
| damero claro | `#ffffff` | 29,95 % |
| cuerpo | `#00a300` | 12,49 % |
| damero oscuro | `#cccccc` | 5,39 % |
| zapato | `#fe7c00` | 3,35 % |
| contorno | `#000000` | 2,83 % |
| moflete / barriga | `#ffffff` | (incluido arriba) |
| silla | `#fe0000` | **0,53 %** |
| suela | amarillo ≈ `#f8dd0e` | **1,2 %** |

El damero y el ruido de JPEG no son dos colores sino **una nube**: `#fefefe`, `#fdfdfd`, `#cbcbcb`,
`#cdcdcd`, `#cacaca`, `#cfcfcf`… Cada variante ocupa entre 0,6 % y 3,3 % del lienzo. Eso es lo que
la cuantización estaba comprando.

### 2.2 Por qué la paleta actual sale sucia

`quantize` con 24 colores sobre el Yoshi (sin fondo) devuelve estos clústeres, ordenados por área:

```
#01a201 30,6 %   #fbfafb 20,4 %   #fd7c02 9,6 %   #030202 6,8 %   #000000 4,1 %
#070606  3,7 %   #02a403  2,9 %   #000401 2,8 %   #f92610 2,6 %   #0b0107 2,4 %
#020109  2,3 %   #02a604  2,0 %   #020e01 1,5 %   #f8dd0e 1,2 %   #010001 1,1 %
#393d23  0,9 %   #27110d  0,9 %   #05aa02 0,9 %   #106e11 0,8 %   #042604 0,8 % …
```

**Dieciocho** de esos colores son negro, casi-negro o verde muy oscuro: la rampa que el antialiasing
del contorno dibuja entre el negro y el verde. Con 8 o 12 ranuras (lo que usa la página), esa rampa
se come el presupuesto y quedan solo 3-4 ranuras para los colores planos: de ahí la crema, la suela
perdida y el contorno con temblor.

### 2.3 Las otras dos causas

- **Clasificador**: `imageSignals` dice **"photo"** para el Yoshi (3 645 colores distintos, entropía
  0,58) aunque el dibujo tiene seis colores. La página manda el caso a `refit` (píxel), que es el
  modo de foto: escalera de píxel y 22 k nodos.
- **Fondo**: el damero son dos colores a distancia RGB ≈ 88. Con la varita de una semilla y
  tolerancia 28 se quita el 13-14 % (media trama); hace falta subir a 120 para quitarlo entero, un
  número que el usuario no tiene por qué adivinar.

---

## 3. Las opciones que se probaron

Todas medidas sobre el mismo Yoshi, sin fondo (`multi-semilla`), con el pipeline de la página.

| opción | resultado | veredicto |
|---|---|---|
| **Cuota de área** `minClusterShare` 0,02 (2 %) | 5 colores, ΔE 0,041 — pero **pierde el rojo de la silla y la suela amarilla** (1,2 % y 0,5 % del área) | ✗ mata colores pequeños legítimos |
| **Mediana 3×3 / 5×5** antes de cuantizar | misma paleta de 6 colores con y sin mediana | ✗ innecesaria |
| **Más colores** (16) | blanco y amarillo vuelven, pero 1 104 paths / 23 244 nodos / 402 KB | ✗ no escala |
| **`filterSpeckle` 10** | 37 paths y 1 118 nodos, pero la paleta sigue sucia (crema, sin amarillo) | ✗ |
| **`simplify` 2,5** | 633 nodos, pero el contorno pierde esquinas (dedos, hombro) | ✗ solo, como perilla |
| **Poda de rampas** (la propuesta) | **6 colores exactos**, 24 paths, 887 nodos, 26 KB | ✓ |

---

## 4. El método que gana: poda de rampas

Un color de antialiasing **no es un color**: es una mezcla lineal de otros dos que sí lo son. Se
detecta y se fusiona con el extremo más cercano; un color plano legítimo, aunque sea pequeño, no
cae sobre esa recta y sobrevive.

```
1. cuantizar fino (24 colores) y contar el área de cada clúster
2. fusionar duplicados (ΔE < 0,02)
3. para cada clúster k, buscar el par (a, b) con área(a)+área(b) ≥ 3×área(k) cuya
   recta en OKLab pase a menos de 0,05 de k → k es rampa → se suma al extremo más cercano
4. repetir 2-3 hasta que no cambie nada
```

Resultado en las cinco imágenes del banco + Yoshi:

| imagen | clase actual | colores finos | **tras poda** | ΔE medio | ¿plano? |
|---|---|---:|---:|---:|---|
| **yoshi** | photo | 24 | **6** | **0,0496** | sí |
| gum-tree | illustration | 24 | **5** | **0,0134** | sí |
| cityscape | poster | 24 | 3 | 0,0885 | no (cielo con degradado) |
| angel (foto) | photo | 24 | 4 | 0,0858 | no |
| k1 (line art) | line-art | 24 | **2** | 0,0512 | sí (pero va por binario) |

**La propia poda es el detector.** El `ΔE` medio de la paleta podada contra los píxeles visibles
—llamémoslo `flatResidual`— separa limpio el arte plano (0,013–0,050) de la foto y el póster con
degradado (0,086–0,089). Umbral propuesto: **`flatResidual < 0,06`**. Es más honesto que contar
colores distintos, que es lo que hoy confunde al clasificador.

### Lo que se ve

Comparación a 2× (`invest/zoom.png`): el original tiene contorno grueso con borde suave y ruido de
JPEG; la versión plana tiene el mismo dibujo con curvas limpias, blanco puro en ojos y mofletes, y
la suela amarilla intacta. Las diferencias son de grosor de contorno (el original engorda por el
antialiasing), no de forma.

---

## 5. Fondo: el damero no es un color, es un patrón

| estrategia | Yoshi |
|---|---|
| varita actual, tolerancia 28 | 13-14 % — deja media trama |
| varita actual, tolerancia 120 | 48,8 % — correcto, pero el número se adivina |
| **multi-semilla** (`#ffffff` + `#cccccc`), tolerancia 18-20 | **47,6-48,8 %** — correcto sin adivinar |

El rellenado es por conectividad, así que la tolerancia puede ser pequeña y aun así llevarse las dos
tonalidades. **La barriga y los mofletes de Yoshi sobreviven** porque están encerrados por el
contorno negro: la conectividad los protege, no el color.

**Falta un paso, y se descubrió midiendo con la librería real.** Entre el damero y el contorno negro
queda un **fleco de 1-2 px de mezcla** que no es ni fondo ni figura: con tolerancia 20 no entra en la
máscara, sobrevive como un anillo casi blanco y el trazado lo convierte en 2 061 piezas de más.

| máscara | fondo | paths | nodos | peso |
|---|---:|---:|---:|---:|
| sin crecer | 47,8 % | 2 085 | 9 180 | 115 KB |
| **crecida 1 px** | 49,2 % | **24** | **973** | **28 KB** |
| crecida 2 px | 49,8 % | 24 | 938 | 27 KB |

Por eso `backgroundMask` acepta `grow` (dilatación 8-conexa). El valor por defecto es **0** —crecer
cambia la geometría de la pieza y quien corta tiene derecho a saberlo— y la página usará **1** para
fondos que vienen de un JPEG.

**Coste conocido**: el borde blanco del sticker es del mismo color que los cuadros claros y está
conectado al damero, así que se va con él. Si se quiere conservar, la vía es re-añadirlo como
contorno desplazado (`bench/lib/kerf.mjs: offsetRings`) y relleno blanco — fase opcional.

---

## 6. Edición: la paleta plana arregla también el borrado

| | paleta ruidosa | paleta plana |
|---|---:|---:|
| paths | 2 470 | **24** |
| grupos `<g fill>` | 58 | 8 |
| subpaths | 2 489 | 47 |

Con 2 470 piezas, «borrar pieza» es inútil (cada mota de antialiasing es una pieza). Con 24, **cada
pieza es una región del dibujo**: la barriga, la silla roja, un zapato, los dedos. Y como el modo
plano usa `cutout` (mosaico sin costuras), borrar deja **hueco transparente**, que es exactamente lo
que hace el *Zap* de Vector Magic sobre su mapa de segmentos.

---

## 7. Plan de ejecución

Cinco fases, cada una con su criterio de aceptación medible. Ninguna dependencia nueva, ningún build.

### Fase 1 — `flatPalette()` en `bench/lib/quantize.mjs` · **hecha**

- `pruneRamp(clusters, { rampTolerance = 0.05, massRatio = 3, nearDuplicate = 0.02 })` y
  `flatPalette(rgba, width, height, { colors = 24, ... })` → `{ palette, paletteHex, coverage, residual, count }`.
  Reutiliza `buildHistogram`/`refine` que ya existen.
- Tests `bench/test/flat-palette.test.mjs`: fixture sintético de 6 colores planos + rampa de 3 px →
  devuelve **exactamente 6** y `residual < 0,02`; foto con degradado → `residual > 0,08`; no muta la
  entrada; el amarillo del 1 % sobrevive.
- **Hecho**: `FLAT_RULES`, `pruneRamp()` y `flatPalette()` exportadas; 8 pruebas en
  `bench/test/flat-palette.test.mjs` (plano sintético con rampa → 5 colores; degradado → residual
  > 0,15; el amarillo del 1 % sobrevive; no muta la entrada).
- **Medido**: `yoshi → 6 colores, residual 0,0363`; `gum-tree → 6, 0,0174`; `k1 → 2, 0,0934`;
  `angel → 4, 0,0830` (los dos últimos, por encima del umbral: no son arte plano).

### Fase 2 — multi-semilla en `bench/lib/background.mjs` · **hecha**

- `borderColors(rgba, width, height, { top = 2 })` y `backgroundMask(..., { seeds })` (acepta
  `#rrggbb[]`); si el segundo color del borde ≥ 15 % del perímetro, la página pasa dos semillas.
- Tests: damero sintético → 2 semillas, `share ≈ 50 %`, el cuadrado interior intacto; el caso de una
  semilla sigue dando lo mismo (no regresión con K1).
- **Hecho**: `borderColors()`, `borderSeeds()`, `growMask()` y `seeds`/`grow` en `backgroundMask`;
  7 pruebas nuevas (damero → 2 semillas; una semilla deja media trama; crecer se come el fleco;
  `growMask` no muta la entrada).
- **Medido**: `yoshi → semillas #ffffff+#cccccc, fondo 49 %, 24 paths, 973 nodos, 28 KB, 285 ms`;
  la barriga sigue opaca. `pnpm test`: **191 pruebas verdes**.

### Fase 3 — la página traza en plano · **hecha**
- `web/app.mjs`: opción **«colores planos»** en el selector; `resolvedMode()` decide
  `binario | plano | refit` con `residual < 0,06`; `trace()` hace `flatPalette` → `nearestPalette` →
  `renderQuantized` → `colorTraceOptions(hex, { mode: "curvas", simplify: 0.8 })`.
- El selector de colores pasa a ser un **tope posterior a la poda**: subirlo no inventa colores,
  bajarlo funde los más pequeños en el más cercano.
- El **damero se detecta solo** (`borderSeeds` + dos tonos neutros + máscara ≥ 10 % del lienzo) y la
  página marca «quitar fondo» sin que el usuario lo pida.
- La línea de decisión lo cuenta todo:
  `auto: … → plano. Paleta plana: 6 colores, tope 16, ΔE 0,039 (umbral 0,06). Fondo: dos tonos
  (#ffffff + #cccccc) quitado, 49 % del lienzo.`
- **Medido en Chromium**: `yoshi → plano, 6 colores, 24 paths, 863 nodos, 25 KB, 94 ms, fondo 49 %`
  (auto, sin tocar nada); `k1 → binario`; `angel y cityscape → refit` (residual 0,083 y 0,089);
  `gum-tree → plano, 157 paths, 4 932 nodos, 129 KB` (antes 276 / 11 039 / 277 KB). Borrar la silla:
  24 → 23 con hueco; deshacer vuelve; las descargas salen con 24 paths y un solo `viewBox`.

### Fase 4 — edición sobre regiones · **hecha**
- Verificar con Yoshi: 24 piezas seleccionables; borrar la silla roja deja hueco; «borrar color»
  quita el rojo entero; deshacer vuelve.
- **Hecho**: selector **«rellenar con»** con los colores vivos del dibujo y su número de piezas, y
  botón **Rellenar** (`path.setAttribute("fill", hex)`). El selector se rehace tras cada edición y
  conserva la elección si el color sigue existiendo.
- Al serializar se quitan los **`<g>` vacíos**: borrar todas las piezas de un color dejaba un `fill`
  fantasma que `svgMetrics` contaba como relleno (medido: descarga con 7 grupos y 1 `#f03a1f`
  después de borrar el rojo; ahora 6 grupos y 0).
- **Medido en Chromium**: borrar la silla → 24 → 23 paths con hueco, deshacer vuelve; rellenar la
  barriga (pieza 9 de 24) con el verde → `#fafbfa` → `#03a704`, deshacer vuelve; borrar el rojo y
  descargar → 20 paths, 5 rellenos, 0 `#f03a1f`, 24 KB, un solo `viewBox`.

### Fase 5 — verificación y documentación · **hecha**
- Tabla en navegador como la de `web/README.md` (colores, paths, nodos, KB, ms) para Yoshi, Gum Tree
  y K1; capturas a 1× y 2×.
- Actualizar `web/README.md` y la fila del índice en `docs/README.md`.
- **Hecho**: `pnpm install --frozen-lockfile` + `pnpm test` (191 verdes) y pasada completa en
  Chromium con las seis imágenes del banco y las cuatro herramientas (fondo, plano, borrar,
  rellenar, borde, deshacer): **cero** errores no capturados y **cero** mensajes en `#error`.
  `web/README.md` y la fila del índice en `docs/README.md` actualizados.

### Fase 6 — borde de corte · **hecha, con trazo y no con Clipper**
- `offsetRings` no sirve en la página: `union.mjs` importa Clipper con `node:module`, así que la
  unión no existe en el navegador. La versión que sí funciona es un **trazo**: cada pieza clonada en
  un grupo blanco por detrás, con `stroke-width = 2 × ancho`, `linejoin: round`. La mitad exterior
  del trazo es el margen; la interior queda tapada por el dibujo. Es la unión de todas las piezas
  desplazada hacia fuera, sin dependencias.
- El borde se compone al vuelo (casilla + ancho en px), no entra en `state.svg` ni en el historial,
  y no cuenta en las métricas; al descargar se le quita el marcador `data-vk-diecut`.
- **Medido en Chromium**: 8 px → 24 piezas editables + 24 copias, descarga con 48 paths y
  `stroke-width="16"`; 20 px → `stroke-width="40"`; con borde puesto, seleccionar/borrar/rellenar
  siguen funcionando y el halo se recompone (23 + 23 tras borrar una pieza).
- **Límite conocido**: el margen se pinta detrás de todo, así que un hueco (pieza borrada o agujero
  del dibujo) se ve blanco, no transparente. Es el material de la pegatina; está documentado.

---

## 8. Riesgos y límites

1. **`flatResidual < 0,06` está medido en cinco imágenes.** Antes de fijarlo hay que barrer el banco
   completo; si aparece un póster plano con un degradado pequeño, el umbral se separa por categoría.
2. **La poda puede comerse un detalle diminuto y legítimo.** El amarillo (1,2 %) sobrevive; un
   detalle de 0,1 % no. Mitigación: `minCount` absoluto (≥ 300 px) y una salida de emergencia
   («máximo de colores» manual, que ya existe).
3. **El modo plano nunca debe aplicarse a una foto**: el `residual` de la foto es 0,086 y el de un
   degradado 0,089; el umbral los deja fuera, pero es una regla de un solo número y hay que probarla.
4. **`cutout` + borrar deja hueco**, no rellena con la capa de abajo. Es lo correcto para «quitar una
   parte» y hay que decirlo en la UI (el modo `refit` sí revela lo de abajo).
5. **El damero quemado es un caso de JPEG.** Un PNG con alfa real no necesita nada de esto.

## 9. Lo que no se hace

Matte por IA, segmentación semántica, editor de nodos. El objetivo es que un dibujo plano salga
plano, sin fondo y editable por regiones — no competir con Clipping Magic.
