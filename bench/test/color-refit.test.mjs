// Reajuste de curvas sobre un SVG de etiquetas de píxel: el paso que convierte la fidelidad del modo
// píxel en curvas.
//
// Lo que se blinda: que el SVG siga siendo relleno por región (mismo número de formas y mismos
// colores), que la geometría se ajuste de verdad y que el error contra la escalera no se dispare.

import test from "node:test";
import assert from "node:assert/strict";

import { REFIT_DEFAULTS, refitSvg } from "../lib/color-refit.mjs";
import { svgMetrics } from "../lib/svg-metrics.mjs";

/** Anillo de escalera de un círculo, como el `d` que emite el modo píxel. */
function circlePath(radius, steps = 180) {
  const points = [];
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    points.push([Math.round(radius + radius * Math.cos(angle)), Math.round(radius + radius * Math.sin(angle))]);
  }
  const [start, ...rest] = points;
  return `M${start[0]},${start[1]}` + rest.map(([x, y]) => `L${x},${y}`).join("") + "Z";
}

function pixelSvg() {
  return (
    '<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="200" height="200">\n' +
    '<path d="M0,0H200V200H0Z" fill="#ffffff"/>\n' +
    `<path d="${circlePath(60)}" fill="#123456"/>\n` +
    "</svg>"
  );
}

test("refitSvg conserva formas y rellenos y cambia la escalera por curvas", () => {
  const svg = pixelSvg();
  const before = svgMetrics(svg);
  const refit = refitSvg(svg);
  const after = svgMetrics(refit);

  assert.equal((refit.match(/<path/g) ?? []).length, (svg.match(/<path/g) ?? []).length);
  assert.match(refit, /fill="#ffffff"/);
  assert.match(refit, /fill="#123456"/);
  assert.ok(refit.includes("C "), "el círculo tiene que salir con curvas");
  assert.ok(after.nodes < before.nodes, `menos nodos que la escalera (${after.nodes} < ${before.nodes})`);
  assert.match(refit, /viewBox|width="200"/);
});

test("refitSvg respeta el error declarado contra la escalera", () => {
  const svg = pixelSvg();
  const refit = refitSvg(svg, { ...REFIT_DEFAULTS, rdpTolerance: 0.3, fitError: 0.3 });

  // El cuadrado blanco tiene que seguir siendo el cuadrado del lienzo (cuatro esquinas exactas).
  const square = /d="(M[^"]*?)"/.exec(refit)[1];
  assert.match(square, /^M 0 0/);
  assert.match(square, /L 200 0/);
  assert.match(square, /L 200 200/);
  assert.match(square, /L 0 200/);

  // Y el círculo no puede haberse ido más de ~1 px del anillo original de radio 60.
  const circle = [...refit.matchAll(/<path d="([^"]*)" fill="#123456"/g)][0][1];
  for (const [, x, y] of circle.matchAll(/([-\d.]+) ([-\d.]+)/g)) {
    const distance = Math.hypot(Number(x) - 60, Number(y) - 60);
    assert.ok(distance > 58 && distance < 62, `punto (${x}, ${y}) a ${distance.toFixed(2)} del centro`);
  }
});

test("refitSvg rechaza un SVG sin formas que reajustar", () => {
  assert.throws(() => refitSvg("<svg></svg>"), /formas/);
  assert.throws(() => refitSvg(42), /SVG/);
});
