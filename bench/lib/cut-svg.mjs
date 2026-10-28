// Emisión de SVG cortable a partir de la geometría unificada.
//
// Dos productos, porque son dos trabajos distintos:
//   - silueta: un solo path con la unión de todas las formas. Es el recorrido mínimo para
//     recortar la pieza, y el que evita el doble corte por completo.
//   - capas: un path por color con la unión de esa capa. Para vinilo y DTF, donde cada color
//     va en su propia lámina y no hay bordes duplicados dentro de la capa.

/** Bounding box de un conjunto de anillos. */
export function ringsBbox(rings) {
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

/** Anillos cerrados → atributo `d`. El punto repetido del cierre se sustituye por `Z`. */
export function ringsToPathData(rings, { precision = 2 } = {}) {
  const number = (value) => {
    const rounded = Number(value.toFixed(precision));
    return Object.is(rounded, -0) ? "0" : String(rounded);
  };

  return rings
    .map((ring) => {
      if (ring.length < 3) return "";
      const points = samePoint(ring[0], ring.at(-1)) ? ring.slice(0, -1) : ring;
      const [first, ...rest] = points;
      const head = `M${number(first[0])} ${number(first[1])}`;
      const body = rest.map(([x, y]) => `L${number(x)} ${number(y)}`).join("");
      return `${head}${body}Z`;
    })
    .join("");
}

/** Silueta: un único path con `evenodd` para que los agujeros resten. */
export function cutSvg({ rings, fill = "#000000", precision = 2, bbox = ringsBbox(rings) }) {
  const d = ringsToPathData(rings, { precision });
  return document({
    bbox,
    body: `<path d="${d}" fill="${fill}" fill-rule="evenodd"/>`,
  });
}

/** Capas: un path por color, cada uno ya unificado. */
export function layerSvg({ layers, bbox, precision = 2 }) {
  const body = layers
    .map((layer) => {
      const d = ringsToPathData(layer.rings, { precision });
      if (!d) return "";
      return `<path d="${d}" fill="${layer.fill}" fill-rule="evenodd"/>`;
    })
    .filter(Boolean)
    .join("\n");
  return document({ bbox: bbox ?? ringsBbox(layers.flatMap((layer) => layer.rings)), body });
}

function document({ bbox, body }) {
  const x = trim(bbox.x);
  const y = trim(bbox.y);
  const width = trim(bbox.width);
  const height = trim(bbox.height);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}">`,
    body,
    "</svg>",
    "",
  ].join("\n");
}

function trim(value) {
  return Number(value.toFixed(3));
}

function samePoint(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}
