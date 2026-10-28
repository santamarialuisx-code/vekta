# Experimento 08 — clasificación automática por categoría

> Fecha: 2026-10-28 · Regla de cascada sobre las **4 imágenes del banco**. Se comprueba la
> categoría, no una métrica de calidad nueva: aquí no hay SSIM ni F1 que inventar. Los nodos y
> rellenos que aparecen abajo son la salida real de `auto-trace.mjs`.

---

## 1. Veredicto corto

**Las cuatro imágenes caen donde el experimento 04 las midió, y el preset deja de ser un único
default de color.** La regla no pregunta nada: mide la imagen y devuelve categoría + motivo.

| Imagen del banco | Etiqueta del banco | Categoría decidida | Preset efectivo | Nodos | Rellenos |
|---|---|---|---:|---:|---:|
| `gum-tree-vector` | `logo-aa` | **illustration** | 12 col / `simplify` 0,6 | 7 083 | 11 |
| `cityscape-sunset-dfm3-01` | `poster` | **poster** | 16 col / `simplify` 0,8 | 8 055 | 16 |
| `angel-luciano-…-unsplash-s` | `photo` | **photo** | 12 col / `simplify` 0,8 | 43 214 | 12 |
| `k1-drawing` | `scan` | **line-art** | binario (Otsu) / 0,8 | 17 749 | 1 |

Los nodos coinciden con los del experimento 04 (7 083 / 8 055 / 43 214) porque son los mismos
presets; K1 sigue en el modo binario del experimento 07, que no se toca.

Lo que **no** es: un clasificador. Es una cascada de umbrales puesta en el hueco que dejan cuatro
imágenes, con caso de prueba. La sección 6 lo dice sin adornos.

---

## 2. Las señales

Todo sale de la imagen, en una pasada de píxel más el histograma que ya calculaba
`lib/lineart.mjs`. No se duplicó Otsu, ni luminancia, ni `neutralShare`.

| Señal | Qué mide | Cómo se calcula |
|---|---|---|
| `distinctColors` | cuántas ranuras de color gasta la imagen | canales cuantizados a 32 niveles (5 bits), combinaciones distintas |
| `luminanceEntropy` | cuánto se reparte el tono, 0..1 | entropía de Shannon del histograma de 256 bins ÷ 8 bits |
| `meanChroma` | saturación media | √(a²+b²) en **OKLab**, el mismo espacio en el que cuantiza el motor |
| `edgeDensity` | cuánta arista hay | Sobel de `lib/lineart.mjs`; se publica como contexto, no decide |
| `neutralShare` | proporción de píxeles sin croma | reutilizada de `lib/lineart.mjs` |
| `inkShare` | proporción bajo el umbral de Otsu | reutilizada de `lib/lineart.mjs` |

Medido sobre el banco (sale de `node bench/classify.mjs`):

| Imagen | Categoría | Colores | Entropía | Borde | Croma | Neutro | Tinta |
|---|---|---:|---:|---:|---:|---:|---:|
| `gum-tree-vector` | illustration | 887 | 52 % | 10 % | 5 % | 24 % | 59 % |
| `cityscape-sunset-dfm3-01` | poster | 1 085 | 76 % | 13 % | 10 % | 0 % | 34 % |
| `angel-luciano-…` | photo | 3 975 | 93 % | 39 % | 9 % | 4 % | 59 % |
| `k1-drawing` | line-art | 32 | 60 % | 34 % | 0 % | 100 % | 13 % |

Dos lecturas que ordenan la regla:

- **Colores** separa la foto (3 975) del arte plano (887–1 085). El corte está en 2 000.
- **Croma** separa el póster (croma 0,097) de la ilustración (0,046) *después* de descartar la
  foto; el corte está en 0,07.

`borde` y `separabilidad` no deciden: la foto tiene 39 % de aristas y K1 el 34 %, y la separabilidad
del Gum Tree (0,80) supera a la de la foto (0,65). Ya lo dejó escrito el experimento 07.

---

## 3. La regla, en una frase por categoría

```
1. line art    · looksLikeLineArt (neutro ≥ 90 % y tinta ≤ 40 %)     ← reutiliza lineart.mjs
2. foto        · neutra pero no line art (foto en blanco y negro)
                 ó > 2 000 colores distintos
                 ó entropía de luminancia > 0,85
3. póster      · croma medio ≥ 0,07 (color plano saturado de borde a borde)
4. ilustración · el resto: paleta corta, croma bajo y fondo neutro
```

El orden es la mitad de la regla. Una foto saturada también tiene croma alto; una foto en blanco y
negro es tan neutra como un escaneo. Cada categoría se descarta antes de mirar la siguiente, y el
motivo devuelto nombra **la señal que decidió, con su umbral**, igual que `looksLikeLineArt`:

