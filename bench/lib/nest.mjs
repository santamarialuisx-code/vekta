// Anidado por estantes (shelf packing) para aprovechar la hoja.
//
// Cada pieza entra en el primer estante donde cabe; si no cabe en ninguno se abre un estante nuevo
// debajo de lo ya usado. No es un anidado óptimo ni lo pretende: es el que se explica en una línea
// y deja una hoja razonablemente llena. La rotación de 90° se prueba sólo si se permite, y en ese
// caso se prefiere la orientación sin girar.
//
// Convenio de la colocación: `{ dx, dy, rotated }` significa "gira la pieza 90° en el plano
// ((x, y) → (-y, x)) y deja su caja envolvente con la esquina en (dx, dy)". El hueco `gapMm` se
// aplica entre piezas y entre estantes; no se reserva margen en el borde de la hoja.

import { ringsBox } from "./units.mjs";
import { ringsArea } from "./spot.mjs";

const EPS = 1e-9;

/**
 * Coloca piezas en una hoja.
 * @param {number[][][][]} pieces piezas, cada una como lista de anillos cerrados en mm
 * @param {{ sheetWidth: number, sheetHeight: number, gapMm?: number, allowRotate90?: boolean }} options
 * @returns {{
 *   placements: ({ dx: number, dy: number, rotated: boolean, widthMm: number, heightMm: number } | null)[],
 *   report: {
 *     sheetWidthMm: number, sheetHeightMm: number, gapMm: number, allowRotate90: boolean,
 *     placed: number, unplaced: number[], occupancy: number, usedWidthMm: number,
 *     usedHeightMm: number, pieceAreaMm2: number, sheetAreaMm2: number
 *   }
 * }}
 * `placements` va en el orden de entrada y vale `null` para las piezas que no caben.
 */
export function nest(pieces, { sheetWidth, sheetHeight, gapMm = 0, allowRotate90 = false } = {}) {
  if (!(sheetWidth > 0)) {
    throw new Error(`el ancho de la hoja debe ser positivo, recibí ${sheetWidth}`);
  }
  if (!(sheetHeight > 0)) {
    throw new Error(`el alto de la hoja debe ser positivo, recibí ${sheetHeight}`);
  }
  if (!(gapMm >= 0)) {
    throw new Error(`el hueco no puede ser negativo, recibí ${gapMm}`);
  }

  const items = (pieces ?? []).map((rings, index) => {
    const box = ringsBox(rings ?? []);
    return {
      index,
      width: box.width,
      height: box.height,
      area: ringsArea(rings ?? []),
    };
  });

  // Estantes parejos: primero la pieza de lado corto más alto, que es la que fija el alto del
  // estante; el área y el índice desempatan para que el resultado sea reproducible.
  const order = [...items].sort(
    (a, b) =>
      stackingHeight(b, allowRotate90) - stackingHeight(a, allowRotate90) ||
      b.area - a.area ||
      a.index - b.index,
  );

  const shelves = [];
  const placements = new Array(items.length).fill(null);
  const unplaced = [];

  for (const item of order) {
    const placement = place(item, { shelves, sheetWidth, sheetHeight, gapMm, allowRotate90 });
    if (placement) placements[item.index] = placement;
    else unplaced.push(item.index);
  }

  const placed = items.length - unplaced.length;
  const usedWidth = Math.max(
    0,
    ...placements.filter(Boolean).map((placement) => placement.dx + placement.widthMm),
  );
  const usedHeight = Math.max(
    0,
    ...placements.filter(Boolean).map((placement) => placement.dy + placement.heightMm),
  );
  const pieceArea = items
    .filter((item) => placements[item.index])
    .reduce((total, item) => total + item.area, 0);
  const sheetArea = sheetWidth * sheetHeight;

  return {
    placements,
    report: {
      sheetWidthMm: round(sheetWidth),
      sheetHeightMm: round(sheetHeight),
      gapMm: round(gapMm),
      allowRotate90,
      placed,
      unplaced,
      occupancy: round(sheetArea > 0 ? pieceArea / sheetArea : 0, 4),
      usedWidthMm: round(usedWidth),
      usedHeightMm: round(usedHeight),
      pieceAreaMm2: round(pieceArea),
      sheetAreaMm2: round(sheetArea),
    },
  };
}

/**
 * Aplica una colocación a los anillos de una pieza.
 * @param {number[][][]} rings
 * @param {{ dx?: number, dy?: number, rotated?: boolean }} placement
 * @returns {number[][][]} copia colocada, sin mutar la entrada
 */
export function placeRings(rings, { dx = 0, dy = 0, rotated = false } = {}) {
  const turned = (rings ?? []).map((ring) =>
    ring.map(([x, y]) => (rotated ? [-y, x] : [x, y])),
  );
  const box = ringsBox(turned);
  return turned.map((ring) => ring.map(([x, y]) => [x - box.x + dx, y - box.y + dy]));
}

function place(item, { shelves, sheetWidth, sheetHeight, gapMm, allowRotate90 }) {
  const orientations = allowRotate90 ? [false, true] : [false];

  for (const rotated of orientations) {
    const width = rotated ? item.height : item.width;
    const height = rotated ? item.width : item.height;
    if (width > sheetWidth + EPS || height > sheetHeight + EPS) continue;

    for (const shelf of shelves) {
      if (height > shelf.height + EPS) continue;
      if (shelf.x + width > sheetWidth + EPS) continue;
      const placement = {
        dx: round(shelf.x),
        dy: round(shelf.y),
        rotated,
        widthMm: round(width),
        heightMm: round(height),
      };
      shelf.x += width + gapMm;
      return placement;
    }

    const y = shelves.length === 0 ? 0 : Math.max(...shelves.map((shelf) => shelf.y + shelf.height)) + gapMm;
    if (y + height > sheetHeight + EPS) continue;

    const placement = {
      dx: 0,
      dy: round(y),
      rotated,
      widthMm: round(width),
      heightMm: round(height),
    };
    shelves.push({ y, height, x: width + gapMm });
    return placement;
  }

  return null;
}

function stackingHeight(item, allowRotate90) {
  return allowRotate90 ? Math.min(item.width, item.height) : item.height;
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
