#!/usr/bin/env node
// Informe de doble corte y emisión de geometría cortable.
//
//   npm run bench:cut                                  # px, SVG
//   node bench/cut.mjs --width-mm 100 --kerf-mm 0.2 --format svg,dxf
//
// Emite dos archivos por entrada y formato:
//   <nombre>--silhouette  un path con la unión de todas las formas (recorte de pieza)
//   <nombre>--layers      un path por color, ya unificado (vinilo, DTF)
// y comprueba que el perímetro de lo emitido coincide con lo medido antes de emitir.

import fs from "node:fs";
import path from "node:path";

import { svgShapes } from "./lib/svg-shapes.mjs";
import { analyzeShapes, cutStats, ringsLength, unionRings } from "./lib/union.mjs";
import { pathToPolylines, polylineLength } from "./lib/path-to-polyline.mjs";
import { cutSvg, layerSvg, ringsBbox } from "./lib/cut-svg.mjs";
import { offsetRings } from "./lib/kerf.mjs";
import { ringsToDxf } from "./lib/dxf.mjs";
import { ringsBox, scaleFromWidth, scaleRings } from "./lib/units.mjs";

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
  const pxBox = ringsBbox(silhouetteRings);

  // Unidades físicas: la escala sale del ancho real que pide el usuario.
  const scale = options.widthMm ? scaleFromWidth(pxBox.width, options.widthMm) : null;
  const unit = scale ? "mm" : null;
  const precision = scale ? 3 : 2;

  const silhouetteOut = scale ? scaleRings(silhouetteRings, scale) : silhouetteRings;
  const layersOut = scale
    ? layers.map((layer) => ({ fill: layer.fill, rings: scaleRings(layer.rings, scale) }))
    : layers;

  // Kerf: la trayectoria se compensa por el radio de la herramienta.
  const radius = options.kerfMm / 2;
  const cutRings = radius > 0 ? offsetRings(silhouetteOut, radius) : silhouetteOut;

  const cutBox = ringsBox(cutRings);
  const cutLength = ringsLength(cutRings);
  const layerLength = ringsLength(layersOut.flatMap((layer) => layer.rings));

  const silhouetteSvgPath = path.join(options.output, `${stem}--silhouette.svg`);
  const layersSvgPath = path.join(options.output, `${stem}--layers.svg`);
  const silhouetteMarkup = cutSvg({ rings: cutRings, bbox: cutBox, unit, precision });
  const layersMarkup = layerSvg({
    layers: layersOut,
    bbox: ringsBox(silhouetteOut),
    unit,
    precision,
  });

  let silhouetteDxfPath = null;
  let layersDxfPath = null;
  if (options.formats.includes("dxf")) {
    silhouetteDxfPath = path.join(options.output, `${stem}--silhouette.dxf`);
    layersDxfPath = path.join(options.output, `${stem}--layers.dxf`);
    fs.writeFileSync(silhouetteDxfPath, ringsToDxf(cutRings));
    fs.writeFileSync(layersDxfPath, ringsToDxf(layersOut.flatMap((layer) => layer.rings)));
  }

  if (options.formats.includes("svg")) {
    fs.writeFileSync(silhouetteSvgPath, silhouetteMarkup);
    fs.writeFileSync(layersSvgPath, layersMarkup);
  }

  // Lo que importa no es lo que se quiso emitir, sino lo que el archivo emitido mide. Se mide el
  // `d` tal cual, sin volver a analizar formas: en mm, cualquier umbral en px² mentiría.
  const emittedSilhouette = options.formats.includes("svg") ? markupLength(silhouetteMarkup) : cutLength;
  const emittedLayers = options.formats.includes("svg") ? markupLength(layersMarkup) : layerLength;

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
    physical: scale
      ? {
          scale: round(scale, 6),
          widthMm: round(cutBox.width, 3),
          heightMm: round(cutBox.height, 3),
          kerfMm: options.kerfMm,
          cutLengthMm: round(cutLength, 3),
          layerLengthMm: round(layerLength, 3),
          nominalWidthMm: round(ringsBox(silhouetteOut).width, 3),
        }
      : null,
    emitted: {
      silhouetteLength: round(emittedSilhouette),
      layerLength: round(emittedLayers),
      silhouetteError: round(deviation(emittedSilhouette, cutLength), 4),
      layerError: round(deviation(emittedLayers, layerLength), 4),
      silhouetteFile: options.formats.includes("svg") ? relative(silhouetteSvgPath) : null,
      layersFile: options.formats.includes("svg") ? relative(layersSvgPath) : null,
      silhouetteDxf: silhouetteDxfPath ? relative(silhouetteDxfPath) : null,
      layersDxf: layersDxfPath ? relative(layersDxfPath) : null,
    },
    ms: Date.now() - started,
  };

  report.push(entry);
  printRow(entry);
}

fs.writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);

console.log(`\n${report.length} archivos → ${relative(options.output)}`);
console.log(`informe → ${relative(options.json)}`);

const worst = report.reduce(
  (acc, entry) => Math.max(acc, entry.emitted.silhouetteError, entry.emitted.layerError),
  0,
);
console.log(`error máximo de lo emitido: ${(worst * 100).toFixed(2)} %`);

function printRow(entry) {
  const name = entry.stem.padEnd(44).slice(0, 44);
  const numbers = [
    `R ${format(entry.outlineLength)}`,
    `E ${format(entry.silhouetteLength)}`,
    `L ${format(entry.layerLength)}`,
    `R/U ${entry.singlePassRedundancy.toFixed(2)}`,
  ];
  if (entry.physical) {
    numbers.push(
      `${format(entry.physical.nominalWidthMm)}×${format(entry.physical.heightMm)} mm`,
      `kerf ${entry.physical.kerfMm} mm`,
    );
  }
  console.log(`${name} ${numbers.join("  ")}`);
}

/** Suma de longitudes de todos los `d` de un SVG emitido, en sus propias unidades. */
function markupLength(markup) {
  let total = 0;
  for (const match of markup.matchAll(/\sd="([^"]*)"/g)) {
    for (const line of pathToPolylines(match[1], { tolerance: 0.01 })) {
      total += polylineLength(line.points);
    }
  }
  return total;
}

function format(value) {
  return String(value).padStart(7);
}

function relative(file) {
  return path.relative(process.cwd(), file).replace(/\\/g, "/");
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
    widthMm: null,
    kerfMm: 0,
    formats: ["svg"],
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
      case "--width-mm":
        parsed.widthMm = Number(args[++i]);
        break;
      case "--kerf-mm":
        parsed.kerfMm = Number(args[++i]);
        break;
      case "--format":
        parsed.formats = args[++i].split(",").map((value) => value.trim());
        break;
      case "--help":
        console.log(
          "uso: node bench/cut.mjs [--in dir] [--out dir] [--json file] [--only texto] [--limit n] " +
            "[--width-mm n] [--kerf-mm n] [--format svg,dxf]",
        );
        process.exit(0);
        break;
      default:
        console.error(`opción desconocida: ${arg}`);
        process.exit(1);
    }
  }

  if (parsed.widthMm !== null && !(parsed.widthMm > 0)) {
    console.error(`--width-mm debe ser positivo, recibí ${parsed.widthMm}`);
    process.exit(1);
  }
  if (!(parsed.kerfMm >= 0)) {
    console.error(`--kerf-mm no puede ser negativo, recibí ${parsed.kerfMm}`);
    process.exit(1);
  }
  for (const format of parsed.formats) {
    if (!["svg", "dxf"].includes(format)) {
      console.error(`formato desconocido: ${format}`);
      process.exit(1);
    }
  }

  return parsed;
}
