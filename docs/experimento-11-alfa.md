# Experimento 11 — El alfa como línea de corte

> Fecha: 2026-10-28 · Banco: 1 fixture nuevo (dona 400 × 400 con alfa real) ·
> Método: `bench/alpha-cut.mjs` · Verificación: `node --test bench/test/alpha.test.mjs`.

---

## 1. Veredicto corto

**Con fondo transparente, la silueta deja de ser el rectángulo del lienzo.** Eso era exactamente lo
que el experimento 02 no pudo medir: sus cuatro imágenes cubren el lienzo, así que su `E` era
`2·(ancho + alto)` —el perímetro del rectángulo— y el «corte de pieza» no tenía pieza. Aquí la
silueta es la frontera que el diseñador dibujó en el alfa, y es la primera vez que el número
significa algo.

Sobre una dona de 400 × 400 (r₁ = 170, r₂ = 80):

| Magnitud | Esperado | Emitido | Error |
|---|---:|---:|---:|
| Perímetro `E` | `2π(r₁ + r₂)` = 1 570,80 px | **1 573,32 px** | +0,16 % |
| Área | `π(r₁² − r₂²)` = 70 685,83 px² | **70 672,18 px²** | −0,02 % |
| Anillos | 1 exterior + 1 agujero | **2 anillos, 1 con agujero** | — |
| Caja | 340 × 340 px (radio 170) | 341,07 × 341,13 px | +0,3 % |

Y el punto que importa, sin adornos: **la silueta de la dona mide casi lo mismo que el rectángulo
del lienzo** (1 573 px frente a 1 600 px, un 1,7 % menos). Comparar longitudes acá engaña. Lo que
cambia no es cuánto se recorre, es **qué se recorta**: el rectángulo no es la pieza. El área lo dice
sin ambigüedad: 70 672 px² de pieza frente a 160 000 px² de lienzo — **el 44,2 %**.

---

## 2. El caso que faltaba

El experimento 02 cerró con esta limitación, textual:

> **La silueta no se pudo probar en su caso real.** Ninguna de las cuatro imágenes tiene fondo
> transparente, así que `E` es siempre el rectángulo del lienzo. El mecanismo está probado (pruebas
> con dona y con dos cuadrados), pero falta una imagen con alfa en el banco.

Este experimento agrega el fixture que faltaba (`bench/inputs/alpha-donut.png`, 6 158 bytes) y el
camino de producto que lo usa. El detalle de 02 que ahora se puede leer al revés: en Gum Tree
`E = 4 350 = 2·(1400 + 775)` era *el perímetro del lienzo*, no el de la figura. Con alfa, `E` es
una propiedad del dibujo.

---

## 3. Método

Nada de geometría inventada: el camino es el del motor.

```
alfa del PNG → máscara 0/1 → imagen de gris 0/255 → vtracer «bw» → unión → SVG + DXF
```

### 3.1 ¿El alfa es información o es un 255 global?

Un PNG de 8 bits guarda canal alfa aunque la imagen no tenga transparencia, así que «tiene alfa» no
significa «tiene forma». `alphaHasTransparency` decide por **proporción de píxeles opacos**:

- `maxOpaqueShare = 0,995`. Si el 99,5 % o más de los píxeles son 255, el alfa no describe nada:
  la silueta sería el rectángulo del lienzo y el CLI se niega a emitir.
- El umbral tolera el antialiasing de un borde (deja alfa parcial en el perímetro) y no un lienzo
  lleno. En la dona: **43,7 % opaco, 55,3 % transparente, 0,95 % parcial** — el 0,95 % parcial es
  justamente el antialiasing del borde, y es la prueba de que el alfa es real y no un relleno.

### 3.2 La máscara y su tolerancia

`alphaMask` umbraliza el alfa en 128 y devuelve 0/1. La `tolerance` (por defecto 1 px) **no es un
cierre morfológico ni un voto de mayoría**: un píxel que no tiene ni un vecino de su mismo valor en
ese radio es ruido y se invierte. La diferencia no es cosmética — en una ventana de 3 × 3 una
esquina de 90° está en minoría (4 propios contra 5 del fondo), así que una mayoría se come las
esquinas de la pieza. Acá sólo desaparece lo que está completamente solo: motas de un píxel fuera
del sujeto y agujeros de un píxel dentro.

### 3.3 La imagen que come el motor

`maskToLuminance` emite **sólo 0 y 255**, con el sujeto en negro. Dos razones:

