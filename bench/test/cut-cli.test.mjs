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
