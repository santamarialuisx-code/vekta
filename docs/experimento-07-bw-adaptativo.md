# Experimento 07 — modo binario y umbral adaptativo: el line art se arregla sin tocar el motor

> Fecha: 2026-10-28 · 44 configuraciones sobre `K1_drawing.jpg` y 5 sobre cada una de las otras tres
> imágenes, 59 SVGs. Dos varas: SSIM contra el original (la de los experimentos 01–06) y **F1 de la
> máscara de tinta** (la que corresponde a un grabado). Medido en navegador, como el resto.

---

## 1. Veredicto corto

**La deuda más grande del banco se cierra, y sin tocar el motor.** El line art pasa de **174 451
nodos y 28 rellenos** a **17 749 nodos y 1 relleno**, con **+0,032 de F1 de tinta** y en **20× menos
tiempo**:

| K1 (3000×1200) | Nodos | Rellenos | Tamaño | Tiempo | SSIM | F1 de tinta |
|---|---:|---:|---:|---:|---:|---:|
| Pipeline de color (16 colores, `simplify` 1,2) | 174 451 | 28 | 3 196 KB | 6 589 ms | **0,8591** | 0,9112 |
| **Preset line art** (`clustering: bw`, umbral Otsu, `simplify` 0,8) | **17 749** | **1** | **366 KB** | **330 ms** | 0,8103 | **0,9436** |

Tres cosas que hay que decir juntas, porque por separado engañan:

1. **El modo binario reproduce el trazo mejor que el pipeline de color** (F1 0,9436 contra 0,9112),
   con un 90 % menos de nodos.
2. **Un solo relleno** no es cosmético: no hay bordes internos que cortar dos veces y no hay tintas
   que separar. La salida de un escaneo es directamente de máquina.
3. **El SSIM baja 0,049** y eso es lo correcto. El SSIM premia reproducir el tono del papel y el gris
   del lápiz; el modo binario los descarta a propósito. En line art el SSIM deja de ser una vara de
   fidelidad y pasa a ser una vara de «cuánto del escaneo se conservó como píxel», que no es la pregunta.

**El umbral adaptativo de Bradley–Roth no hace falta.** El mejor adaptativo de 16 configuraciones
llega a F1 0,9409; el umbral fijo con el Otsu de la propia imagen llega a **0,9595**. La ventana local
mezcla el trazo con el papel y mueve el corte según la zona: con el fondo ya uniforme de un escaneo,
solo aporta ruido.

---

## 2. Por qué hacía falta otra vara

El experimento 05 midió K1 contra su propio escaneo y concluyó que la imagen estaba en 0,86 de SSIM,
la peor del banco. Ese número es real, pero no dice lo que hay que arreglar: **un escaneo no es una
foto que haya que reproducir, es una máscara de tinta que hay que extraer.**

Así que aquí se mide también la **F1 de la máscara de tinta**: píxel oscuro del render contra píxel
oscuro del original, los dos cortados en el **umbral de Otsu de la imagen** (135 para K1). Precisión
= no inventar tinta; exhaustividad (recall) = no perder trazo. F1 junta las dos.

La métrica tiene techo conocido: el modo `pixel` del motor, que no ajusta curvas y sigue el borde del
mapa de bits, da **F1 0,9957**. Ese es el máximo alcanzable con este motor; lo que se pierde hasta
ahí es el precio de convertir píxeles en curvas.

---

## 3. El barrido completo sobre K1

Base común: `mode: spline`, `hierarchical: cutout`, `optimize: 2`. La línea base de color usa paleta
de 16 colores cuantizada en OKLab y `simplify` 1,2, que es el preset de line art del experimento 04.

