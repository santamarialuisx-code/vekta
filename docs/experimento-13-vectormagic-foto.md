# Experimento 13 — ¿el hueco de 0,032 es estructural? Medición en foto y póster

> Fecha: 2026-10-28 · Dos renders nuevos de Vector Magic extraídos de su visor en canvas:
> foto `bench/out/vectormagic-angel.png` (1050×700) y póster `bench/out/vectormagic-cityscape.png`
> (1400×980). Configuración de Vector Magic en ambos casos: **Foto/Ilustración con contornos
> suavizados, detalle Alto, colores Ilimitados**. Misma vara que los experimentos 01–07
> (SSIM sobre luminancia, ventanas 8×8, stride 8; implementación idéntica a `bench/metrics.html`).

---

## 1. Veredicto corto

**El hueco no es una constante del motor: depende de la categoría, y en foto se multiplica por cinco.**

| Categoría | Nuestro SSIM vs original | Vector Magic vs original | Hueco |
|---|---:|---:|---:|
| Ilustración (Gum Tree) | 0,9351 | 0,9808 | **0,0457** |
| Póster (Cityscape) | 0,9518 | 0,9672 | **0,0154** |
| **Foto (Ángel)** | **0,6693** | **0,8267** | **0,1574** |

- El 0,0325 del experimento 05 **se reproduce exactamente** (0,9808 − 0,9483 con colores
  ilimitados y `simplify 0`), así que la vara es la misma y las cifras son comparables.
- En póster vamos **la mitad de lejos** que en ilustración: 0,015. Ahí no hay nada que rescatar.
- En foto el hueco es **0,157**, cinco veces el de la ilustración, y el hueco no se cierra con
  perillas: los barridos del experimento 05 dieron 0,6658 para el Ángel con 16 colores, casi
  idéntico a nuestro 0,6693 con 12.
- **Categoría a atacar primero: foto.** No porque sea la más visible, sino porque es la única
  donde el modelo (segmentar en colores planos) falla por diseño y no por calibración.

**Dónde duele exactamente.** El fondo desenfocado del Ángel —un gradiente suave, sin aristas— es
la región peor: **0,676 nuestro contra 0,918 de Vector Magic**. Nuestro trazado no puede
representar un degradado con 12 rellenos planos; Vector Magic entrega **52 353 colores distintos**
en ese mismo render frente a los **13 307** nuestros. El problema en foto es **profundidad tonal**,
no contorno.

---

## 2. Pasos exactos del cuestionario

Todo gratis, sin cuenta y sin tarjeta: ambas imágenes (0,74 MP y 1,37 MP) entran en el límite de
2 MP del plan gratuito, y el render vectorial se puede leer del `<canvas>` del visor. **No se intentó
descargar el SVG**: no hace falta para medir, y no se verificó si el export pide cuenta (la página
de resultado sí está detrás de «Descargar el resultado», que es lo que el experimento 01 ya daba por
muro de pago).

### 2.1 Foto — `angel-luciano-LATYeZyw88c-unsplash-s.jpg`

1. `https://es.vectormagic.com/` → botón **«Vectorizar imagen»** → selector de fichero → se sube
   `bench/inputs/angel-luciano-LATYeZyw88c-unsplash-s.jpg`.
2. Se procesa automáticamente y la barra inferior del visor dice, **estado inicial**:
   `Foto, Mediana, Colores ilimitados`. El tipo lo detecta él: **Foto**.
3. El cuestionario «Mejorar el resultado» muestra dos bloques:
   - **«Imagen escaneada o dibujo?»** con un único botón **«Procesar como ilustración»**.
     **No se pulsa**: pulsarlo cambiaría el tipo a ilustración. Se deja en Foto.
   - **Nivel de detalles**: `Bajo` · `Mediano` · `Alto` → se pulsa **Alto**.
   - **Colores**: `Ilimitado` · `Personalizado` → se deja **Ilimitado** (ya venía así).
4. **Avanzado** (plegado, no se toca): `Editar el resultado`, `Eliminar el fondo`,
   `Seleccionar las configuraciones manualmente`.
5. La barra inferior pasa a confirmar la elección: **`Foto, Alta, Colores ilimitados`**
   (captura `04-alto.png`, `05-alto-done.png`).
6. Vista **«Vista en un panel»** (tecla `1`) y **zoom 1:1** (tecla `Fin`), y se extrae el canvas.

