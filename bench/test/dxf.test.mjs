import test from "node:test";
import assert from "node:assert/strict";

import { ringsToDxf } from "../lib/dxf.mjs";

const square = [
  [0, 0],
  [20, 0],
  [20, 10],
  [0, 10],
  [0, 0],
];

const linesOf = (dxf) => dxf.trimEnd().split("\n");

function pairs(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i += 2) out.push([lines[i], lines[i + 1]]);
  return out;
}

test("el DXF declara R2000, milímetros y una sección de entidades", () => {
  const dxf = ringsToDxf([square]);
  const lines = linesOf(dxf);
  const all = pairs(lines);
  assert.ok(all.some(([code, value]) => code === "9" && value === "$ACADVER"));
  assert.deepEqual(
    all.filter(([code]) => code === "1").slice(0, 1).map(([, value]) => value),
    ["AC1015"],
  );
  assert.ok(all.some(([code, value]) => code === "9" && value === "$INSUNITS"));
  assert.ok(all.some(([code, value]) => code === "70" && value === "4"));
  assert.ok(lines.includes("ENTITIES"));
  assert.equal(lines.at(-1), "EOF");
});

test("cada anillo es un LWPOLYLINE cerrado con sus vértices", () => {
  const dxf = ringsToDxf([square, square.map(([x, y]) => [x + 30, y])]);
  const lines = linesOf(dxf);
  assert.equal(lines.filter((line) => line === "LWPOLYLINE").length, 2);
  assert.equal(
    pairs(lines).filter(([code, value]) => code === "70" && value === "1").length,
    2,
  );
  const counts = pairs(lines)
    .filter(([code]) => code === "90")
    .map(([, value]) => Number(value));
  assert.deepEqual(counts, [4, 4]); // el punto de cierre repetido se descarta
});

test("Y se invierte como pide DXF", () => {
  const dxf = ringsToDxf([square]);
  const all = pairs(linesOf(dxf));
  const yValues = all.filter(([code]) => code === "20").map(([, value]) => Number(value));
  const xValues = all.filter(([code]) => code === "10").map(([, value]) => Number(value));
  assert.deepEqual(xValues, [0, 20, 20, 0]);
  assert.deepEqual(yValues, [0, 0, -10, -10]); // -0 se normaliza a 0
});

test("un anillo degenerado no genera entidad", () => {
  const dxf = ringsToDxf([[[0, 0], [1, 0], [0, 0]]]);
  assert.ok(!linesOf(dxf).includes("LWPOLYLINE"));
});