| configuración | nodos | rellenos | KB | ms | SSIM | F1 |
|---|---:|---:|---:|---:|---:|---:|
| `color-16-simplify-1.2` | 174.451 | 28 | 3196 | 6589 | 0,8591 | 0,9112 |
| `bw-fixed-96` | 35.043 | 1 | 768 | 337 | 0,8049 | 0,9215 |
| `bw-fixed-112` | 34.821 | 1 | 759 | 338 | 0,8095 | 0,9401 |
| `bw-fixed-128` | 34.953 | 1 | 762 | 333 | 0,8118 | 0,9548 |
| `bw-fixed-144` | 34.392 | 1 | 745 | 335 | 0,8102 | 0,9549 |
| `bw-fixed-160` | 33.837 | 1 | 732 | 334 | 0,8045 | 0,9373 |
| `bw-fixed-176` | 33.048 | 1 | 709 | 332 | 0,7921 | 0,9088 |
| `bw-fixed-192` | 33.401 | 1 | 701 | 330 | 0,7704 | 0,8699 |
| `bw-adaptive-w0-t10` | 35.167 | 1 | 761 | 403 | 0,8054 | 0,9182 |
| `bw-adaptive-w16-t10` | 37.870 | 1 | 832 | 413 | 0,8191 | 0,9266 |
| `bw-adaptive-w32-t10` | 36.934 | 1 | 805 | 413 | 0,8146 | 0,9231 |
| `bw-adaptive-w64-t10` | 35.862 | 1 | 779 | 405 | 0,8098 | 0,9202 |
| `bw-adaptive-w0-t15` | 35.199 | 1 | 765 | 409 | 0,8099 | 0,9290 |
| `bw-adaptive-w16-t15` | 37.235 | 1 | 817 | 411 | 0,8180 | 0,9293 |
| `bw-adaptive-w32-t15` | 36.343 | 1 | 794 | 407 | 0,8165 | 0,9311 |
| `bw-adaptive-w64-t15` | 35.640 | 1 | 777 | 410 | 0,8128 | 0,9296 |
| `bw-adaptive-w0-t25` | 35.297 | 1 | 766 | 408 | 0,8135 | 0,9409 |
| `bw-adaptive-w16-t25` | 36.805 | 1 | 810 | 412 | 0,8144 | 0,9267 |
| `bw-adaptive-w32-t25` | 36.169 | 1 | 793 | 406 | 0,8151 | 0,9341 |
| `bw-adaptive-w64-t25` | 35.417 | 1 | 771 | 404 | 0,8139 | 0,9382 |
| `bw-adaptive-w0-t35` | 35.214 | 1 | 771 | 402 | 0,8116 | 0,9387 |
| `bw-adaptive-w16-t35` | 36.535 | 1 | 806 | 408 | 0,8076 | 0,9131 |
| `bw-adaptive-w32-t35` | 36.172 | 1 | 794 | 404 | 0,8112 | 0,9262 |
| `bw-adaptive-w64-t35` | 35.555 | 1 | 777 | 403 | 0,8110 | 0,9331 |
| `bw-otsu-simplify-0` | 34.592 | 1 | 751 | 335 | 0,8116 | **0,9595** |
| **`bw-otsu-simplify-0.8`** (preset) | 17.749 | 1 | 366 | 330 | 0,8103 | 0,9436 |
| `bw-otsu-simplify-1.2` | 15.582 | 1 | 309 | 307 | 0,8060 | 0,9326 |
| `bw-otsu-simplify-1.6` | 14.879 | 1 | 290 | 302 | 0,8011 | 0,9233 |
| `bw-otsu-simplify-2` | 14.567 | 1 | 281 | 300 | 0,7964 | 0,9146 |
| `bw-otsu-simplify-1.2-fs8` | 13.980 | 1 | 275 | 300 | 0,7937 | 0,9216 |
| `bw-otsu-simplify-1.2-fs16` | 12.595 | 1 | 245 | 290 | 0,7760 | 0,8982 |
| `bw-otsu-simplify-1.2-fs32` | 11.901 | 1 | 231 | 281 | 0,7647 | 0,8808 |
| `bw-otsu-simplify-1.2-polygon` | 30.637 | 1 | **136** | 272 | 0,8097 | 0,9593 |
| `bw-otsu-simplify-1.2-pixel` | 86.224 | 1 | 233 | 358 | 0,8075 | **0,9957** |
| `bw-adaptive-simplify-0` | 35.199 | 1 | 765 | 404 | 0,8099 | 0,9290 |
| `bw-adaptive-simplify-0.8` | 18.032 | 1 | 374 | 399 | 0,8097 | 0,9182 |
| `bw-adaptive-simplify-1.2` | 15.648 | 1 | 311 | 375 | 0,8059 | 0,9105 |
| `bw-adaptive-simplify-1.6` | 14.950 | 1 | 292 | 385 | 0,8021 | 0,9055 |
| `bw-adaptive-simplify-2` | 14.584 | 1 | 282 | 370 | 0,7973 | 0,8963 |
| `bw-adaptive-simplify-1.2-fs2` | 17.323 | 1 | 345 | 383 | 0,8109 | 0,9121 |
| `bw-adaptive-simplify-1.2-fs4` | 15.648 | 1 | 311 | 378 | 0,8059 | 0,9105 |
| `bw-adaptive-simplify-1.2-fs8` | 14.015 | 1 | 277 | 368 | 0,7944 | 0,9024 |
| `bw-adaptive-simplify-1.2-pixel` | 90.029 | 1 | 242 | 429 | 0,8038 | 0,9433 |
| `bw-adaptive-simplify-1.2-polygon` | 31.368 | 1 | 138 | 338 | 0,8079 | 0,9293 |

