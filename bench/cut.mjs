#!/usr/bin/env node
// Informe de doble corte y emisión de SVG cortable.
//
//   npm run bench:cut                       # todos los SVG de bench/out/svg
//   node bench/cut.mjs --only gum-tree      # filtra por nombre
//   node bench/cut.mjs --limit 4            # primeras N entradas
//
// Emite dos archivos por entrada:
//   <nombre>--silhouette.svg  un path con la unión de todas las formas (recorte de pieza)
//   <nombre>--layers.svg      un path por color, ya unificado (vinilo, DTF)
// y comprueba que el perímetro de lo emitido coincide con lo medido antes de emitir.

import fs from "node:fs";
import path from "node:path";

import { svgShapes } from "./lib/svg-shapes.mjs";
import { analyzeShapes, cutStats, unionRings } from "./lib/union.mjs";
import { cutSvg, layerSvg, ringsBbox } from "./lib/cut-svg.mjs";

const options = parseArgs(process.argv.slice(2));
const files = listInputs(options.input, options.only).slice(0, options.limit ?? Infinity);

if (files.length === 0) {
  console.error(`No hay SVG en ${options.input}`);
  process.exit(1);
}

fs.mkdirSync(options.output, { recursive: true });

const report = [];
for (const file of files) {
  const started = Date.now();
  const svg = fs.readFileSync(file, "utf8");
  const shapes = svgShapes(svg);

  if (shapes.length === 0) {
    console.warn(`sin formas rellenas: ${file}`);
    continue;
  }

  const analysis = analyzeShapes(shapes);
  const stats = cutStats(shapes);

  const silhouetteRings = unionRings(analysis.allPolygons);
  const layers = [...analysis.polygonsByColor].map(([fill, polygons]) => ({
    fill,
    rings: unionRings(polygons),
  }));

  const stem = path.basename(file, ".svg");
  const bbox = ringsBbox(silhouetteRings);
  const silhouettePath = path.join(options.output, `${stem}--silhouette.svg`);
  const layersPath = path.join(options.output, `${stem}--layers.svg`);

  const silhouetteMarkup = cutSvg({ rings: silhouetteRings, bbox });
  const layersMarkup = layerSvg({ layers, bbox });

  fs.writeFileSync(silhouettePath, silhouetteMarkup);
  fs.writeFileSync(layersPath, layersMarkup);

  // Lo que importa no es lo que se quiso emitir, sino lo que el archivo emitido mide.
  const emittedSilhouette = cutStats(svgShapes(silhouetteMarkup)).outlineLength;
  const emittedLayers = cutStats(svgShapes(layersMarkup)).outlineLength;

  const entry = {
    file: path.relative(process.cwd(), file).replace(/\\/g, "/"),
    stem,
    colors: stats.colorCount,
    contours: stats.contourCount,
    holes: stats.holeCount,
    outlineLength: round(stats.outlineLength),
    layerLength: round(stats.layerLength),
    silhouetteLength: round(stats.silhouetteLength),
    uniqueCutLength: round(stats.uniqueCutLength),
    redundancy: round(stats.redundancy, 3),
    singlePassRedundancy: round(stats.singlePassRedundancy, 3),
    savings: {
      layer: round(1 - stats.layerLength / stats.outlineLength, 3),
      silhouette: round(1 - stats.silhouetteLength / stats.outlineLength, 3),
      singlePass: round(1 - stats.uniqueCutLength / stats.outlineLength, 3),
    },
    emitted: {
      silhouetteLength: round(emittedSilhouette),
      layerLength: round(emittedLayers),
      silhouetteError: round(deviation(emittedSilhouette, stats.silhouetteLength), 4),
      layerError: round(deviation(emittedLayers, stats.layerLength), 4),
      silhouetteFile: path.relative(process.cwd(), silhouettePath).replace(/\\/g, "/"),
      layersFile: path.relative(process.cwd(), layersPath).replace(/\\/g, "/"),
    },
    ms: Date.now() - started,
  };

  report.push(entry);
  printRow(entry);
}

fs.writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);

console.log(`\n${report.length} archivos → ${path.relative(process.cwd(), options.output)}`);
console.log(`informe → ${path.relative(process.cwd(), options.json)}`);

const worst = report.reduce(
  (acc, entry) =>
    Math.max(acc, entry.emitted.silhouetteError, entry.emitted.layerError),
  0,
);
console.log(`error máximo de lo emitido: ${(worst * 100).toFixed(2)} %`);

function printRow(entry) {
  const name = entry.stem.padEnd(44).slice(0, 44);
  const numbers = [
    `R ${format(entry.outlineLength)}`,
    `E ${format(entry.silhouetteLength)}`,
    `L ${format(entry.layerLength)}`,
    `U ${format(entry.uniqueCutLength)}`,
    `R/U ${entry.singlePassRedundancy.toFixed(2)}`,
    `ahorro E ${(entry.savings.silhouette * 100).toFixed(0)}%`,
  ];
  console.log(`${name} ${numbers.join("  ")}`);
}

function format(value) {
  return String(value).padStart(7);
}

function deviation(actual, expected) {
  return expected > 0 ? Math.abs(actual - expected) / expected : 0;
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function listInputs(directory, only) {
  return fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".svg"))
    .filter((name) => (only ? name.includes(only) : true))
    .sort()
    .map((name) => path.join(directory, name));
}

function parseArgs(args) {
  const parsed = {
    input: path.join("bench", "out", "svg"),
    output: path.join("bench", "out", "cut"),
    json: path.join("bench", "out", "cut-report.json"),
    only: null,
    limit: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--in":
        parsed.input = args[++i];
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
      case "--limit":
        parsed.limit = Number(args[++i]);
        break;
      case "--help":
        console.log(
          "uso: node bench/cut.mjs [--in dir] [--out dir] [--json file] [--only texto] [--limit n]",
        );
        process.exit(0);
        break;
      default:
        console.error(`opción desconocida: ${arg}`);
        process.exit(1);
    }
  }

  return parsed;
}
