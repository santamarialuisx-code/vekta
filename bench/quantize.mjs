#!/usr/bin/env node
// Cuantización perceptiva de las imágenes de entrada.
//
//   npm run bench:quantize                 # 16 colores, las 4 imágenes del banco
//   node bench/quantize.mjs --colors 24
//   node bench/quantize.mjs --only Gum
//
// Escribe un PNG por imagen en bench/out/quantized/ y un informe con el ΔE medio y p95 contra la
// imagen original. Es la etapa previa al trazado: aquí se decide qué colores existen.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { decodeImage, encodePng } from "./lib/image-io.mjs";
import { quantize, renderQuantized } from "./lib/quantize.mjs";
import { INPUTS, slug } from "./lib/variants.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const options = parseArgs(process.argv.slice(2));

const inputs = INPUTS.filter((input) => !options.only || input.file.includes(options.only));
if (inputs.length === 0) {
  console.error(`ninguna imagen coincide con ${options.only}`);
  process.exit(1);
}

fs.mkdirSync(options.output, { recursive: true });

const report = [];
for (const input of inputs) {
  const started = Date.now();
  const source = path.join(here, "inputs", input.file);
  const image = decodeImage(fs.readFileSync(source));
  const result = quantize(image.rgba, image.width, image.height, { maxColors: options.colors });
  const rendered = renderQuantized(image.rgba, image.width, image.height, result);

  const name = `${slug(input.file)}__oklab-${options.colors}.png`;
  const target = path.join(options.output, name);
  fs.writeFileSync(target, encodePng({ width: image.width, height: image.height, rgba: rendered }));

  const entry = {
    file: input.file,
    label: input.label,
    png: path.relative(process.cwd(), target).replace(/\\/g, "/"),
    width: image.width,
    height: image.height,
    colors: result.palette.length,
    requestedColors: options.colors,
    sourceColors: result.sourceColors,
    visiblePixels: result.visiblePixels,
    droppedClusters: result.droppedClusters,
    iterations: result.iterations,
    meanDeltaE: round(result.meanDeltaE, 4),
    p95DeltaE: round(result.p95DeltaE, 4),
    palette: result.paletteHex,
    ms: Date.now() - started,
  };

  report.push(entry);
  console.log(
    [
      slug(input.file).padEnd(34),
      `${String(entry.colors).padStart(2)} colores`,
      `de ${format(entry.sourceColors)} distintos`,
      `ΔE medio ${entry.meanDeltaE.toFixed(3)}`,
      `p95 ${entry.p95DeltaE.toFixed(3)}`,
      `${entry.ms} ms`,
    ].join("  "),
  );
}

fs.writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\n${report.length} imágenes → ${path.relative(process.cwd(), options.output)}`);
console.log(`informe → ${path.relative(process.cwd(), options.json)}`);

function format(value) {
  return value.toLocaleString("es-ES");
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseArgs(args) {
  const parsed = {
    colors: 16,
    output: path.join("bench", "out", "quantized"),
    json: path.join("bench", "out", "quantize-report.json"),
    only: null,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--colors":
        parsed.colors = Number(args[++i]);
        break;
      case "--out":
        parsed.output = args[++i];
        break;
      case "--json":
        parsed.json = args[++i];
        break;
      case "--only":
        parsed.only = args[++i];
        break;
      case "--help":
        console.log("uso: node bench/quantize.mjs [--colors n] [--only texto] [--out dir] [--json file]");
        process.exit(0);
        break;
      default:
        console.error(`opción desconocida: ${args[i]}`);
        process.exit(1);
    }
  }

  return parsed;
}