`w` = `adaptiveWindow` (0 = automático, ~1/8 del lado corto); `t` = `adaptiveT` (sensibilidad).

---

## 4. El adaptativo pierde, y se puede ver por qué

Bradley–Roth compara cada píxel con la media de su ventana. En un escaneo el trazo *está dentro de la
ventana*, así que la media local baja justo donde hay tinta: el umbral se estrecha en las zonas
densas y se ensancha en las vacías. El resultado es un trazo de grosor variable.

Se ve en precisión/exhaustividad, que se mueven en direcciones opuestas según `adaptiveT`:

| configuración | Precisión | Exhaustividad | F1 |
|---|---:|---:|---:|
| `bw-fixed-160` | 0,895 | 0,984 | 0,9373 |
| `bw-fixed-192` | 0,774 | 0,993 | 0,8699 |
| `bw-adaptive-w16-t35` | 0,983 | 0,852 | 0,9131 |
| `bw-adaptive-w0-t10` | 0,873 | 0,968 | 0,9182 |
| `bw-adaptive-w0-t25` (mejor adaptativo) | 0,943 | 0,939 | 0,9409 |
| `bw-otsu-simplify-0` | 0,957 | 0,962 | **0,9595** |

Subir `adaptiveT` afina el trazo (mucha precisión, poca exhaustividad); bajarlo lo engorda. El mejor
punto adaptativo equilibra como el Otsu, pero llega 0,019 más abajo. Y cuesta 20 % más de tiempo.

Sobre una foto con iluminación desigual el adaptativo seguiría teniendo sentido. En los escaneos de
este banco no hay ese problema, y no se va a pagar por resolver uno que no existe.

---

## 5. El umbral no se elige: se calcula

Barrido de umbral fijo: 128 y 144 empatan en F1 (0,9548 y 0,9549) y de ahí hacia cualquier lado cae
— 96 pierde exhaustividad, 192 pierde precisión. La banda buena es estrecha y depende de la imagen.

El **Otsu de K1 es 135**, justo dentro de esa banda. No es casualidad: Otsu elige el corte que
maximiza la separación tinta/fondo, que es exactamente lo que el modo binario necesita. Así que el
preset no lleva un número, lleva un cálculo:

```js
// bench/lib/lineart.mjs
{ clustering: "bw", binaryThreshold: min(255, otsu + 1), simplify: 0.8 }
```

El `+1` importa: Otsu devuelve el último nivel que todavía es tinta y el motor corta **por debajo** del
umbral. Con el valor crudo, una imagen perfectamente bimodal en 50 y 246 pierde justo la tinta y el
SVG sale **vacío** — hay una prueba para ese caso.

Con el umbral autocalibrado y sin `simplify`, el modo binario gana **a todos** los umbrales fijos
(0,9595 contra 0,9549 del mejor fijo) sin que nadie elija nada.

---

## 6. Cuánto cuesta cada nodo

La regla del experimento 04 (mayor `simplify` cuya caída no pase de una tolerancia) se puede aplicar
ahora con una vara que sí mide el trazo:

