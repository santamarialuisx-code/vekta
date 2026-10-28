// Clasificación por categoría: la regla que elige preset en `auto-trace.mjs`.
//
// Se prueba por el interfaz público (`imageSignals`, `classifyImage`, `tracePreset` y los dos CLI),
// no por el almacenamiento interno: lo que importa es que cada imagen del banco caiga donde el
// experimento 04 la midió y que el motivo nombre la señal que decidió.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  CATEGORY_PRESETS,
  CATEGORY_RULES,
  classifyImage,
  imageSignals,
  tracePreset,
} from "../lib/category.mjs";
import { LINE_ART_RULES } from "../lib/lineart.mjs";
import { rgbToOklab } from "../lib/oklab.mjs";
import { encodePng } from "../lib/image-io.mjs";

const classifyCli = fileURLToPath(new URL("../classify.mjs", import.meta.url));
const autoTraceCli = fileURLToPath(new URL("../auto-trace.mjs", import.meta.url));

// --- imágenes sintéticas: RGBA de width × height con relleno por función ---

function image(width, height, fill) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fill(x, y);
      const i = (y * width + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = 255;
    }
  }
  return { rgba, width, height };
}

/** Escaneo a lápiz: papel casi blanco con trazos finos oscuros. */
const scan = () =>
  image(80, 60, (x, y) => (x % 9 === 0 || y % 11 === 0 ? [50, 50, 50] : [246, 246, 243]));

/** Foto en blanco y negro: neutra, pero Otsu la parte por la mitad. */
const grayPhoto = () =>
  image(80, 60, (x, y) => {
    const value = (x * 7 + y * 13) % 256;
    return [value, value, value];
  });

/** Póster: cuatro planos de color muy saturados, sin fondo neutro. */
const poster = () =>
  image(80, 60, (x, y) => {
    const quadrant = (x < 40 ? 0 : 1) + (y < 30 ? 0 : 2);
    return [
      [220, 30, 40],
      [20, 60, 200],
      [250, 190, 20],
      [30, 160, 90],
    ][quadrant];
  });

/** Ilustración: formas de color sobre un fondo de papel neutro. */
const illustration = () => image(80, 60, (x) => (x < 20 ? [40, 60, 120] : [248, 248, 248]));

/** Foto de color: cada píxel gasta una combinación distinta. */
const colorPhoto = () =>
  image(80, 60, (x, y) => [(x * 3) % 256, (y * 5) % 256, (x * 7 + y * 11) % 256]);

const signalsOf = (fixture) => imageSignals(fixture.rgba, fixture.width, fixture.height);

function chromaOf(rgb) {
  const [, a, b] = rgbToOklab(...rgb);
  return Math.hypot(a, b);
}

// --- señales ---

test("imageSignals cuenta colores a 32 niveles, entropía y croma en OKLab", () => {
  // Cuatro grises equiprobables: 2 bits de entropía sobre 8 posibles.
  const quadrants = image(4, 4, (x, y) => {
    const quadrant = (x < 2 ? 0 : 1) + (y < 2 ? 0 : 2);
    return [
      [0, 0, 0],
      [85, 85, 85],
      [170, 170, 170],
      [255, 255, 255],
    ][quadrant];
  });
  const signals = imageSignals(quadrants.rgba, 4, 4);

  assert.equal(signals.width, 4);
  assert.equal(signals.distinctColors, 4);
  assert.ok(Math.abs(signals.luminanceEntropy - 0.25) < 1e-9, `entropía ${signals.luminanceEntropy}`);
  assert.ok(signals.meanChroma < 1e-6, `croma ${signals.meanChroma}`);
  assert.equal(signals.neutralShare, 1);
  assert.equal(signals.gray.length, 16);
  assert.ok(signals.inkShare > 0 && signals.inkShare < 1);
  assert.equal(typeof signals.edgeDensity, "number");
  assert.ok(signals.threshold > 0 && signals.threshold < 255);
});

