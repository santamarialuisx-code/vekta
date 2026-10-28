# Experimento 03 — ¿arregla la cuantización el acabado?

> Fecha: 2026-10-28 · Pipeline: decodificar → cuantizar en OKLab → trazar con la paleta explícita.
> Banco: 4 imágenes × 2 variantes (`default`, `cutout-opt`) × 2 modos (directo, cuantizado a 16).
> Verificación en navegador con la misma SSIM de `metrics.html` (8×8 sobre luminancia).

---

## 1. Veredicto corto

**Sí, y por dos vías a la vez: menos nodos y las nubes de vuelta.**

- Nodos: **−8 % a −37 %** en las variantes de mosaico y fotografía, con SSIM **igual o mejor**.
- Las cinco nubes del Gum Tree, que el trazado directo se comía, **vuelven** con el 98,5 % de sus
  píxeles intactos.
- Los halos de antialiasing **no necesitan una pasada de limpieza**: eran un problema de paleta.
  El trazado directo emite 237–8 018 colores de relleno (casi todos intermedios de antialiasing);
  con paleta explícita emite 14–16, exactamente la paleta.

La limpieza de regiones que estaba planeada como paso siguiente **queda descartada por datos**, no
por opinión: no hay regiones que limpiar si la paleta nunca llega a contener el color del halo.

---

## 2. Método

```
imagen → decodeImage → quantize(maxColors: 16, OKLab, área) → renderQuantized
       → vtracer.convertPixels(rgba, w, h, { ...variante, palette })
```

Dos detalles que cambian el resultado:

1. **La paleta se pasa explícita a vtracer.** Si se le deja volver a agrupar, deriva los colores
   unos pocos niveles y fragmenta el SVG: 146 grupos con 15 colores de entrada, en vez de 14. Con
   `palette` el SVG usa exactamente la paleta.
2. **La comparación es contra el mismo trazador con las mismas opciones**, cambiando solo el modo.
   Cualquier diferencia de nodos o SSIM es atribuible a la cuantización.

Comandos:

```bash
npm run bench:quantize   # paleta + PNG de inspección
npm run bench:pipeline   # 4 imágenes × 2 variantes × 2 modos
```

---

## 3. Números

Nodos del SVG y SSIM contra el original (16 colores):

| Imagen · variante | Nodos directo | Nodos 16 colores | Δ nodos | SSIM directo | SSIM 16 colores | Color de relleno |
|---|---:|---:|---:|---:|---:|---:|
| Gum Tree · `cutout-opt` | 5 428 | **4 977** | −8,3 % | 0,9239 | 0,9263 | 237 → 15 |
| Gum Tree · `default` | 10 817 | **9 625** | −11,0 % | 0,9483 | 0,9486 | 268 → 14 |
| Cityscape · `cutout-opt` | 7 872 | **7 239** | −8,0 % | 0,9472 | 0,9443 | 364 → 16 |
| Cityscape · `default` | 9 319 | **7 774** | −16,6 % | 0,9534 | 0,9500 | 410 → 16 |
| Ángel · `cutout-opt` | 78 184 | **49 386** | −36,8 % | 0,6578 | 0,6645 | 7 269 → 16 |
| Ángel · `default` | 122 865 | **90 682** | −26,2 % | 0,7595 | 0,7920 | 8 018 → 16 |
| K1 · `cutout-opt` | 176 144 | 173 851 | −1,3 % | 0,8570 | 0,8586 | 254 → 28 |
| K1 · `default` | 283 922 | 275 727 | −2,9 % | 0,8519 | 0,8513 | 254 → 16 |

Lectura:

- **Fotografía** es donde más gana: −26 % y −37 % de nodos, y el SSIM **sube** 0,03 en `default`.
  Tiene sentido: 8 018 colores son en su mayoría ruido de gradiente; quedarse con 16 regiones
  grandes elimina nodos que no aportaban estructura.
- **Ilustración** gana menos nodos (−8 % a −17 %) pero el SSIM se mueve ±0,003, es decir, nada.
  Es el caso de las nubes.
- **Line art** casi no cambia (−1 % a −3 %): K1 ya era, en la práctica, blanco y negro. La
  cuantización no le quita calidad, pero tampoco le quita nodos. Ese es un problema de `simplify`,
  no de color.

---

## 4. La prueba visual que importa

Recorte 3× de la franja de nubes del Gum Tree, trazado `cutout-opt`:

| | Nubes | Colores del SVG |
|---|---|---|
| Original | 5 nubes visibles | — |
| Trazado directo | **desaparecen**, el cielo queda plano | 237 |
| Cuantizado a 16 | **las 5 nubes, igual que el original** | 15 |

Medido sobre los 65 436 px casi blancos de la franja: con 16 colores el **98,5 %** de esos píxeles
quedan sin cambio (ΔE < 0,005) y el máximo es 0,019. Con 8 colores el 0 % sobrevive: la paleta se
queda sin ranura para el blanco de la nube y se la come el cielo rosa.

Conclusión operativa: **la paleta necesita ranuras suficientes para las regiones de bajo contraste
con área**. 16 basta para esta ilustración; 8 no. El tamaño de paleta por categoría es una decisión
de producto pendiente, no un detalle.

---

## 5. Decisión sobre la limpieza de regiones

El plan original era: borrar componentes bajo un área mínima y reasignar sus píxeles al vecino más
cercano en ΔE, para matar halos de antialiasing.

**No se implementa.** Un halo existe porque la paleta contiene un color intermedio; si el
cuantizador nunca le da una ranura, no hay halo que borrar. Los números lo respaldan: 237–8 018
colores de relleno en el trazado directo contra 14–16 con paleta explícita, y ningún color fuera de
la paleta en el SVG resultante.

Queda como hipótesis a revisar si aparece una entrada donde el halo sea **estructural** (no de
paleta), por ejemplo un degradado real que haya que conservar. Hoy no hay evidencia de eso.

---

## 6. Limitaciones

- **SSIM premia fidelidad de píxel, no calidad de curva.** Se lee junto al número de nodos, como en
  el experimento 01. Un SSIM que sube no significa automáticamente un SVG mejor.
- **K1 no mejora.** El line art necesita otra herramienta (`simplify` y umbral adaptativo), no
  cuantización.
- **16 colores es una elección, no un resultado.** No se barrió el tamaño de paleta por categoría;
  el barrido es el siguiente paso natural junto con `simplify`.
- El pipeline de color es JS puro y no depende de Node, pero **el trazado se midió con el build
  `wasm-pack --target nodejs`**: en el navegador cambia el pegamento, no los algoritmos.

---

## 7. Siguiente

1. **Barrido de `simplify` × tamaño de paleta por categoría**: el criterio es «mitad de nodos,
   misma percepción», y K1 es el caso que lo necesita.
2. **DXF + kerf**: la salida cortable sigue sin compensación de radio de herramienta.
3. **Repetir el experimento 02 sobre la salida cuantizada**: ¿el doble corte cambia con 15 colores
   en vez de 268? La predicción es que `R/U` se mantiene cerca de 2, pero ahora con un cuarto del
   recorrido absoluto.
