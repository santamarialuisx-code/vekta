#!/usr/bin/env node
// Clasificar imágenes sin trazar.
//
//   node bench/classify.mjs                    # las 4 imágenes del banco
//   node bench/classify.mjs --only K1          # una sola
//   node bench/classify.mjs --inputs lote/     # una carpeta propia
//
// Imprime la tabla de decisión: imagen, categoría, señales, preset efectivo y motivo. No escribe
// SVG: sirve para ver por qué una imagen cae en su categoría antes de gastar tiempo (y nodos) en el
// trazado. La regla vive en `lib/category.mjs`; este fichero solo la presenta.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { classifyImage, imageSignals, tracePreset } from "./lib/category.mjs";
import { decodeImage } from "./lib/image-io.mjs";
import { INPUTS, slug } from "./lib/variants.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const options = parseArgs(process.argv.slice(2));

// Misma convención que `auto-trace.mjs`: `--inputs` manda sobre el banco y `--only` filtra por
// nombre de fichero.
const inputs = options.inputs
  ? fs
      .readdirSync(options.inputs)
      .filter((file) => /\.(png|jpe?g|gif|bmp)$/i.test(file))
      .sort()
      .map((file) => ({ file, source: path.join(options.inputs, file) }))
  : INPUTS.filter((input) => !options.only || input.file.includes(options.only));

if (inputs.length === 0) {
  console.error(options.inputs ? `no hay imágenes en ${options.inputs}` : `ninguna imagen coincide con ${options.only}`);
  process.exit(1);
}

const rows = inputs.map((input) => {
  const image = decodeImage(fs.readFileSync(input.source ?? path.join(here, "inputs", input.file)));
  const signals = imageSignals(image.rgba, image.width, image.height);
  const verdict = classifyImage(signals);
  const preset = tracePreset(verdict.category, signals);

  return {
    image: input.file,
    imgSlug: slug(input.file),
    category: verdict.category,
    reason: verdict.reason,
    preset: presetLabel(preset),
    signals,
  };
});

printTable(rows);

function printTable(entries) {
  const width = {
    image: Math.max(6, ...entries.map((entry) => entry.imgSlug.length)),
    category: Math.max(9, ...entries.map((entry) => entry.category.length)),
    colors: Math.max(7, ...entries.map((entry) => String(entry.signals.distinctColors).length)),
    entropy: Math.max(8, ...entries.map((entry) => percent(entry.signals.luminanceEntropy).length)),
    edges: Math.max(5, ...entries.map((entry) => percent(entry.signals.edgeDensity).length)),
    chroma: Math.max(5, ...entries.map((entry) => percent(entry.signals.meanChroma).length)),
    neutral: Math.max(6, ...entries.map((entry) => percent(entry.signals.neutralShare).length)),
    ink: Math.max(5, ...entries.map((entry) => percent(entry.signals.inkShare).length)),
    preset: Math.max(6, ...entries.map((entry) => entry.preset.length)),
  };

  const header = [
    "imagen".padEnd(width.image),
    "categoría".padEnd(width.category),
    "colores".padStart(width.colors),
    "entropía".padStart(width.entropy),
    "borde".padStart(width.edges),
    "croma".padStart(width.chroma),
    "neutro".padStart(width.neutral),
    "tinta".padStart(width.ink),
    "preset".padEnd(width.preset),
    "motivo",
  ].join("  ");
  console.log(header);

  for (const entry of entries) {
    const s = entry.signals;
    console.log(
      [
        entry.imgSlug.padEnd(width.image),
        entry.category.padEnd(width.category),
        String(s.distinctColors).padStart(width.colors),
        percent(s.luminanceEntropy).padStart(width.entropy),
        percent(s.edgeDensity).padStart(width.edges),
        percent(s.meanChroma).padStart(width.chroma),
        percent(s.neutralShare).padStart(width.neutral),
        percent(s.inkShare).padStart(width.ink),
        entry.preset.padEnd(width.preset),
        entry.reason,
      ].join("  "),
    );
  }
}

function presetLabel(preset) {
  if (preset.clustering === "bw") return `bw / ${decimal(preset.simplify)}`;
  return `${preset.colors} col / ${decimal(preset.simplify)}`;
}

function percent(value) {
  return `${(value * 100).toFixed(0)} %`;
}

function decimal(value) {
  return value.toFixed(1).replace(".", ",");
}

function parseArgs(args) {
  const parsed = {
    only: null,
    inputs: null,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--only":
        parsed.only = args[++i];
        break;
      case "--inputs":
        parsed.inputs = args[++i];
        break;
      case "--help":
        console.log("uso: node bench/classify.mjs [--only texto] [--inputs dir]");
        process.exit(0);
        break;
      default:
        console.error(`opción desconocida: ${args[i]}`);
        process.exit(1);
    }
  }

  return parsed;
}
