# Análisis competitivo: Vector Magic

> Fecha: 2026-10-28 · Método: navegación real del producto (es.vectormagic.com) con ego-browser,
> inspección del DOM, flujo completo de vectorización y lectura de documentación pública.
> Evidencia en `C:/Users/luis/ego/vekta-vm-20261028/` (capturas + dumps).

---

## 1. Resumen ejecutivo

Vector Magic es **un producto maduro, estrecho y bien empaquetado**, no un monstruo tecnológico inalcanzable.
Su foso real no es el algoritmo (que es bueno pero replicable con vtracer), sino:

1. **15 años de tuning** de parámetros por tipo de imagen, empaquetado como un cuestionario de 5 preguntas.
2. **La marca "funciona a la primera"** — verificada: con una ilustración difícil (ramas finas, antialiasing),
   su resultado es limpio y prácticamente usable sin retoque.
3. **18 locales** y una operación de soporte/pagos/facturación ya montada.

Y tiene **tres debilidades estructurales explícitas**, documentadas por ellos mismos, que caen justo
en el nicho elegido (láser / CNC / corte / DTF):

| Debilidad | Evidencia literal |
|---|---|
| El corte por láser **quema cada borde compartido dos veces** | *"Aún podría cortar dos veces por borde ya que la mayoría de los bordes están formados por dos figuras"* |
| **DXF solo en escritorio** (y la web es donde está el motor nuevo) | Tabla de precios: "Imágenes DXF y AI — solo Escritorio" |
| El **motor nuevo no está en escritorio**; el viejo no está en la web | *"La edición en línea y la de escritorio usan diferentes motores… no incluye las mejoras futuras en el procesamiento de la edición en línea"* |
| Todo el cálculo es **server-side**; editar reenvía la imagen | *"Los cambios que haga se guardarán en el servidor cuando pulse Siguiente"* |

---

## 2. Qué es el producto

Dos productos distintos que comparten marca y no comparten motor:

| | Edición en línea | Edición de escritorio |
|---|---|---|
| Precio | **USD 7,99/mes** (suscripción, uso ilimitado) | **USD 295** pago único (1 usuario, 2 equipos) |
| Motor | el nuevo | el clásico, **v1.21**, 23,6 MB (Windows) |
| Entrada | JPG, PNG, BMP, GIF (sRGB) | + TIFF |
| Salida | SVG, EPS, PDF | + **AI, DXF** |
| Límite | **2 megapíxeles** (recorta o encoge) | sin límite práctico |
| Idiomas | **18 locales** | 4 (EN, DE, ES, FR) |
| Exclusivo | motor nuevo, eliminar fondo | modo avanzado con control específico, grupos por color, **procesamiento por lotes**, imágenes muy grandes, drag&drop de salida |

Notas de negocio:
- **Gratis para probar, paywall para descargar.** Subes y vectorizas sin límite; el muro está en la descarga.
- **Crédito puente**: los primeros USD 50 gastados en la web se descuentan del precio del escritorio.
- **Sin facturas ni órdenes de compra. Sin descuentos académicos/sin ánimo de lucro. Cuotas no reembolsables.**
- Empresa: **Cedar Lake Ventures, Inc.** (misma casa que **Clipping Magic**, su producto hermano de quitar fondos → se venden mutuamente).
- Auth delegada a `cedarlakeventures.com/signon/...` (proveedor propio, genérico).

---

## 3. Arquitectura observada (deducida de la UI, no especulada)

```
subida ──▶ servidor ──▶ segmentación (mapa de etiquetas por color)
                          │
                          ├─▶ "suavizado" (ajuste de curvas) ──▶ SVG/EPS/PDF
                          └─▶ editor de segmentación (round-trip al servidor en cada paso)
```

Confirmado por su propio texto: *"La segmentación es la **ruda** separación de la imagen en piezas que después
se suavizan para producir la imagen en vector final."*

Consecuencias:
- **Cada edición es un viaje al servidor.** Editar y ver el resultado recarga. No hay edición en vivo.
- El editor **no es un editor de nodos**. Es un editor de *píxeles de segmentación*. Herramientas: Localizador,
  Mover, **Zap**, **Rellenar**, **Pixel**, **Selector de color** + alternar Mapa de bits / Segm. / Vector + deshacer.
- La UI es un árbol de "tarjetas grandes". Ningún parámetro numérico expuesto en la web.
- El resultado vectorial se pinta en `<canvas>`, no en SVG del DOM (probablemente para no entregar el SVG sin pagar).