| `simplify` | Nodos | Δ nodos | F1 | Δ F1 |
|---:|---:|---:|---:|---:|
| 0 | 34.592 | — | 0,9595 | — |
| 0,8 | 17.749 | −48,7 % | 0,9436 | −0,0159 |
| 1,2 | 15.582 | −12,2 % | 0,9326 | −0,0110 |
| 1,6 | 14.879 | −4,5 % | 0,9233 | −0,0093 |
| 2 | 14.567 | −2,1 % | 0,9146 | −0,0087 |

El codo está en **0,8**: la mitad de los nodos por 0,016 de F1. De ahí en adelante cada punto de F1
cuesta cada vez más nodos, y el SVG apenas adelgaza. Por eso el preset usa 0,8 y no 1,2 como el resto
de categorías: en line art los nodos son curvas de un trazo fino, y comérselos se nota en la
exhaustividad.

`filterSpeckle` no ayuda: 8 ya cuesta 0,022 de F1 para ahorrar 3 600 nodos, peor cambio que subir
`simplify`.

---

## 7. Dos modos que sí valen, según el destino

- **`mode: polygon`** — F1 0,9593 (idéntico a `simplify` 0) con 30 637 nodos y **136 KB**: un 82 % menos
  de archivo que la spline equivalente. Emite segmentos rectos, que es lo que muchos CAM convierten
  de todos modos antes de mover el cabezal. Es la opción cuando el destino es una máquina.
- **`mode: pixel`** — F1 0,9957, el techo del motor, con 86 224 nodos. No es vectorizar: es calcar el
  mapa de bits. Sirve como referencia de cuánto se pierde al ajustar curvas, no como salida.

---

## 8. Dónde NO se aplica: la prueba de que la regla hace falta

El modo binario sobre las otras tres imágenes, con la misma configuración:

| imagen | configuración | nodos | rellenos | KB | SSIM | F1 |
|---|---|---:|---:|---:|---:|---:|
| gum-tree-vector | `color-16-simplify-1.2` | 5.315 | 15 | 134 | **0,9303** | 0,9937 |
| gum-tree-vector | preset line art | 1.159 | 1 | 28 | 0,4065 | 0,9965 |
| cityscape-sunset-dfm3-01 | `color-16-simplify-1.2` | 7.421 | 16 | 153 | **0,9479** | 0,9713 |
| cityscape-sunset-dfm3-01 | preset line art | 2.450 | 1 | 49 | 0,5929 | 0,9801 |
| angel-luciano-…-unsplash-s | `color-16-simplify-1.2` | 50.050 | 16 | 967 | **0,6653** | 0,9186 |
| angel-luciano-…-unsplash-s | preset line art | 6.912 | 1 | 102 | 0,1569 | 0,8893 |

**Aquí está la trampa de la métrica nueva, y conviene dejarla escrita:** en una imagen de color el
F1 de tinta *no avisa*. Gum Tree sale con F1 0,9965 —mejor que en el propio K1— mientras el SSIM se
hunde a 0,41 y la ilustración queda reducida a una silueta. La máscara de Otsu de una ilustración de
color recorta «la mitad oscura de la imagen», y el modo binario reproduce fielmente esa mitad oscura.
La métrica es correcta; la pregunta era otra.

Moraleja: **el F1 de tinta solo significa algo después de decidir que la imagen es tinta.** Por eso la
decisión no la toma la métrica, la toma la imagen.

---

## 9. La regla de decisión

Dos condiciones, las dos necesarias, sobre señales que ya están en la imagen:

| imagen | umbral Otsu | separabilidad | tinta | neutro | bordes | decisión |
|---|---:|---:|---:|---:|---:|---|
| gum-tree-vector | 165 | 0,802 | 58,5 % | 24 % | 10,4 % | color |
| cityscape-sunset-dfm3-01 | 156 | 0,755 | 34,3 % | 0 % | 12,5 % | color |
| angel-luciano-…-unsplash-s | 141 | 0,654 | 59,3 % | 4 % | 38,7 % | color |
| k1-drawing | 135 | 0,898 | 13,0 % | **100 %** | 34,3 % | **line art** |

