// Unidades físicas: de píxeles de imagen a milímetros de máquina.
//
// Un SVG en píxeles no dice cuánto mide la pieza. Para cortar hace falta una escala explícita: el
// usuario da el ancho real que quiere y todo lo demás se deriva de ahí.

/** Escala píxeles → mm para un ancho físico objetivo. */
export function scaleFromWidth(pixelWidth, targetWidthMm) {
  if (!(pixelWidth > 0)) throw new Error("el ancho en píxeles debe ser positivo");
  if (!(targetWidthMm > 0)) throw new Error("el ancho en milímetros debe ser positivo");
  return targetWidthMm / pixelWidth;
}

/** Copia los anillos aplicando una escala uniforme (no muta la entrada). */
export function scaleRings(rings, scale) {
  return rings.map((ring) => ring.map(([x, y]) => [x * scale, y * scale]));
}

/** Caja envolvente de un conjunto de anillos, en las mismas unidades que la entrada. */
export function ringsBox(rings) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
