// Pruebas de la geometría de corte.
// El criterio central: la salida de un trazador por colores es teselada, así que un borde
// interno pertenece a dos formas y una máquina de corte lo recorre dos veces. Eso se mide
// comparando la longitud total de contornos contra el perímetro de la unión booleana.

import test from "node:test";
import assert from "node:assert/strict";

import { parsePath, pathToPolylines, polylineLength } from "../lib/path-to-polyline.mjs";
import { svgShapes } from "../lib/svg-shapes.mjs";
import { cutStats } from "../lib/union.mjs";

const near = (actual, expected, eps = 1e-6) =>
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `esperaba ${expected} ± ${eps}, obtuve ${actual}`,
  );

// --- tokenizador y aplanado -------------------------------------------------

test("parsePath separa comandos y argumentos, absolutos y relativos", () => {
  const cmds = parsePath("M0 0 H10 V10 h-10 z");
  assert.deepEqual(
    cmds.map((c) => c.cmd),
    ["M", "H", "V", "h", "z"],
  );
  assert.deepEqual(cmds[0].args, [0, 0]);
  assert.deepEqual(cmds[1].args, [10]);
  assert.deepEqual(cmds[3].args, [-10]);
});

test("parsePath acepta números con signo, decimales y notación exponencial", () => {
  const cmds = parsePath("M-1.5.5L1e2-2E-1");
  assert.deepEqual(cmds[0].args, [-1.5, 0.5]);
  assert.deepEqual(cmds[1].args, [100, -0.2]);
});

test("parsePath expande coordenadas implícitas tras el moveto", () => {
  const cmds = parsePath("M0 0 10 0 10 10Z");
  assert.deepEqual(
    cmds.map((c) => c.cmd),
    ["M", "L", "L", "Z"],
  );
});

test("un cuadrado absoluto mide su perímetro y queda cerrado", () => {
  const [line] = pathToPolylines("M0 0 H10 V10 H0 Z");
  assert.equal(line.closed, true);
  near(polylineLength(line.points), 40);
  assert.equal(line.points.length, 5); // el cierre repite el primer punto
  assert.deepEqual(line.points[0], [0, 0]);
  assert.deepEqual(line.points.at(-1), [0, 0]);
});

test("el mismo cuadrado en relativo mide igual", () => {
  const [line] = pathToPolylines("m0 0 h10 v10 h-10 z");
  near(polylineLength(line.points), 40);
});

test("los subpaths se devuelven por separado", () => {
  const lines = pathToPolylines("M0 0 H10 V10 H0 Z M20 20 H30 V30 H20 Z");
  assert.equal(lines.length, 2);
  near(polylineLength(lines[0].points), 40);
  near(polylineLength(lines[1].points), 40);
});

test("un círculo de cuatro cúbicas se aplana con error < 1 %", () => {
  const r = 10;
  const k = 0.5522847498307936 * r;
  const d = [
    `M${r} 0`,
    `C${r} ${k} ${k} ${r} 0 ${r}`,
    `C${-k} ${r} ${-r} ${k} ${-r} 0`,
    `C${-r} ${-k} ${-k} ${-r} 0 ${-r}`,
    `C${k} ${-r} ${r} ${-k} ${r} 0`,
    "Z",
  ].join(" ");
  const [line] = pathToPolylines(d, { tolerance: 0.01 });
  const perimeter = 2 * Math.PI * r;
  assert.ok(
    Math.abs(polylineLength(line.points) - perimeter) / perimeter < 0.01,
    `perímetro ${polylineLength(line.points)} vs ${perimeter}`,
  );
  // el aplanado adaptativo no debe generar un polígono tosco
  assert.ok(line.points.length >= 16, `solo ${line.points.length} puntos`);
});

test("S refleja el punto de control anterior igual que su C explícita", () => {
  const smooth = pathToPolylines("M0 0 C0 5 5 10 10 10 S20 15 20 20", { tolerance: 0.001 });
  const explicit = pathToPolylines("M0 0 C0 5 5 10 10 10 C15 10 20 15 20 20", {
    tolerance: 0.001,
  });
  near(polylineLength(smooth[0].points), polylineLength(explicit[0].points), 1e-6);
});

test("T se comporta como la Q explícita equivalente", () => {
  const smooth = pathToPolylines("M0 0 Q5 10 10 0 T20 0", { tolerance: 0.001 });
  const explicit = pathToPolylines("M0 0 Q5 10 10 0 Q15 -10 20 0", { tolerance: 0.001 });
  near(polylineLength(smooth[0].points), polylineLength(explicit[0].points), 1e-6);
});

// --- extracción de formas desde el SVG --------------------------------------

test("svgShapes hereda el fill del grupo", () => {
  const svg = `<svg><g fill="#ff0000"><path d="M0 0 H10 V10 Z"/></g></svg>`;
  const shapes = svgShapes(svg);
  assert.equal(shapes.length, 1);
  assert.equal(shapes[0].fill, "#ff0000");
  assert.equal(shapes[0].fillRule, "nonzero");
});

test("el fill propio gana sobre el heredado y se ignora none", () => {
  const svg = `<svg><g fill="#00ff00">
    <path d="M0 0 H10 V10 Z" fill="#0000ff"/>
    <path d="M20 0 H30 V10 Z" fill="none"/>
  </g></svg>`;
  const shapes = svgShapes(svg);
  assert.equal(shapes.length, 1);
  assert.equal(shapes[0].fill, "#0000ff");
});

