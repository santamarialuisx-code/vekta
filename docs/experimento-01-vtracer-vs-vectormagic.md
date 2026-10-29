# Experimento 01 — ¿está vtracer a la altura de Vector Magic?

> Fecha: 2026-10-28 · Imagen de referencia: `Gum Tree Vector.jpg` (1400×775, ilustración
> vectorial con antialiasing — el mismo caso que se probó en Vector Magic).
> Referencia de Vector Magic extraída del canvas de su propio visor a 1:1
> (`bench/out/vectormagic-gumtree.png`, 1400×775 px, píxel a píxel).

---

## 1. Veredicto corto

**Sí, la geometría está a la altura. No, la limpieza todavía no.**

vtracer reproduce la composición, los colores y las formas al nivel de Vector Magic.
Lo que pierde es **acabado**: halos de antialiasing en los bordes, regiones de bajo
contraste que se traga (las nubes blancas sobre el cielo rosa) y una densidad de nodos
2–3× mayor para el mismo aspecto.

Los tres problemas son de **post-proceso sobre el resultado del trazado**, no del
trazador. No hay que reescribir nada: hay que añadir una fase de limpieza.

---

## 2. Números

Medido con el banco de pruebas (`bench/`). SSIM y PSNR sobre luminancia, ventanas 8×8.
«vs original» compara el SVG rasterizado con el JPG de entrada; «vs VM» compara con
la salida real de Vector Magic.

| Variante | Nodos | Paths | Colores | Tamaño | SSIM vs original | SSIM vs VM |
|---|---:|---:|---:|---:|---:|---:|
| **Vector Magic** | — | — | — | — | (referencia) | 1.0000 |
| vtracer `default` (stacked, spline) | 10 817 | 387 | 268 | 281 KB | **0.9483** | **0.9436** |
| vtracer `cutout` (mosaico sin costuras) | 14 460 | 341 | 237 | 344 KB | 0.9408 | 0.9347 |
| `default` + `simplify 1.5` + `optimize 2` | **4 885** | 387 | 268 | 129 KB | 0.9322 | 0.9280 |
| `cutout` + `simplify 1.5` + `optimize 2` | 5 428 | 341 | 237 | 130 KB | 0.9239 | 0.9180 |
| `cp5 ld32 sp4` + simplify (el más agresivo sano) | 2 811 | 143 | 143 | 77 KB | 0.9298 | — |
| `cp3 ld96 sp8` (sobre-aplanado) | 750 | 67 | 49 | 21 KB | 0.8439 | 0.8401 |

> El número de nodos de Vector Magic no se pudo medir: su SVG está detrás del muro de
> pago y solo se expone rasterizado en `<canvas>`. Visualmente su densidad está en la
> banda de 2 000–5 000 nodos para esta imagen.

**Tiempo:** vtracer tarda **0,36–0,63 s** para 1,08 MP en WASM, en un solo hilo del
navegador. Para `K1_drawing.jpg` (3000×1200, 3,6 MP) tarda 6–8 s. Todo en el cliente.

---

## 3. Lectura visual

Comparando recortes a 2,6× (`C:/Users/luis/ego/vekta-vm-20261028/cmp/`):

**Lo que vtracer hace igual de bien**
- Composición, jerarquía de formas y paleta. A tamaño normal son intercambiables.
- Los reflejos del agua (las rayitas turquesa claras) se conservan.
- En algunas zonas captura **más** detalle fino que Vector Magic (ramitas de 2 px).

**Lo que falla**

1. **Regiones de bajo contraste desaparecen.** Las cinco nubes blancas sobre el cielo
   rosa: Vector Magic las conserva todas, vtracer no deja ninguna. Se las traga el
   agrupamiento jerárquico por color.
2. **Halos de antialiasing.** Cada forma del follaje queda rodeada de un filo de color
   intermedio (verde más claro). Vector Magic produce un borde único y limpio.
3. **Contornos con temblor.** Las siluetas grandes tienen pequeñas ondas de píxel;
   las de Vector Magic son curvas decididas.
4. **Exceso de nodos.** 10 817 por defecto contra una estimación de 2 000–5 000 de VM.

**Y un hallazgo del barrido:** aplanar agresivamente *empeora*. Bajar `colorPrecision`
a 3 y subir `layerDifference` a 96 deja el archivo en 750 nodos y 21 KB, pero destruye
nubes, reflejos y detalle de ramas (SSIM 0.844). **El camino no es aplastar colores, es
limpiar regiones.** Ese es el insight que decide la arquitectura del post-proceso.

---

## 4. Qué construye Vekta para cerrar el hueco

Tres pasadas, en este orden, todas sobre el resultado del trazado:

1. **Cuantización perceptiva (antes de trazar).** k-means en OKLab con un número de
   clústeres elegido por heurística, en vez del agrupamiento jerárquico por umbral de
   color. Objetivo: conservar las nubes (ΔE pequeño pero región grande) y descartar
   ruido (ΔE pequeño y región diminuta). vtracer ya tiene OKLab dentro; hay que
   sustituir la política de fusión.
2. **Limpieza de regiones (después de trazar).** borrar regiones por debajo de un área
   en px², reasignar sus píxeles al vecino más cercano en ΔE, y repetir. Esto elimina
   los halos de antialiasing, que son exactamente eso: regiones de 1–2 px de ancho con
   color intermedio.
3. **Suavizado con preservación de esquinas (después del fit).** ya existe (`simplify`),
   pero hay que calibrarlo con el criterio «mitad de nodos, misma percepción», no con
   un umbral fijo.

Con (1)+(2) se recuperan las nubes y se matan los halos. Con (3) se iguala la economía
de nodos. Nada de esto es investigación abierta: es trabajo de ajuste y de escribir dos
pasadas.

---

## 5. Reproducir

```bash
pnpm install
pnpm bench          # genera SVGs + métricas en bench/out/
pnpm bench:sweep    # barrido fino sobre Gum Tree
pnpm bench:serve    # http://127.0.0.1:8787/compare.html
```

Para medir fidelidad hay que abrir en el navegador (el cálculo de SSIM corre sobre
canvas, con el original y el SVG rasterizados al mismo tamaño):

- `http://127.0.0.1:8787/metrics.html` — SSIM/PSNR de cada SVG contra el original
- `http://127.0.0.1:8787/vmdiff.html` — SSIM/PSNR contra la salida de Vector Magic

Comparador visual con parámetros:

```
/compare.html?a=vm&b=sweep/stacked_cp6_ld16_sp4.svg&fx=0.45&fy=0.35&frac=0.2
```

`a`/`b` aceptan `orig`, `vm`, o una ruta relativa a `bench/out/`.

### Limitaciones conocidas

- Solo hay referencia de Vector Magic para `Gum Tree`. Las otras tres imágenes tienen
  métricas contra el original, no contra su salida.
- SSIM premia la fidelidad de píxel, no la calidad de curva. Un trazado con el doble de
  nodos puntúa alto. Hay que leerlo junto con el número de nodos, nunca solo.
- Toda la evaluación es perceptual global. Falta una comprobación de «¿esto lo puede
  cortar un láser?», que es la métrica que de verdad importa al nicho.