### 2.2 Póster — `Cityscape Sunset_DFM3-01.jpg`

1. Mismo flujo: portada → **«Vectorizar imagen»** → se sube
   `bench/inputs/Cityscape Sunset_DFM3-01.jpg`.
2. La barra inferior dice, **estado inicial y final a la vez**:
   `Ilustración con contornos suavizados, Alta, Colores ilimitados`
   (captura `09-poster-questionnaire.png`).
3. Diferencias con la foto, y son relevantes:
   - **No aparece** la sección «Imagen escaneada o dibujo?»: el tipo detectado ya es arte plano.
   - **«Alto» e «Ilimitado» ya vienen seleccionados por defecto.** No se pulsó nada.
4. Vista en un panel + zoom 1:1 + extracción del canvas.

Fotos del cuestionario y del estado final: `C:/Users/luis/ego/vekta-vm-paridad-20261028-1720/`
(`03-questionnaire.png`, `04-alto.png`, `05-alto-done.png`, `09-poster-questionnaire.png`).

---

## 3. Cómo se extrajo el render (y cómo se verificó que es 1:1)

El truco del experimento 01, con una comprobación que allí no había: el recorte se **verifica
contra el original** en vez de fiarse del centrado.

1. `canvas.toDataURL("image/png")` del canvas visible (2171×1281 px de backing store, `dpr` 1).
2. Con zoom **1:1**, el ancho del área de imagen dentro del canvas se mide por bbox de píxeles
   distintos del fondo: **exactamente 1050 px** (foto) y **exactamente 1400 px** (póster). Es la
   prueba de que no hay reescalado.
3. El desplazamiento se fija por **mínimo de MSE contra el original** sobre una rejilla de
   ±10 px alrededor del centro, no por la fórmula `x=(canvasW−imgW)/2` (que da 560,5: medio píxel
   de error, suficiente para envenenar el SSIM):

| Imagen | canvas | bbox ancho | offset elegido | RMSE mínimo | RMSE a +1 px |
|---|---|---:|---|---:|---:|
| Ángel | 2171×1281 | 1050 | (561, 291) | **10,00** | 11,57 (dx +1) |
| Cityscape | 2171×1281 | 1400 | (386, 151) | **6,25** | 11,84 (dx +1) |

El mínimo es inequívoco (el RMSE sube 16–90 % con un píxel de desplazamiento), así que el recorte
es píxel a píxel el render de Vector Magic al tamaño de la imagen.

Caveat honesto: el bbox de **altura** no sirve para verificar (el canvas pinta otros elementos
fuera de la imagen, el bbox se estira a 1264 px); la verificación real es la anchura exacta más el
mínimo de MSE. Capturas: `06-canvas-full.png`, `07-canvas.png`, `10-poster-canvas.png`.

---

## 4. Números

SSIM y PSNR sobre luminancia. «vs original» compara contra el JPG de entrada; «vs VM» contra el
render real de Vector Magic. Todo rasterizado a tamaño nativo (sin reescalado en ningún caso).

| Imagen | Nodos | Rellenos | SVG | SSIM vs original | PSNR vs original | SSIM vs VM | PSNR vs VM |
|---|---:|---:|---:|---:|---:|---:|---:|
| Ángel (foto) — Vector Magic | — | — | — | **0,8267** | 28,30 | 1,0000 | — |
| Ángel (foto) — Vekta/vtracer | 43 214 | 12 | 876 KB | **0,6693** | 25,31 | 0,6290 | 24,33 |
| Cityscape (póster) — Vector Magic | — | — | — | **0,9672** | 31,71 | 1,0000 | — |
| Cityscape (póster) — Vekta/vtracer | 8 055 | 16 | 175 KB | **0,9518** | 31,07 | 0,9340 | 28,68 |
| Gum Tree (ilustración) — Vector Magic | — | — | — | **0,9808** | 34,57 | 1,0000 | — |
| Gum Tree (ilustración) — Vekta/vtracer | 7 083 | 11 | 185 KB | **0,9351** | 31,04 | 0,9298 | 29,98 |

Nodos y rellenos nuestros salen de `bench/out/auto-report.json` (preset automático:
foto 12 colores/`simplify` 0,8 · póster 16/0,8 · ilustración 12/0,6).

