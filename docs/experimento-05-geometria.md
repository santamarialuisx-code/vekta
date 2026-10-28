# Experimento 05 — ¿se puede cerrar el hueco de geometría con parámetros?

> Fecha: 2026-10-28 · 108 combinaciones de `cornerThreshold` × `spliceThreshold` × `lengthThreshold`,
> 48 de `pathPrecision` × `filterSpeckle` × `layerDifference` (Gum Tree), más 13 trazas dirigidas de
> esquinas bajas. SSIM contra el original y, en Gum Tree, contra el render real de Vector Magic.

---

## 1. Veredicto corto

**No. El hueco de 0,032 SSIM no se cierra con parámetros: hay que tocar el motor.**

- Los umbrales de esquina y splicing mueven el SSIM **+0,0001 a +0,0002**. Es ruido.
- Bajar `cornerThreshold` de 60 a 45 compra **+0,0037** a cambio de **+3 % de nodos** en ilustración.
  Es lo único con retorno real, y sirve como opción de fidelidad, no como default.
- `filterSpeckle: 0` compra **+0,018** de SSIM… a cambio de **19× nodos** (118 232 contra 6 083).
  Eso ya no es vectorizar, es calcar el mapa de bits.
- `pathPrecision` entre 2 y 8 produce **exactamente la misma salida**.
- `layerDifference: 64` destruye la fidelidad (0,875).

Con la mejor configuración sensata (ct 45): **0,9410** contra **0,9808** de Vector Magic. Queda un
hueco de **0,040**. Con presupuesto infinito de nodos (fs 0): 0,9554. Sigue faltando 0,025.

---

## 2. De dónde sale el hueco, descompuesto

Gum Tree, SSIM contra el original, con la misma vara en todos los casos:

| Configuración | SSIM | Hueco vs VM (0,9808) |
|---|---:|---:|
| Vector Magic | **0,9808** | — |
| vtracer, colores ilimitados, `simplify` 0 | 0,9483 | **0,0325** |
| vtracer, 16 colores, `simplify` 0 | 0,9442 | 0,0366 |
| vtracer, 16 colores, `simplify` 0,8 (calibrado) | 0,9373 | 0,0435 |
| + `cornerThreshold` 45 | 0,9410 | 0,0398 |
| + `filterSpeckle` 0 (118 232 nodos) | 0,9554 | 0,0254 |

Lectura: la paleta cuesta ~0,004, el `simplify` ~0,007, y **el resto — 0,0325 — es geometría de
motor**: cómo se reconstruyen las regiones y cómo se ajustan las curvas. No hay perilla que lo toque.

---

## 3. Lo que se barrió

### 3.1 Esquinas, splicing y longitud (108 trazas)

Base: `ct 60 / sp 45 / lt 4` con 16 colores y `simplify 0,8`. El valor por defecto de vtracer.

| Imagen | Base (SSIM / nodos) | Mejor combinación | SSIM / nodos | Δ SSIM |
|---|---:|---|---:|---:|
| Gum Tree | 0,9373 / 6 083 | 60 / 30 / 4 | 0,9374 / 6 229 | **+0,0001** |
| Cityscape | 0,9518 / 8 055 | 60 / 60 / 4 | 0,9519 / 8 011 | **+0,0001** |
| Ángel | 0,6658 / 51 864 | 60 / 60 / 6 | 0,6660 / 52 124 | **+0,0002** |
| K1 | 0,8605 / 177 129 | 60 / 45 / 6 | 0,8607 / 177 909 | **+0,0002** |

`cornerThreshold` 90 y 120 empeoran: redondean esquinas reales (0,9362 y 0,9356 en Gum Tree).

### 3.2 Esquinas bajas (13 trazas)

Gum Tree, `sp 45 / lt 4` salvo donde se indica:

| `cornerThreshold` | SSIM | Nodos |
|---:|---:|---:|
| 30 (`sp 30`) | **0,9423** | 7 343 |
| 45 | **0,9410** | 6 285 |
| 60 (default) | 0,9373 | 6 083 |
| 90 | 0,9362 | 6 239 |
| 120 | 0,9356 | 6 691 |

Barato en ilustración (+0,0037 por +3 % de nodos) y caro en foto y line art (+12,7 % y +9,8 % de
nodos para +0,0022 y +0,0010). Por eso no se convierte en default general.

### 3.3 Precisión, motas y capas (48 trazas, Gum Tree)

SSIM / nodos. `pathPrecision` 2, 3, 5 y 8 dan resultados **idénticos**, así que se colapsa:

| `filterSpeckle` \ `layerDifference` | 4 | 16 (default) | 64 |
|---|---:|---:|---:|
| 0 | 0,9554 / 118 232 | 0,9525 / 104 205 | 0,8855 / 24 429 |
| 2 | 0,9374 / 6 556 | 0,9376 / 6 251 | 0,8750 / 2 640 |
| 4 (default) | 0,9373 / 6 192 | **0,9373 / 6 083** | 0,8749 / 2 599 |
| 8 | 0,9353 / 5 641 | 0,9351 / 5 606 | 0,8729 / 2 400 |

La curva dice que el default ya está en el codo: pasar de `fs 4` a `fs 2` no cambia nada, y pasar a
`fs 0` multiplica los nodos por 19 para ganar 0,018.

---

## 4. Decisión

- **Los presets no cambian.** `ct 60`, `sp 45`, `lt 4`, `fs 4`, `ld 16` ya están en el codo; moverlos
  no compra fidelidad perceptible.
- **Se documenta `cornerThreshold: 45` como opción de fidelidad** para ilustración/logotipo: +0,0037
  de SSIM por +3 % de nodos. La diferencia visual en el recorte 3× es indistinguible; la decisión es
  de producto, no de calidad.
- **El hueco restante es del motor, no de configuración.** Cerrarlo requiere trabajo sobre cómo
  vtracer reconstruye regiones y ajusta curvas (estimación de borde subpíxel, mejor fit con
  detección de esquinas sobre el antialiasing), o cambiar de etapa de trazado. No es un barrido.

---

## 5. Limitaciones

- **La referencia es una sola imagen.** Solo Gum Tree tiene render real de Vector Magic (el resto
  está tras el muro de pago). El hueco de 0,032 está medido en un caso; no se generaliza sin más
  renders.
- **SSIM contra su render penaliza color y geometría a la vez.** La descomposición de la sección 2
  separa lo que se puede separar (colores, simplify), pero no aísla forma de color dentro del motor.
- **`pathPrecision` sin efecto** puede significar que no aplica en modo spline; se reporta lo
  observado, no una teoría.
- El barrido de knobs se hizo solo en Gum Tree por costo (K1 tarda ~6 s por traza). Las conclusiones
  de la sección 3.3 no se verificaron en las otras tres imágenes.

---

## 6. Siguiente

1. **Modo `bw` con umbral adaptativo para line art**: K1 sigue en 0,86 y es la deuda más grande.
2. **Conseguir más renders de Vector Magic** para saber si el hueco de 0,032 es de esta imagen o
   estructural.
3. **Trabajo de motor**: estimación de borde subpíxel antes del ajuste de curvas. Es el único camino
   que queda para el 0,032.
