# Experimento 10 — Archivo de producción: entrada, anidado y tintas

> Fecha: 2026-10-28 · Cierra las tres promesas que el experimento 06 dejó abiertas: entrada de
> herramienta, anidado en hoja y tintas con nombre y orden. Verificación: `node --test` sobre las
> tres suites nuevas (22 pruebas) más las del código tocado, y emisión real sobre los SVG del banco.
> SSIM y F1 no aplican: acá no se compara una imagen contra otra, se mide geometría, formato y
> colocación.

---

## 1. Veredicto corto

**El DXF dejó de ser una demostración y pasó a ser un archivo de taller.** Tres transformaciones
sobre la misma geometría, ninguna de ellas cosmética:

- **Entrada y salida**: el contorno se corta abierto, con dos segmentos que llegan desde el scrap,
  de largo y ángulo exactos, sin perforar la pieza. Sobre la pieza real del banco, el recorrido pasa
  de **311,326 mm a 315,326 mm** — los 4 mm son las dos entradas de 2 mm.
- **Anidado**: la pieza se coloca en la hoja y el informe dice cuánto ocupa o que no cabe. Dos
  piezas de 100×50 con 5 mm de hueco entran en 220×120 (ocupación **37,88 %**) y no entran en
  190×100 (queda una fuera, se informa).
- **Tintas**: una capa DXF por color con nombre (`CUT-1`, `CUT-2`… o `--spot-names rojo,azul`), su
  área y el orden de impresión por área descendente, con tabla de capas en el archivo.

Sin las banderas nuevas, la salida no cambia **ni un byte**: se comparó el DXF y el SVG de
`gum-tree-vector__cutout-opt` en píxeles y en mm con kerf contra la versión anterior, y los cuatro
archivos salieron idénticos.

---

## 2. Banderas nuevas

| Bandera | Qué hace | Por defecto |
|---|---|---|
| `--lead-mm n` | largo de la entrada y la salida, en mm | `0` (sin entrada) |
| `--lead-angle 0-90` | ángulo de la entrada respecto de la tangente: 0 = tangencial, 90 = perpendicular | `0` |
| `--nest` | coloca la pieza en la hoja | apagado |
| `--sheet ANCHOxALTO` | medida de la hoja en mm (`--sheet 300x200`) | — |
| `--gap-mm n` | separación entre piezas y entre estantes | `0` |
| `--spot-names rojo,azul` | un nombre de tinta por color, en orden de impresión | `CUT-1`, `CUT-2`… |

`--lead-mm` y `--nest` exigen `--width-mm`: son milímetros, y sin ancho físico la geometría está en
píxeles. Con cualquiera de las dos, la silueta se emite **sólo en DXF** y se avisa por consola: una
trayectoria abierta no es un SVG relleno, y cerrarla en el SVG dibujaría una línea de más.

---

## 3. Entrada de herramienta

### El criterio del lado

`unionRings` y `offsetRings` devuelven los anillos con el **material a la izquierda** del sentido de
giro: contornos con área positiva, agujeros con área negativa, igual que distingue el kerf. Entonces
el scrap, para una dirección de avance `t = (tx, ty)`, es siempre la derecha:

```
n = (ty, -tx)        // scrap: afuera del contorno, adentro del agujero
```

No hay que mirar el signo del área para elegir el lado; el signo se usa para otra cosa: rankear los
vértices. El punto de ataque es el vértice **más convexo desde el material** (el de mayor giro,
empate por orden), porque ahí el scrap ocupa más ángulo y la tangente hacia atrás queda fuera.

La entrada va hacia atrás de la tangente del borde de salida y la salida hacia delante del borde de
llegada, las dos inclinadas `angleDeg` hacia el scrap:

```
entrada = cos(φ) · (-t_salida)  + sin(φ) · n_salida
salida  = cos(φ) · (+t_llegada) + sin(φ) · n_llegada
```