1. `clustering: 'bw'` considera tinta lo que cae *por debajo* del umbral (`bench/lib/lineart.mjs`),
   así que el sujeto tiene que ser el negro. Si se invirtiera, el motor trazaría el fondo.
2. Con dos únicos niveles, `binaryThreshold: 128` es el punto medio exacto entre ellos: no hay gris
   que decidir, y el resultado no depende de Otsu ni del contenido de la imagen. Un solo umbral
   fijo sirve para toda entrada.

El resto de las opciones es el preset de line art medido en el experimento 07
(`mode: spline`, `hierarchical: cutout`, `optimize: 2`, `simplify: 0,8`). Con `simplify` 0 la dona
sale a +0,61 % de perímetro con 397 nodos; con 0,8, a +0,16 % con 192 nodos — y el archivo pasa de
7 469 a 1 595 bytes.

### 3.4 Emisión y medición

Se reutiliza lo que ya existía: `lib/cut-svg.mjs` (silueta con `fill-rule="evenodd"`),
`lib/dxf.mjs` (R2000, `$INSUNITS = 4`), `lib/units.mjs` (escala desde el ancho real) y
`lib/kerf.mjs` (compensación de radio). El informe publica área y perímetro **medidos sobre el
archivo escrito**, volviendo a leer su `d` con `lib/path-to-polyline.mjs`, no sobre la geometría en
memoria. En la dona el error de lo emitido queda por debajo de 0,01 % en perímetro y área.

Comandos:

```bash
node bench/alpha-cut.mjs --in bench/inputs/alpha-donut.png
node bench/alpha-cut.mjs --in pieza.png --width-mm 100 --kerf-mm 0.2
node bench/test/alpha.test.mjs
```

Salida por entrada: `<nombre>--silhouette.svg` y `<nombre>--silhouette.dxf`, más
`bench/out/alpha-report.json`.

---

## 4. Cifras del fixture, en las tres unidades que importan

`bench/inputs/alpha-donut.png`: 400 × 400, centro (200, 200), r₁ = 170, r₂ = 80, color plano
`rgb(200 64 48)`, alfa por cobertura con supermuestreo 4 × 4 (17 niveles, sin ruido).

| Caso | Caja | Perímetro | Área |
|---|---:|---:|---:|
| Píxeles | 341,07 × 341,13 px | 1 573,32 px | 70 672,18 px² |
| `--width-mm 100` | 100,00 × 100,02 mm | 461,29 mm | 6 075,34 mm² |
| `--width-mm 100 --kerf-mm 0.2` | 100,20 × 100,22 mm | 461,20 mm | 6 121,47 mm² |

Dos lecturas que valen para el taller:

- **La caja emitida supera al diámetro nominal en ~1 px** (341,07 frente a 340). Es el borde del
  alfa: el umbral 128 corta donde el píxel está medio cubierto, es decir ~0,5 px fuera del radio
  geométrico por cada lado, y el ajuste de spline redondea el resto. Está por debajo de cualquier
  kerf.
- **El kerf deja el perímetro casi igual y sube el área.** En una dona, compensar 0,2 mm suma
  2π·r al contorno exterior y resta 2π·r al del agujero: el recorrido total no cambia (461,29 →
  461,20 mm). El área sí: +46,13 mm², y la teoría dice `2π·r·(R₁ + R₂) = 46,2 mm²` con
  `R₁ = 50 mm`, `R₂ = 23,5 mm` y `r = 0,1 mm`. El kerf no es un detalle de emisión: cambia la pieza.

---

## 5. Por qué el corte de pieza por fin significa algo

| Flujo | Qué se emite | Qué recorta la máquina |
|---|---|---|
| Exp. 02, imágenes que cubren el lienzo | unión de todo | el rectángulo del lienzo (1 600 px en una imagen de 400 × 400) |
| Exp. 11, PNG con alfa | unión del sujeto | la pieza dibujada (1 573 px, 70 672 px² de 160 000) |

Un taller no paga el recorrido, paga la pieza mal cortada. Con el rectángulo del lienzo, o se corta
un marco que nadie pidió, o no se corta nada. Con alfa, el mismo `E` del experimento 02 pasa a ser
el contorno del diseño, agujeros incluidos, y el SVG y el DXF que salen ya son el archivo que va a
la máquina (con unidades declaradas y kerf compensado si se pide el ancho real).

Lo que **no** cambia: el flujo de color (vinilo/DTF por capas) sigue siendo el del experimento 02.
El alfa sólo decide qué es sujeto; si hay que reproducir color, `flattenOntoWhite` compone el alfa
sobre blanco antes de cuantizar, porque un PNG transparente guarda negro donde no hay nada y
cuantizar ese negro mete una región que el diseñador no dibujó.

