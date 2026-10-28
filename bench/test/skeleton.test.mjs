// Línea central del trazo: máscara de tinta → esqueleto de 1 px → polilíneas.
//
// Todo lo que se prueba aquí es geometría sintética. El escaneo (K1) no sirve como prueba: no hay
// verdad de referencia píxel a píxel para una línea central, así que las promesas se fijan con
// formas cuyo resultado correcto se puede escribir a mano: una barra, un anillo, un cuadrado lleno,
// una L y una franja de 2 px.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { encodePng } from "../lib/image-io.mjs";
import {
  inkMask,
  maskLength,
  polylineLength,
  simplifyPolyline,
  thin,
  traceSkeleton,
} from "../lib/skeleton.mjs";

const cli = fileURLToPath(new URL("../stroke.mjs", import.meta.url));

// --- máscaras sintéticas: 0/1 por función, igual que las imágenes de lineart.test.mjs ---

function maskOf(width, height, fill) {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (fill(x, y)) mask[y * width + x] = 1;
    }
  }
  return mask;
}

function inkPixels(mask) {
  let count = 0;
  for (const value of mask) count += value ? 1 : 0;
  return count;
}

// --- máscara de tinta ---

test("inkMask marca la tinta por debajo del umbral", () => {
  // La convención es la del motor: es tinta lo que queda *por debajo* del umbral, y el umbral del
  // preset de line art ya viene desplazado para incluirlo (`lineArtOptions`).
  const gray = Float32Array.from([0, 60, 99, 100, 140, 255]);
  assert.deepEqual([...inkMask(gray, 6, 1, 100)], [1, 1, 1, 0, 0, 0]);
  assert.deepEqual([...inkMask(gray, 6, 1, 0)], [0, 0, 0, 0, 0, 0]);
});

test("inkMask exige el tamaño declarado y un umbral numérico", () => {
  assert.throws(() => inkMask(new Float32Array(8), 3, 3, 100), /width × height/);
  assert.throws(() => inkMask(new Float32Array(9), 3, 3, Number.NaN), /umbral/);
});

// --- adelgazado ---

test("una franja de 2 px se adelgaza a una sola fila", () => {
  // El caso que delata a un adelgazador flojo: 2 px de grosor es «casi» una línea, y quedarse con
  // las dos filas (o con un borde del trazo) duplica la longitud de la línea central.
  const width = 40;
  const height = 10;
  const mask = maskOf(width, height, (x, y) => x >= 6 && x <= 33 && (y === 4 || y === 5));
  const skeleton = thin(mask, width, height);

  const rows = new Map();
  for (let y = 0; y < height; y++) {
    let rowInk = 0;
    for (let x = 0; x < width; x++) rowInk += skeleton[y * width + x] ? 1 : 0;
    if (rowInk > 0) rows.set(y, rowInk);
  }

  assert.equal(rows.size, 1, `quedan ${rows.size} filas con tinta: ${[...rows.keys()].join(", ")}`);
  assert.equal([...rows.values()][0], 28, "la fila que queda conserva el largo de la franja");
  assert.ok(rows.has(4) || rows.has(5), "no se inventan filas fuera de la franja original");
});

// --- trazado ---

test("una línea gruesa sale como una sola polilínea del largo de su eje", () => {
  const width = 71;
  const height = 21;
  const mask = maskOf(width, height, (x, y) => x >= 5 && x <= 65 && y >= 8 && y <= 12);
  const skeleton = thin(mask, width, height);

  // 5 px de grosor → 1 px: ni dos filas paralelas ni una escalera.
  assert.equal(inkPixels(skeleton), 61);

  const polylines = traceSkeleton(skeleton, width, height);
  assert.equal(polylines.length, 1);
  assert.deepEqual(polylines[0].at(0), [5, 10]);
  assert.deepEqual(polylines[0].at(-1), [65, 10]);

  // El largo de la línea central es el del eje, no el del contorno (que serían ~120 px).
  assert.ok(Math.abs(polylineLength(polylines[0]) - 60) < 1e-9);
  assert.ok(Math.abs(maskLength(skeleton, width, height) - 60) < 1e-9);

  // Y RDP no la toca: dos puntos, misma longitud.
  const simplified = simplifyPolyline(polylines[0], 1);
  assert.equal(simplified.length, 2);
  assert.ok(Math.abs(polylineLength(simplified) - 60) < 1e-9);
});

test("un anillo sale como un ciclo cerrado", () => {
  const size = 41;
  const center = 20;
  const mask = maskOf(size, size, (x, y) => {
    const radius = Math.hypot(x - center, y - center);
    return radius >= 8 && radius <= 11;
  });
  const skeleton = thin(mask, size, size);

  const polylines = traceSkeleton(skeleton, size, size);
  assert.equal(polylines.length, 1);

  const [ring] = polylines;
  // Cerrado: el primer punto se repite al final, como en `path-to-polyline.mjs`.
  assert.deepEqual(ring.at(0), ring.at(-1));

  // Radio medio 9,5 → circunferencia ≈ 59,7 px. Se admite el error de digitalizar un círculo.
  const circumference = polylineLength(ring);
  assert.ok(circumference > 45 && circumference < 75, `circunferencia ${circumference}`);

  const simplified = simplifyPolyline(ring, 1);
  assert.deepEqual(simplified.at(0), simplified.at(-1));
  assert.ok(simplified.length >= 3);
  assert.ok(simplified.length < ring.length, "RDP quita el escalón del píxel");
});

