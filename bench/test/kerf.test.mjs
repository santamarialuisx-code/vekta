// El kerf no es cosmético: si se compensa al revés, la pieza sale chica y el agujero grande.

import test from "node:test";
import assert from "node:assert/strict";

import { offsetRings } from "../lib/kerf.mjs";

const square = (x, y, size) => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
  [x, y],
];

const area = (ring) => {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return sum / 2;
};

test("el contorno exterior crece por el radio de la herramienta", () => {
  const [outer] = offsetRings([square(0, 0, 10)], 0.1);
  const box = outer.reduce(
    (acc, [x, y]) => ({
      minX: Math.min(acc.minX, x),
      minY: Math.min(acc.minY, y),
      maxX: Math.max(acc.maxX, x),
      maxY: Math.max(acc.maxY, y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  assert.ok(Math.abs(box.minX + 0.1) < 1e-3, `minX ${box.minX}`);
  assert.ok(Math.abs(box.maxX - 10.1) < 1e-3, `maxX ${box.maxX}`);
  // cuadrado 10 con esquinas redondeadas de 0,1: 100 + 4·10·0,1 + π·0,1²
  assert.ok(Math.abs(area(outer) - 104.03) < 0.02, `área ${area(outer)}`);
});

test("un agujero se compensa al revés", () => {
  // El agujero va con giro contrario, como lo devuelve `unionRings` (Clipper distingue
  // contorno de agujero por el sentido de giro, no por anidamiento).
  const holeRing = square(3, 3, 4).reverse();
  const rings = offsetRings([square(0, 0, 10), holeRing], 0.1);
  const holes = rings.filter((ring) => area(ring) < 0);
  const outers = rings.filter((ring) => area(ring) > 0);
  assert.equal(outers.length, 1);
  assert.equal(holes.length, 1);

  const [hole] = holes;
  const minX = Math.min(...hole.map(([x]) => x));
  const maxX = Math.max(...hole.map(([x]) => x));
  assert.ok(Math.abs(minX - 3.1) < 1e-3, `minX del agujero ${minX}`);
  assert.ok(Math.abs(maxX - 6.9) < 1e-3, `maxX del agujero ${maxX}`);
  assert.ok(Math.abs(area(hole) + 3.8 * 3.8) < 0.1, `área del agujero ${area(hole)}`);
});

test("sin kerf devuelve la geometría tal cual, sin mutarla", () => {
  const rings = [square(0, 0, 10)];
  const out = offsetRings(rings, 0);
  assert.deepEqual(out, rings);
  assert.notEqual(out[0], rings[0]);
});

test("un contorno que desaparece por completo no se emite", () => {
  const out = offsetRings([square(0, 0, 0.1)], -0.5);
  assert.equal(out.length, 0);
});