---

## 6. API

`bench/lib/alpha.mjs`:

| Función | Qué hace |
|---|---|
| `alphaStats(rgba)` | proporciones opaca / transparente / parcial del alfa |
| `alphaHasTransparency(rgba, { maxOpaqueShare })` | ¿el alfa describe forma o es un 255 global? |
| `alphaMask(rgba, width, height, { tolerance })` | máscara 0/1 del sujeto, con limpieza de píxeles aislados |
| `maskToLuminance(mask, width, height)` | imagen `{ width, height, rgba }` con 0/255, lista para `clustering: 'bw'` |
| `flattenOntoWhite(rgba, width, height)` | composición sobre blanco para el camino de color |

Constantes públicas: `ALPHA_RULES` (`minAlpha: 128`, `maxOpaqueShare: 0.995`, `tolerance: 1`) y
`ALPHA_TRACE_OPTIONS` (el preset de trazado), para que la doc, el CLI y las pruebas hablen de los
mismos números.

---

## 7. Verificación

**8 pruebas** en `bench/test/alpha.test.mjs`, todas por la interfaz pública (nada de leer estado
interno):

1. La dona tiene alfa real: `alphaHasTransparency` da `true`, el 44,2 % del lienzo es sujeto
   (a menos del 1 % de `π(r₁² − r₂²)`), hay alfa parcial y la máscara acierta en el agujero y en la
   corona.
2. Un PNG opaco se detecta como alfa inútil; con medio lienzo transparente, ya es útil.
3. El ruido de un píxel: cuatro motas (dos transparentes dentro, dos opacas fuera) desaparecen con
   `tolerance: 1` y la máscara queda **idéntica** al cuadrado limpio.
4. `maskToLuminance` sólo emite 0 y 255, con el sujeto en negro y alfa opaco.
5. `flattenOntoWhite`: transparente → blanco, opaco → intacto, alfa 128 → 127, y no muta la entrada.
6. La dona trazada: 2 anillos, 1 con agujero, 2 subpaths en el `d` del SVG, perímetro a menos del
   2 % de `2π(r₁ + r₂)`, área a menos del 2 % de `π(r₁² − r₂²)`, área menor que el disco lleno (el
   agujero resta), y el perímetro del JSON igual al medido sobre el archivo.
7. `--width-mm 100 --kerf-mm 1`: caja compensada 100 + 2·0,5 mm, `mm` en el SVG, perímetro físico en
   rango, DXF con los 2 anillos.
8. Una imagen sin alfa útil: el CLI sale con código 1 y el mensaje nombra la causa
   (`el alfa no aporta silueta: 100,0 % de los píxeles son opacos`).

Lo que se midió sobre los archivos emitidos: **perímetro y área por debajo de 0,01 % de lo
calculado** en los tres casos del fixture (px, mm y kerf).

---

## 8. Limitaciones

- **El fixture es sintético.** Mide el mecanismo (alfa como corte), no el alfa de un export real:
  una foto recortada con sombras suaves o un PNG con vidrio semitransparente tienen regiones
  parciales que el umbral 128 parte donde caiga. Falta un caso real en el banco.
- **La tolerancia sólo limpia píxeles aislados.** Una mota de 2 × 2 px sobrevive; para eso haría
  falta un filtro de área mínima, que mueve el borde y hay que decidir con el taller.
- **La escala sale de la caja.** `--width-mm` fija el ancho de la caja envolvente, no el diámetro del
  sujeto: con bordes de alfa de ~0,5 px, el diámetro queda ~0,3 % por debajo del nominal.
- **`--kerf-mm` exige `--width-mm`** y el CLI lo rechaza si falta: sin escala física, un radio en mm
  no significa nada. `bench/cut.mjs` no lo exige (trabaja en px por defecto); la diferencia es
  deliberada.
- **Sin SSIM ni F1.** Este experimento mide geometría de corte, no fidelidad de imagen; esa vara es
  la del experimento 01 y no se mezcla acá.

---

## 9. Siguiente

1. **Un PNG real** (recorte de foto o ilustración con alfa) en el banco, para ver qué hace el umbral
   128 con sombras y bordes suaves.
2. **Área mínima de agujero** como opción de la máscara: los agujeros de 1–4 px son ruido de
   exportación y hoy sólo se limpian si son de un píxel.
3. **Capa de color + silueta en un solo informe**: hoy `alpha-cut.mjs` emite sólo la pieza; el flujo
   de vinilo del experimento 02 sigue en `cut.mjs`.
