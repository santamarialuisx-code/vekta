// Unión booleana por color y medición del doble corte.
//
// Una salida teselada por colores asigna cada borde interno a dos formas, así que la máquina
// recorre ese borde dos veces. `redundancy` mide el exceso al cortar por capas de color
// (vinilo, DTF, cada color en su lámina) y `singlePassRedundancy` el exceso al cortar todos
// los bordes de una sola pasada, donde cada borde debería recorrerse una única vez.
//
// El kernel es Clipper (enteros, tolerante a aristas colineales y auto-intersecciones). Los
// ports JS de Martinez (`polygon-clipping`, `polyclip-ts`) fallan con la salida real de un
// trazador: sus bordes compartidos son casi coincidentes, no exactamente iguales.

import { createRequire } from "node:module";

import { pathToPolylines, polylineLength } from "./path-to-polyline.mjs";

const require = createRequire(import.meta.url);
const ClipperLib = require("clipper-lib");

const CLIP_SCALE = 1000; // 0,001 px de resolución: muy por debajo de la tolerancia de corte
const MIN_RING_AREA = 0.5; // px²: por debajo no hay nada que cortar, es ruido de aplanado

// Cierre morfológico. Dos regiones contiguas comparten borde, pero cada una lo aproxima con
// su propio Bézier: al aplanar quedan rendijas de centésimas de píxel. No son diseño ni se
// pueden cortar, y sin cerrarlas la unión devuelve anillos-hairline que inflan el perímetro.
// 0,5 px = 2× la tolerancia de aplanado, muy por debajo de cualquier kerf real.
const CLOSE_GAP = 0.5;

/**
 * Agrupa las formas por color y separa contornos de agujeros.
 * @param {{ d: string, fill?: string, fillRule?: string }[]} shapes
 */
export function analyzeShapes(shapes, { tolerance = 0.25, minArea = MIN_RING_AREA } = {}) {
  const polygonsByColor = new Map();
  const allPolygons = [];

  let outlineLength = 0;
  let contourCount = 0;
  let holeCount = 0;

  for (const shape of shapes ?? []) {
    const color = String(shape.fill ?? "#000000").trim().toLowerCase();
    const polygons = shapePolygons(shape, { tolerance, minArea });

    for (const polygon of polygons) {
      for (const ring of polygon) {
        outlineLength += polylineLength(ring);
        contourCount++;
      }
      if (polygon.length > 1) holeCount++;

      if (!polygonsByColor.has(color)) polygonsByColor.set(color, []);
      polygonsByColor.get(color).push(polygon);
      allPolygons.push(polygon);
    }
  }

  return {
    polygonsByColor,
    allPolygons,
    outlineLength,
    contourCount,
    holeCount,
    shapeCount: (shapes ?? []).length,
  };
}

/**
 * Unión booleana de polígonos (con agujeros) devuelta como anillos cerrados en px.
 * Clipper entrega los anillos sin jerarquía: para recorrer o dibujar alcanza con el conjunto,
 * y el sentido de giro distingue contorno de agujero.
 * @param {number[][][][]} polygons
 * @returns {number[][][]} anillos cerrados
 */
export function unionRings(polygons, { scale = CLIP_SCALE, closeGap = CLOSE_GAP } = {}) {
  if (polygons.length === 0) return [];
  if (polygons.length === 1) return polygons[0].map(closeRing);

  const clipper = new ClipperLib.Clipper();
  for (const polygon of polygons) {
    polygon.forEach((ring, index) => {
      const path = toClipperPath(ring, { scale, orientation: index === 0 ? 1 : -1 });
      if (path.length >= 3) clipper.AddPath(path, ClipperLib.PolyType.ptSubject, true);
    });
  }

  const solution = new ClipperLib.Paths();
  clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    solution,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );

  const gap = Math.round(closeGap * scale);
  const merged = gap > 0 ? closeGaps(solution, gap) : solution;

  return merged
    .map((path) => path.map((point) => [point.X / scale, point.Y / scale]))
    .filter((ring) => ring.length >= 3)
    .map(closeRing);
}

/** Longitud total de los anillos, agujeros incluidos. */
export function ringsLength(rings) {
  let total = 0;
  for (const ring of rings) total += polylineLength(ring);
  return total;
}

/**
 * @param {{ d: string, fill?: string, fillRule?: string }[]} shapes
 * @returns {{
 *   shapeCount: number, colorCount: number, contourCount: number, holeCount: number,
 *   outlineLength: number, layerLength: number, silhouetteLength: number,
 *   uniqueCutLength: number, redundancy: number, singlePassRedundancy: number,
 *   duplicateLength: number, singlePassDuplicateLength: number
 * }}
 * `outlineLength` es lo que trae el SVG; `layerLength` la unión por color; `silhouetteLength`
 * la unión de todo; `uniqueCutLength` el óptimo de una pasada con cada borde una sola vez.
 */
