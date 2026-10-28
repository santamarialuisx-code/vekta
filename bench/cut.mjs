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
//
// Para que el archivo sea de taller y no de demostración agrega, sin cambiar nada si no se piden:
//
//   --lead-mm 2 --lead-angle 45   entrada y salida de herramienta hacia el scrap
//   --nest --sheet 300x200 --gap-mm 5   coloca la pieza en la hoja e informa ocupación
//   --spot-names rojo,azul        una capa DXF por tinta, en orden de impresión

import fs from "node:fs";
import path from "node:path";

import { svgShapes } from "./lib/svg-shapes.mjs";
import { analyzeShapes, cutStats, ringsLength, unionRings } from "./lib/union.mjs";
import { pathToPolylines, polylineLength } from "./lib/path-to-polyline.mjs";
import { cutSvg, layerSvg, ringsBbox } from "./lib/cut-svg.mjs";
import { offsetRings } from "./lib/kerf.mjs";
import { layersToDxf, ringsToDxf } from "./lib/dxf.mjs";
import { ringsBox, scaleFromWidth, scaleRings } from "./lib/units.mjs";
import { addLead, isOpenPath } from "./lib/lead.mjs";
import { nest, placeRings } from "./lib/nest.mjs";
import { spotLayers } from "./lib/spot.mjs";

const options = parseArgs(process.argv.slice(2));
const files = listInputs(options.input, options.only).slice(0, options.limit ?? Infinity);

if (files.length === 0) {
  console.error(`No hay SVG en ${options.input}`);
  process.exit(1);
}

fs.mkdirSync(options.output, { recursive: true });

// Una trayectoria abierta no es un SVG relleno: con entrada de herramienta o con anidado la
// silueta se emite sólo en DXF, que es el archivo que lee la máquina.
const toolpath = options.leadMm > 0 || options.nest;
const silhouetteFormats = new Set(options.formats);
if (toolpath) {
  if (silhouetteFormats.delete("svg")) {
    console.warn(
      "con --lead-mm o --nest la silueta se emite sólo en DXF: una trayectoria abierta no es un SVG relleno",
    );
  }
  silhouetteFormats.add("dxf");
}

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

  // Entrada de herramienta: la trayectoria deja de ser cerrada. La geometría ya está en mm, así
  // que acá no hay escala que convertir.
  const leadedRings =
    options.leadMm > 0
      ? addLead(cutRings, { lengthMm: options.leadMm, angleDeg: options.leadAngle })
      : null;
  const toolpathRings = leadedRings ?? cutRings;
  const openPaths = leadedRings ? leadedRings.filter(isOpenPath).length : 0;

  // Anidado: una pieza por archivo de entrada.
  let nesting = null;
  let placedRings = toolpathRings;
  if (options.nest) {
    nesting = nest([toolpathRings], {
      sheetWidth: options.sheet.sheetWidth,
      sheetHeight: options.sheet.sheetHeight,
      gapMm: options.gapMm,
    });
    const [placement] = nesting.placements;
    if (placement) placedRings = placeRings(toolpathRings, placement);
  }

  // Separación de tintas: una capa con nombre por color, en orden de impresión.
  const spots = readSpots(shapes, options, scale);
  const outputLayers = spots
    ? spots.map((spot) => ({ fill: spot.color, rings: spot.rings }))
    : layersOut;

  const cutBox = ringsBox(cutRings);
  const cutLength = ringsLength(cutRings);
  const layerLength = ringsLength(outputLayers.flatMap((layer) => layer.rings));

  const silhouetteSvgPath = path.join(options.output, `${stem}--silhouette.svg`);
  const layersSvgPath = path.join(options.output, `${stem}--layers.svg`);
  const silhouetteMarkup = cutSvg({ rings: placedRings, bbox: ringsBox(placedRings), unit, precision });
  const layersMarkup = layerSvg({
    layers: outputLayers,
    bbox: ringsBox(silhouetteOut),
    unit,
    precision,
  });

  let silhouetteDxfPath = null;
  let layersDxfPath = null;
  if (silhouetteFormats.has("dxf")) {
    silhouetteDxfPath = path.join(options.output, `${stem}--silhouette.dxf`);
    // Con entrada de herramienta, cada anillo decide: el que tiene entrada va abierto y el que no
    // pudo tenerla sigue cerrado.
    fs.writeFileSync(
      silhouetteDxfPath,
      ringsToDxf(
        placedRings,
        leadedRings ? { closed: (ring) => !isOpenPath(ring) } : { closed: true },
      ),
    );
  }
  if (options.formats.includes("dxf")) {
    layersDxfPath = path.join(options.output, `${stem}--layers.dxf`);
    fs.writeFileSync(
      layersDxfPath,
      spots
        ? layersToDxf(spots.map((spot) => ({ name: spot.name, rings: spot.rings })))
        : ringsToDxf(outputLayers.flatMap((layer) => layer.rings)),
    );
  }

  if (silhouetteFormats.has("svg")) fs.writeFileSync(silhouetteSvgPath, silhouetteMarkup);
  if (options.formats.includes("svg")) fs.writeFileSync(layersSvgPath, layersMarkup);

  // Lo que importa no es lo que se quiso emitir, sino lo que el archivo emitido mide. Se mide el
  // `d` tal cual, sin volver a analizar formas: en mm, cualquier umbral en px² mentiría.
  const emittedSilhouette = silhouetteFormats.has("svg") ? markupLength(silhouetteMarkup) : cutLength;
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
      silhouetteFile: silhouetteFormats.has("svg") ? relative(silhouetteSvgPath) : null,
      layersFile: options.formats.includes("svg") ? relative(layersSvgPath) : null,
      silhouetteDxf: silhouetteDxfPath ? relative(silhouetteDxfPath) : null,
      layersDxf: layersDxfPath ? relative(layersDxfPath) : null,
    },
    ms: Date.now() - started,
  };

  if (leadedRings) {
    entry.lead = {
      lengthMm: options.leadMm,
      angleDeg: options.leadAngle,
      openPaths,
      closedPaths: leadedRings.length - openPaths,
    };
  }
  if (nesting) {
    const [placement] = nesting.placements;
    entry.nest = {
      ...nesting.report,
      fits: placement !== null,
      dx: placement ? placement.dx : null,
      dy: placement ? placement.dy : null,
      rotated: placement ? placement.rotated : null,
    };
  }
  if (spots) {
    entry.spots = spots.map((spot) => ({
      name: spot.name,
      color: spot.color,
      areaMm2: round(spot.area, 3),
      order: spot.order,
    }));
  }

  report.push(entry);
  printRow(entry);
  if (spots) {
    console.log(
      `             tintas: ${spots
        .map((spot) => `${spot.order}. ${spot.name} ${spot.color} ${round(spot.area, 2)} mm²`)
        .join("  ")}`,
    );
  }
  if (nesting) {
    const { report: sheet } = nesting;
    console.log(
      `             hoja ${sheet.sheetWidthMm}×${sheet.sheetHeightMm} mm  ` +
        `ocupación ${(sheet.occupancy * 100).toFixed(2)} %  ` +
        (sheet.placed > 0 ? `usado ${sheet.usedWidthMm}×${sheet.usedHeightMm} mm` : "no cabe"),
    );
  }
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

