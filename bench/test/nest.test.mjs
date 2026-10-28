// Anidado por estantes: lo que se prueba no es que el algoritmo sea óptimo, sino que dos piezas
// que caben a mano caben, que las que no caben se informan y que la ocupación se pueda recalcular
// a mano.

import test from "node:test";
import assert from "node:assert/strict";

import { nest, placeRings } from "../lib/nest.mjs";

const rectangle = (width, height, x = 0, y = 0) => [
  [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
    [x, y],
  ],
];

const area = (ring) => {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return sum / 2;
};

const bbox = (rings) => {
  const xs = rings.flatMap((ring) => ring.map(([x]) => x));
  const ys = rings.flatMap((ring) => ring.map(([, y]) => y));
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
};

test("dos piezas de 100×50 caben en una hoja de 220×120 con 5 mm de hueco", () => {
  const { placements, report } = nest([rectangle(100, 50), rectangle(100, 50)], {
    sheetWidth: 220,
    sheetHeight: 120,
    gapMm: 5,
  });

  assert.equal(report.placed, 2);
  assert.deepEqual(report.unplaced, []);
  assert.deepEqual(placements[0], { dx: 0, dy: 0, rotated: false, widthMm: 100, heightMm: 50 });
  assert.deepEqual(placements[1], { dx: 105, dy: 0, rotated: false, widthMm: 100, heightMm: 50 });

  // Ocupación a mano: 2 · 100 · 50 / (220 · 120) = 10 000 / 26 400 = 0,3788.
  assert.ok(Math.abs(report.occupancy - 10000 / 26400) < 1e-4, `ocupación ${report.occupancy}`);
  assert.equal(report.usedWidthMm, 205);
  assert.equal(report.usedHeightMm, 50);
  assert.equal(report.sheetAreaMm2, 26400);
  assert.equal(report.pieceAreaMm2, 10000);
});

test("en una hoja de 190×100 no caben y se informa cuál queda fuera", () => {
  const { placements, report } = nest([rectangle(100, 50), rectangle(100, 50)], {
    sheetWidth: 190,
    sheetHeight: 100,
    gapMm: 5,
  });

  assert.equal(report.placed, 1);
  assert.deepEqual(report.unplaced, [1]);
  assert.equal(placements[1], null);
  assert.ok(Math.abs(report.occupancy - 5000 / 19000) < 1e-4, `ocupación ${report.occupancy}`);
});

test("sin rotación permitida una pieza girada no entra; con rotación sí", () => {
  const piece = rectangle(150, 40);
  const sheet = { sheetWidth: 50, sheetHeight: 200 };

  const straight = nest([piece], { ...sheet, gapMm: 0 });
  assert.deepEqual(straight.report.unplaced, [0]);
  assert.equal(straight.placements[0], null);

  const rotated = nest([piece], { ...sheet, gapMm: 0, allowRotate90: true });
  assert.equal(rotated.report.unplaced.length, 0);
  assert.deepEqual(rotated.placements[0], {
    dx: 0,
    dy: 0,
    rotated: true,
    widthMm: 40,
    heightMm: 150,
  });
  assert.ok(Math.abs(rotated.report.occupancy - 0.6) < 1e-4, `ocupación ${rotated.report.occupancy}`);
});

test("la colocación devuelve la pieza dentro de la hoja y con su caja en dx, dy", () => {
  const { placements } = nest([rectangle(100, 50), rectangle(60, 30)], {
    sheetWidth: 220,
    sheetHeight: 120,
    gapMm: 5,
  });

  const placed = placeRings(rectangle(60, 30), placements[1]);
  const box = bbox(placed);
  assert.equal(box.minX, placements[1].dx);
  assert.deepEqual(box, { minX: 105, minY: 0, maxX: 165, maxY: 30 });
  // Mover no cambia el área de la pieza: 60 × 30.
  assert.equal(Math.abs(area(placed[0])), 1800);
});

test("una pieza más grande que la hoja se informa como fuera", () => {
  const { report } = nest([rectangle(400, 400)], {
    sheetWidth: 300,
    sheetHeight: 200,
    gapMm: 0,
  });
  assert.deepEqual(report.unplaced, [0]);
  assert.equal(report.occupancy, 0);
});

test("hoja y hueco inválidos se rechazan con un mensaje en español", () => {
  assert.throws(() => nest([], { sheetWidth: 0, sheetHeight: 100 }), /ancho de la hoja/);
  assert.throws(() => nest([], { sheetWidth: 100, sheetHeight: 0 }), /alto de la hoja/);
  assert.throws(
    () => nest([], { sheetWidth: 100, sheetHeight: 100, gapMm: -1 }),
    /hueco no puede ser negativo/,
  );
});
