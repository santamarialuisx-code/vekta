// Muestreo subpíxel en el pipeline de color: ampliar la imagen antes de decidir a qué color de la
// paleta pertenece cada píxel, y devolver la geometría al marco original.
//
// Lo que se blinda aquí es lo que puede fallar en silencio: que el frame que ve el motor tenga el
// tamaño ampliado, que la paleta viaje explícita, y que el `d` vuelva dividido a la rejilla. Un SVG
// con el tamaño equivocado sigue siendo válido y la medición saldría igual de contenta.

import test from "node:test";
import assert from "node:assert/strict";

import { nearestPalette } from "../lib/quantize.mjs";
import { traceColorSubpixel, upsampleRgba } from "../lib/subpixel-color.mjs";
import { svgMetrics } from "../lib/svg-metrics.mjs";

/** Imagen RGBA de `width × height` con relleno por función. */
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

function pixel(rgba, index) {
  return Array.from(rgba.slice(index * 4, index * 4 + 4));
}

test("upsampleRgba interpola color y alfa por centros de píxel", () => {
  // Blanco y negro en una fila: a 2× la rampa cae en 191 y 64, la misma que la luminancia.
  const up = upsampleRgba(Uint8Array.from([255, 255, 255, 255, 0, 0, 0, 255]), 2, 1, 2);

  assert.deepEqual([up.width, up.height], [4, 2]);
  assert.deepEqual(pixel(up.rgba, 0), [255, 255, 255, 255]);
  assert.deepEqual(pixel(up.rgba, 1), [191, 191, 191, 255]);
  assert.deepEqual(pixel(up.rgba, 2), [64, 64, 64, 255]);
  assert.deepEqual(pixel(up.rgba, 3), [0, 0, 0, 255]);
});

test("upsampleRgba rechaza escalas no enteras y buffers cortos", () => {
  const one = Uint8Array.from([0, 0, 0, 255]);
  assert.throws(() => upsampleRgba(one, 1, 1, 0), /entero ≥ 1/);
  assert.throws(() => upsampleRgba(one, 1, 1, 1.5), /entero ≥ 1/);
  assert.throws(() => upsampleRgba(one, 2, 2, 2), /width × height/);
});

test("nearestPalette asigna cada píxel al color más cercano de la paleta", () => {
  const palette = [[0, 0, 0], [255, 255, 255]];
  const rgba = Uint8Array.from([
    10, 10, 10, 255,
    250, 250, 250, 255,
    200, 200, 200, 255,
    0, 0, 0, 0,
  ]);

  const indices = nearestPalette(rgba, palette);
  assert.deepEqual(Array.from(indices), [0, 1, 1, 255], "el transparente no gasta ranura");
});

test("traceColorSubpixel traza el frame ampliado con la paleta y vuelve al marco original", () => {
  const calls = [];
  const fake = (rgba, width, height, options) => {
    calls.push({ rgba, width, height, options });
    return `<svg width="${width}" height="${height}"><path d="M0 0 L12 6" fill="#000000"/></svg>`;
  };

  const img = image(2, 2, (x, y) => (x === 0 && y === 0 ? [255, 0, 0] : [0, 0, 255]));
  const result = traceColorSubpixel(fake, img, { scale: 3, variant: "source", maxColors: 2, simplify: 0.6 });

  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].width, calls[0].height], [6, 6], "el motor ve la imagen ampliada");
  assert.equal(calls[0].options.simplify, 0.6);
  assert.equal(calls[0].options.palette.length, result.paletteSize, "la paleta viaja explícita al motor");
  for (const hex of calls[0].options.palette) assert.match(hex, /^#[0-9a-f]{6}$/);

  assert.match(result.svg, /viewBox="0 0 2 2"/);
  assert.match(result.svg, /d="M 0 0 L 4 2"/, "la geometría se divide por la escala");
  assert.equal(result.paletteSize, 2);
  assert.equal(result.scale, 3);
});

test("traceColorSubpixel en la variante 1× reproduce el camino de siempre", () => {
  const calls = [];
  const fake = (rgba, width, height, options) => {
    calls.push({ width, height, options });
    return `<svg width="${width}" height="${height}"><path d="M0 0 L2 2" fill="#000000"/></svg>`;
  };

  const img = image(2, 2, (x, y) => (x === 0 && y === 0 ? [255, 0, 0] : [0, 0, 255]));
  const result = traceColorSubpixel(fake, img, { variant: "baseline", maxColors: 2 });

  assert.deepEqual([calls[0].width, calls[0].height], [2, 2]);
  assert.equal(result.scale, 1);
  assert.doesNotMatch(result.svg, /viewBox/, "el camino de siempre no añade viewBox");
  assert.ok(svgMetrics(result.svg).nodes > 0);
});
