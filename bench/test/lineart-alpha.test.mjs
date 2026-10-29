// El fondo transparente es papel, no tinta.
//
// Un PNG recortado guarda negro (0, 0, 0, 0) donde no hay sujeto. Medido en crudo, ese negro es
// "tinta" para el histograma y "neutro" para la regla de line art: el clasificador ve una foto y el
// modo binario traza un lienzo negro completo. Aquí se comprueba que las señales se miden sobre la
// imagen compuesta en papel blanco, y que una imagen opaca no cambia ni un decimal.

import test from "node:test";
import assert from "node:assert/strict";

import { luminance, lineArtSignals, looksLikeLineArt } from "../lib/lineart.mjs";
import { subpixelFrame } from "../lib/subpixel-transform.mjs";

const SIZE = 60;

/** Lienzo transparente con un anillo oscuro: el caso "dibujo a lápiz recortado". */
function transparentRing({ color = [40, 40, 40], inner = 14, outer = 24 } = {}) {
  const rgba = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      const radius = Math.hypot(x - SIZE / 2, y - SIZE / 2);
      if (radius < inner || radius > outer) continue; // alfa 0, rgb 0
      rgba[i] = color[0];
      rgba[i + 1] = color[1];
      rgba[i + 2] = color[2];
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

/** Lienzo transparente con un cuadrado de color diminuto: ilustración recortada. */
function transparentColorBlob() {
  const rgba = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 26; y < 34; y++) {
    for (let x = 26; x < 34; x++) {
      const i = (y * SIZE + x) * 4;
      rgba[i] = 255;
      rgba[i + 1] = 0;
      rgba[i + 2] = 0;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

/** Lienzo opaco de grises, para la prueba de no-regresión. */
function opaqueGray() {
  const rgba = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      const value = (x * 4 + y * 2) % 256;
      rgba[i] = value;
      rgba[i + 1] = value;
      rgba[i + 2] = value;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

test("el fondo transparente se mide como papel blanco", () => {
  const rgba = transparentRing();
  const signals = lineArtSignals(rgba, SIZE, SIZE);

  assert.equal(signals.gray[0], 255, "la esquina transparente es papel");
  assert.ok(signals.visibleShare > 0.1 && signals.visibleShare < 0.6, `visible ${signals.visibleShare}`);
  assert.ok(signals.inkShare < 0.4, `tinta ${signals.inkShare}: el fondo no cuenta como tinta`);
});

test("un dibujo recortado se clasifica como line art", () => {
  const verdict = looksLikeLineArt(lineArtSignals(transparentRing(), SIZE, SIZE));
  assert.equal(verdict.lineArt, true, verdict.reason);
});

test("una ilustración de color recortada no se confunde con line art", () => {
  const signals = lineArtSignals(transparentColorBlob(), SIZE, SIZE);
  const verdict = looksLikeLineArt(signals);

  // El 96 % del lienzo es transparente: si contara como neutro, la regla diría line art.
  assert.equal(signals.neutralShare, 0, `neutros ${signals.neutralShare}`);
  assert.equal(verdict.lineArt, false, verdict.reason);
  assert.match(verdict.reason, /^color:/);
});

test("una imagen opaca mide exactamente lo mismo que antes", () => {
  const rgba = opaqueGray();
  const signals = lineArtSignals(rgba, SIZE, SIZE);

  assert.deepEqual(Array.from(signals.gray), Array.from(luminance(rgba, SIZE, SIZE)));
  assert.equal(signals.visibleShare, 1);
  assert.equal(signals.neutralShare, 1, "todos los píxeles son grises y todos se consideran");
});

test("el motor recibe papel blanco donde no hay sujeto", () => {
  const frame = subpixelFrame(lineArtSignals(transparentRing(), SIZE, SIZE), 3);

  assert.equal(frame.width, SIZE * 3);
  const corner = 0;
  assert.deepEqual([...frame.rgba.slice(corner, corner + 4)], [255, 255, 255, 255]);
});