- **`neutralShare` ≥ 90 %** — proporción de píxeles con croma < 20. Un escaneo a lápiz, una tinta o un
  grabado son grises; una ilustración o una foto, no. Es el discriminador fuerte: K1 da 100 %, el
  resto 0–24 %.
- **`inkShare` ≤ 40 %** — proporción bajo el umbral de Otsu. El line art es tinta sobre papel: 13 % en
  K1. Esta condición existe para la **foto en blanco y negro**, que pasa la primera prueba con un
  100 % de píxeles neutros y sin embargo es una foto: su Otsu la parte por la mitad y ese ~50 % de
  tinta la delata. Hay una prueba con una imagen sintética exactamente así.

`separability` y `edgeDensity` se publican como contexto y **no** deciden: la separabilidad de Gum
Tree (0,802) es mayor que la de la foto (0,654), así que no ordena nada por sí sola, y una foto con
mucho detalle tiene tantos bordes como un plano técnico.

---

## 10. Lo que esto no arregla

- **El hueco de 0,032 SSIM frente a Vector Magic sigue siendo de motor.** Este experimento ni lo toca:
  cambia la vara para line art, no la reconstrucción de regiones. Sigue pendiente la estimación de
  borde subpíxel.
- **El SSIM de K1 baja.** Quien mire la tabla del experimento 05 y esta verá 0,86 → 0,81 y podría
  pensar que empeoramos. Es el precio de tirar el tono del papel, y es deliberado; la cifra que
  describe el resultado es la F1 (0,9112 → 0,9436).
- **El binario no separa tintas.** Un escaneo con dos tintas (sellos, tampones) sale como una sola
  silueta. Eso sigue siendo trabajo del trazado por color, y de la separación de tintas que está en
  la arquitectura prevista pero no implementada.
- **La regla es una heurística de dos condiciones**, no un clasificador. Con cuatro imágenes no se
  puede afirmar más. La auto-clasificación por categoría (siguiente frente) tiene aquí su punto de
  partida y su caso de prueba.

---

## 11. Lo que se entrega

`bench/lib/lineart.mjs`

- `LINE_ART_RULES`, `luminance`, `luminanceHistogram`, `otsuThreshold`, `neutralShare`, `edgeDensity`,
  `lineArtSignals`, `looksLikeLineArt`, `LINE_ART_PRESET`, `lineArtOptions`.
- 15 pruebas en `bench/test/lineart.test.mjs`: Otsu sobre histogramas sintéticos (bimodal, gaussiana,
  plano, vacío), turno de 8 bits en el umbral, `neutralShare` gris/color/mixto, `edgeDensity`,
  decisión sobre escaneo / foto en blanco y negro / ilustración.

`bench/bw-sweep.mjs` — el barrido. `pnpm bench:bw`.
`bench/bw.html` — la medición: SSIM y F1 de tinta en el navegador. `pnpm bench:serve`.
`bench/auto-trace.mjs` — el camino del producto: decide por imagen y traza. `pnpm bench:auto`.

```
$ pnpm bench:auto
gum-tree-vector                    color     nodos=  6083  rellenos=15    155KB    463ms  color: 24 % de píxeles neutros, mínimo 90 %
cityscape-sunset-dfm3-01           color     nodos=  8055  rellenos=16    171KB    568ms  color: 0 % de píxeles neutros, mínimo 90 %
angel-luciano-…-unsplash-s         color     nodos= 51864  rellenos=16   1010KB   1121ms  color: 4 % de píxeles neutros, mínimo 90 %
k1-drawing                         line-art  nodos= 17749  rellenos= 1    366KB    354ms  neutro (100 %) con 13 % de tinta
```

## 12. Reproducir

```bash
pnpm install
pnpm bench:bw        # 59 SVGs + nodos/bytes/ms y las señales por imagen
pnpm bench:serve     # http://127.0.0.1:8787/bw.html  → SSIM y F1 de tinta
pnpm bench:auto      # decisión + trazado del preset
pnpm test                # incluida la integración: el escaneo sale con un relleno
```