**Nodos de Vector Magic: no se pueden medir.** Su visor no los expone en ninguna parte: no hay
texto `nodo`/`node`/`path`/`traz` en el DOM del editor (probado por introspección del texto de la
página), y la página de resultado (`12-download-page.png`) solo ofrece formatos de exportación
(`Rellenar solamente` / `Trazar + rellenar`, SVG/EPS/PDF), sin estadísticas de geometría. Confirmado
otra vez lo del experimento 01, sin novedad.

### 4.1 Contraste con la serie anterior

| Medición | Valor | Fuente |
|---|---:|---|
| VM Gum Tree vs original | 0,9808 | exp 05 §2 — **reproducido idéntico aquí** |
| vtracer colores ilimitados + `simplify 0` vs original | 0,9483 | exp 05 §2 |
| → hueco de ilustración con «presupuesto infinito» | **0,0325** | exp 05 |
| vtracer preset automático (12 colores → 11 rellenos, `simplify 0,6`) | 0,9351 | este experimento |
| → hueco de ilustración con el producto real | **0,0457** | este experimento |
| Ángel 16 colores, `simplify 0,8` | 0,6658 | exp 05 §3.1 |
| Ángel preset automático (12 colores) | 0,6693 | este experimento |

Dos lecturas de esto:

1. **La paleta explica un tercio del hueco de ilustración** (0,0457 → 0,0325 al quitar el límite de
   colores), pero **no explica nada en foto**: 16 colores dan 0,6658 y 12 dan 0,6693, es decir,
   mover la paleta no mueve la aguja porque el motor no la aprovecha.
2. Por tanto el 0,032 **no es estructural en el sentido de constante**: es el hueco de un tipo de
   imagen. En foto el mismo motor cae 0,157.

---

## 5. Dónde vive el hueco: SSIM local y profundidad de color

SSIM en tres recortes de 220–300 px por imagen (misma implementación, rejilla 8×8 reiniciada en el
recorte; sirve para localizar, no para comparar con la cifra global).

| Imagen | Región | Vekta vs original | VM vs original | Hueco local |
|---|---|---:|---:|---:|
| Ángel (foto) | **fondo desenfocado** (bokeh) | **0,6764** | **0,9183** | **0,242** |
| Ángel (foto) | hierba y margaritas | 0,6092 | 0,7510 | 0,142 |
| Ángel (foto) | cabeza (hocico, lengua, pelo) | 0,7151 | 0,8701 | 0,155 |
| Cityscape (póster) | ventanas y franjas | 0,9372 | 0,9818 | 0,045 |
| Cityscape (póster) | cielo con nubes | 0,9640 | 0,9829 | 0,019 |
| Cityscape (póster) | sol | 0,9794 | 0,9845 | 0,005 |
| Gum Tree (ilustración) | follaje | 0,9151 | 0,9823 | 0,067 |
| Gum Tree (ilustración) | nubes sobre cielo | 0,9695 | 0,9887 | 0,019 |
| Gum Tree (ilustración) | agua y reflejos | 0,9334 | 0,9704 | 0,037 |

Colores distintos en el render rasterizado (cuenta directa sobre el bitmap):

| Imagen | Original | Vekta | Vector Magic |
|---|---:|---:|---:|
| Ángel | 129 335 | 13 307 | **52 353** |
| Cityscape | 31 328 | 8 020 | 6 774 |
| Gum Tree | 15 173 | 7 064 | 6 590 |

Lectura: en póster e ilustración **Vector Magic usa menos colores distintos que nosotros** y aun así
puntúa más alto — ahí el hueco es de geometría de contorno, como ya concluyó el experimento 05. En
foto se invierte: Vector Magic usa **cuatro veces más** niveles tonales que nosotros, y es
precisamente en la región de gradiente suave donde la diferencia explota (0,24 de hueco local).

---

## 6. Lectura visual

Recortes 3× en `11-strip-angel-head.png`, `11-strip-angel-grass.png`, `11-strip-city.png`
(original · nuestro SVG · Vector Magic, lado a lado).

**Foto, cabeza (3×).** Nuestro trazado convierte el hocico en manchas beige y blanco sin
estructura; **la lengua rosa desaparece** y queda del color de la piel; los ojos son dos huecos
negros sin brillo. Vector Magic conserva el rosa de la lengua, el degradado del hocico y el
contraste pelo/fondo. A tamaño de imagen completa se ve como una acuarela lavada; al lado del suyo,
como un fallo.

