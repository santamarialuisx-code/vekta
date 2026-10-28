import test from "node:test";
import assert from "node:assert/strict";

import {
  LINE_ART_PRESET,
  LINE_ART_RULES,
  LINE_ART_SCALE,
  edgeDensity,
  lineArtOptions,
  lineArtSignals,
  looksLikeLineArt,
  luminance,
  luminanceHistogram,
  neutralShare,
  otsuThreshold,
} from "../lib/lineart.mjs";

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

function histogram(spikes) {
  const hist = new Float64Array(256);
  for (const [bin, weight] of spikes) hist[bin] += weight;
  return hist;
}

test("Otsu separa dos picos limpios", () => {
  const hist = histogram([[40, 0.3], [200, 0.7]]);
  const result = otsuThreshold(hist);

  assert.ok(result.threshold >= 40 && result.threshold < 200, `umbral ${result.threshold}`);
  assert.ok(result.separability > 0.95, `separabilidad ${result.separability}`);
  assert.ok(Math.abs(result.inkShare - 0.3) < 1e-9);
});

test("Otsu no confunde una gaussiana con dos poblaciones", () => {
  // Unimodal: se separa por la mitad, pero con separabilidad de ~0,64, no de bimodal (>0,95).
  const hist = new Float64Array(256);
  for (let i = 0; i < 256; i++) hist[i] = Math.exp(-((i - 128) ** 2) / (2 * 12 ** 2));
  const sum = hist.reduce((a, b) => a + b, 0);
  for (let i = 0; i < 256; i++) hist[i] /= sum;

  const result = otsuThreshold(hist);
  assert.equal(result.threshold, 127);
  assert.ok(result.separability > 0.5 && result.separability < 0.8, `separabilidad ${result.separability}`);
});

test("Otsu sobre un histograma plano cae en el centro", () => {
  const hist = histogram(Array.from({ length: 256 }, (_, i) => [i, 1]));
  const result = otsuThreshold(hist);

  assert.equal(result.threshold, 127);
  assert.equal(result.inkShare, 0.5);
  // El plano puntúa alto (0,75) sin tener dos poblaciones: por eso no es un test de unimodalidad.
  assert.ok(result.separability > 0.5 && result.separability < 0.8, `separabilidad ${result.separability}`);
});

test("Otsu rechaza histogramas imposibles", () => {
  assert.throws(() => otsuThreshold(new Float64Array(16)), /256 bins/);
  assert.throws(() => otsuThreshold(new Float64Array(256)), /vacío/);
});

test("la luminancia sigue Rec. 601", () => {
  const white = image(1, 1, () => [255, 255, 255]);
  const black = image(1, 1, () => [0, 0, 0]);
  const red = image(1, 1, () => [255, 0, 0]);

  assert.equal(luminance(white.rgba, 1, 1)[0], 255);
  assert.equal(luminance(black.rgba, 1, 1)[0], 0);
  assert.ok(Math.abs(luminance(red.rgba, 1, 1)[0] - 76.245) < 1e-3);
});

test("la luminancia exige el tamaño declarado", () => {
  assert.throws(() => luminance(new Uint8Array(8), 2, 2), /width × height × 4/);
});

test("el histograma está normalizado aunque haya pocos píxeles", () => {
  const { rgba, width, height } = image(2, 1, (x) => (x === 0 ? [0, 0, 0] : [255, 255, 255]));
  const hist = luminanceHistogram(luminance(rgba, width, height));

  assert.ok(Math.abs(hist[0] - 0.5) < 1e-9);
  assert.ok(Math.abs(hist[255] - 0.5) < 1e-9);
  assert.equal(hist.reduce((a, b) => a + b, 0), 1);
});

test("neutralShare distingue gris de color", () => {
  const gray = image(4, 4, (x) => [x * 10, x * 10, x * 10]);
  const colorful = image(4, 4, (x) => [255, x * 10, 0]);
  const half = image(4, 4, (x) => (x < 2 ? [120, 120, 120] : [255, 0, 0]));

  assert.equal(neutralShare(gray.rgba), 1);
  assert.equal(neutralShare(colorful.rgba), 0);
  assert.equal(neutralShare(half.rgba), 0.5);
});

