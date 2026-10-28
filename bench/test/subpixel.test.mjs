// Transform subpíxel: el `d`, la ampliación y el marco del SVG.
//
// Lo que hay que blindar aquí no es una métrica, es un transform: si `scalePathData` se equivoca en
// un solo comando, el SVG «ampliado» sigue siendo un SVG válido y el barrido mide basura sin fallar.
// Por eso el primer bloque fija los valores a mano, comando por comando, incluidos los relativos y
// los radios de arco, que son justo los que una multiplicación ingenua rompe.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { parsePath, pathToPolylines } from "../lib/path-to-polyline.mjs";
import { svgMetrics } from "../lib/svg-metrics.mjs";
import {
  FIXED_DECIMALS,
  scalePathData,
  subpixelFrame,
  subpixelOptions,
  traceSubpixel,
  upsampleLuminance,
} from "../lib/subpixel.mjs";

// Un `d` con los diez comandos, absolutos y relativos, en el mismo orden en que los emite el motor
// más los que solo aparecen al reescribir a mano.
const ALL_COMMANDS =
  "M10 20 L30 40 H50 V60 C70 80 90 100 110 120 S130 140 150 160 Q170 180 190 200 T210 220 " +
  "A5 10 30 1 0 230 240 Z m1 2 l3 4 h5 v6 c7 8 9 10 11 12 s13 14 15 16 q17 18 19 20 t21 22 " +
  "a23 24 45 0 1 25 26 z";

const DOUBLE = (value) => String(Number((value * 2).toFixed(FIXED_DECIMALS)));

test("scalePathData duplica todas las longitudes y deja ángulos y flags intactos", () => {
  assert.equal(
    scalePathData(ALL_COMMANDS, 2),
    "M 20 40 L 60 80 H 100 V 120 C 140 160 180 200 220 240 S 260 280 300 320 " +
      "Q 340 360 380 400 T 420 440 A 10 20 30 1 0 460 480 Z " +
      "m 2 4 l 6 8 h 10 v 12 c 14 16 18 20 22 24 s 26 28 30 32 q 34 36 38 40 t 42 44 " +
      "a 46 48 45 0 1 50 52 z",
  );
});

test("scalePathData con factor 1 no mueve ninguna coordenada", () => {
  const scaled = scalePathData(ALL_COMMANDS, 1);

  const original = parsePath(ALL_COMMANDS);
  const result = parsePath(scaled);
  assert.equal(result.length, original.length);
  for (let i = 0; i < original.length; i++) {
    assert.equal(result[i].cmd, original[i].cmd, `comando ${i}`);
    assert.deepEqual(result[i].args, original[i].args, `argumentos del comando ${i}`);
  }
});

test("scalePathData es reversible: ampliar y volver deja el mismo camino", () => {
  const roundTrip = parsePath(scalePathData(scalePathData(ALL_COMMANDS, 4), 0.25));

  const original = parsePath(ALL_COMMANDS);
  for (let i = 0; i < original.length; i++) {
    for (let j = 0; j < original[i].args.length; j++) {
      assert.equal(roundTrip[i].args[j], original[i].args[j], `comando ${i}, argumento ${j}`);
    }
  }
});

test("scalePathData redondea a precisión fija y no deja ceros ni -0", () => {
  // 1/3 no es representable: lo que importa es que el SVG no arrastre 17 decimales.
  assert.equal(scalePathData("M1 2 L100 1", 1 / 3), "M 0.33 0.67 L 33.33 0.33");
  // Los enteros se escriben enteros y el cero negativo no sobrevive al redondeo.
  assert.equal(scalePathData("M10 20 L0 -0.001", 0.5), "M 5 10 L 0 0");
});

test("scalePathData expande las repeticiones implícitas de un moveto", () => {
  // `M0 0 10 10` significa «moveto y lineto»; el segundo par tiene que escalar como línea.
  assert.equal(scalePathData("M0 0 10 10", 2), "M 0 0 L 20 20");
});

test("scalePathData rechaza factores no positivos", () => {
  for (const factor of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => scalePathData("M0 0", factor), /número positivo/);
  }
});

test("upsampleLuminance replica un píxel blanco a 2× y 3×", () => {
  const white = Float32Array.from([255]);

  const twice = upsampleLuminance(white, 1, 1, 2);
  assert.deepEqual([twice.width, twice.height], [2, 2]);
  assert.deepEqual(Array.from(twice.gray), [255, 255, 255, 255]);

  const thrice = upsampleLuminance(white, 1, 1, 3);
  assert.deepEqual([thrice.width, thrice.height], [3, 3]);
  assert.deepEqual(Array.from(thrice.gray), new Array(9).fill(255));
});

test("upsampleLuminance interpola bilinealmente entre píxeles vecinos", () => {
  // Dos píxeles, uno blanco y uno negro, a 2×: la rampa cae en los centros 0,25 y 0,75. La fila se
  // repite porque el borde vertical también se replica.
  const up = upsampleLuminance(Float32Array.from([255, 0]), 2, 1, 2);

  assert.deepEqual([up.width, up.height], [4, 2]);
  assert.deepEqual(Array.from(up.gray), [255, 191.25, 63.75, 0, 255, 191.25, 63.75, 0]);
});