**Foto, hierba y margaritas (3×).** Las margaritas del fondo se convierten en pegotes crema sin
centro amarillo; las briznas se funden en una alfombra verde de dos tonos. Vector Magic conserva
briznas individuales y flores reconocibles. Es el mismo síntoma que en Gum Tree (regiones pequeñas
de bajo contraste que se traga el agrupamiento por color), pero aquí se come la mitad inferior de la
imagen.

**Póster, ventanas (3×).** Prácticamente empatados. Nuestras franjas de ventanas tienen el borde
ligeramente más tembloroso y un tono un punto más apagado; la geometría y la composición son
intercambiables. Coherente con el 0,015 de hueco global.

---

## 7. Veredicto

1. **¿El hueco de 0,032 se parece en foto?** No: es **cinco veces mayor** (0,157). Y no es un
   desplazamiento constante del motor que se pueda compensar: en póster baja a 0,015 y en
   ilustración queda en 0,033–0,046 según preset. **El hueco escala con la complejidad tonal de la
   imagen, no con la categoría declarada.**
2. **¿Es estructural o de esa imagen?** Estructural **en foto**, y ahí sí es de modelo: un trazado
   de N rellenos planos no puede aproximar un bokeh; Vector Magic gana porque produce 4× más
   niveles tonales y los coloca en regiones coherentes. En ilustración y póster el hueco residual
   es de contorno (follaje 0,067, ventanas 0,045), que es el terreno del experimento 05: motor de
   geometría, no color.
3. **¿Qué categoría atacar primero?** **Foto.** Es donde hay 0,157 que ganar y donde el fallo se ve
   a simple vista (lengua, flores, bokeh). Póster e ilustración ya están a 0,015–0,046 y no mueven
   la aguja del producto.
4. **Qué NO sirve, dicho con números:** subir colores. 16 colores en foto dieron 0,6658 contra
   0,6693 con 12 (exp 05 §3.1), y en ilustración el techo del preset ilimitado es 0,9483. Lo que
   falta en foto es **representar tono continuo** —bandas con transición o degradados reales— en
   las zonas de baja frecuencia, no más entradas de paleta sueltas.

---

## 8. Limitaciones

- **Una imagen por categoría.** Dos renders nuevos; las conclusiones de foto se apoyan en una sola
  foto. El patrón (gradiente suave = peor región) es claro, pero no está medido en una segunda.
- **Asimetría de configuración, deliberada y declarada:** Vector Magic corrió con colores
  ilimitados y nosotros con el preset automático (12 y 16 colores). Es la comparación de producto
  (lo que cada uno entrega por defecto con «calidad alta»), no la de motores a igualdad de ajustes.
  El apartado 4.1 separa lo que se puede separar con los datos del experimento 05.
- **SSIM contra el render de VM penaliza color y geometría a la vez**, y premia fidelidad de píxel:
  no mide calidad de curva. Leer siempre junto a los recortes y al número de nodos.
- **Nodos de Vector Magic no medibles** (visor y página de resultado no los publican).
- **El render extraído es el del visor**, no el fichero exportado: pasa por el rasterizador del
  navegador a 1:1. Es lo mismo que se hizo en el experimento 01, así que la comparación con 01–07
  es válida, pero no es el SVG de Vector Magic.
- No se probó la descarga: no se verificó si pide cuenta ni si el export difiere del visor.

---

## 9. Reproducir

```bash
node bench/serve.mjs        # http://127.0.0.1:8787/  (para métricas de la serie 01–07)
```

Los renders de referencia ya están en el repo:

- `bench/out/vectormagic-angel.png` — 1050×700, render de Vector Magic de la foto
- `bench/out/vectormagic-cityscape.png` — 1400×980, render de Vector Magic del póster
- `bench/out/vectormagic-gumtree.png` — 1400×775, el de siempre (intacto)

Las tres comparaciones por imagen se calcularon en el navegador con `page.evaluate` y canvas, con
la implementación de SSIM copiada literalmente de `bench/metrics.html`. Guion y evidencias de la
sesión: `C:/Users/luis/ego/vekta-vm-paridad-20261028-1720/`
(`round-08-metrics-angel.mjs`, `round-10-poster-extract.mjs`, `round-11-gumtree-strips.mjs`,
`round-13-regions.mjs`, `13-regions-colors.json`, capturas `*.png`).

Control de cordura: el mismo código devuelve **0,9808** para Gum Tree vs original, exactamente el
valor del experimento 05, y **0,9518** para Cityscape con nuestro SVG, exactamente el del barrido de
esquinas. La vara no se movió.