### El cuestionario (su verdadero producto)

Al entrar por primera vez, 5 pasos de tarjetas con lupa de vista previa:

1. **¿Qué tipo de imagen es esta?** → Fotografía · Ilustración con bordes suavizados (antialiasing) · Ilustración con bordes no fusionados
2. **¿Qué nivel de detalle?** → Alto · Mediano · Bajo
3. **¿Calidad (no resolución)?** → Alto · Mediano · Bajo *(el color es constante / bastante constante / varía mucho)*
4. **¿Cómo se manejan los colores?** → Ilimitados · Personalizados
5. **Paletas sugeridas** → 11 miniaturas, de 2 a 12 colores, con una marcada como recomendada

Después de eso el panel se reduce a: *Nivel de detalles* + *Colores*, y un desplegable "Avanzado" con
*Editar el resultado*, *Eliminar el fondo*, *Seleccionar las configuraciones manualmente*.

> **Lectura clave:** venden "vectorización completamente automática", pero la primera experiencia real es un
> **cuestionario de clasificación de imagen**. El usuario hace de clasificador. Eso es simultáneamente su
> fricción y su calidad: el usuario elige el preset, por eso acierta.

### Calidad observada

Caso probado: `Gum Tree Vector.jpg` (1400×775, ilustración vectorial con antialiasing, ramas finas,
¿cuántos tonos? muchos). Detección automática: **"Ilustración con contornos suavizados, Alta, Colores ilimitados"**.
Resultado: bordes limpios, curvas suaves, forma reconocible en las ramas. Sin retoque, usable.

Esto es lo que hay que igualar. No es trivial, pero vtracer con `clustering=color-cluster`,
`mode=spline`, `hierarchical=cutout` y `simplify` activo llega cerca — hay que medirlo, no suponerlo.

---

## 4. Sus límites, en sus propias palabras

Estas frases son de su página de *Formatos de archivo* y son **la lista de la compra para Vekta**:

> **Rellenar solamente** — *"Es bueno para los métodos de impresión y cortado basados en vectores, como cortar
> vinilo, grabar con láser y bordar, ya que solamente corta una vez por figura. **Aún podría cortar dos veces por
> borde ya que la mayoría de los bordes están formados por dos figuras.**"*

> **Trazar + rellenar** — *"**Puede cortar dos veces por figura** cuando se usa para cortar vinilo, grabar con
> láser, bordar, etc."*

> **DXF** — *"A algunos programas se les dificulta leer archivos DXF con curvas, así es que la edición de
> escritorio es compatible con los modos de salida de líneas + curvas al igual que solo líneas."*

Traducido: **admiten que su salida no está pensada para un cabezal de corte.** Vectorizan contornos por color,
los apilan o los teselan, y el láser recorre cada frontera compartida dos veces. Es un problema de *modelo de
salida*, no de precisión. Y es exactamente el problema del nicho elegido.

---

## 5. Dónde está su foso y dónde no

**Foso real (difícil de copiar):**
- Tuning de presets por tipo de imagen. Años de casos vistos.
- Confianza de marca: reseñas de 15 años, "esto me sirvió a la primera".
- 18 locales + soporte + facturación + licencias de escritorio.
- La sensación de calidad que da el cuestionario con lupas de vista previa.

**No es foso (replicable hoy):**
- El tracer. `vtracer` (MIT) ya tiene clustering de color jerárquico, watershed, umbral adaptativo,
  cuantización en **OKLab**, paleta fija, `max_colors`, fit de Bézier con detección de esquinas,
  simplificación de curvas y un modo **mosaico sin costuras** donde cada frontera se ajusta una sola vez.
- El editor de segmentación. Son 5 herramientas sobre un mapa de etiquetas + undo/redo.
- La UI. Es Bootstrap + canvas.
- El límite de 2 MP. No tienen competencia ahí por decisión, no por técnica.

**Su punto más frágil:** escritorio v1.21 con motor viejo a USD 295, frente a una web a 7,99/mes con motor nuevo.
Es una migración a medio hacer y ellos lo dicen en voz alta.

---

## 6. Tesis para Vekta

No competir en "el mejor tracer de fotos". Competir en **"el tracer que produce archivos que una máquina
puede ejecutar"**, con foco en láser / CNC / corte de vinilo / DTF.

Las cuatro apuestas:

