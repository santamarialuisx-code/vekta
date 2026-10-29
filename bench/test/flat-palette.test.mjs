// Paleta plana: los colores de un dibujo, no la rampa de su antialiasing.
//
// El caso que motivó el módulo es un dibujo de seis colores (blanco, negro, verde, naranja, rojo y
// amarillo) guardado como JPEG: el antialiasing del contorno deja una docena de tonos intermedios
// que la cuantización compra como colores propios, y con el presupuesto gastado el blanco y el
// amarillo se funden en crema. Aquí se comprueba que la poda devuelve los seis, que un color
// pequeño pero legítimo sobrevive, y que un degradado de verdad no se confunde con arte plano.

import test from "node:test";
import assert from "node:assert/strict";

import { FLAT_RULES, flatPalette, pruneRamp } from "../lib/quantize.mjs";
import { deltaE, oklabToRgb, rgbToOklab } from "../lib/oklab.mjs";

const SIZE = 200;

const hex = ([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** Un punto de la recta entre dos colores, interpolado en OKLab (como lo haría un antialiasing). */
function mix(a, b, t) {
  const A = rgbToOklab(...a);
  const B = rgbToOklab(...b);
  return oklabToRgb(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

function canvas() {
  return new Uint8Array(SIZE * SIZE * 4);
}

function paint(rgba, { x, y, w, h, color }) {
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) {
      const i = (row * SIZE + col) * 4;
      rgba[i] = color[0];
      rgba[i + 1] = color[1];
      rgba[i + 2] = color[2];
      rgba[i + 3] = 255;
    }
  }
}

const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];
const GREEN = [0, 163, 0];
const RED = [254, 0, 0];
const YELLOW = [248, 221, 14];

/**
 * Dibujo plano sintético: fondo blanco, un bloque verde, uno rojo, un contorno negro y una franja
 * de rampa negro→blanco de cinco niveles (el antialiasing), más una mota amarilla del 1 %.
 */
function flatArt({ withRamp = true } = {}) {
  const rgba = canvas();
  paint(rgba, { x: 0, y: 0, w: SIZE, h: SIZE, color: WHITE });
  paint(rgba, { x: 20, y: 20, w: 80, h: 80, color: GREEN });
  paint(rgba, { x: 120, y: 20, w: 40, h: 40, color: RED });
  paint(rgba, { x: 20, y: 120, w: 30, h: 30, color: BLACK });
  paint(rgba, { x: 160, y: 160, w: 20, h: 20, color: YELLOW }); // 400 px = 1 %

  if (withRamp) {
    for (let step = 0; step < 5; step++) {
      paint(rgba, { x: 60 + step * 20, y: 160, w: 20, h: 30, color: mix(BLACK, WHITE, (step + 1) / 6) });
    }
  }
  return rgba;
}

/** Degradado de verdad: no hay dos colores planos de los que sea mezcla. */
function gradient() {
  const rgba = canvas();
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const color = mix(BLACK, WHITE, x / (SIZE - 1));
      const i = (y * SIZE + x) * 4;
      rgba[i] = color[0];
      rgba[i + 1] = color[1];
      rgba[i + 2] = color[2];
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

function hasColor(palette, color, tolerance = 0.02) {
  const lab = rgbToOklab(...color);
  return palette.some((rgb) => deltaE(lab, rgbToOklab(...rgb)) < tolerance);
}

function distanceTo(palette, color) {
  const lab = rgbToOklab(...color);
  return Math.min(...palette.map((rgb) => deltaE(lab, rgbToOklab(...rgb))));
}

// --- el caso que importa ---------------------------------------------------

test("devuelve los colores planos y descarta la rampa de antialiasing", () => {
  const result = flatPalette(flatArt(), SIZE, SIZE);

  assert.equal(result.count, 5, `paleta: ${result.paletteHex.join(" ")}`);
  for (const color of [WHITE, BLACK, GREEN, RED]) {
    assert.ok(hasColor(result.palette, color), `falta ${hex(color)} en ${result.paletteHex.join(" ")}`);
  }
  // Ningún tono intermedio del contorno sobrevive como color propio.
  assert.ok(distanceTo(result.palette, mix(BLACK, WHITE, 0.5)) > 0.1);
});

test("un color pequeño pero legítimo sobrevive a la poda", () => {
  const result = flatPalette(flatArt(), SIZE, SIZE);
  // El amarillo ocupa el 1 % del lienzo y no es mezcla de nada: tiene que estar.
  assert.ok(hasColor(result.palette, YELLOW, 0.05), `falta el amarillo en ${result.paletteHex.join(" ")}`);
});

test("la rampa no inventa colores: sin rampa sale la misma paleta", () => {
  const conRampa = flatPalette(flatArt({ withRamp: true }), SIZE, SIZE);
  const sinRampa = flatPalette(flatArt({ withRamp: false }), SIZE, SIZE);

  assert.equal(conRampa.count, sinRampa.count);
  assert.deepEqual(
    conRampa.paletteHex.slice().sort(),
    sinRampa.paletteHex.slice().sort(),
    "la franja de antialiasing no debe cambiar la paleta",
  );
});

// --- el límite -------------------------------------------------------------

test("un degradado no es arte plano: la poda deja dos colores y un error alto", () => {
  const result = flatPalette(gradient(), SIZE, SIZE);

  assert.ok(result.count <= 3, `colores: ${result.count}`);
  assert.ok(result.residual > 0.15, `residual ${result.residual}: un degradado no puede puntuar bajo`);
});

test("el arte plano puntúa bajo en residual, el degradado alto", () => {
  const flat = flatPalette(flatArt(), SIZE, SIZE);
  const grad = flatPalette(gradient(), SIZE, SIZE);

  assert.ok(flat.residual < FLAT_RULES.maxResidual, `plano ${flat.residual}`);
  assert.ok(grad.residual > FLAT_RULES.maxResidual, `degradado ${grad.residual}`);
});

// --- contrato --------------------------------------------------------------

test("no muta el buffer de entrada", () => {
  const rgba = flatArt();
  const before = Uint8Array.from(rgba);
  flatPalette(rgba, SIZE, SIZE);
  assert.deepEqual(rgba, before);
});

test("pruneRamp fusiona lo que está sobre la recta y respeta lo que está fuera", () => {
  const black = { rgb: BLACK, lab: rgbToOklab(...BLACK), count: 10_000 };
  const white = { rgb: WHITE, lab: rgbToOklab(...WHITE), count: 10_000 };
  const enMedio = { rgb: mix(BLACK, WHITE, 0.5), lab: rgbToOklab(...mix(BLACK, WHITE, 0.5)), count: 1_000 };
  const fuera = { rgb: RED, lab: rgbToOklab(...RED), count: 1_000 };

  const pruned = pruneRamp([black, white, enMedio, fuera]);
  const hexes = pruned.map((c) => hex(c.rgb));

  assert.equal(pruned.length, 3, hexes.join(" "));
  assert.ok(hexes.includes(hex(BLACK)) && hexes.includes(hex(WHITE)) && hexes.includes(hex(RED)));
  // La masa del color absorbido no se pierde: se suma al extremo.
  assert.ok(pruned.reduce((sum, c) => sum + c.count, 0) === 22_000);
});

test("valida tamaños y paletas vacías", () => {
  assert.throws(() => flatPalette(new Uint8Array(10), SIZE, SIZE), /width × height × 4/);
  assert.throws(() => flatPalette(canvas(), 0, SIZE), /enteros positivos/);
  assert.throws(() => pruneRamp([]), /clúster/);
});
