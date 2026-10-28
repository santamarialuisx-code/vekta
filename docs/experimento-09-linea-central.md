# Experimento 09 — línea central: el contorno pasa dos veces, la cresta una

> Fecha: 2026-10-28 · `K1_drawing.jpg` (3000×1200) sobre Node 24, todo en CPU, sin navegador.
> Las cifras de longitud, nodos, trazos y tiempo son la salida real de `node bench/stroke.mjs`.
> **SSIM y F1 quedan PENDIENTE-MEDIR**: con una línea de 1 px no miden lo mismo que con un relleno
> (ver §7).

---

## 1. Veredicto corto

**El contorno no es una línea, son dos.** Donde el trazador entrega la frontera de la tinta (ida y
vuelta por cada trazo, más la cáscara de cada mancha), esta vía entrega la cresta: un solo recorrido
por el medio del trazo, que es lo que necesitan un grabado y un plotter de pluma.

En K1 la línea central mide **114 956 px frente a los 189 957 px del contorno** del mismo trazado:
**−39,5 % de recorrido**, con el mismo umbral y la misma máscara de tinta que el preset del
experimento 07.

| K1 (3000×1200, umbral Otsu 135→136) | Contorno (preset binario) | Línea central (`--tolerance 1`) |
|---|---:|---:|
| Recorrido | 189 957 px | **114 956 px** |
| Nodos en el SVG | 17 749 | 21 621 |
| Subpaths / polilíneas | 2 179 | 8 587 |
| Rellenos | 1 | **0 (`stroke`, `fill: none`)** |
| Tamaño del SVG | 366 KB | 205 KB |
| Tiempo (cómputo, sin decodificar) | 500–560 ms | 515 ms |
| SSIM | PENDIENTE-MEDIR | PENDIENTE-MEDIR |
| F1 de tinta | PENDIENTE-MEDIR | PENDIENTE-MEDIR |

Tres cosas que hay que decir juntas:

1. **Se gana en tinta recorrida, no en nodos.** A `--tolerance 1` la línea central tiene un 22 % más
   de nodos que el contorno suavizado, porque es una polilínea que sigue el escalón del píxel
   mientras el contorno es una curva ajustada. A `--tolerance 2` los nodos quedan a la par (18 852
   contra 17 749) manteniendo el −40,4 % de recorrido. La métrica que importa para una máquina es el
   recorrido y el número de veces que la pluma baja.
2. **Cero rellenos.** El SVG emitido lleva `stroke` y `fill="none"`: es un camino, no una silueta. Un
   grabador ya no tiene que decidir qué lado del borde es interior.
3. **No hay eje medial.** El adelgazado conserva la topología, así que un bloque macizo colapsa a un
   punto en vez de dar la X de sus diagonales. Sirve para trazos; para áreas hace falta sombreado,
   no esqueleto. Está en las limitaciones, no es un detalle menor.

---

## 2. Por qué hacía falta otra geometría

El banco venía midiendo perímetros de contorno: el experimento 02 los compara con uniones booleanas,
el 06 los compensa por kerf y el 07 los reduce a un solo relleno. Todo eso responde a «¿cuánto corta
una máquina?». Para grabado y pluma la pregunta es otra: **¿cuánto recorre la herramienta?**

Un trazo de 3 px de ancho tiene un contorno de ~2·largo + remates: el trazo se recorre dos veces (los
dos lados) y el grabador quema el doble de tiempo. La línea central es la curva que pasa por el medio
del trazo, un píxel de ancho, con la misma topología que la tinta.

Lo que se mide aquí es solo la geometría. La calidad visual (¿se parece al dibujo?) necesita su propia
vara, y esa está pendiente: el SSIM premia reproducir el gris del lápiz, y el F1 de la máscara de
tinta compara áreas, no crestas. Un trazo de 1 px dibujado sobre un trazo de 5 px real nunca va a
llenar la máscara, así que el F1 de este experimento no sería comparable con el 0,9436 del 07.

---

## 3. El camino, en tres pasos

Todo está en `bench/lib/skeleton.mjs`; el CLI es `bench/stroke.mjs`.

1. **`inkMask(gray, width, height, threshold)`** — binariza la luminancia. Se reutiliza el umbral del
   preset de line art (`lineArtOptions`, Otsu + 1) para no decidir dos veces qué es tinta. En K1 eso
   deja **466 770 px** de tinta, el 13 % de la imagen.
