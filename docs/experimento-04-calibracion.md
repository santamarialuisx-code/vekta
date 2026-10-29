# Experimento 04 — Calibración: `simplify` × paleta

> Fecha: 2026-10-28 · Barrido `maxColors` × `simplify` sobre las 4 imágenes, base `cutout` +
> `optimize 2` (el modo que sirve para cortar). SSIM contra el original medido en navegador con la
> misma implementación que `metrics.html`.
> 140 combinaciones gruesas + 36 finas (0,4 / 0,6 / 1,0) + 8 para cerrar la tabla de paleta.

---

## 1. Veredicto corto

**«Mitad de nodos, misma percepción» se cumple en ilustración y en poster. En foto y en line art no
se puede: el presupuesto de SSIM se agota antes de llegar al −50 %.**

| Categoría | Paleta | `simplify` | Nodos | Δ nodos | Δ SSIM | ¿−50 %? |
|---|---:|---:|---:|---:|---:|---|
| Ilustración (Gum Tree) | 12 | 0,6 | 14 821 → **7 083** | −52 % | −0,004 | **sí** |
| Poster (Cityscape) | 16 | 0,8 | 17 287 → **8 055** | −53 % | −0,004 | **sí** |
| Fotografía (Ángel) | 12 | 0,8 | 64 214 → **43 214** | −33 % | −0,004 | no |
| Line art (K1) | 16 | 1,2 | 240 135 → **174 451** | −27 % | −0,005 | no |

Regla aplicada: **el mayor `simplify` cuya caída de SSIM no pase de 0,005** respecto de `simplify 0`
con la misma paleta. No se eligió a ojo ninguna fila.

En K1 la curva se agota: pasar de 1,2 a 3 solo quita otro 0,5 % de nodos. Su economía no está en
`simplify`; está en otra parte (umbral adaptativo, modo `bw`), y eso queda fuera de este
experimento.

---

## 2. Cómo se eligió cada cosa

**Paleta** — con `simplify 0,6` fijo, tres columnas por imagen: nodos, SSIM y **p95 de ΔE** de la
cuantización (el error de color real, que el SSIM no mide bien).

| Imagen | 8 col | 12 col | 16 col | 24 col | 32 col |
|---|---|---|---|---|---|
| Gum Tree | 6 491 / 0,9347 / 0,034 | **7 083 / 0,9351 / 0,012** | 7 099 / 0,9393 / 0,011 | 7 232 / 0,9382 / 0,009 | 7 388 / 0,9396 / 0,009 |
| Cityscape | 8 402 / 0,9545 / 0,050 | 8 691 / 0,9511 / 0,037 | **9 031 / 0,9530 / 0,033** | 9 309 / 0,9508 / 0,032 | 9 124 / 0,9510 / 0,032 |
| Ángel | 38 671 / 0,6434 / 0,076 | **45 138 / 0,6700 / 0,060** | 54 054 / 0,6664 / 0,050 | 63 830 / 0,6583 / 0,043 | 73 325 / 0,6532 / 0,039 |
| K1 | 178 103 / 0,8676 / 0,049 | 241 682 / 0,8752 / 0,033 | **180 517 / 0,8613 / 0,030** | 180 580 / 0,8612 / 0,022 | 177 998 / 0,8615 / 0,022 |

Lectura por imagen:

- **Gum Tree**: el corte está entre 8 y 12. A 8 colores el p95 de ΔE se dispara (0,034) y las nubes
  pierden su blanco; a 12 vuelven a estar **98,5 % intactas** (mismo valor que a 16). De 16 en
  adelante solo se compran 0,002 de ΔE pagando ~3 % más de nodos. **12.**
- **Cityscape**: la meseta empieza en 16 (0,033); de 8 a 12 todavía se gana 0,013 de ΔE. **16.**
- **Ángel**: es el caso donde SSIM y fidelidad de color **discrepan**. El SSIM prefiere 12
  (0,6700) y cae con más colores (0,6532 a 32), mientras el ΔE mejora con más colores (0,060 a
  12 → 0,039 a 32). Es el límite conocido del SSIM: premia píxel, no color. Recomendación: **12
  si manda el tamaño, 24 si manda el color**; el documento no elige por vosotros.
- **K1**: **evitar 12**. Con 12 colores el barrido de grises fragmenta el escaneo y produce
  **241 682** nodos, un 35 % más que con 8 o 16. Con 16 queda en 180 517 y el p95 de ΔE es 0,030.
  **16.**

---

