# Experimento 06 — DXF, milímetros y kerf

> Fecha: 2026-10-28 · Cierra tres de las seis promesas de «cut-ready»: unidades reales, DXF en el
> navegador y compensación de ancho de corte. Verificación: `npm test` (55 pruebas) y emisión real
> sobre los SVG del banco.

---

## 1. Veredicto corto

**La salida ya es un archivo que una máquina puede ejecutar, no una imagen que se parece a un
vector.** Lo que se podía hacer con geometría, está hecho:

- **Milímetros reales**: se pide un ancho físico (`--width-mm 100`) y el SVG declara `width="100.2mm"`.
- **DXF**: `AC1015` con `LWPOLYLINE`, `$INSUNITS = 4` (mm), una capa `CUT`, eje Y invertido como
  exige el formato. Lo lee LightBurn, Inkscape, LibreCAD y QCAD sin adivinar la escala.
- **Kerf**: la trayectoria se compensa por el radio de la herramienta. Contornos exteriores crecen,
  agujeros se encogen. Un cuadrado de 10 mm con kerf 0,2 mm emite un contorno de 10,2 mm y su área
  pasa de 100 a 104,03 mm².

Queda fuera, y se dice: single-stroke, tintas con nombre y orden, kerf variable, lead-in/out y
anidado.

---

## 2. Qué se emite

Para cada SVG de entrada, con `npm run bench:cut -- --width-mm 100 --kerf-mm 0.2 --format svg,dxf`:

| Archivo | Contenido |
|---|---|
| `<nombre>--silhouette.svg` | un path con la unión de todo, en mm, con kerf aplicado |
| `<nombre>--silhouette.dxf` | la misma trayectoria en DXF |
| `<nombre>--layers.svg` | un path por color, en mm, sin kerf (capas para vinilo/DTF) |
| `<nombre>--layers.dxf` | las capas en DXF |

Sin `--width-mm` el comportamiento anterior no cambia: píxeles, solo SVG. Así los informes del
experimento 02 siguen siendo reproducibles.

**Ejemplo real** (Gum Tree `cutout-opt`, 1400×775 px):

```
100 × 55,557 mm nominales
kerf 0,2 mm → 100,2 × 55,557 mm de trayectoria
recorrido de la silueta:   311,3 mm
recorrido de las capas:  6 276,7 mm  (6,3 m)
```

Esa última línea es el doble corte del experimento 02 **en unidades de máquina**: cortar todos los
bordes de color de una pieza de 10 cm son 6,3 metros de recorrido, contra 31 cm de la silueta.

---

## 3. Cómo se compensa el kerf

La herramienta tiene radio: si se corta sobre el contorno, la pieza sale más chica por el ancho del
corte. La compensación desplaza la trayectoria al **radio** (`kerf / 2`):

- contornos exteriores → hacia fuera;
- agujeros → hacia dentro.

El desplazamiento se hace con `ClipperOffset`, unión redonda y tolerancia de arco 0,01 mm. Que los
agujeros vayan al revés no es un detalle de implementación: Clipper distingue contorno de agujero
por el **sentido de giro**, y `unionRings` ya devuelve los agujeros con giro contrario. Si se
invirtiera, el agujero crecería con el kerf y la pieza no entraría.

Verificado en las pruebas: exterior 10 → 10,2 mm (área 104,03 mm²) y agujero 4 → 3,8 mm (área
14,44 mm²).

---

## 4. Por qué AC1015 y no R12

R12 es más compatible, pero **no tiene variable de unidades**: el archivo saldría ambiguo y cada
programa asumiría una escala. AC1015 (R2000) con `$INSUNITS = 4` es lo que leen las herramientas de
corte actuales sin preguntar. El precio es un formato algo más moderno; el beneficio es que el
archivo dice lo que mide.

Otras decisiones:

- `LWPOLYLINE` cerrada (`70 = 1`) en vez de `POLYLINE`/`VERTEX`: menos renglones y más rápido de
  leer, sin perder compatibilidad en el software de corte.
- Una sola capa `CUT`. Las capas por color van en el archivo de capas, no en el de corte.
- Eje Y invertido: SVG crece hacia abajo, DXF hacia arriba.

---

## 5. Verificación

```
$ npm test
ℹ tests 55   ℹ pass 55   ℹ fail 0

$ node bench/cut.mjs --only gum-tree-vector__cutout-opt --width-mm 100 --kerf-mm 0.2 --format svg,dxf
error máximo de lo emitido: 0.00 %
```

- El perímetro de lo emitido se mide **releyendo el `d` del archivo**, no la geometría de entrada.
  En mm eso obliga a no reutilizar el analizador con umbrales en px², que mentiría: por eso el
  verificador mide el `d` tal cual.
- Pruebas nuevas: escala, kerf en exterior y agujero, DXF (cabecera, unidades, cierre, vértices,
  inversión de Y, anillo degenerado) y CLI completo en mm.

---

## 6. Limitaciones

- **Kerf constante.** No hay compensación por ángulo, material ni potencia. Es el paso siguiente
  natural y no cambia la arquitectura.
- **Kerf solo en la silueta.** Las capas por color salen a tamaño nominal: compensar cada capa por
  separado las haría solaparse entre sí, que es peor para DTF.
- **Sin lead-in/lead-out ni nesting.** Un archivo de producción real los necesita; son
  transformaciones sobre la misma geometría.
- **Coordenadas en mm con 3 decimales** (0,001 mm). Muy por debajo de cualquier tolerancia de
  máquina, pero es una decisión, no un dato.
- **No se probó en una máquina.** La validación es estructural (DXF válido, unidades, cotas); falta
  abrirlo en LightBurn real y cortar.

---

## 7. Siguiente

1. **Single-stroke / línea central** para grabado y plotter: es el otro hueco declarado del nicho.
2. **Separación de tintas** con nombre y orden de impresión para serigrafía.
3. **Lead-in/out y nesting** para que el DXF sea de producción, no de demostración.
