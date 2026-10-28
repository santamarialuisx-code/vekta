// Pruebas de emisión: el SVG cortable tiene que medir lo que dice medir.
// El criterio no es "el marcado parece razonable", sino que al volver a leer el archivo emitido
// su perímetro coincida con la longitud medida antes de emitirlo.

import test from "node:test";
import assert from "node:assert/strict";

import { svgShapes } from "../lib/svg-shapes.mjs";
import { analyzeShapes, cutStats, ringsLength, unionRings } from "../lib/union.mjs";
import { cutSvg, layerSvg, ringsBbox, ringsToPathData } from "../lib/cut-svg.mjs";
import { pathToPolylines, polylineLength } from "../lib/path-to-polyline.mjs";

const squarePath = (x, y, size) => `M${x} ${y} H${x + size} V${y + size} H${x} Z`;
const squareRing = (x, y, size) => [
  [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
    [x, y],
  ],
];

const rel = (actual, expected, tolerance = 0.01) =>
  assert.ok(
    Math.abs(actual - expected) / expected <= tolerance,
    `esperaba ${expected} ± ${tolerance * 100}%, obtuve ${actual}`,
  );

const lengthOf = (d) =>
  pathToPolylines(d, { tolerance: 0.05 }).reduce(
    (total, line) => total + polylineLength(line.points),
    0,
  );

test("ringsToPathData emite un cuadrado cerrado que se vuelve a medir igual", () => {
  const d = ringsToPathData(squareRing(0, 0, 10));
  assert.match(d, /^M0 0L10 0L10 10L0 10Z$/);
  rel(lengthOf(d), 40, 1e-9);
});

test("ringsToPathData respeta la precisión pedida", () => {
  const d = ringsToPathData([[[0.123456, 0.987654], [10.111111, 0.987654], [10.111111, 10.5]]], {
    precision: 1,
  });
  assert.match(d, /^M0\.1 1L10\.1 1L10\.1 10\.5Z$/);
});

test("ringsBbox encuadra el conjunto", () => {
  const bbox = ringsBbox([...squareRing(0, 0, 10), ...squareRing(10, 0, 10)]);
  assert.deepEqual(bbox, { x: 0, y: 0, width: 20, height: 10 });
});

test("cutSvg emite un solo path con evenodd y un viewBox que encuadra", () => {
  const rings = unionRings([squareRing(0, 0, 10)]);
  const svg = cutSvg({ rings });
  assert.equal((svg.match(/<path\b/g) ?? []).length, 1);
  assert.match(svg, /fill-rule="evenodd"/);
  assert.match(svg, /viewBox="0 0 10 10"/);
  assert.match(svg, /width="10" height="10"/);
});

test("layerSvg emite un path por color", () => {
  const svg = layerSvg({
    layers: [
      { fill: "#ff0000", rings: squareRing(0, 0, 10) },
      { fill: "#00ff00", rings: squareRing(10, 0, 10) },
    ],
    bbox: { x: 0, y: 0, width: 20, height: 10 },
  });
  assert.equal((svg.match(/<path\b/g) ?? []).length, 2);
  assert.match(svg, /fill="#ff0000"/);
  assert.match(svg, /viewBox="0 0 20 10"/);
});

test("la silueta emitida mide E: dos cuadrados que comparten arista", () => {
  const source = `<svg><g fill="#ff0000">
    <path d="${squarePath(0, 0, 10)}"/>
    <path d="${squarePath(10, 0, 10)}"/>
  </g></svg>`;
  const shapes = svgShapes(source);
  const analysis = analyzeShapes(shapes);
  const stats = cutStats(shapes);
  const rings = unionRings(analysis.allPolygons);

  const emitted = cutSvg({ rings });
  const remeasured = cutStats(svgShapes(emitted));

  rel(stats.silhouetteLength, 60, 1e-9);
  rel(remeasured.outlineLength, stats.silhouetteLength);
  rel(ringsLength(rings), stats.silhouetteLength);
});

test("las capas emitidas miden L: dos colores que comparten arista", () => {
  const source = `<svg><g fill="#ff0000"><path d="${squarePath(0, 0, 10)}"/></g>
    <path d="${squarePath(10, 0, 10)}" fill="#00ff00"/></svg>`;
  const shapes = svgShapes(source);
  const analysis = analyzeShapes(shapes);
  const stats = cutStats(shapes);

  const layers = [...analysis.polygonsByColor].map(([fill, polygons]) => ({
    fill,
    rings: unionRings(polygons),
  }));
  const emitted = layerSvg({ layers, bbox: ringsBbox(unionRings(analysis.allPolygons)) });

  rel(stats.layerLength, 80, 1e-9);
  rel(cutStats(svgShapes(emitted)).outlineLength, stats.layerLength);
  rel(stats.silhouetteLength, 60, 1e-9);
  assert.ok(stats.uniqueCutLength > stats.silhouetteLength);
});

test("la silueta conserva los agujeros con evenodd", () => {
  const donut = `M0 0 H10 V10 H0 Z M3 3 V7 H7 V3 Z`;
  const shapes = svgShapes(`<svg><path d="${donut}" fill="#000000"/></svg>`);
  const analysis = analyzeShapes(shapes);
  const rings = unionRings(analysis.allPolygons);
  assert.equal(rings.length, 2);
  rel(cutStats(svgShapes(cutSvg({ rings }))).outlineLength, 56);
});