## 3. Curva de `simplify`, completa

Con la paleta recomendada, SSIM y nodos. La fila marcada es la elegida.

**Gum Tree · 12 colores** (base 14 821 nodos, SSIM 0,9395)

| `simplify` | Nodos | Δ nodos | SSIM |
|---:|---:|---:|---:|
| 0 | 14 821 | — | 0,9395 |
| **0,6** | **7 083** | **−52,2 %** | **0,9351** |
| 0,8 | 6 081 | −59,0 % | 0,9330 |
| 1,2 | 5 245 | −64,6 % | 0,9274 |
| 2 | 4 551 | −69,3 % | 0,9148 |
| 3 | 4 205 | −71,6 % | 0,9034 |

**Cityscape · 16 colores** (base 17 287 nodos, SSIM 0,9559)

| `simplify` | Nodos | Δ nodos | SSIM |
|---:|---:|---:|---:|
| 0 | 17 287 | — | 0,9559 |
| 0,6 | 9 031 | −47,8 % | 0,9530 |
| **0,8** | **8 055** | **−53,4 %** | **0,9518** |
| 1 | 7 607 | −56,0 % | 0,9500 |
| 1,6 | 7 179 | −58,5 % | 0,9429 |
| 3 | 6 949 | −59,8 % | 0,9252 |

**Ángel · 12 colores** (base 64 214 nodos, SSIM 0,6737)

| `simplify` | Nodos | Δ nodos | SSIM |
|---:|---:|---:|---:|
| 0 | 64 214 | — | 0,6737 |
| 0,6 | 45 138 | −29,7 % | 0,6700 |
| **0,8** | **43 214** | **−32,7 %** | **0,6693** |
| 1,2 | 41 522 | −35,3 % | 0,6684 |
| 2 | 40 552 | −36,8 % | 0,6665 |
| 3 | 40 200 | −37,4 % | 0,6649 |

**K1 · 16 colores** (base 240 135 nodos, SSIM 0,8638)

| `simplify` | Nodos | Δ nodos | SSIM |
|---:|---:|---:|---:|
| 0 | 240 135 | — | 0,8638 |
| 0,6 | 180 517 | −24,8 % | 0,8613 |
| 1 | 175 379 | −27,0 % | 0,8599 |
| **1,2** | **174 451** | **−27,4 %** | **0,8591** |
| 1,6 | 173 713 | −27,7 % | 0,8585 |
| 3 | 173 235 | −27,9 % | 0,8563 |

---

## 4. Lo que cambia en el producto

- El presupuesto de color y el de geometría **se eligen por categoría**, no con un default único:
  ilustración 12, poster 16, foto 12–24, line art 16.
- `simplify` deja de ser un número mágico: 0,6–0,8 para ilustración y poster; 0,8 para foto; 1,2
  para line art con el criterio declarado.
- El caso de K1 es una señal de producto: **el line art no se arregla con este pipeline**. Necesita
  el modo `bw` con umbral adaptativo (Bradley–Roth), que vtracer ya tiene y este banco nunca probó.

---

## 5. Verificación

- Recorte a 3× del ajuste elegido, comparado contra `simplify 0`: las nubes de Gum Tree siguen
  ahí y las líneas de K1 conservan el texto; la diferencia es el temblor de píxel que desaparece.
  Verificado en **ego-browser**, no solo por número.
- `pnpm test`: 44 pruebas en verde (no se tocó código de librería, solo el banco).

---

## 6. Limitaciones

- **SSIM no mide color.** Donde SSIM y ΔE discrepan (Ángel) se publican las dos cifras y no se
  elige una por vosotros.
- **La búsqueda no es exhaustiva**: `simplify` se muestreó en 10 niveles y la paleta en 5. El
  óptimo puede estar entre dos muestras; el criterio de selección es explícito para que se pueda
  repetir con otra rejilla.
- **El barrido no toca `colorPrecision`, `layerDifference` ni `filterSpeckle`.** Se fijaron en los
  defaults porque el experimento 01 ya mostró que aplanar colores empeora el resultado.
- K1 tiene un comportamiento anómalo a 12 colores que no se investigó: se documenta y se evita.

---

## 7. Siguiente

1. **DXF + kerf**: la salida cortable sigue sin compensación de radio de herramienta.
2. **Modo `bw` + umbral adaptativo para line art**: es la deuda que deja K1.
3. Repetir el experimento 02 sobre la configuración calibrada, para cerrar el número de doble corte
   con el pipeline definitivo.
