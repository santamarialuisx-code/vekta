// Integración del CLI: recorre una carpeta, emite los dos SVG y deja un informe que dice
// que lo emitido mide lo medido. Sin red, sin navegador, sin estado compartido.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../cut.mjs", import.meta.url));

test("cut.mjs emite silueta y capas y verifica sus perímetros", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vekta-cut-"));
  const input = path.join(root, "in");
  const output = path.join(root, "out");
  const json = path.join(root, "report.json");
  fs.mkdirSync(input);

  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10">
    <g fill="#ff0000"><path d="M0 0 H10 V10 H0 Z"/></g>
    <path d="M10 0 H20 V10 H10 Z" fill="#00ff00"/>
  </svg>`;
  fs.writeFileSync(path.join(input, "fixture.svg"), source);

  execFileSync(process.execPath, [cli, "--in", input, "--out", output, "--json", json], {
    stdio: "pipe",
  });

  const report = JSON.parse(fs.readFileSync(json, "utf8"));
  assert.equal(report.length, 1);

  const [entry] = report;
  assert.equal(entry.stem, "fixture");
  assert.equal(entry.colors, 2);
  assert.equal(entry.outlineLength, 80);
  assert.equal(entry.layerLength, 80);
  assert.equal(entry.silhouetteLength, 60);
  assert.equal(entry.uniqueCutLength, 70);
  assert.equal(entry.emitted.silhouetteError, 0);
  assert.equal(entry.emitted.layerError, 0);
  assert.equal(entry.emitted.silhouetteLength, 60);
  assert.equal(entry.emitted.layerLength, 80);

  assert.ok(fs.existsSync(path.join(output, "fixture--silhouette.svg")));
  assert.ok(fs.existsSync(path.join(output, "fixture--layers.svg")));

  const layers = fs.readFileSync(path.join(output, "fixture--layers.svg"), "utf8");
  assert.match(layers, /fill-rule="evenodd"/);
  assert.match(layers, /viewBox="0 0 20 10"/);

  fs.rmSync(root, { recursive: true, force: true });
});

test("cut.mjs emite milímetros, compensa kerf y escribe DXF", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vekta-cut-mm-"));
  const input = path.join(root, "in");
  const output = path.join(root, "out");
  const json = path.join(root, "report.json");
  fs.mkdirSync(input);

  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10">
    <g fill="#ff0000"><path d="M0 0 H10 V10 H0 Z"/></g>
    <path d="M10 0 H20 V10 H10 Z" fill="#00ff00"/>
  </svg>`;
  fs.writeFileSync(path.join(input, "fixture.svg"), source);

  execFileSync(
    process.execPath,
    [
      cli,
      "--in", input,
      "--out", output,
      "--json", json,
      "--width-mm", "20",
      "--kerf-mm", "0.2",
      "--format", "svg,dxf",
    ],
    { stdio: "pipe" },
  );

  const [entry] = JSON.parse(fs.readFileSync(json, "utf8"));
  assert.equal(entry.physical.nominalWidthMm, 20);
  assert.ok(Math.abs(entry.physical.widthMm - 20.2) < 0.01, `ancho ${entry.physical.widthMm}`);
  assert.ok(Math.abs(entry.physical.heightMm - 10.2) < 0.01, `alto ${entry.physical.heightMm}`);
  assert.equal(entry.physical.kerfMm, 0.2);
  // rectángulo 20,2 × 10,2 con esquinas redondeadas de radio 0,1
  assert.ok(
    Math.abs(entry.physical.cutLengthMm - 60.628) < 0.1,
    `recorrido ${entry.physical.cutLengthMm}`,
  );
  assert.ok(entry.emitted.silhouetteError < 0.001, `error ${entry.emitted.silhouetteError}`);

  const silhouetteSvg = fs.readFileSync(path.join(output, "fixture--silhouette.svg"), "utf8");
  assert.match(silhouetteSvg, /width="20\.2mm" height="10\.2mm"/);

  for (const file of ["fixture--silhouette.dxf", "fixture--layers.dxf"]) {
    const dxf = fs.readFileSync(path.join(output, file), "utf8");
    assert.match(dxf, /AC1015/);
    assert.match(dxf, /\$INSUNITS/);
    assert.ok(dxf.includes("LWPOLYLINE"), `${file} sin LWPOLYLINE`);
    assert.ok(dxf.trimEnd().endsWith("EOF"));
  }

  fs.rmSync(root, { recursive: true, force: true });
});