Con φ = 0° las dos son tangentes puras (la herramienta entra ya moviéndose en la dirección de
corte: no hay cambio de dirección ni marca de permanencia) y con φ = 90° son perpendiculares.

### Cuadrado de 100 mm, con números

```
entrada 0°:  (-5, 0) → (0, 0) → (100, 0) → (100, 100) → (0, 100) → (0, 0) → (0, -5)
```

- largo de cada entrada: 5 mm exactos;
- ángulo con el borde: 0° exactos;
- los dos segmentos están en `x < 0` / `y < 0`: fuera del cuadrado, tocándolo sólo en el vértice.

Con 45° la entrada mide 5 mm y forma 45,000° con el borde de salida, y la salida 45,000° con el de
llegada. En una esquina recta con 45° las dos caen sobre la misma diagonal del scrap: el recorrido
empieza y termina en el mismo punto, y la polilínea sigue siendo abierta (el vértice de ataque se
repite en el recorrido). Es scrap, se corta dos veces ahí y no afecta a la pieza.

### Lo que no se abre

Un vértice sólo se acepta si los dos segmentos quedan en el scrap (se muestrean 9 puntos por
segmento y se comprueba de qué lado del anillo caen) y no cortan ninguna arista del mismo anillo. Si
ningún vértice sirve, el anillo **se devuelve cerrado** y el informe lo cuenta en `closedPaths`. Pasa
con los agujeros convexos: en un cuadrado o un círculo hueco no hay vértice desde el que entrar
tangencialmente sin tocar material, y una perpendicular inventada sería peor que no entrar.

---

## 4. Anidado

Estantes, no optimización: las piezas se ordenan por alto del lado corto (descendente) y cada una
entra en el primer estante donde cabe; si no cabe en ninguno se abre un estante nuevo debajo. La
rotación de 90° se prueba sólo si se permite y se prefiere sin girar.

Convenio de la colocación: `{ dx, dy, rotated }` = gira la pieza 90° en el plano y deja su caja
envolvente con la esquina en `(dx, dy)`. El hueco se aplica entre piezas y entre estantes; el borde
de la hoja no reserva margen.

| Caso | Resultado |
|---|---|
| 2 piezas 100×50, hoja 220×120, hueco 5 | colocadas en (0,0) y (105,0); usado 205×50; ocupación 10 000/26 400 = **37,88 %** |
| 2 piezas 100×50, hoja 190×100, hueco 5 | 1 colocada, `unplaced: [1]`; ocupación 5 000/19 000 = **26,32 %** |
| pieza real `cutout-pal12` 100×66,667, hoja 300×200 | ocupación 6 666,667/60 000 = **11,11 %** |
| pieza real `cutout-opt` 100×55,357, hoja 80×40 | `fits: false`, `unplaced: [0]`, ocupación **0 %** |

La ocupación es área de material (agujeros descontados) sobre área de hoja, no área de la caja
usada: mide material, no rectángulo.

---

## 5. Tintas

`spotLayers(shapes)` agrupa por color, une cada capa, calcula el área y ordena por área descendente.
El nombre se asigna **en orden de impresión**, no en orden de aparición en el archivo: la tinta que
cubre más superficie va primero, que es lo que pide el secado y el registro.

El área no se calcula por el signo del giro: `unionRings` devuelve el giro canónico sólo cuando pasa
por Clipper, y cuando una capa tiene un solo polígono devuelve el giro original. La jerarquía se
resuelve por anidamiento (profundidad par contorno, impar agujero), así que un agujero resta siempre.

El DXF de capas lleva tabla `LAYER` con un registro por tinta, y cada polilínea en su capa. Sobre
una pieza de 40×20 con un agujero de 6×6 y un cuadrado azul de 20×20:

```
tintas: 1. rojo #0000ff 400 mm²  2. azul #ff0000 364 mm²
```

— 400 mm² del cuadrado de 20×20 y 364 mm² del de 20×20 menos el agujero de 36 mm². Los nombres se
asignaron por orden, así que el área mayor recibió el primer nombre de la lista.

