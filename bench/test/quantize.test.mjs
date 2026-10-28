// Pruebas del cuantizador: lo importante no es "reduce colores", es que decida por área y no
// solo por distancia. Las nubes del Gum Tree son una región de ΔE diminuto y área enorme; el
// ruido de antialiasing es lo contrario.

import test from "node:test";
import assert from "node:assert/strict";

import { deltaE, rgbToOklab } from "../lib/oklab.mjs";
import { quantize, renderQuantized } from "../lib/quantize.mjs";
import { decodeImage, encodePng } from "../lib/image-io.mjs";

function image(width, height, paint) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = paint(x, y);
      const i = (y * width + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = a;
    }
  }
  return { width, height, rgba };
}

const nearDelta = (rgb, reference, eps) => {
  const distance = deltaE(rgbToOklab(...rgb), rgbToOklab(...reference));
  assert.ok(distance <= eps, `ΔE ${distance} > ${eps} para ${rgb} vs ${reference}`);
};

const paletteHex = (result) =>
  result.palette.map(([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`);

test("una imagen de dos tonos devuelve exactamente esos dos tonos", () => {
  const source = image(20, 20, (x) => (x < 10 ? [255, 0, 0] : [0, 0, 255]));
  const result = quantize(source.rgba, source.width, source.height, { maxColors: 4 });

  assert.equal(result.palette.length, 2);
  assert.deepEqual(new Set(paletteHex(result)), new Set(["#ff0000", "#0000ff"]));
  assert.equal(result.droppedClusters, 0);
  assert.ok(result.meanDeltaE < 1e-6);
});

test("con límite de 2 colores, la región grande de ΔE pequeño sobrevive al mote diminuto", () => {
  // Fondo rosa (el cielo), bloque grande de otro rosa casi igual (la nube) y un píxel verde.
  const sky = [240, 146, 147];
  const cloud = [243, 147, 147];
  const speck = [0, 255, 0];
  const source = image(200, 200, (x, y) => {
    if (x === 0 && y === 0) return speck;
    if (x >= 50 && x < 150 && y >= 50 && y < 150) return cloud;
    return sky;
  });

  const result = quantize(source.rgba, source.width, source.height, {
    maxColors: 2,
    minClusterShare: 0.002,
  });

  assert.equal(result.palette.length, 2);
  assert.equal(result.droppedClusters, 0);

  const labs = result.palette.map(([r, g, b]) => rgbToOklab(r, g, b));
  const distanceTo = (color) =>
    Math.min(...labs.map((lab) => deltaE(lab, rgbToOklab(...color))));
  assert.ok(distanceTo(sky) < 0.01, `sin el rosa del cielo: ${paletteHex(result)}`);
  assert.ok(distanceTo(cloud) < 0.01, `sin el rosa de la nube: ${paletteHex(result)}`);
  assert.ok(labs.every((lab) => lab[1] > 0), `apareció verde en la paleta: ${paletteHex(result)}`);

  // El píxel verde quedó reasignado: el resultado no tiene verde.
  const rendered = renderQuantized(source.rgba, source.width, source.height, result);
  const speckIndex = (0 * source.width + 0) * 4;
  assert.ok(rendered[speckIndex + 1] < 160);
});

test("el alfa se conserva y los píxeles transparentes no votan", () => {
  const source = image(10, 10, (x, y) => {
    if (x < 5) return [0, 0, 0, 0];
    return [10, 20, 30, 255];
  });

  const result = quantize(source.rgba, source.width, source.height, { maxColors: 4 });
  assert.equal(result.palette.length, 1);
  nearDelta(result.palette[0], [10, 20, 30], 0.005);

  const rendered = renderQuantized(source.rgba, source.width, source.height, result);
  for (const index of [0, 1, 2, 3, 4 * 4 + 3]) assert.equal(rendered[index], 0);
  assert.equal(rendered[5 * 4 + 3], 255);
  assert.equal(rendered[5 * 4], 10);
});

test("el cuantizador es determinista", () => {
  const source = image(40, 40, (x, y) => [x * 5, y * 5, (x + y) * 3]);
  const a = quantize(source.rgba, source.width, source.height, { maxColors: 6 });
  const b = quantize(source.rgba, source.width, source.height, { maxColors: 6 });
  assert.deepEqual(paletteHex(a), paletteHex(b));
  assert.deepEqual(Array.from(a.indices), Array.from(b.indices));
});

test("los índices apuntan a la paleta y el ΔE reportado coincide con el real", () => {
  const source = image(30, 30, (x, y) => [x * 8, y * 8, 128]);
  const result = quantize(source.rgba, source.width, source.height, { maxColors: 5 });

  assert.equal(result.indices.length, source.width * source.height);
  let total = 0;
  for (let p = 0; p < result.indices.length; p++) {
    const index = result.indices[p];
    assert.ok(index >= 0 && index < result.palette.length);
    const i = p * 4;
    const original = rgbToOklab(source.rgba[i], source.rgba[i + 1], source.rgba[i + 2]);
    const color = result.palette[index];
    total += deltaE(original, rgbToOklab(color[0], color[1], color[2]));
  }
  const mean = total / result.indices.length;
  assert.ok(Math.abs(mean - result.meanDeltaE) < 1e-6);
  assert.ok(result.p95DeltaE >= mean);
});

test("los colores degenerados no rompen la paleta", () => {
  const flat = image(8, 8, () => [7, 7, 7]);
  const result = quantize(flat.rgba, flat.width, flat.height, { maxColors: 8 });
  assert.equal(result.palette.length, 1);
  assert.equal(paletteHex(result)[0], "#070707");

  const empty = new Uint8Array(4 * 4 * 4); // todo transparente
  const transparent = quantize(empty, 4, 4, { maxColors: 4 });
  assert.equal(transparent.palette.length, 0);
  assert.equal(transparent.meanDeltaE, 0);
});

test("image-io decodifica PNG y vuelve a codificar sin perder píxeles", () => {
  const source = image(4, 3, (x, y) => [x * 60, y * 90, 40, 200]);
  const png = encodePng(source);
  const decoded = decodeImage(png);

  assert.equal(decoded.width, 4);
  assert.equal(decoded.height, 3);
  assert.deepEqual(Array.from(decoded.rgba), Array.from(source.rgba));
  assert.match(png.subarray(0, 4).toString("hex"), /^89504e47$/);
});