```
ilustración: croma medio 5 % con paleta corta (887 colores)
póster: croma medio 10 %, mínimo 7 % para color plano saturado
foto: 3975 colores distintos a 32 niveles, máximo 2000 para arte plano
line art: neutro (100 %) con 13 % de tinta
```

Los umbrales son constantes exportadas, no números sueltos en una condición:

| Constante | Valor | Dónde cae |
|---|---:|---|
| `quantizeBits` | 5 | 32 niveles por canal = 32 768 combinaciones |
| `photoMinColors` | 2 000 | entre 1 085 (póster) y 3 975 (foto) |
| `photoMinEntropy` | 0,85 | entre 0,76 (póster) y 0,93 (foto) |
| `posterMinMeanChroma` | 0,07 | entre 0,046 (ilustración) y 0,097 (póster) |

El caso de la foto en blanco y negro reutiliza el motivo que ya produce `looksLikeLineArt` cuando
descarta una imagen por exceso de tinta; no se reescribe la condición.

---

## 4. Lo que imprime el banco

`node bench/classify.mjs` — clasifica sin trazar:

```
imagen                                categoría     colores  entropía  borde  croma  neutro  tinta  preset        motivo
gum-tree-vector                       illustration      887      52 %   10 %    5 %    24 %   59 %  12 col / 0,6  ilustración: croma medio 5 % con paleta corta (887 colores)
cityscape-sunset-dfm3-01              poster           1085      76 %   13 %   10 %     0 %   34 %  16 col / 0,8  póster: croma medio 10 %, mínimo 7 % para color plano saturado
angel-luciano-latyezyw88c-unsplash-s  photo            3975      93 %   39 %    9 %     4 %   59 %  12 col / 0,8  foto: 3975 colores distintos a 32 niveles, máximo 2000 para arte plano
k1-drawing                            line-art           32      60 %   34 %    0 %   100 %   13 %  bw / 0,8      line art: neutro (100 %) con 13 % de tinta
```

`node bench/auto-trace.mjs --out bench/out/auto --json bench/out/auto-report.json` — decide y traza:

```
gum-tree-vector                    illustration 12 col / 0,6   nodos=  7083  rellenos=11    181KB    534ms  ilustración: croma medio 5 % con paleta corta (887 colores)
cityscape-sunset-dfm3-01           poster       16 col / 0,8   nodos=  8055  rellenos=16    171KB    705ms  póster: croma medio 10 %, mínimo 7 % para color plano saturado
angel-luciano-latyezyw88c-unsplash-s photo        12 col / 0,8   nodos= 43214  rellenos=12    856KB   1287ms  foto: 3975 colores distintos a 32 niveles, máximo 2000 para arte plano
k1-drawing                         line-art     bw / 0,8       nodos= 17749  rellenos= 1    366KB    482ms  line art: neutro (100 %) con 13 % de tinta

4 SVGs en bench\out\auto
informe → bench\out\auto-report.json
```

La paleta efectiva puede quedar por debajo del máximo (Gum Tree: 11 rellenos con presupuesto 12),
porque el cuantizador descarta clústeres sin área; el presupuesto es un techo, no una cuota. Los
milisegundos varían entre ejecuciones; nodos, rellenos y bytes de una misma versión, no.

---

## 5. Presets por categoría

Copiados del experimento 04 (mayor `simplify` cuya caída de SSIM no pase de 0,005), sin recalcular:

| Categoría | Colores | `simplify` |
|---|---:|---:|
| ilustración | 12 | 0,6 |
| póster | 16 | 0,8 |
| foto | 12 | 0,8 |
| line art (color, exp. 04) | 16 | 1,2 |

**El line art es la excepción documentada.** `CATEGORY_PRESETS['line-art']` guarda lo que midió el
experimento 04 en el pipeline de color (16 / 1,2), pero `auto-trace.mjs` no lo usa: el experimento 07
demostró que el modo binario con el Otsu de la imagen gana en trazo, en nodos y en tiempo. El preset
efectivo lo resuelve `tracePreset('line-art', signals)` → `{ colors: 1, clustering: 'bw',
binaryThreshold: Otsu + 1, simplify: 0,8 }`. Así el número medido no se pierde y el camino del
producto no se degrada.

---

## 6. El riesgo: cuatro imágenes

Con cuatro casos no se calibra un clasificador, y este documento no pretende lo contrario. Los
umbrales están en el punto medio de los huecos que dejan esas cuatro imágenes; si el banco crece,
hay que volver a medirlos, no asumirlos. Estos son los fallos previsibles:

