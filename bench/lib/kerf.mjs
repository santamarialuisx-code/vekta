// Compensación de ancho de corte (kerf).
//
// La herramienta tiene radio: si se corta justo sobre el contorno, la pieza sale más chica (o el
// agujero más grande) por el ancho del corte. La compensación desplaza la trayectoria media
// herramienta hacia fuera en los contornos exteriores y hacia dentro en los agujeros, de modo que
// la pieza final mida lo dibujado.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ClipperLib = require("clipper-lib");

const UNITS_PER_MM = 10000; // 0,0001 mm: muy por debajo de cualquier tolerancia de máquina

/**
 * Desplaza los anillos por radio de herramienta.
 * @param {number[][][]} rings anillos cerrados en mm; contornos y agujeros se distinguen por el
 *   sentido de giro, igual que en `unionRings`
 * @param {number} radiusMm radio del corte (kerf / 2); positivo compensa hacia fuera
 * @returns {number[][][]} anillos desplazados, en mm
 */
export function offsetRings(rings, radiusMm) {
  if (radiusMm === 0) return rings.map((ring) => ring.map(([x, y]) => [x, y]));

  const offset = new ClipperLib.ClipperOffset(2, 0.01 * UNITS_PER_MM);
  let added = 0;
  for (const ring of rings) {
    const path = toPath(ring, UNITS_PER_MM);
    if (path.length >= 3) {
      offset.AddPath(path, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
      added++;
    }
  }
  if (added === 0) return [];

  const solution = new ClipperLib.Paths();
  offset.Execute(solution, radiusMm * UNITS_PER_MM);

  return solution
    .map((path) => path.map((point) => [point.X / UNITS_PER_MM, point.Y / UNITS_PER_MM]))
    .filter((ring) => ring.length >= 3)
    .map(closeRing);
}

/** Anillo cerrado sin puntos consecutivos repetidos. */
function toPath(ring, scale) {
  const points = [];
  for (const [x, y] of ring) {
    const point = new ClipperLib.IntPoint(Math.round(x * scale), Math.round(y * scale));
    const last = points.at(-1);
    if (!last || last.X !== point.X || last.Y !== point.Y) points.push(point);
  }
  if (points.length > 1) {
    const first = points[0];
    const last = points.at(-1);
    if (first.X === last.X && first.Y === last.Y) points.pop();
  }
  return points;
}

function closeRing(ring) {
  if (ring.length === 0) return ring;
  const closed = ring.map((point) => [point[0], point[1]]);
  const [first] = closed;
  const last = closed.at(-1);
  if (last[0] !== first[0] || last[1] !== first[1]) closed.push([first[0], first[1]]);
  return closed;
}