### 6.1 Todo en el cliente (WASM)
Vector Magic procesa en servidor: 2 MP de límite, latencia, coste marginal, y la imagen del cliente sale de su
equipo. Con el core en WASM:
- **Sin límite de tamaño** (solo el de la RAM del navegador).
- **Cero coste marginal** → se puede ofrecer gratis o pago único.
- **Privacidad**: argumento real para talleres que reciben arte de clientes con NDA.
- **Edición instantánea**: cambiar paleta o detalle sin recargar. Su editor hace round-trip al servidor.

### 6.2 Salida "cut-ready", no "render-ready"
Donde ellos fallan por diseño:
- **Unión booleana** de todas las formas de un mismo color en un *compound path* con agujeros y winding correcto
  → el láser recorre cada contorno **una sola vez**.
- **Unidades reales**: SVG con `width`/`height` en mm y `viewBox` coherente; DXF en la web, no en un escritorio de 295 USD.
- **Kerf / compensación de ancho de corte** (offset del contorno) — nadie lo hace en web.
- **Single-stroke / línea central** para grabado y plotter de pluma: esqueletonización por eje medial en vez de
  contorno. Es un módulo aparte y es un hueco real de mercado.
- **Separación de tintas** para serigrafía/DTF: una capa por spot color, con nombres y orden de impresión.

### 6.3 El cuestionario, pero respondido por el software
Su fricción es que el usuario clasifica la imagen. Con 4 heurísticas baratas (colores únicos tras cuantizar,
densidad de bordes, entropía del gradiente, planitud del histograma) se clasifica solo. Un botón, no cinco pasos.
Eso es a la vez mejor UX y mejor producto que lo que ellos tienen.

### 6.4 Precio alineado al nicho
7,99/mes es hostil para un taller que vectoriza 6 logos al mes; 295 USD es hostil para todo el mundo.
Un pago único bajo o un crédito perpetuo ("10 imágenes, tuyas para siempre") encaja mejor con el comprador
de láser/CNC, y no requiere ni suscripciones ni gestión de cuentas para el MVP.

---

## 7. Matriz de huecos

| Necesidad del nicho | Vector Magic | Vekta |
|---|---|---|
| Corte sin doble pasada | ✗ (lo admiten) | Unión booleana + compound paths |
| DXF en el navegador | ✗ (solo escritorio, 295 USD) | Nativo |
| Dimensiones reales (mm) | parcial | SVG con unidades físicas |
| Kerf / compensación | ✗ | Offset de contorno |
| Single-stroke / línea central | ✗ | Eje medial |
| Separación de tintas | ✗ | Capas por spot color |
| Sin límite de megapíxeles | ✗ (2 MP) | Sin límite (WASM) |
| Privacidad del arte del cliente | ✗ (sube al servidor) | 100% local |
| Edición sin recargar | ✗ (round-trip) | En vivo |
| Vectorizar sin preguntas | parcial | Auto-clasificación |
| Calidad de trazado en fotos | 🏆 referencia | A medir, probablemente por debajo al inicio |
| Marca / confianza | 🏆 15 años | Cero |

---

## 8. Riesgos

1. **La calidad base es alta.** Si Vekta traza peor que ellos en el caso típico, ninguna función de nicho salva
   el producto. Hay que medir SSIM y nº de nodos desde la semana 1.
2. **El editor es caro.** Su editor es de segmentación (5 herramientas, barato). El nuestro, si aspira a nodos,
   es un orden de magnitud más caro. Empezar por segmentación también.
3. **Ellos pueden reaccionar.** Añadir DXF a la web es un ticket pequeño para ellos. La defensa no es la
   función suelta, es el paquete "archivos que la máquina ejecuta" + precio + local-first.
4. **Nicho pequeño hasta que se demuestre.** Láser/CNC/DTF en LATAM y España: hay que validar volumen antes
   de construir el editor completo.

---

## 9. Siguiente paso recomendado

**Hecho.** Ver [`experimento-01-vtracer-vs-vectormagic.md`](experimento-01-vtracer-vs-vectormagic.md).

Resultado en una línea: la geometría de vtracer está a la altura; lo que falta es
limpieza de regiones (halos de antialiasing y regiones de bajo contraste que se traga)
y economía de nodos. Los tres son post-proceso, no trazador. La arquitectura del core
de Vekta queda fijada como **cuantizar en OKLab → trazar → limpiar regiones → simplificar
con esquinas**.