---

## 6. Verificación

```
$ node --test bench/test/spot.test.mjs bench/test/lead.test.mjs bench/test/nest.test.mjs
ℹ tests 22   ℹ pass 22   ℹ fail 0

$ node --test bench/test/spot.test.mjs bench/test/lead.test.mjs bench/test/nest.test.mjs \
    bench/test/dxf.test.mjs bench/test/cut-cli.test.mjs bench/test/kerf.test.mjs
ℹ tests 32   ℹ pass 32   ℹ fail 0

$ node bench/cut.mjs --only gum-tree-vector__cutout-opt --width-mm 100 --kerf-mm 0.2 \
    --lead-mm 2 --lead-angle 45 --format dxf
gum-tree-vector__cutout-opt    R 88772  E 4350  L 88340.1  R/U 1.92   100×55.557 mm  kerf 0.2 mm
informe: lead [lengthMm 2, angleDeg 45, openPaths 1, closedPaths 0]
error máximo de lo emitido: 0.00 %
recorrido medido en el DXF: 315,326 mm  (nominal 311,326 mm → +4,000 mm = 2 × 2 mm)
```

Pruebas nuevas: largo y ángulo exactos sobre el cuadrado de 100 mm (con el camino completo
comparado punto por punto), ninguna muestra de entrada o salida dentro de la pieza entre 0° y 90°,
anillo degenerado, agujero convexo que se devuelve cerrado, escala mm/píxel; anidado que cabe, que no
cabe, rotación permitida y no permitida, ocupación a mano, pieza más grande que la hoja; nombres por
orden de impresión, área con agujero, escala del área, orden sin mutar la entrada.

**Sin banderas nuevas no cambia nada**: el DXF y el SVG de `gum-tree-vector__cutout-opt` en píxeles y
en mm con kerf 0,2 salieron idénticos byte a byte contra la versión anterior, y el informe del banco
coincide campo por campo salvo `ms` y las rutas de salida.

---

## 7. Limitaciones

- **Kerf variable.** Se sigue compensando con un radio constante. Entrada de herramienta y kerf son
  transformaciones separadas: primero el kerf, después la entrada, sobre la trayectoria ya
  compensada.
- **Esquinas no tangentes.** La entrada es una recta; no hay arco ni rampa, así que en una esquina
  con ángulo interior muy agudo el segmento puede quedar corto en el papel de la máquina aunque no
  toque material.
- **Agujeros sin entrada.** Un agujero convexo se corta cerrado (ver §3). La entrada perpendicular
  desde el hueco es el paso siguiente, y necesita una bandera propia porque el ángulo pedido no
  aplica igual.
- **Ningún cruce contra los demás anillos.** La comprobación de "no cortar" es contra el propio
  anillo, no contra el resto de la pieza: una concavidad vecina muy cerca del punto de ataque puede
  quedar cruzada por la entrada.
- **Anidado no óptimo.** Estantes: no busca el mínimo de hoja, no prueba rotaciones arbitrarias ni
  encaja piezas en huecos de otras. Con una pieza por archivo de entrada, además, el anidado de este
  banco sólo coloca una: el algoritmo está probado con varias piezas en las pruebas unitarias.
- **Margen de hoja.** El hueco no se reserva contra el borde: la pieza puede empezar en (0,0).
- **No se probó en una máquina.** La validación es estructural (DXF válido, capas, cotas, largos).
  Falta abrirlo en LightBurn real, ver la entrada en el preview y cortar.

---

## 8. Siguiente

1. **Entrada en agujeros** con bandera propia (perpendicular desde el hueco, o rampa).
2. **Nesting real por archivo**: hoy una entrada es una pieza; falta un modo que tome varias piezas
   y emita una hoja con todas.
3. **Kerf variable** por ángulo y material: es el último supuesto constante que queda en la
   geometría.