// Un nombre de más o de menos es un error de uso, no una excepción con traza: se informa y se
// corta el proceso.
function readSpots(shapes, options, scale) {
  if (options.spotNames.length === 0) return null;
  try {
    return spotLayers(shapes, { names: options.spotNames, scale: scale ?? 1 });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

function parseArgs(args) {  const parsed = {
    input: path.join("bench", "out", "svg"),
    output: path.join("bench", "out", "cut"),
    json: path.join("bench", "out", "cut-report.json"),
    only: null,
    limit: null,
    widthMm: null,
    kerfMm: 0,
    leadMm: 0,
    leadAngle: 0,
    nest: false,
    sheet: null,
    gapMm: 0,
    spotNames: [],
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
      case "--lead-mm":
        parsed.leadMm = Number(args[++i]);
        break;
      case "--lead-angle":
        parsed.leadAngle = Number(args[++i]);
        break;
      case "--nest":
        parsed.nest = true;
        break;
      case "--sheet":
        parsed.sheet = parseSheet(args[++i]);
        break;
      case "--gap-mm":
        parsed.gapMm = Number(args[++i]);
        break;
      case "--spot-names":
        parsed.spotNames = args[++i]
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean);
        break;
      case "--format":
        parsed.formats = args[++i].split(",").map((value) => value.trim());
        break;
      case "--help":
        console.log(
          "uso: node bench/cut.mjs [--in dir] [--out dir] [--json file] [--only texto] [--limit n] " +
            "[--width-mm n] [--kerf-mm n] [--format svg,dxf] [--lead-mm n] [--lead-angle 0-90] " +
            "[--nest] [--sheet ANCHOxALTO] [--gap-mm n] [--spot-names rojo,azul]",
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
  if (!(parsed.leadMm >= 0)) {
    console.error(`--lead-mm no puede ser negativo, recibí ${parsed.leadMm}`);
    process.exit(1);
  }
  if (!(parsed.leadAngle >= 0 && parsed.leadAngle <= 90)) {
    console.error(`--lead-angle debe estar entre 0 y 90 grados, recibí ${parsed.leadAngle}`);
    process.exit(1);
  }
  if (!(parsed.gapMm >= 0)) {
    console.error(`--gap-mm no puede ser negativo, recibí ${parsed.gapMm}`);
    process.exit(1);
  }
  if (parsed.nest && !parsed.sheet) {
    console.error("--nest requiere --sheet ANCHOxALTO, por ejemplo --sheet 300x200");
    process.exit(1);
  }
  // La entrada de herramienta y el anidado están en milímetros: sin ancho físico no hay mm.
  if ((parsed.leadMm > 0 || parsed.nest) && !(parsed.widthMm > 0)) {
    console.error("--lead-mm y --nest trabajan en milímetros: hace falta --width-mm");
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

function parseSheet(value) {
  const match = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/i.exec(String(value ?? ""));
  if (!match) {
    console.error(`--sheet debe ser ANCHOxALTO en mm, recibí ${value}`);
    process.exit(1);
  }
  const [, width, height] = match.map(Number);
  if (!(width > 0 && height > 0)) {
    console.error(`--sheet debe tener medidas positivas, recibí ${value}`);
    process.exit(1);
  }
  return { sheetWidth: width, sheetHeight: height };
}