test("un cuadrado relleno no deja diagonales espurias", () => {
  // El adelgazado conserva la topología, no el eje medial: un bloque macizo se erosiona por los
  // cuatro lados a la vez y colapsa a un punto. La consecuencia buena es que no inventa la X de
  // diagonales que sí daría el eje medial (y que en un grabado serían dos rayas que no existen en el
  // dibujo); la consecuencia a recordar es que aquí no hay línea central que grabar, y por eso el
  // relleno se documenta como limitación.
  const size = 41;
  const mask = maskOf(size, size, (x, y) => x >= 5 && x <= 35 && y >= 5 && y <= 35);
  const skeleton = thin(mask, size, size);

  assert.ok(inkPixels(skeleton) <= 4, `el bloque deja ${inkPixels(skeleton)} píxeles`);

  // Ni una sola diagonal: la línea central del bloque mide ~0 frente a los ~124 px del contorno.
  assert.ok(maskLength(skeleton, size, size) <= 2, `longitud ${maskLength(skeleton, size, size)}`);

  // Y lo que sí se traza avanza píxel a píxel, sin saltos diagonales de dos en dos.
  for (const points of traceSkeleton(skeleton, size, size)) {
    for (let i = 1; i < points.length; i++) {
      const step = Math.max(
        Math.abs(points[i][0] - points[i - 1][0]),
        Math.abs(points[i][1] - points[i - 1][1]),
      );
      assert.equal(step, 1, "el trazo avanza píxel a píxel, sin saltos");
    }
  }
});

test("un cruce corta los trazos en el nodo", () => {
  // Dos barras gruesas en cruz: el centro es un nodo de grado 4, así que la traza se corta ahí y
  // salen cuatro brazos. Es la razón por la que un cruce se convierte en cuatro polilíneas.
  const width = 41;
  const height = 41;
  const mask = maskOf(
    width,
    height,
    (x, y) => (Math.abs(y - 20) <= 2 && x >= 4 && x <= 36) || (Math.abs(x - 20) <= 2 && y >= 4 && y <= 36),
  );
  const skeleton = thin(mask, width, height);

  const polylines = traceSkeleton(skeleton, width, height);
  assert.equal(polylines.length, 4);
  for (const points of polylines) {
    // Cada brazo empieza o acaba junto al centro del cruce.
    const nearCenter = [...points].some(
      ([x, y]) => Math.abs(x - 20) <= 1 && Math.abs(y - 20) <= 1,
    );
    assert.ok(nearCenter, "el corte cae en el nodo");
    assert.ok(polylineLength(points) > 10);
  }
});

// --- CLI: el archivo que se emite es la promesa del experimento ---

test("el CLI emite un SVG con stroke, sin fill, y su informe", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vekta-stroke-"));
  const input = path.join(root, "in");
  const output = path.join(root, "out");
  const json = path.join(root, "report.json");
  fs.mkdirSync(input);

  // Barra de 5 px de grosor: el caso que el informe tiene que reconocer como una sola polilínea.
  const width = 120;
  const height = 40;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ink = x >= 20 && x <= 99 && y >= 18 && y <= 22;
      const i = (y * width + x) * 4;
      const level = ink ? 40 : 246;
      rgba[i] = level;
      rgba[i + 1] = level;
      rgba[i + 2] = level;
      rgba[i + 3] = 255;
    }
  }
  fs.writeFileSync(path.join(input, "line.png"), encodePng({ width, height, rgba }));

  execFileSync(
    process.execPath,
    [cli, "--inputs", input, "--out", output, "--json", json, "--tolerance", "0.5"],
    { stdio: "pipe" },
  );

  const report = JSON.parse(fs.readFileSync(json, "utf8"));
  assert.equal(report.length, 1);

  const [entry] = report;
  assert.equal(entry.lineArt, true, entry.reason);
  assert.equal(entry.polylines, 1);
  assert.equal(entry.closedPolylines, 0);
  assert.equal(entry.nodes, 2);
  // Del extremo a extremo de la barra: 79 px, no los ~168 px de su contorno.
  assert.ok(Math.abs(entry.centerlineLength - 79) <= 1, `centro ${entry.centerlineLength}`);
  assert.ok(entry.contourPerimeter > 150, `contorno ${entry.contourPerimeter}`);
  assert.ok(entry.contourRatio > 1.8 && entry.contourRatio < 2.8, `ratio ${entry.contourRatio}`);

  const svg = fs.readFileSync(path.join(output, "line--centerline.svg"), "utf8");
  assert.match(svg, /stroke="#000000"/);
  assert.match(svg, /fill="none"/);
  assert.doesNotMatch(svg, /fill="(?!none)/);
  assert.match(svg, /d="M20 20 L99 20"/);

  fs.rmSync(root, { recursive: true, force: true });
});

// --- simplificación ---

test("RDP conserva las esquinas de una L y elimina los puntos colineales", () => {
  const l = [[0, 0], [4, 0], [8, 0], [12, 0], [12, 6], [12, 12]];
  assert.deepEqual(simplifyPolyline(l, 0.5), [[0, 0], [12, 0], [12, 12]]);

  // Con una tolerancia grande se van los puntos intermedios, pero el vértice de 90° se queda: es
  // lo único que no se puede aproximar sin cambiar la forma.
  assert.deepEqual(simplifyPolyline(l, 6), [[0, 0], [12, 0], [12, 12]]);

  // El escalón de píxel de una diagonal también es colineal a efectos de la tolerancia.
  const staircase = Array.from({ length: 6 }, (_, i) => [i, i]);
  assert.deepEqual(simplifyPolyline(staircase, 0.5), [[0, 0], [5, 5]]);

  // Los extremos no se tocan nunca.
  assert.deepEqual(simplifyPolyline([[0, 0], [10, 0]], 100), [[0, 0], [10, 0]]);
  assert.equal(simplifyPolyline([[3, 3]], 1).length, 1);
  assert.ok(Math.abs(polylineLength([[0, 0], [3, 4]]) - 5) < 1e-9);
});