test("edgeDensity es 0 sin aristas y alto en un borde", () => {
  const flat = image(8, 8, () => [255, 255, 255]);
  const step = image(8, 8, (x) => (x < 4 ? [0, 0, 0] : [255, 255, 255]));

  assert.equal(edgeDensity(luminance(flat.rgba, 8, 8), 8, 8), 0);
  assert.ok(edgeDensity(luminance(step.rgba, 8, 8), 8, 8) > 0.1);
  assert.equal(edgeDensity(new Float32Array(4), 2, 2), 0);
});

test("un escaneo a lápiz se reconoce como line art", () => {
  // Papel casi blanco con trazos finos oscuros: poca tinta, todo neutro.
  const scan = image(40, 40, (x, y) => (x % 10 === 0 || y % 13 === 0 ? [60, 60, 60] : [245, 245, 242]));
  const signals = lineArtSignals(scan.rgba, scan.width, scan.height);
  const verdict = looksLikeLineArt(signals);

  assert.equal(verdict.lineArt, true, verdict.reason);
  assert.ok(signals.inkShare < LINE_ART_RULES.maxInkShare);
  assert.ok(signals.neutralShare >= LINE_ART_RULES.minNeutralShare);
});

test("una foto en blanco y negro no se reconoce como line art", () => {
  // Neutra, pero Otsu parte la imagen por la mitad: es una foto, no un trazo.
  const photo = image(40, 40, (x, y) => {
    const value = (x * 7 + y * 13) % 256;
    return [value, value, value];
  });
  const signals = lineArtSignals(photo.rgba, photo.width, photo.height);
  const verdict = looksLikeLineArt(signals);

  assert.equal(signals.neutralShare, 1);
  assert.equal(verdict.lineArt, false);
  assert.match(verdict.reason, /foto/);
});

test("una ilustración de color no se reconoce como line art", () => {
  const illustration = image(40, 40, (x, y) => [(x * 6) % 256, (y * 11) % 256, 180]);
  const signals = lineArtSignals(illustration.rgba, illustration.width, illustration.height);
  const verdict = looksLikeLineArt(signals);

  assert.equal(verdict.lineArt, false);
  assert.match(verdict.reason, /color/);
});

test("lineArtSignals publica el umbral de Otsu y las señales juntas", () => {
  const scan = image(20, 20, (x) => (x < 2 ? [40, 40, 40] : [250, 250, 250]));
  const signals = lineArtSignals(scan.rgba, 20, 20);

  assert.equal(signals.width, 20);
  assert.ok(signals.threshold >= 40 && signals.threshold < 250);
  assert.ok(signals.separability > 0.5);
  assert.equal(signals.gray.length, 400);
  assert.equal(signals.histogram.length, 256);
});

test("el preset de line art traza con el Otsu de la imagen, un nivel por encima", () => {
  const scan = image(20, 20, (x) => (x < 2 ? [50, 50, 50] : [246, 246, 246]));
  const signals = lineArtSignals(scan.rgba, 20, 20);
  const opts = lineArtOptions(signals);

  assert.equal(signals.threshold, 50);
  // Otsu devuelve el último nivel de tinta; el motor corta por debajo del umbral. Sin el +1, una
  // imagen bimodal justa pierde la tinta y el SVG sale vacío.
  assert.equal(opts.binaryThreshold, 51);
  assert.equal(opts.clustering, "bw");
  assert.equal(opts.adaptive, undefined, "Bradley–Roth pierde 0,02 de F1 en un escaneo");
  assert.equal(opts.simplify, 1.2, "el preset se midió a 3×: con el muestreo fino 1,2 no se pasa");

  assert.equal(lineArtOptions(signals, { simplify: 0 }).simplify, 0);
  assert.throws(() => lineArtOptions(), /señales/);
});

test("el preset de line art se muestrea a 3× y no filtra la escala al motor", () => {
  // La escala es del preset (cómo se lee la imagen), no del motor: si viajara dentro de las
  // opciones, `vtracer` recibiría una clave que no conoce y nada lo delataría.
  assert.equal(LINE_ART_SCALE, 3, "3× es el codo medido en el experimento 12");

  const opts = lineArtOptions({ threshold: 128 });
  assert.equal("scale" in opts, false);
  assert.equal(opts.simplify, LINE_ART_PRESET.simplify);
});

test("el umbral del preset no se sale de 8 bits", () => {
  assert.equal(lineArtOptions({ threshold: 255 }).binaryThreshold, 255);
});
