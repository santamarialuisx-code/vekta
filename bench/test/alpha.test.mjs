// El alfa como línea de corte.
//
// La dona es el caso que el banco no tenía: la silueta no es el lienzo. Lo que se comprueba es que
// el alfa se lee como información (y que no se confunde con un 255 global), que la máscara limpia
// el ruido de un píxel con la tolerancia, que la imagen de gris que come el motor sólo tiene 0 y
// 255, y que la geometría emitida —medida sobre el archivo escrito— mide lo que mide la figura.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { decodeImage, encodePng } from "../lib/image-io.mjs";
import {
  ALPHA_RULES,
  alphaHasTransparency,
  alphaMask,
  alphaStats,
  flattenOntoWhite,
  maskToLuminance,
} from "../lib/alpha.mjs";
import { pathToPolylines } from "../lib/path-to-polyline.mjs";

const cli = fileURLToPath(new URL("../alpha-cut.mjs", import.meta.url));
const fixture = fileURLToPath(new URL("../inputs/alpha-donut.png", import.meta.url));

// Geometría del fixture, en píxeles de imagen.
const OUTER = 170;
const INNER = 80;

/** Buffer RGBA8 construido píxel a píxel; `alpha` puede ser 255 fijo o una función. */
function rgba(width, height, { color = [200, 64, 48], alpha = () => 255 } = {}) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = color[0];
      data[i + 1] = color[1];
      data[i + 2] = color[2];
      data[i + 3] = alpha(x, y);
    }
  }
  return data;
}

/** Área con signo de una polilínea cerrada (shoelace). */
function signedArea(points) {
  let area = 0;
  for (let i = 0; i < points.length - 1; i++) {
    area += points[i][0] * points[i + 1][1] - points[i + 1][0] * points[i][1];
  }
  return area / 2;
}

/** Área y perímetro de un SVG emitido, leídos del `d` tal como quedó escrito. */
function measure(markup) {
  let area = 0;
  let perimeter = 0;
  for (const match of markup.matchAll(/\sd="([^"]*)"/g)) {
    for (const line of pathToPolylines(match[1], { tolerance: 0.01 })) {
      area += signedArea(line.points);
      for (let i = 1; i < line.points.length; i++) {
        perimeter += Math.hypot(
          line.points[i][0] - line.points[i - 1][0],
          line.points[i][1] - line.points[i - 1][1],
        );
      }
    }
  }
  return { area: Math.abs(area), perimeter };
}

test("la dona tiene alfa real y la máscara recorta exactamente la corona", () => {
  const image = decodeImage(fs.readFileSync(fixture));
  const stats = alphaStats(image.rgba);

  assert.equal(image.width, 400);
  assert.equal(image.height, 400);
  assert.equal(alphaHasTransparency(image.rgba), true);
  // El anillo de la dona ocupa π(r₁² − r₂²) / (400 × 400) = 44,2 % del lienzo.
  assert.ok(stats.opaqueShare > 0.43 && stats.opaqueShare < 0.45, `opaque ${stats.opaqueShare}`);
  // Antialiasing de verdad: hay alfa parcial, no sólo 0 y 255.
  assert.ok(stats.partialShare > 0.001, `parcial ${stats.partialShare}`);

  const mask = alphaMask(image.rgba, image.width, image.height);
  assert.equal(mask.length, image.width * image.height);
  let subject = 0;
  for (const value of mask) {
    assert.ok(value === 0 || value === 1);
    subject += value;
  }
  const expected = Math.PI * (OUTER ** 2 - INNER ** 2);
  assert.ok(
    Math.abs(subject - expected) / expected < 0.01,
    `sujeto ${subject} px, esperado ${expected.toFixed(0)} px`,
  );

  // Un píxel del centro del agujero y otro del borde exterior de la corona.
  assert.equal(mask[200 * 400 + 200], 0);
  assert.equal(mask[200 * 400 + 40], 1);
});

