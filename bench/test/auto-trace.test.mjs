// Integración del trazado automático: la carpeta la pone la prueba, la decisión la toman las
// señales de la imagen. Lo que se comprueba es lo que promete el experimento 07: un escaneo sale en
// modo binario y con **un solo relleno**; una imagen de color no se toca.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { encodePng } from "../lib/image-io.mjs";

const cli = fileURLToPath(new URL("../auto-trace.mjs", import.meta.url));

function rgba(width, height, fill) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fill(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { width, height, rgba: data };
}

test("auto-trace decide por imagen y el line art sale con un solo relleno", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vekta-auto-"));
  const input = path.join(root, "in");
  const output = path.join(root, "out");
  const json = path.join(root, "report.json");
  fs.mkdirSync(input);

  // Escaneo: papel casi blanco con trazos oscuros finos.
  fs.writeFileSync(
    path.join(input, "scan.png"),
    encodePng(
      rgba(80, 60, (x, y) => (x % 9 === 0 || y % 11 === 0 ? [50, 50, 50] : [246, 246, 243])),
    ),
  );

  // Ilustración de color: nada que ver con tinta.
  fs.writeFileSync(
    path.join(input, "color.png"),
    encodePng(rgba(80, 60, (x, y) => (x < 40 ? [200, 30, 60] : [20, 90, 190]))),
  );

  execFileSync(process.execPath, [cli, "--inputs", input, "--out", output, "--json", json], {
    stdio: "pipe",
  });

  const report = JSON.parse(fs.readFileSync(json, "utf8"));
  assert.equal(report.length, 2);

  const scan = report.find((entry) => entry.imgSlug === "scan");
  const color = report.find((entry) => entry.imgSlug === "color");

  assert.equal(scan.decision, "line-art", scan.reason);
  assert.equal(scan.fills, 1, "el modo binario no puede emitir más de un relleno");
  assert.ok(scan.nodes > 0);
  // Bimodal justa: Otsu devuelve el nivel de la tinta, 50.
  assert.equal(scan.threshold, 50);
  // El preset se traza a 3× y vuelve al marco del PNG; el color no paga ese muestreo.
  assert.equal(scan.subpixelScale, 3);
  assert.equal(color.subpixelScale, 1);
  // El modo de entrega viaja en el informe: binario para line art, curvas para color.
  assert.equal(scan.mode, "binario");
  assert.equal(color.mode, "curvas");
  assert.ok(fs.existsSync(path.join(output, scan.svg.split("/").pop())));

  assert.equal(color.decision, "color");
  assert.ok(color.fills >= 2, `la ilustración conserva sus rellenos, no ${color.fills}`);
  assert.ok(color.paletteSize >= 2);

  // `--fidelity` cambia el modo del color (experimento 14) y deja el line art como estaba.
  const fidelityJson = path.join(root, "fidelity.json");
  execFileSync(
    process.execPath,
    [cli, "--inputs", input, "--out", path.join(root, "out-fidelity"), "--json", fidelityJson, "--fidelity"],
    { stdio: "pipe" },
  );
  const fidelity = JSON.parse(fs.readFileSync(fidelityJson, "utf8"));
  const fidelityScan = fidelity.find((entry) => entry.imgSlug === "scan");
  const fidelityColor = fidelity.find((entry) => entry.imgSlug === "color");

  assert.equal(fidelityColor.mode, "fidelidad");
  assert.equal(fidelityColor.fills, color.fills, "el modo no cambia la paleta, solo el trazado");
  assert.equal(fidelityColor.paletteSize, color.paletteSize);
  assert.ok(fidelityColor.nodes > 0);
  // El SVG entregado tiene que ser otro: si el modo no llegara al motor, sería idéntico byte a byte.
  const curvesSvg = fs.readFileSync(path.join(output, color.svg.split("/").pop()), "utf8");
  const fidelitySvg = fs.readFileSync(path.join(root, "out-fidelity", fidelityColor.svg.split("/").pop()), "utf8");
  assert.notEqual(fidelitySvg, curvesSvg, "el modo píxel no puede emitir el mismo SVG que las curvas");
  assert.equal(fidelityScan.mode, "binario");
  assert.equal(fidelityScan.subpixelScale, 3);
});