test("sin fill en ningún ancestro se asume negro y se hereda fill-rule", () => {
  const svg = `<svg><g fill-rule="evenodd"><path d="M0 0 H10 V10 Z M2 2 H8 V8 Z"/></g></svg>`;
  const [shape] = svgShapes(svg);
  assert.equal(shape.fill, "#000000");
  assert.equal(shape.fillRule, "evenodd");
});

test("el estilo en línea gana sobre el atributo de presentación", () => {
  const svg = `<svg><path d="M0 0 H10 V10 Z" fill="#111111" style="fill:#abcdef;fill-rule:evenodd"/></svg>`;
  const [shape] = svgShapes(svg);
  assert.equal(shape.fill, "#abcdef");
  assert.equal(shape.fillRule, "evenodd");
});

test("svgShapes ignora lo que está dentro de defs", () => {
  const svg = `<svg><defs><path d="M0 0 H99 V99 Z" fill="#ff0000"/></defs>
    <path d="M0 0 H10 V10 Z" fill="#00ff00"/></svg>`;
  const shapes = svgShapes(svg);
  assert.equal(shapes.length, 1);
  assert.equal(shapes[0].fill, "#00ff00");
});

test("svgShapes soporta polygon y polygon con relleno explícito", () => {
  const svg = `<svg><polygon points="0,0 10,0 10,10 0,10" fill="#123456"/></svg>`;
  const [shape] = svgShapes(svg);
  assert.equal(shape.fill, "#123456");
  near(polylineLength(pathToPolylines(shape.d)[0].points), 40);
});

// --- unión booleana y factor de redundancia ---------------------------------

const squarePath = (x, y, size) =>
  `M${x} ${y} H${x + size} V${y + size} H${x} Z`;

test("una sola forma no se corta dos veces", () => {
  const stats = cutStats([{ d: squarePath(0, 0, 10), fill: "#000000" }]);
  near(stats.outlineLength, 40);
  near(stats.layerLength, 40);
  near(stats.silhouetteLength, 40);
  near(stats.uniqueCutLength, 40);
  near(stats.redundancy, 1);
  near(stats.singlePassRedundancy, 1);
  near(stats.duplicateLength, 0);
  near(stats.singlePassDuplicateLength, 0);
  assert.equal(stats.colorCount, 1);
  assert.equal(stats.contourCount, 1);
});

test("dos formas del mismo color que comparten arista se fusionan al cortar", () => {
  const stats = cutStats([
    { d: squarePath(0, 0, 10), fill: "#000000" },
    { d: squarePath(10, 0, 10), fill: "#000000" },
  ]);
  near(stats.outlineLength, 80);
  near(stats.layerLength, 60); // la capa une las dos formas: la arista compartida desaparece
  near(stats.silhouetteLength, 60);
  near(stats.uniqueCutLength, 60);
  near(stats.redundancy, 80 / 60);
  near(stats.singlePassRedundancy, 80 / 60);
  near(stats.duplicateLength, 20);
});

test("dos formas idénticas superpuestas duplican el recorrido completo", () => {
  const stats = cutStats([
    { d: squarePath(0, 0, 10), fill: "#000000" },
    { d: squarePath(0, 0, 10), fill: "#000000" },
  ]);
  near(stats.outlineLength, 80);
  near(stats.layerLength, 40);
  near(stats.silhouetteLength, 40);
  near(stats.uniqueCutLength, 40);
  near(stats.redundancy, 2);
  near(stats.singlePassRedundancy, 2);
});

test("un borde entre dos colores distintos se recorre una sola vez en una pasada", () => {
  const stats = cutStats([
    { d: squarePath(0, 0, 10), fill: "#ff0000" },
    { d: squarePath(10, 0, 10), fill: "#00ff00" },
  ]);
  assert.equal(stats.colorCount, 2);
  near(stats.outlineLength, 80);
  near(stats.layerLength, 80); // dos capas de color: cada una corta su cuadrado
  near(stats.silhouetteLength, 60); // la silueta del conjunto es el rectángulo 20x10
  near(stats.uniqueCutLength, 70); // silueta + el borde de color, una sola vez
  near(stats.redundancy, 1); // por capas no se desperdicia nada
  near(stats.singlePassRedundancy, 80 / 70);
});

test("un path con agujero evenodd no duplica el contorno interior", () => {
  const d = "M0 0 H10 V10 H0 Z M3 3 V7 H7 V3 Z";
  const stats = cutStats([{ d, fill: "#000000", fillRule: "evenodd" }]);
  near(stats.outlineLength, 56); // 40 exteriores + 16 del agujero 4x4
  near(stats.layerLength, 56);
  near(stats.uniqueCutLength, 56);
  near(stats.redundancy, 1);
  assert.equal(stats.holeCount, 1);
});

test("los contornos degenerados se descartan", () => {
  const stats = cutStats([
    { d: squarePath(0, 0, 10), fill: "#000000" },
    { d: "M5 5 H5 V5 Z", fill: "#000000" },
  ]);
  assert.equal(stats.contourCount, 1);
  near(stats.outlineLength, 40);
});

test("las formas sin fill se asumen negras, igual que en svgShapes", () => {
  const stats = cutStats([{ d: squarePath(0, 0, 10) }]);
  assert.equal(stats.colorCount, 1);
  near(stats.silhouetteLength, 40);
});