2. **`thin(mask, width, height, { maxIterations })`** — Zhang–Suen: dos subpasos por iteración, cada
   uno borrando frontera en un lado (noroeste / sureste) con las cuatro condiciones clásicas, y
   borrando todos los marcados a la vez para no sesgar el resultado hacia el orden de recorrido.
   Convierte los 466 770 px de tinta en **114 899 px** de esqueleto (4,1× menos) en **305 ms**.
   Dos arreglos sobre el algoritmo de libro, los dos con prueba:
   - una franja de 2 px se queda en una sola fila (sin esto el adelgazado deja dos crestas paralelas);
   - los extremos se alargan por dentro de la tinta hasta donde acaba el trazo original, porque
     Zhang–Suen se come ~2 px por punta en un trazo de 5 px (la punta es «frontera» como cualquier
     otro borde). Sin esto, cada trazo corto saldría más corto que el dibujo.
3. **`traceSkeleton(mask, width, height)`** — recorre el esqueleto y **corta en los nodos**: todo
   píxel cuyo grado no es 2 es extremo (1) o cruce (3 o más). Un cruce no se atraviesa: se convierte
   en cuatro polilíneas, porque una polilínea que gira dentro del cruce no se puede grabar sin
   levantar la pluma. Además se descarta el vecino diagonal redundante (aquel cuya conexión ya está
   hecha por el píxel ortogonal común): sin ese filtro el escalón de un círculo se lee como un cruce
   falso y un anillo sale partido en 31 trozos de 1–13 px en vez de un solo ciclo.

Después, `simplifyPolyline` (RDP, iterativo) convierte la escalera de píxel en segmentos, y
`maskLength` da la longitud total. `polylineLength` se reexporta de `path-to-polyline.mjs`: la misma
fórmula que miden los perímetros de corte, no una copia.

---

## 4. K1 con detalle

`node bench/stroke.mjs --only K1`. Los pasos están medidos por separado en el mismo proceso; el total
del CLI es el que reporta el propio CLI (tres corridas) e incluye además decodificar el JPEG y
escribir el SVG.

| paso | ms | salida |
|---|---:|---|
| decodificar el JPEG | 122 | 3000×1200 |
| señales de line art + `inkMask` | 137 | umbral 136, 466 770 px de tinta |
| `thin` | 305 | 114 899 px de esqueleto |
| `traceSkeleton` | 58 | 8 587 polilíneas, 124 107 puntos, 120 747 px |
| RDP (`tolerance` 1) | 15 | 21 621 nodos, 114 956 px |
| **total del CLI** (suma lo anterior + SVG + informe) | **626–689** | SVG de 205 KB + informe |
| contorno de comparación (motor binario + medición) | 500–560 | 17 749 nodos, 189 957 px, 366 KB |


El adelgazado se lleva el 60 % del cómputo: es una pasada por los píxeles que siguen siendo tinta,
dos veces por iteración. El contorno del motor tarda lo mismo para dar un 65 % más de recorrido.

La escalera de píxel sobreestima: sin RDP el recorrido es 120 747 px, un 4,8 % más, porque cada paso
diagonal mide √2 lo que mide su proyección. La tabla de tolerancias, medida sobre las mismas 8 587
polilíneas:

| `--tolerance` | nodos | longitud px | vs. crudo |
|---:|---:|---:|---:|
| 0,5 | 35 452 | 119 109 | −1,4 % |
| **1** (por defecto) | 21 621 | 114 956 | −4,8 % |
| 1,5 | 20 055 | 114 242 | −5,4 % |
| 2 | 18 852 | 113 278 | −6,2 % |
| 3 | 18 037 | 112 318 | −7,0 % |
| 4 | 17 734 | 111 754 | −7,4 % |

De 1 a 2 se pierden 2 769 nodos (−13 %) por 1 678 px de longitud (−1,5 %): para un plotter, cuya
restricción es el número de segmentos que dibuja, `--tolerance 2` es mejor negocio. El defecto se
queda en 1 porque es el que no se separa del trazo del lápiz.

### Por qué el contorno no mide exactamente el doble

La relación medida es **1,652**, no 2. En un trazo fino aislado el contorno mide ~2× (la prueba
sintética de la barra da 1,8–2,8), pero K1 tiene zonas macizas: un relleno aporta contorno completo y
casi nada de línea central, así que baja la media. Es la misma asimetría que hace que el esqueleto de
un cuadrado lleno sea un punto.

---

## 5. Lo que fijan las pruebas

`node --test bench/test/skeleton.test.mjs` — 9 pruebas, todas sintéticas (no hay verdad de referencia
para una línea central en un escaneo):