test("upsampleLuminance con escala 1 es la identidad", () => {
  const gray = Float32Array.from([0, 12.5, 128, 200.25, 255, 3]);
  const up = upsampleLuminance(gray, 3, 2, 1);

  assert.deepEqual([up.width, up.height], [3, 2]);
  assert.deepEqual(Array.from(up.gray), Array.from(gray));
});

test("upsampleLuminance rechaza escalas no enteras y buffers cortos", () => {
  assert.throws(() => upsampleLuminance(Float32Array.from([0]), 1, 1, 0), /entero ≥ 1/);
  assert.throws(() => upsampleLuminance(Float32Array.from([0]), 1, 1, 1.5), /entero ≥ 1/);
  assert.throws(() => upsampleLuminance(Float32Array.from([0, 0]), 3, 1, 2), /width × height/);
});

test("subpixelFrame entrega la luminancia ampliada como RGBA gris opaco", () => {
  // Dos píxeles, blanco y negro: a 2× la rampa cae en 191,25 y 63,75, que es lo que el motor verá.
  const frame = subpixelFrame({ width: 2, height: 1, gray: Float32Array.from([255, 0]), threshold: 128 }, 2);

  assert.deepEqual([frame.width, frame.height], [4, 2]);
  assert.equal(frame.rgba.length, 4 * 2 * 4);
  assert.deepEqual(Array.from(frame.rgba.slice(0, 8)), [255, 255, 255, 255, 191, 191, 191, 255]);
  assert.deepEqual(Array.from(frame.rgba.slice(8, 12)), [64, 64, 64, 255]);
  assert.equal(frame.rgba[31], 255, "el alfa tiene que quedar opaco hasta el último píxel");
});

test("traceSubpixel traza ampliado y devuelve la geometría al marco original", () => {
  const calls = [];
  const fake = (rgba, width, height, options) => {
    calls.push({ rgba, width, height, options });
    return `<svg width="${width}" height="${height}"><path d="M0 0 L6 3" fill="#000"/></svg>`;
  };

  const signals = { width: 2, height: 1, gray: Float32Array.from([0, 255]), threshold: 200 };
  const svg = traceSubpixel(fake, signals, { scale: 3, simplify: 0.4 });

  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].width, calls[0].height], [6, 3], "el motor ve la imagen ampliada");
  assert.equal(calls[0].options.binaryThreshold, 201, "el umbral es el Otsu original + 1");
  assert.equal(calls[0].options.simplify, 0.4, "el simplify del preset llega al motor");
  assert.equal(calls[0].options.clustering, "bw");

  assert.match(svg, /viewBox="0 0 2 1"/);
  assert.match(svg, /width="2"/);
  assert.match(svg, /height="1"/);
  assert.match(svg, /d="M 0 0 L 2 1"/, "la geometría se divide por la escala");
});

test("la parte pura del subpíxel no importa el motor de Node", () => {
  // Es el contrato de la demo: `web/app.mjs` importa este módulo en el navegador, donde el paquete
  // `@visioncortex/vtracer` no se puede resolver sin bundler. Un import de motor aquí rompe la demo
  // sin romper ninguna prueba de Node, así que se vigila el texto del módulo.
  const source = fs.readFileSync(new URL("../lib/subpixel-transform.mjs", import.meta.url), "utf8");

  assert.doesNotMatch(source, /^\s*import\s[^;]*from\s+["']@visioncortex/m);
  assert.doesNotMatch(source, /^\s*import\s[^;]*from\s+["']node:/m);
});

test("subpixelOptions devuelve el SVG en el marco de la imagen original", () => {
  // Un cuadrado negro sobre fondo blanco: el caso mínimo con un borde que estimar.
  const width = 32;
  const height = 32;
  const gray = new Float32Array(width * height).fill(255);
  for (let y = 8; y < 24; y++) {
    for (let x = 8; x < 24; x++) gray[y * width + x] = 0;
  }
  const signals = { width, height, gray, threshold: 128 };

  for (const scale of [1, 2]) {
    const svg = subpixelOptions(signals, { scale });
    const metrics = svgMetrics(svg);

    assert.match(svg, /viewBox="0 0 32 32"/, `escala ${scale}: viewBox original`);
    assert.equal(metrics.width, "32", `escala ${scale}: ancho original`);
    assert.equal(metrics.height, "32", `escala ${scale}: alto original`);
    assert.ok(metrics.nodes > 0, `escala ${scale}: el SVG no puede salir vacío`);

    // La geometría aplanada tiene que caer sobre el cuadrado 8..24 de la imagen original. Sin la
    // división por la escala, a 2× el contorno estaría entre 16 y 48 y este recuadro lo delata.
    const points = [...svg.matchAll(/\sd="([^"]*)"/g)]
      .flatMap((match) => pathToPolylines(match[1], { tolerance: 0.05 }))
      .flatMap((line) => line.points);
    assert.ok(points.length > 0, `escala ${scale}: el SVG no tiene geometría`);

    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    for (const [name, values] of [["x", xs], ["y", ys]]) {
      assert.ok(Math.min(...values) >= 7, `escala ${scale}: ${name} mínimo fuera del cuadrado`);
      assert.ok(Math.max(...values) <= 25, `escala ${scale}: ${name} máximo fuera del cuadrado`);
    }
  }
});
