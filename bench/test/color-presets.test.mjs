// Presets de color: el modo de curvas y el modo fidelidad.
//
// Lo que se blinda aquí es la frontera entre los dos modos, que es donde una regresión se ve tarde:
// si `fidelidad` acabara enviando `simplify` al motor, el SVG saldría con curvas y la tabla del
// experimento 14 dejaría de reproducirse sin que ninguna prueba se quejara.

import test from "node:test";
import assert from "node:assert/strict";

import { COLOR_MODES, DEFAULT_COLOR_MODE, FIDELITY_COLORS, colorTraceOptions } from "../lib/color-presets.mjs";

test("el modo de curvas es el de siempre y lleva la paleta explícita", () => {
  const options = colorTraceOptions(["#112233", "#445566"], { simplify: 0.8 });

  assert.equal(DEFAULT_COLOR_MODE, "curvas");
  assert.equal(options.mode, "spline");
  assert.equal(options.hierarchical, "cutout");
  assert.equal(options.simplify, 0.8);
  assert.equal(options.optimize, 2);
  assert.deepEqual(options.palette, ["#112233", "#445566"]);
  assert.equal(options.filterSpeckle, undefined);
});

test("el modo fidelidad traza píxel a píxel y no manda simplify", () => {
  const options = colorTraceOptions(["#112233"], { mode: "fidelidad", simplify: 0.6 });

  assert.equal(options.mode, "pixel");
  // `simplify` se ignora en modo pixel, pero enviarlo sugeriría que hace algo.
  assert.equal("simplify" in options, false);
  assert.equal(options.filterSpeckle, 2);
  assert.equal(options.palette.length, 1);
});

test("la paleta del modo fidelidad crece solo donde hace falta", () => {
  assert.deepEqual(FIDELITY_COLORS, { illustration: 12, poster: 16, photo: 24 });
  assert.equal(COLOR_MODES.fidelidad.mode, "pixel");
  assert.equal(COLOR_MODES.curvas.mode, "spline");
});

test("un modo desconocido o una paleta vacía se rechazan con mensaje", () => {
  assert.throws(() => colorTraceOptions(["#000000"], { mode: "acuarela" }), /modo de color desconocido/);
  assert.throws(() => colorTraceOptions([]), /paleta/);
});
