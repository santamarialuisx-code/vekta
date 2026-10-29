// La varita del fondo: qué píxeles son fondo y qué píxeles son sujeto.
//
// El caso real es un JPG o un PNG exportado con fondo blanco: no hay alfa que leer, así que el
// fondo hay que deducirlo del color del borde. Lo que se comprueba aquí es que la máscara no se
// come el sujeto, que la tolerancia se comporta como un dial (más tolerancia, más fondo) y que una
// máscara demasiado grande o demasiado chica no se aplica: eso no es un fondo, es la imagen.

import test from "node:test";
import assert from "node:assert/strict";

import {
  BACKGROUND_RULES,
  applyBackgroundMask,
  backgroundMask,
  borderColors,
  borderSeeds,
  growMask,
  dominantBorderColor,
} from "../lib/background.mjs";

const SIZE = 100;
const SIDE = 40; // sujeto de 40 × 40 = 1 600 de 10 000 px
const SUBJECT_SHARE = (SIDE * SIDE) / (SIZE * SIZE);

/** Lienzo opaco con un cuadrado de color en el centro, y ruido de compresión opcional. */
function scene({ paper = [250, 250, 250], ink = [220, 30, 30], noise = 0 } = {}) {
  const rgba = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      const inside = x >= 30 && x < 30 + SIDE && y >= 30 && y < 30 + SIDE;
      const color = inside ? ink : paper;
      const jitter = noise ? ((x * 7 + y * 13) % (2 * noise + 1)) - noise : 0;
      rgba[i] = clamp(color[0] + jitter);
      rgba[i + 1] = clamp(color[1] + jitter);
      rgba[i + 2] = clamp(color[2] + jitter);
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

function clamp(value) {
  return Math.min(255, Math.max(0, value));
}

function count(mask) {
  let total = 0;
  for (const value of mask) total += value;
  return total;
}

// --- color semilla ---------------------------------------------------------

test("el color semilla es la moda del borde, no una esquina", () => {
  const rgba = scene();
  // Una esquina pintada de otro color no debe cambiar la decisión.
  const corner = 0;
  rgba[corner] = 12;
  rgba[corner + 1] = 12;
  rgba[corner + 2] = 12;

  const seed = dominantBorderColor(rgba, SIZE, SIZE);
  assert.equal(seed.hex, "#fafafa");
  assert.ok(seed.share > 0.99, `la moda del borde cubre ${seed.share}`);
});

// --- máscara ---------------------------------------------------------------

test("la máscara cubre el fondo y no toca el sujeto", () => {
  const rgba = scene();
  const { mask, applied, hex, share } = backgroundMask(rgba, SIZE, SIZE);

  assert.equal(applied, true);
  assert.equal(hex, "#fafafa");
  assert.ok(Math.abs(share - (1 - SUBJECT_SHARE)) < 1e-9, `fondo medido ${share}`);

  const at = (x, y) => mask[y * SIZE + x];
  assert.equal(at(0, 0), 1, "la esquina es fondo");
  assert.equal(at(SIZE - 1, SIZE - 1), 1, "la otra esquina también");
  assert.equal(at(50, 50), 0, "el centro es sujeto");
  assert.equal(count(mask), SIZE * SIZE - SIDE * SIDE);
});

test("la tolerancia es un dial: más tolerancia, más fondo", () => {
  const rgba = scene({ noise: 20 });

  const exact = backgroundMask(rgba, SIZE, SIZE, { tolerance: 0 });
  const middle = backgroundMask(rgba, SIZE, SIZE, { tolerance: BACKGROUND_RULES.tolerance });
  const wide = backgroundMask(rgba, SIZE, SIZE, { tolerance: 120 });

  assert.ok(exact.share < middle.share, `0 → ${exact.share}, 28 → ${middle.share}`);
  assert.ok(middle.share < wide.share, `28 → ${middle.share}, 120 → ${wide.share}`);
  // Con tolerancia amplia el papel con ruido se va entero y el sujeto se queda.
  assert.ok(Math.abs(wide.share - (1 - SUBJECT_SHARE)) < 1e-9, `120 → ${wide.share}`);
});

test("un fondo demasiado grande no se aplica: eso es la imagen entera", () => {
  const rgba = new Uint8Array(SIZE * SIZE * 4).fill(200);
  for (let p = 0; p < SIZE * SIZE; p++) rgba[p * 4 + 3] = 255;

  const { applied, mask, share } = backgroundMask(rgba, SIZE, SIZE);
  assert.equal(share, 1);
  assert.equal(applied, false, "un lienzo de un solo color no tiene sujeto que recortar");
  assert.equal(count(mask), 0);
});

test("un fondo demasiado chico tampoco: es una mota", () => {
  const { applied, mask } = backgroundMask(scene(), SIZE, SIZE, { minShare: 0.9 });
  assert.equal(applied, false);
  assert.equal(count(mask), 0);
});

// --- aplicación ------------------------------------------------------------

test("aplicar la máscara pone alfa 0 sin tocar el color ni el original", () => {
  const rgba = scene();
  const before = Uint8Array.from(rgba);
  const { mask } = backgroundMask(rgba, SIZE, SIZE);

  const cut = applyBackgroundMask(rgba, mask);

  assert.deepEqual(rgba, before, "el buffer de entrada no se muta");
  const corner = 0;
  const center = (50 * SIZE + 50) * 4;
  assert.equal(cut[corner + 3], 0, "el fondo queda transparente");
  assert.equal(cut[center + 3], 255, "el sujeto sigue opaco");
  assert.deepEqual([...cut.slice(corner, corner + 3)], [...rgba.slice(corner, corner + 3)]);
  assert.deepEqual([...cut.slice(center, center + 3)], [...rgba.slice(center, center + 3)]);
});

// --- validación ------------------------------------------------------------

test("los tamaños y la máscara se validan con mensajes explícitos", () => {
  assert.throws(() => backgroundMask(new Uint8Array(10), SIZE, SIZE), /width × height × 4/);
  assert.throws(() => backgroundMask(scene(), 0, SIZE), /width × height × 4|enteros positivos/);
  assert.throws(() => applyBackgroundMask(scene(), new Uint8Array(3)), /máscara/);
});

// --- damero: el fondo que no es un color ------------------------------------

const CELL = 10;

/** Damero de transparencia (el que un JPEG deja quemado) con un sujeto rojo en el centro. */
function checkerboard({ light = [255, 255, 255], dark = [204, 204, 204], subject = [220, 30, 30] } = {}) {
  const rgba = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      const inside = x >= 40 && x < 60 && y >= 40 && y < 60;
      const tone = (Math.floor(x / CELL) + Math.floor(y / CELL)) % 2 === 0 ? light : dark;
      const color = inside ? subject : tone;
      rgba[i] = color[0];
      rgba[i + 1] = color[1];
      rgba[i + 2] = color[2];
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

test("borderColors ve las dos tonalidades del damero", () => {
  const tones = borderColors(checkerboard(), SIZE, SIZE);

  assert.equal(tones.length, 2);
  assert.deepEqual(tones.map((t) => t.hex).sort(), ["#cccccc", "#ffffff"]);
  for (const tone of tones) {
    assert.ok(Math.abs(tone.share - 0.5) < 0.05, `${tone.hex} ocupa ${tone.share} del borde`);
  }
});

test("borderSeeds pide una semilla en un borde uniforme y dos en un damero", () => {
  assert.deepEqual(borderSeeds(scene(), SIZE, SIZE), ["#fafafa"]);
  assert.equal(borderSeeds(checkerboard(), SIZE, SIZE).length, 2);
});

test("con dos semillas el damero se va entero y el sujeto queda intacto", () => {
  const rgba = checkerboard();
  const seeds = borderSeeds(rgba, SIZE, SIZE);
  const multi = backgroundMask(rgba, SIZE, SIZE, { seeds, tolerance: 18 });

  assert.equal(multi.applied, true);
  assert.ok(Math.abs(multi.share - (1 - 400 / (SIZE * SIZE))) < 1e-9, `quitó ${multi.share}`);
  assert.equal(multi.mask[50 * SIZE + 50], 0, "el sujeto no se toca");
  assert.deepEqual(multi.seeds, seeds);
});

test("con una sola semilla el damero se queda a medias: por eso hacen falta dos", () => {
  const rgba = checkerboard();
  const single = backgroundMask(rgba, SIZE, SIZE, { seeds: ["#ffffff"], tolerance: 18 });
  const multi = backgroundMask(rgba, SIZE, SIZE, { seeds: borderSeeds(rgba, SIZE, SIZE), tolerance: 18 });

  assert.ok(single.share < multi.share - 0.1, `una semilla ${single.share} vs dos ${multi.share}`);
  assert.equal(single.seeds.length, 1);
});

test("las semillas se validan", () => {
  assert.throws(() => backgroundMask(scene(), SIZE, SIZE, { seeds: [] }), /semilla/);
  assert.throws(() => backgroundMask(scene(), SIZE, SIZE, { seeds: ["#zzz"] }), /semilla/);
});

// --- fleco de antialiasing -------------------------------------------------

test("crecer la máscara se come el fleco del borde", () => {
  // Sujeto rojo con un anillo de 1 px de mezcla (el antialiasing de un JPEG).
  const rgba = scene();
  for (let y = 29; y <= 70; y++) {
    for (let x = 29; x <= 70; x++) {
      const edge = x === 29 || y === 29 || x === 70 || y === 70;
      if (!edge) continue;
      const i = (y * SIZE + x) * 4;
      rgba[i] = 235;
      rgba[i + 1] = 140;
      rgba[i + 2] = 140;
    }
  }

  const raw = backgroundMask(rgba, SIZE, SIZE);
  const grown = backgroundMask(rgba, SIZE, SIZE, { grow: 1 });

  assert.ok(grown.share > raw.share, `crecida ${grown.share} vs cruda ${raw.share}`);
  assert.equal(grown.mask[50 * SIZE + 50], 0, "el centro del sujeto sigue opaco");
  assert.equal(raw.mask[29 * SIZE + 50], 0, "el anillo de mezcla no es fondo para la máscara cruda");
  assert.equal(grown.mask[29 * SIZE + 50], 1, "crecer 1 px se lleva el anillo");
  assert.equal(grown.grow, 1);
});

test("growMask no muta la entrada y valida el radio", () => {
  const mask = new Uint8Array(SIZE * SIZE);
  mask[50 * SIZE + 50] = 1;
  const before = Uint8Array.from(mask);

  const grown = growMask(mask, SIZE, SIZE, 2);
  assert.deepEqual(mask, before);
  assert.equal(grown.filter((v) => v === 1).length, 25, "un píxel crecido 2 en 8-conexo es un cuadrado de 5 × 5");
  assert.deepEqual(growMask(mask, SIZE, SIZE, 0), mask);

  assert.throws(() => growMask(mask, SIZE, SIZE, -1), /entero ≥ 0/);
  assert.throws(() => growMask(mask, SIZE, SIZE, 1.5), /entero ≥ 0/);
  assert.throws(() => growMask(new Uint8Array(4), SIZE, SIZE, 1), /width × height/);
});