test("el croma medio es el de OKLab, el mismo espacio en que cuantiza el motor", () => {
  const half = image(4, 2, (x) => (x < 2 ? [255, 0, 0] : [255, 255, 255]));
  const signals = imageSignals(half.rgba, 4, 2);

  assert.equal(signals.distinctColors, 2);
  // Rojo y blanco, mitad y mitad: el croma medio es medio croma del rojo (el blanco es neutro).
  assert.ok(
    Math.abs(signals.meanChroma - chromaOf([255, 0, 0]) / 2) < 1e-6,
    `croma ${signals.meanChroma}`,
  );
  // Dos tonos equiprobables: 1 bit de entropía.
  assert.ok(Math.abs(signals.luminanceEntropy - 0.125) < 1e-9);
  assert.equal(signals.neutralShare, 0.5);
});

// --- regla y presets ---

test("los umbrales son constantes exportadas, no números sueltos", () => {
  assert.equal(CATEGORY_RULES.quantizeBits, 5, "32 niveles por canal");
  assert.equal(CATEGORY_RULES.photoMinColors, 2000);
  assert.equal(CATEGORY_RULES.photoMinEntropy, 0.85);
  assert.equal(CATEGORY_RULES.posterMinMeanChroma, 0.07);
});

test("los presets son los que midió el experimento 04", () => {
  assert.deepEqual(CATEGORY_PRESETS, {
    "line-art": { colors: 16, simplify: 1.2 },
    illustration: { colors: 12, simplify: 0.6 },
    poster: { colors: 16, simplify: 0.8 },
    photo: { colors: 12, simplify: 0.8 },
  });
});

test("trazar un line art usa el preset binario, no el de color del experimento 04", () => {
  const signals = signalsOf(scan());
  const preset = tracePreset("line-art", signals);

  assert.equal(preset.colors, 1);
  assert.equal(preset.clustering, "bw");
  assert.equal(preset.simplify, 0.8);
  assert.equal(preset.binaryThreshold, signals.threshold + 1);
  assert.deepEqual(tracePreset("poster"), { colors: 16, simplify: 0.8 });
  assert.deepEqual(tracePreset("illustration"), { colors: 12, simplify: 0.6 });
  assert.throws(() => tracePreset("acuarela"), /categoría desconocida/);
  assert.throws(() => tracePreset("line-art"), /señales/);
});

// --- clasificación ---

test("un escaneo es line-art y reutiliza la regla de lineart.mjs", () => {
  const signals = signalsOf(scan());
  const verdict = classifyImage(signals);

  assert.equal(verdict.category, "line-art");
  assert.match(verdict.reason, /^line art:/);
  assert.match(verdict.reason, /tinta/);
  assert.ok(signals.neutralShare >= LINE_ART_RULES.minNeutralShare);
  assert.ok(signals.inkShare <= LINE_ART_RULES.maxInkShare);
});

test("una foto en blanco y negro es foto, no line art ni ilustración", () => {
  const signals = signalsOf(grayPhoto());
  const verdict = classifyImage(signals);

  assert.equal(signals.neutralShare, 1);
  assert.ok(signals.inkShare > LINE_ART_RULES.maxInkShare);
  assert.equal(verdict.category, "photo");
  // El motivo es el que ya da `looksLikeLineArt` al descartar la imagen por tinta.
  assert.match(verdict.reason, /^foto:/);
  assert.match(verdict.reason, /umbral/);
});

test("una foto de color se reconoce por la cantidad de colores", () => {
  const signals = signalsOf(colorPhoto());
  const verdict = classifyImage(signals);

  assert.ok(signals.distinctColors > CATEGORY_RULES.photoMinColors, `${signals.distinctColors}`);
  assert.equal(verdict.category, "photo");
  assert.match(verdict.reason, /^foto:/);
  assert.match(verdict.reason, /colores distintos a 32 niveles/);
});

test("un póster es paleta corta con croma alto", () => {
  const signals = signalsOf(poster());
  const verdict = classifyImage(signals);

  assert.ok(signals.distinctColors <= CATEGORY_RULES.photoMinColors);
  assert.ok(signals.meanChroma >= CATEGORY_RULES.posterMinMeanChroma);
  assert.equal(verdict.category, "poster");
  assert.match(verdict.reason, /^póster:/);
  assert.match(verdict.reason, /croma medio \d+ %/);
});