| prueba | qué fija |
|---|---|
| `inkMask` | la convención del motor: tinta = por debajo del umbral |
| franja de 2 px | el adelgazado deja **una** fila, con el largo de la franja y sin inventar filas |
| línea gruesa | una sola polilínea, extremos `[5,10]`–`[65,10]`, longitud **exactamente** 60 px (la del eje), y RDP la deja en dos puntos |
| anillo | un solo ciclo cerrado (primer punto = último), circunferencia en 45–75 px para radio 9,5 |
| cuadrado relleno | sin diagonales: ≤ 4 px de esqueleto y longitud ≤ 2 px, y todo trazo avanza píxel a píxel |
| cruce | dos barras en cruz dan exactamente 4 polilíneas, cada una con un extremo junto al centro |
| RDP | conserva las esquinas de una L (incluso con tolerancia 6), quita colineales y colapsa el escalón diagonal |
| CLI | emite `<slug>--centerline.svg` con `stroke`, `fill="none"` y `d="M20 20 L99 20"` para una barra sintética, con el informe en JSON |

La prueba del CLI existe porque el contrato del experimento no es «una función devuelve puntos» sino
«el archivo que se emite tiene `stroke` y ningún `fill`». Usa `--inputs` (misma convención que
`auto-trace.mjs`) para no depender del banco.

---

## 6. Reproducir

```bash
node bench/stroke.mjs --only K1
node bench/stroke.mjs --only K1 --tolerance 2 --out bench/out/stroke-tol2 --json bench/out/stroke-tol2.json
node --test bench/test/skeleton.test.mjs
```

Escribe `bench/out/stroke/<slug>--centerline.svg` y `bench/out/stroke-report.json`. Las tres imágenes
que no son line art se omiten con el motivo en el informe (`gum-tree-vector` 24 % de píxeles neutros,
`cityscape-sunset` 0 %, `angel-luciano` 4 %): adelgazar una foto no da una línea central, da una
maraña de crestas de tono.

> Pendiente de contenedor: `bench/out/stroke/`, `bench/out/stroke-report.json` y las variantes
> `bench/out/stroke-*` todavía no están en `.gitignore` (el resto de las salidas del banco sí).

---

## 7. Limitaciones (honestas)

1. **Cruces.** Cada nodo corta la traza. K1 sale con **8 587 polilíneas** (40 de ellas cerradas), y
   un plotter tendría que levantar la pluma 8 587 veces. Falta ordenar el recorrido y decidir si un
   cruce se atraviesa en una sola pasada; hoy se corta, que es lo único que no engaña.
2. **Espuelas.** **1 671 de 8 587** polilíneas (19 %) miden menos de 3 px después de RDP: son restos
   del adelgazado en los remates. El informe las cuenta (`shortPolylines`) en vez de esconderlas; no
   se podan aquí porque podar es una decisión de dibujo, no de geometría.
3. **Grosor variable.** Dos trazos de 2 px y de 12 px dan la misma línea central. Para grabar es lo
   correcto; para reproducir el dibujo, no. La punta de un trazo grueso se alarga en línea recta por
   la tangente, así que un remate redondeado queda como un apéndice recto de ~medio grosor.
4. **Rellenos.** Un bloque macizo colapsa a un punto: un cuadrado de 31×31 deja 1 px de esqueleto.
   No es un fallo del algoritmo, es qué significa «esqueleto», pero deja las áreas sin geometría
   grabable. Para eso hace falta sombreado/hatching, no línea central.
5. **Texto.** El adelgazado no distingue letras de dibujo. Un glifo con trazo fino sale bien; uno con
   contrafuerte grueso colapsa como cualquier relleno, y las letras pequeñas de un escaneo a 3000 px
   producen espuelas y lazos de 1–2 px.
6. **Esquinas agudas.** El adelgazado redondea y acorta las esquinas, y RDP con tolerancia 1 puede
   cortar hasta 1 px más: un vértice de 90° queda como un chaflán. Con tolerancia 0 (sin RDP) la
   esquina se conserva pero el nodo cuenta la escalera de píxel.
7. **Sesgo digital.** Una franja de 2 px se queda con una de sus dos filas originales, no con la
   línea intermedia: la cresta puede estar hasta 0,5 px fuera del eje real. Sin RDP, un trazo a 45°
   mide √2 por paso (4,8 % de más en K1).
8. **Extensión de extremos.** La punta se alarga en línea recta por dentro de la tinta. Si el trazo
   original acaba en curva cerrada, el alargamiento se queda dentro de la tinta pero no sigue la
   curva: es una aproximación, no una reconstrucción.
9. **SSIM y F1, PENDIENTE-MEDIR.** No se reportan porque no son comparables con los del experimento
   07: un camino de 1 px no cubre una máscara de tinta de 3 px de ancho. Hace falta una vara propia
   (por ejemplo, distancia media de la línea central a la máscara, o cobertura del esqueleto dentro de
   la tinta) y eso es el siguiente experimento, no este.
10. **Sin verdad de referencia.** Todo lo verificado son formas sintéticas con resultado escrito a
    mano. Sobre K1 hay cifras, no corrección: nadie ha dibujado a mano la línea central de K1 para
    comparar.
