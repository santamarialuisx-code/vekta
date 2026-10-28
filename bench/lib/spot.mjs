// Separación de tintas: una capa por color, con nombre y orden de impresión.
//
// Una salida por colores ya existe (`layerSvg`), pero un taller de serigrafía necesita dos cosas
// más: el nombre de la tinta y el orden en que se estampa. El orden no es el de aparición en el
// archivo, que es arbitrario, sino de mayor a menor área: la tinta que cubre más superficie va
// primero, que es lo que pide el secado y el registro.

import { analyzeShapes, unionRings } from "./union.mjs";

const EPS = 1e-9;

/**
 * Agrupa las formas por color en capas con nombre, área y orden.
 * @param {{ d: string, fill?: string, fillRule?: string }[]} shapes
 * @param {{ names?: string[], scale?: number }} options
 *   `names` se asigna en orden de impresión (mayor área primero); `scale` son mm por unidad de la
 *   geometría y se aplica a la geometría y al área
 * @returns {{ name: string, color: string, area: number, rings: number[][][], order: number }[]}
 */
export function spotLayers(shapes, { names = [], scale = 1 } = {}) {
  if (!(scale > 0)) {
    throw new Error(`la escala debe ser positiva, recibí ${scale}`);
  }

  const analysis = analyzeShapes(shapes ?? []);
  const layers = [...analysis.polygonsByColor].map(([color, polygons]) => {
    const rings = unionRings(polygons).map((ring) => scaleRing(ring, scale));
    return { name: null, color, area: ringsArea(rings), rings, order: null };
  });

  validate(names, layers.length);
  return printOrder(layers).map((layer, index) => ({
    ...layer,
    name: names.length > 0 ? names[index] : `CUT-${index + 1}`,
  }));
}

/**
 * Orden de impresión: área descendente, empate por nombre de color para que sea reproducible.
 * @param {{ color?: string, area: number }[]} layers
 * @returns {{ order: number }[]} copia ordenada, con `order` de 1 a n; no muta la entrada
 */
export function printOrder(layers) {
  return [...(layers ?? [])]
    .sort((a, b) => b.area - a.area || String(a.color).localeCompare(String(b.color)))
    .map((layer, index) => ({ ...layer, order: index + 1 }));
}

/**
 * Área del material de un conjunto de anillos cerrados.
 *
 * El signo del área no alcanza como fuente de verdad: `unionRings` devuelve el giro canónico
 * (material a la izquierda) cuando pasa por Clipper, pero cuando una capa tiene un solo polígono
 * devuelve el giro original. Por eso la jerarquía se resuelve por anidamiento: profundidad par es
 * contorno y suma, profundidad impar es agujero y resta.
 * @param {number[][][]} rings
 * @returns {number} área en unidades de la geometría, siempre positiva
 */
export function ringsArea(rings) {
  let total = 0;
  (rings ?? []).forEach((ring, index) => {
    const own = Math.abs(ringArea(ring));
    let depth = 0;
    (rings ?? []).forEach((other, otherIndex) => {
      if (otherIndex !== index && ringInside(ring, other)) depth++;
    });
    total += depth % 2 === 0 ? own : -own;
  });
  return Math.abs(total);
}

function validate(names, colorCount) {
  if (names.length === 0) return;
  if (names.length !== colorCount) {
    const nombres = names.length === 1 ? "nombre de tinta" : "nombres de tinta";
    const colores = colorCount === 1 ? "color" : "colores";
    throw new Error(`hay ${colorCount} ${colores} y ${names.length} ${nombres}`);
  }
  const seen = new Set();
  for (const name of names) {
    if (!name) throw new Error("un nombre de tinta no puede estar vacío");
    if (seen.has(name)) throw new Error(`nombre de tinta repetido: ${name}`);
    seen.add(name);
  }
}

function scaleRing(ring, scale) {
  if (scale === 1) return ring.map(([x, y]) => [x, y]);
  return ring.map(([x, y]) => [x * scale, y * scale]);
}

function ringArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return sum / 2;
}

function ringInside(inner, outer) {
  const outerBox = box(outer);
  const innerBox = box(inner);
  if (
    innerBox.minX < outerBox.minX - EPS ||
    innerBox.minY < outerBox.minY - EPS ||
    innerBox.maxX > outerBox.maxX + EPS ||
    innerBox.maxY > outerBox.maxY + EPS
  ) {
    return false;
  }

  const points = inner.slice(0, -1);
  let inside = 0;
  for (const point of points) if (pointInRing(point, outer)) inside++;
  return inside >= points.length / 2;
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y === yj > y) continue;
    if (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function box(ring) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}