test("una ilustración es paleta corta con fondo neutro", () => {
  const signals = signalsOf(illustration());
  const verdict = classifyImage(signals);

  assert.ok(signals.neutralShare > 0);
  assert.ok(signals.meanChroma < CATEGORY_RULES.posterMinMeanChroma);
  assert.equal(verdict.category, "illustration");
  assert.match(verdict.reason, /^ilustración:/);
  assert.match(verdict.reason, /paleta corta/);
});

test("el orden de la cascada importa: el color saturado no adelanta a la foto", () => {
  const vivid = colorPhoto();
  const signals = signalsOf(vivid);

  assert.ok(signals.meanChroma >= CATEGORY_RULES.posterMinMeanChroma);
  assert.equal(classifyImage(signals).category, "photo");
});

test("classifyImage exige las señales de la imagen", () => {
  assert.throws(() => classifyImage(), /señales/);
  assert.throws(() => classifyImage({ neutralShare: 1, inkShare: 0 }), /señales/);
});

// --- CLI ---

test("classify.mjs imprime la tabla de decisión y no traza nada", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vekta-classify-"));
  try {
    const input = path.join(root, "in");
    fs.mkdirSync(input);
    fs.writeFileSync(path.join(input, "scan.png"), encodePng(scan()));
    fs.writeFileSync(path.join(input, "poster.png"), encodePng(poster()));

    const stdout = execFileSync(process.execPath, [classifyCli, "--inputs", input], {
      encoding: "utf8",
    });

    assert.match(stdout, /imagen/);
    assert.match(stdout, /categoría/);
    assert.match(stdout, /motivo/);
    assert.match(stdout, /preset/);
    assert.match(stdout, /^scan\s+line-art/m);
    assert.match(stdout, /^poster\s+poster/m);
    assert.match(stdout, /^scan\s+line-art.*bw \/ 0,8/m);
    assert.deepEqual(fs.readdirSync(root), ["in"], "el clasificador no escribe ficheros");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("auto-trace elige el preset por categoría y conserva el camino binario", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vekta-auto-category-"));
  try {
    const input = path.join(root, "in");
    const output = path.join(root, "out");
    const json = path.join(root, "report.json");
    fs.mkdirSync(input);
    fs.writeFileSync(path.join(input, "scan.png"), encodePng(scan()));
    fs.writeFileSync(path.join(input, "poster.png"), encodePng(poster()));

    execFileSync(process.execPath, [autoTraceCli, "--inputs", input, "--out", output, "--json", json], {
      stdio: "pipe",
    });

    const report = JSON.parse(fs.readFileSync(json, "utf8"));
    const scanRow = report.find((entry) => entry.imgSlug === "scan");
    const posterRow = report.find((entry) => entry.imgSlug === "poster");

    // Comportamiento del experimento 07 que no puede cambiar: escaneo, un relleno, umbral Otsu.
    assert.equal(scanRow.decision, "line-art");
    assert.equal(scanRow.category, "line-art");
    assert.equal(scanRow.fills, 1);
    assert.equal(scanRow.threshold, 50);
    assert.equal(scanRow.preset.clustering, "bw");
    assert.equal(scanRow.preset.colors, 1);
    assert.equal(scanRow.preset.binaryThreshold, 51);
    assert.equal(scanRow.preset.simplify, 0.8);

    // Lo nuevo: el color ya no lleva un preset único, lleva el de su categoría.
    assert.equal(posterRow.category, "poster");
    assert.equal(posterRow.decision, "color");
    assert.equal(posterRow.preset.colors, 16);
    assert.equal(posterRow.preset.simplify, 0.8);
    assert.ok(posterRow.fills >= 2, `el póster conserva sus rellenos, no ${posterRow.fills}`);
    assert.ok(fs.existsSync(path.join(output, posterRow.svg.split("/").pop())));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