export function cutStats(shapes, options = {}) {
  const analysis = analyzeShapes(shapes, options);

  let layerLength = 0;
  for (const polygons of analysis.polygonsByColor.values()) {
    layerLength += ringsLength(unionRings(polygons));
  }

  const silhouetteLength = ringsLength(unionRings(analysis.allPolygons));

  // Un borde entre dos formas del mismo color desaparece al unir por capa (S_s), pero un borde
  // entre dos colores es un contorno real que se recorre una sola vez (S_c). Con L = E + 2·S_c
  // y R = E + 2·S_c + 2·S_s, el recorrido único de una pasada es E + S_c = (E + L) / 2.
  const uniqueCutLength = Math.max(silhouetteLength, (silhouetteLength + layerLength) / 2);

  return {
    shapeCount: analysis.shapeCount,
    colorCount: analysis.polygonsByColor.size,
    contourCount: analysis.contourCount,
    holeCount: analysis.holeCount,
    outlineLength: analysis.outlineLength,
    layerLength,
    silhouetteLength,
    uniqueCutLength,
    redundancy: ratio(analysis.outlineLength, layerLength),
    singlePassRedundancy: ratio(analysis.outlineLength, uniqueCutLength),
    duplicateLength: Math.max(0, analysis.outlineLength - layerLength),
    singlePassDuplicateLength: Math.max(0, analysis.outlineLength - uniqueCutLength),
  };
}

function shapePolygons(shape, { tolerance, minArea }) {
  const rings = [];
  for (const line of pathToPolylines(shape.d, { tolerance })) {
    const ring = closeRing(line.points);
    if (ring.length < 4) continue;
    const area = ringArea(ring);
    if (Math.abs(area) < minArea) continue;
    rings.push({ ring, area });
  }
  return groupRings(rings);
}

// Anida los anillos de un mismo path: profundidad par es contorno, impar es agujero.
function groupRings(rings) {
  const depth = rings.map((candidate, index) => {
    let count = 0;
    for (const [otherIndex, other] of rings.entries()) {
      if (otherIndex !== index && ringInside(candidate.ring, other.ring)) count++;
    }
    return count;
  });

  const polygons = [];
  const byIndex = new Map();

  rings.forEach((entry, index) => {
    if (depth[index] % 2 !== 0) return;
    const polygon = [entry.ring];
    polygons.push(polygon);
    byIndex.set(index, polygon);
  });

  rings.forEach((entry, index) => {
    if (depth[index] % 2 === 0) return;

    let parent = null;
    let parentArea = Infinity;
    rings.forEach((candidate, candidateIndex) => {
      if (depth[candidateIndex] !== depth[index] - 1) return;
      if (!ringInside(entry.ring, candidate.ring)) return;
      if (candidate.area < parentArea) {
        parentArea = candidate.area;
        parent = candidateIndex;
      }
    });

    if (parent === null) {
      const polygon = [entry.ring];
      polygons.push(polygon);
      byIndex.set(index, polygon);
    } else {
      byIndex.get(parent).push(entry.ring);
    }
  });

  return polygons;
}

function toClipperPath(ring, { scale, orientation }) {
  const points = [];
  const closed = closeRing(ring);
  for (const [x, y] of closed) {
    const point = new ClipperLib.IntPoint(Math.round(x * scale), Math.round(y * scale));
    const last = points.at(-1);
    if (!last || last.X !== point.X || last.Y !== point.Y) points.push(point);
  }
  // Clipper espera anillos sin repetir el primer punto.
  if (points.length > 1) {
    const first = points[0];
    const last = points.at(-1);
    if (first.X === last.X && first.Y === last.Y) points.pop();
  }
  if (orientation > 0 && signedArea(points) < 0) points.reverse();
  if (orientation < 0 && signedArea(points) > 0) points.reverse();
  return points;
}

// Cierre morfológico: dilatar y volver a contraer. Une las rendijas sin mover el contorno.
function closeGaps(paths, delta) {
  const grown = offsetPaths(paths, delta);
  return offsetPaths(grown, -delta);
}

function offsetPaths(paths, delta) {
  const offset = new ClipperLib.ClipperOffset(2, 0.25);
  offset.AddPaths(paths, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  const result = new ClipperLib.Paths();
  offset.Execute(result, delta);
  return result;
}

function signedArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.X * b.Y - b.X * a.Y;
  }
  return area / 2;
}

function closeRing(points) {
  if (points.length === 0) return points;
  const closed = points.map((point) => [point[0], point[1]]);
  const [first] = closed;
  const last = closed.at(-1);
  if (last[0] !== first[0] || last[1] !== first[1]) closed.push([first[0], first[1]]);
  return closed;
}

function ringArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return area / 2;
}

function ringInside(inner, outer) {
  if (!bboxContains(bbox(outer), bbox(inner))) return false;
  let inside = 0;
  for (const point of inner.slice(0, -1)) {
    if (pointInRing(point, outer)) inside++;
  }
  return inside / (inner.length - 1) >= 0.5;
}

function bbox(ring) {
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

function bboxContains(outer, inner) {
  return (
    inner.minX >= outer.minX &&
    inner.minY >= outer.minY &&
    inner.maxX <= outer.maxX &&
    inner.maxY <= outer.maxY
  );
}

// Ray casting; los anillos de un mismo path no se tocan, así que un vértice es muestra válida.
function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}