test("un PNG sin alfa se detecta como alfa inútil", () => {
  const opaque = rgba(60, 40);

  assert.equal(alphaHasTransparency(opaque), false);
  const stats = alphaStats(opaque);
  assert.equal(stats.opaqueShare, 1);
  assert.equal(stats.transparentShare, 0);

  // El umbral está documentado: con medio lienzo transparente el alfa ya describe forma.
  const half = rgba(60, 40, { alpha: (x) => (x < 30 ? 0 : 255) });
  assert.equal(
    alphaStats(half).opaqueShare > ALPHA_RULES.maxOpaqueShare,
    false,
  );
  assert.equal(alphaHasTransparency(half), true);
});

test("la tolerancia limpia el ruido de un píxel", () => {
  const width = 40;
  const height = 40;
  // Cuadrado lleno de 20 × 20 con cuatro motas: dos transparentes dentro y dos opacas fuera.
  const noisy = rgba(width, height, {
    alpha: (x, y) => {
      const inside = x >= 10 && x < 30 && y >= 10 && y < 30;
      if (x === 15 && y === 15) return 0;
      if (x === 20 && y === 25) return 0;
      if (x === 2 && y === 2) return 255;
      if (x === 37 && y === 37) return 255;
      return inside ? 255 : 0;
    },
  });

  const clean = maskOf(width, height, (x, y) => (x >= 10 && x < 30 && y >= 10 && y < 30 ? 1 : 0));

  const raw = alphaMask(noisy, width, height, { tolerance: 0 });
  assert.equal(raw[15 * width + 15], 0);
  assert.equal(raw[2 * width + 2], 1);
  assert.notDeepEqual(raw, clean);

  const denoised = alphaMask(noisy, width, height, { tolerance: ALPHA_RULES.tolerance });
  assert.deepEqual(denoised, clean);
});

test("maskToLuminance sólo emite 0 y 255 con el sujeto como tinta", () => {
  const width = 3;
  const height = 2;
  const mask = Uint8Array.from([1, 0, 1, 0, 0, 1]);
  const gray = maskToLuminance(mask, width, height);

  assert.equal(gray.width, width);
  assert.equal(gray.height, height);
  assert.equal(gray.rgba.length, width * height * 4);

  for (let p = 0; p < mask.length; p++) {
    const expected = mask[p] ? 0 : 255;
    const i = p * 4;
    assert.equal(gray.rgba[i], expected);
    assert.equal(gray.rgba[i + 1], expected);
    assert.equal(gray.rgba[i + 2], expected);
    assert.equal(gray.rgba[i + 3], 255);
  }

  // Con dos únicos niveles, el umbral 128 del modo binario parte exacto: no hay gris que decidir.
  for (const value of gray.rgba) {
    assert.ok(value === 0 || value === 255);
  }
});

test("flattenOntoWhite compone el alfa sobre blanco", () => {
  const width = 3;
  const height = 1;
  const source = Uint8Array.from([
    200, 64, 48, 0,
    200, 64, 48, 255,
    0, 0, 0, 128,
  ]);
  const flat = flattenOntoWhite(source, width, height);

  assert.deepEqual(Array.from(flat.slice(0, 4)), [255, 255, 255, 255]);
  assert.deepEqual(Array.from(flat.slice(4, 8)), [200, 64, 48, 255]);
  // alfa 128 sobre blanco: 0 · 128/255 + 255 · 127/255 = 127.
  assert.deepEqual(Array.from(flat.slice(8, 12)), [127, 127, 127, 255]);

  // No muta la entrada: el camino de color sigue teniendo el alfa original.
  assert.equal(source[3], 0);
});

