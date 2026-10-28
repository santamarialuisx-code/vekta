// Reajuste de curvas sobre las etiquetas de píxel.
//
// Lo que se blinda aquí es el contrato del que depende el experimento 15: que la geometría de entrada
// se lea sin perder anillos, que el ajuste no se salga del error declarado y que las esquinas agudas
// sobrevivan. Si el error se colara, el SSIM subiría o bajaría sin que ninguna prueba dijera por qué.

import test from "node:test";
import assert from "node:assert/strict";

import { fitCurves, ringsFromPath } from "../lib/curve-fit.mjs";
import { parsePath, pathToPolylines } from "../lib/path-to-polyline.mjs";

/** Distancia de un punto al segmento `a`–`b`. */
function distanceToSegment(point, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point[0] - a[0], point[1] - a[1]);
  let t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
}

/** Distancia máxima de una polilínea (muestreada) al anillo original. */
function maxDistanceToRing(samples, ring) {
  let worst = 0;
  for (const point of samples) {
    let best = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      best = Math.min(best, distanceToSegment(point, a, b));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

/** Anillo de un círculo redondeado a la rejilla: la escalera que deja el modo píxel. */
function pixelCircle(radius, steps = 360) {
  const ring = [];
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    ring.push([Math.round(radius + radius * Math.cos(angle)), Math.round(radius + radius * Math.sin(angle))]);
  }
  return ring;
}

/** Anillo de un cuadrado de lado `size` con escalera de píxel, como lo emite el modo píxel. */
function staircaseSquare(size) {
  const ring = [];
  for (let x = 0; x <= size; x++) ring.push([x, 0]);
  for (let y = 0; y <= size; y++) ring.push([size, y]);
  for (let x = size; x >= 0; x--) ring.push([x, size]);
  for (let y = size; y >= 0; y--) ring.push([0, y]);
  return ring;
}

test("ringsFromPath lee un `d` de modo píxel con M/H/V/Z absolutos y relativos", () => {
  // Un cuadrado y un triángulo: `H`/`V` relativos y `Z` tienen que cerrar anillos distintos.
  const rings = ringsFromPath("M0,0H10V10H0Z M20,0h5v5z");

  assert.equal(rings.length, 2);
  assert.deepEqual(rings[0], [[0, 0], [10, 0], [10, 10], [0, 10]]);
  assert.deepEqual(rings[1], [[20, 0], [25, 0], [25, 5]]);
});

test("fitCurves cambia una escalera curva por Béziers y baja el número de nodos", () => {
  const ring = pixelCircle(40);
  const d = fitCurves([ring], { cornerAngle: 60, rdpTolerance: 0.6, fitError: 0.6 });
  const commands = parsePath(d);

  assert.ok(d.endsWith("Z"), "el anillo se cierra");
  assert.ok(commands.some((command) => command.cmd === "C"), "hay curvas y no solo segmentos");
  assert.ok(commands.length < ring.length / 4, `menos nodos que la escalera (${commands.length})`);
});

test("fitCurves deja un cuadrado en cuatro segmentos rectos", () => {
  const ring = staircaseSquare(40);
  const d = fitCurves([ring], { cornerAngle: 60, rdpTolerance: 0.6, fitError: 0.6 });
  const commands = parsePath(d);
  const draw = commands.filter((command) => command.cmd !== "M" && command.cmd !== "Z");

  // Tres lados dibujados y la `Z` cierra el cuarto: emitir la recta de vuelta duplicaría un nodo.
  assert.equal(draw.length + 1, 4, `un cuadrado son cuatro lados, no ${draw.length + 1}`);
  assert.ok(draw.every((command) => command.cmd === "L"), "los lados rectos no se convierten en curvas");
});

test("fitCurves respeta el error declarado contra la escalera original", () => {
  const ring = pixelCircle(40);
  for (const fitError of [0.4, 0.8]) {
    const d = fitCurves([ring], { cornerAngle: 60, rdpTolerance: 0.6, fitError });
    const samples = pathToPolylines(d, { tolerance: 0.02 }).flatMap((line) => line.points);

    assert.ok(samples.length > 0, "el camino tiene geometría");
    const worst = maxDistanceToRing(samples, ring);
    assert.ok(worst <= fitError + 0.35, `error ${worst.toFixed(2)} con fitError ${fitError}`);
  }
});

test("fitCurves conserva las esquinas agudas del cuadrado", () => {
  const ring = staircaseSquare(40);
  const d = fitCurves([ring], { cornerAngle: 60, rdpTolerance: 0.6, fitError: 0.6 });

  // El camino tiene que pasar por las cuatro esquinas del cuadrado (escalera incluida).
  const samples = pathToPolylines(d, { tolerance: 0.05 }).flatMap((line) => line.points);
  for (const corner of [[0, 0], [40, 0], [40, 40], [0, 40]]) {
    const nearest = Math.min(...samples.map((point) => Math.hypot(point[0] - corner[0], point[1] - corner[1])));
    assert.ok(nearest <= 0.8, `esquina ${corner} a ${nearest.toFixed(2)} px`);
  }
});

test("fitCurves no muta la entrada y rechaza anillos degenerados", () => {
  const ring = staircaseSquare(4);
  const copy = ring.map((point) => [...point]);
  fitCurves([ring], { cornerAngle: 60, rdpTolerance: 0.6, fitError: 0.6 });
  assert.deepEqual(ring, copy);

  assert.throws(() => fitCurves([[[0, 0], [1, 1]]]), /anillo/);
  assert.throws(() => fitCurves("no"), /anillos/);
});