- **Póster con fondo blanco** → cae en `illustration` (croma medio bajo) y usa 12 / 0,6 en vez de
  16 / 0,8. El daño es un presupuesto de color más corto, no una imagen rota.
- **Ilustración saturada de borde a borde** → cae en `poster` y usa 16 / 0,8. Es el preset más
  generoso de los dos, así que el error también es barato.
- **Arte plano con ruido de JPEG** → si cruza los 2 000 colores a 32 niveles, cae en `photo`. Gum
  Tree está en 887: hay margen, pero no es una garantía para todos los JPEG.
- **Foto en blanco y negro con dominante de color** → si pierde `neutralShare`, depende de colores y
  entropía. El caso neutro puro está cubierto; el casi-neutro no se ha medido.
- **Categorías fuera del banco** (acuarela, cómic, captura de pantalla) no tienen preset propio: se
  reparten entre las cuatro anteriores. No hay datos para afirmar nada sobre ellas.

La regla se entrega con **caso de prueba**, no con una promesa de precisión. Cualquier cifra de
acierto sobre el banco sería circular: los umbrales se eligieron mirando esas mismas cuatro
imágenes.

---

## 7. Lo que se entrega

**`bench/lib/category.mjs`** — el modelo y la regla.

- `CATEGORY_RULES` — umbrales documentados (`quantizeBits`, `photoMinColors`, `photoMinEntropy`,
  `posterMinMeanChroma`).
- `CATEGORY_PRESETS` — presets por categoría del experimento 04.
- `imageSignals(rgba, width, height)` — señales de categoría + las de `lineArtSignals`.
- `classifyImage(signals)` → `{ category, reason }`, con
  `line-art | illustration | poster | photo`.
- `tracePreset(category, signals)` — preset efectivo (binario en line art, medido en el resto).

**`bench/classify.mjs`** — CLI que imprime la tabla de decisión. No escribe SVG; acepta `--only` y
`--inputs`, igual que `auto-trace.mjs`.

**`bench/auto-trace.mjs`** — elige preset por categoría. `--colors` y `--simplify` siguen existiendo
como sobrescritura explícita; el informe añade `category`, `sourceCategory`, `preset` y las señales.
El campo `decision` (`line-art` / `color`) se conserva para no romper a quien ya leía el informe.

**`bench/test/category.test.mjs`** — 14 pruebas: medida de señales (colores a 32 niveles, entropía,
croma en OKLab), constantes y presets, las cuatro categorías con imágenes sintéticas, el orden de la
cascada (foto en blanco y negro, foto saturada), `tracePreset`, la tabla del CLI y la integración de
`auto-trace` (escaneo con un relleno y umbral 50; póster con su preset).

---

## 8. Verificación

```
$ node --test bench/test/category.test.mjs
✔ imageSignals cuenta colores a 32 niveles, entropía y croma en OKLab
✔ el croma medio es el de OKLab, el mismo espacio en que cuantiza el motor
✔ los umbrales son constantes exportadas, no números sueltos
✔ los presets son los que midió el experimento 04
✔ trazar un line art usa el preset binario, no el de color del experimento 04
✔ un escaneo es line-art y reutiliza la regla de lineart.mjs
✔ una foto en blanco y negro es foto, no line art ni ilustración
✔ una foto de color se reconoce por la cantidad de colores
✔ un póster es paleta corta con croma alto
✔ una ilustración es paleta corta con fondo neutro
✔ el orden de la cascada importa: el color saturado no adelanta a la foto
✔ classifyImage exige las señales de la imagen
✔ classify.mjs imprime la tabla de decisión y no traza nada
✔ auto-trace elige el preset por categoría y conserva el camino binario
ℹ tests 14 · pass 14 · fail 0
```

```
$ node bench/auto-trace.mjs --out bench/out/auto --json bench/out/auto-report.json
```

La salida es la de la sección 4: `scan → line-art`, `logo-aa → illustration`, `poster → poster`,
`photo → photo`.

La suite completa (`npm test`) no se ejecutó en esta tarea; solo se modificó `auto-trace.mjs` fuera
de los ficheros nuevos, y su prueba de integración existente se replica dentro de
`category.test.mjs`.

---

## 9. Pendiente

- **PENDIENTE-MEDIR**: SSIM y F1 de tinta por categoría comparando el preset elegido contra el
  default único anterior. Aquí no se midieron y no se citan cifras.
- **PENDIENTE-MEDIR**: precisión de la regla sobre un banco más grande (≥ 20 imágenes por categoría).
  Con cuatro no se puede afirmar; los umbrales actuales son el punto de partida.
- Repetir la calibración del experimento 04 si el banco crece: los presets por categoría son de estas
  cuatro imágenes, no de la categoría en abstracto.