test("alpha-cut traza la dona: un exterior, un agujero, perímetro y área medidos", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vekta-alpha-"));
  const output = path.join(root, "out");
  const json = path.join(root, "report.json");

  execFileSync(process.execPath, [cli, "--in", fixture, "--out", output, "--json", json], {
    stdio: "pipe",
  });

  const report = JSON.parse(fs.readFileSync(json, "utf8"));
  assert.equal(report.length, 1);
  const [entry] = report;

  assert.equal(entry.stem, "alpha-donut");
  assert.equal(entry.alpha.useful, true);
  assert.equal(entry.geometry.rings, 2);
  assert.equal(entry.geometry.contours, 2);
  assert.equal(entry.geometry.holes, 1);

  const svgFile = path.join(output, "alpha-donut--silhouette.svg");
  const dxfFile = path.join(output, "alpha-donut--silhouette.dxf");
  assert.ok(fs.existsSync(svgFile));
  assert.ok(fs.existsSync(dxfFile));

  const markup = fs.readFileSync(svgFile, "utf8");
  // Silueta: un solo path con un exterior y un agujero que resta.
  assert.match(markup, /fill-rule="evenodd"/);
  const d = /d="([^"]*)"/.exec(markup)[1];
  assert.equal(d.match(/M/g).length, 2);

  // Lo que manda es el archivo emitido, no lo que se quiso emitir.
  const emitted = measure(markup);
  assert.equal(entry.emitted.svg, path.relative(process.cwd(), svgFile).replace(/\\/g, "/"));
  assert.ok(
    Math.abs(emitted.perimeter - entry.emitted.perimeter) < 0.01,
    `informe ${entry.emitted.perimeter} vs archivo ${emitted.perimeter}`,
  );

  // Perímetro ≈ 2π(r₁ + r₂) y área ≈ π(r₁² − r₂²).
  const exactPerimeter = 2 * Math.PI * (OUTER + INNER);
  const exactArea = Math.PI * (OUTER ** 2 - INNER ** 2);
  assert.ok(
    Math.abs(emitted.perimeter - exactPerimeter) / exactPerimeter < 0.02,
    `perímetro ${emitted.perimeter.toFixed(2)} vs ${exactPerimeter.toFixed(2)}`,
  );
  assert.ok(
    Math.abs(emitted.area - exactArea) / exactArea < 0.02,
    `área ${emitted.area.toFixed(2)} vs ${exactArea.toFixed(2)}`,
  );
  // El agujero resta: el área emitida no es la del disco lleno.
  assert.ok(emitted.area < Math.PI * OUTER ** 2 * 0.9);

  // Y el DXF lleva los dos anillos, en milímetros declarados.
  const dxf = fs.readFileSync(dxfFile, "utf8");
  assert.equal(dxf.match(/LWPOLYLINE/g).length, 2);
  assert.ok(dxf.includes("$INSUNITS"));

  fs.rmSync(root, { recursive: true, force: true });
});

test("alpha-cut escala a milímetros y compensa el kerf", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vekta-alpha-mm-"));
  const output = path.join(root, "out");
  const json = path.join(root, "report.json");

  execFileSync(
    process.execPath,
    [
      cli,
      "--in", fixture,
      "--out", output,
      "--json", json,
      "--width-mm", "100",
      "--kerf-mm", "1",
    ],
    { stdio: "pipe" },
  );

  const [entry] = JSON.parse(fs.readFileSync(json, "utf8"));
  assert.equal(entry.physical.nominalWidthMm, 100);
  assert.equal(entry.physical.kerfMm, 1);
  // La caja se mide sobre la trayectoria compensada: 100 mm de pieza + 2 · radio (0,5 mm).
  assert.ok(
    Math.abs(entry.physical.widthMm - 101) < 0.2,
    `ancho compensado ${entry.physical.widthMm} mm`,
  );
  assert.ok(entry.physical.perimeterMm > 400 && entry.physical.perimeterMm < 500);

  const markup = fs.readFileSync(path.join(output, "alpha-donut--silhouette.svg"), "utf8");
  assert.match(markup, /width="[\d.]+mm"/);
  assert.match(markup, /viewBox="[\d.\- ]+"/);

  fs.rmSync(root, { recursive: true, force: true });
});

test("alpha-cut rechaza una imagen sin alfa útil", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vekta-alpha-opaque-"));
  const input = path.join(root, "opaque.png");
  const output = path.join(root, "out");
  const json = path.join(root, "report.json");
  fs.writeFileSync(input, encodePng({ width: 40, height: 30, rgba: rgba(40, 30) }));

  assert.throws(
    () => execFileSync(process.execPath, [cli, "--in", input, "--out", output, "--json", json], {
      stdio: "pipe",
      encoding: "utf8",
    }),
    (error) => {
      assert.equal(error.status, 1);
      assert.match(error.stderr, /alfa no aporta silueta/);
      assert.match(error.stderr, /100,0 % de los píxeles son opacos/);
      return true;
    },
  );

  fs.rmSync(root, { recursive: true, force: true });
});

function maskOf(width, height, fn) {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) mask[y * width + x] = fn(x, y);
  }
  return mask;
}
