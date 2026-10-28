import test from "node:test";
import assert from "node:assert/strict";

import { ringsBox, scaleFromWidth, scaleRings } from "../lib/units.mjs";

test("la escala sale del ancho físico pedido", () => {
  assert.equal(scaleFromWidth(1400, 100), 100 / 1400);
  assert.equal(scaleFromWidth(20, 20), 1);
  assert.throws(() => scaleFromWidth(0, 100));
  assert.throws(() => scaleFromWidth(1400, 0));
});

test("escalar anillos no muta la entrada y respeta la caja", () => {
  const rings = [[[0, 0], [20, 0], [20, 10], [0, 10], [0, 0]]];
  const scaled = scaleRings(rings, 0.5);
  assert.deepEqual(scaled[0][2], [10, 5]);
  assert.deepEqual(rings[0][2], [20, 10]);
  assert.deepEqual(ringsBox(scaled), { x: 0, y: 0, width: 10, height: 5 });
});
