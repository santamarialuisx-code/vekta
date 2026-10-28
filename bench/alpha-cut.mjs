#!/usr/bin/env node
// Corte de pieza desde el alfa de un PNG.
//
//   node bench/alpha-cut.mjs --in bench/inputs/alpha-donut.png
//   node bench/alpha-cut.mjs --in pieza.png --width-mm 100 --kerf-mm 0.2
//   node bench/alpha-cut.mjs --in pieza.png --out bench/out/alfa --json bench/out/alfa.json
//
// La decisión importante: con fondo transparente la silueta **no** es el rectángulo del lienzo.
// El experimento 02 midió el corte de pieza sobre cuatro imágenes que cubren el lienzo entero, así
// que su `E` era el perímetro del rectángulo y el número no significaba nada. Aquí la silueta es
// la frontera del sujeto que el diseñador dibujó en el alfa: eso, y sólo eso, es lo que un taller
// recorta.
//
// El camino es el del motor, sin inventar geometría:
//
//   alfa → máscara 0/1 → imagen de gris 0/255 → vtracer `bw` → unión → SVG + DXF
//
// y el informe publica área y perímetro **medidos sobre el archivo emitido**, no sobre la
// intención. Si lo emitido no mide lo medido, el error se ve en el JSON.

import fs from "node:fs";
import path from "node:path";

import vtracer from "@visioncortex/vtracer";

import { ALPHA_RULES, ALPHA_TRACE_OPTIONS, alphaHasTransparency, alphaMask, alphaStats, maskToLuminance } from "./lib/alpha.mjs";
import { decodeImage } from "./lib/image-io.mjs";
import { svgShapes } from "./lib/svg-shapes.mjs";
import { analyzeShapes, cutStats, ringsLength, unionRings } from "./lib/union.mjs";
import { pathToPolylines } from "./lib/path-to-polyline.mjs";
import { cutSvg, ringsBbox } from "./lib/cut-svg.mjs";
import { offsetRings } from "./lib/kerf.mjs";
import { ringsToDxf } from "./lib/dxf.mjs";
import { ringsBox, scaleFromWidth, scaleRings } from "./lib/units.mjs";

const options = parseArgs(process.argv.slice(2));

if (!options.input) {
  console.error("falta --in: hace falta una imagen con fondo transparente (PNG o JPEG)");
  process.exit(1);
}
if (options.kerfMm > 0 && options.widthMm === null) {
  console.error("--kerf-mm necesita --width-mm: sin escala física el ancho de corte no significa nada");
  process.exit(1);
}

const started = Date.now();

let image;
try {
  image = decodeImage(fs.readFileSync(options.input));
} catch (error) {
  console.error(`no se pudo leer ${options.input}: ${error.message}`);
  process.exit(1);
}

const stats = alphaStats(image.rgba);
if (!alphaHasTransparency(image.rgba)) {
  console.error(
    "el alfa no aporta silueta: " +
      `${percent(stats.opaqueShare)} % de los píxeles son opacos ` +
      `(máximo ${percent(ALPHA_RULES.maxOpaqueShare)} %). ` +
      "Sin fondo transparente la silueta sería el rectángulo del lienzo y no hay pieza que recortar",
  );
  process.exit(1);
}

const mask = alphaMask(image.rgba, image.width, image.height);
const subjectPixels = countOnes(mask);
if (subjectPixels === 0) {
  console.error(`la máscara está vacía: ningún píxel llega al alfa ${ALPHA_RULES.minAlpha}`);
  process.exit(1);
}
if (subjectPixels === mask.length) {
  console.error("la máscara cubre el lienzo entero: no hay borde de sujeto que recortar");
  process.exit(1);
}

// La máscara entra al motor como imagen de gris con dos niveles: sujeto negro (tinta), fondo blanco.
const luminance = maskToLuminance(mask, image.width, image.height);

let svg;
try {
  svg = vtracer.convertPixels(luminance.rgba, luminance.width, luminance.height, ALPHA_TRACE_OPTIONS);
} catch (error) {
  console.error(`el trazador falló: ${error.message}`);
  process.exit(1);
}

const shapes = svgShapes(svg);
if (shapes.length === 0) {
  console.error("el trazador no devolvió formas rellenas: no hay silueta que emitir");
  process.exit(1);
}

// Unión de todo el trazado: la silueta es un solo recorrido, con los agujeros restados.
const analysis = analyzeShapes(shapes);
const strokeCounts = cutStats(shapes);
const silhouetteRings = unionRings(analysis.allPolygons);
if (silhouetteRings.length === 0) {
  console.error("la silueta quedó vacía después de unir el trazado");
  process.exit(1);
}

const pxBox = ringsBbox(silhouetteRings);
const pxArea = ringsArea(silhouetteRings);
const pxPerimeter = ringsLength(silhouetteRings);

// Unidades físicas: la escala sale del ancho real que pide el usuario.
const scale = options.widthMm ? scaleFromWidth(pxBox.width, options.widthMm) : null;
const unit = scale ? "mm" : null;
const precision = scale ? 3 : 2;
const silhouetteOut = scale ? scaleRings(silhouetteRings, scale) : silhouetteRings;

// Kerf: la trayectoria se compensa por el radio de la herramienta.
const radius = options.kerfMm / 2;
const cutRings = radius > 0 ? offsetRings(silhouetteOut, radius) : silhouetteOut;

const cutBox = ringsBox(cutRings);
const cutArea = ringsArea(cutRings);
const cutLength = ringsLength(cutRings);
const markup = cutSvg({ rings: cutRings, bbox: cutBox, unit, precision });

const stem = path.basename(options.input).replace(/\.[^.]+$/, "");
fs.mkdirSync(options.output, { recursive: true });
const svgPath = path.join(options.output, `${stem}--silhouette.svg`);
const dxfPath = path.join(options.output, `${stem}--silhouette.dxf`);
fs.writeFileSync(svgPath, markup);
fs.writeFileSync(dxfPath, ringsToDxf(cutRings));

// Lo que importa no es lo que se quiso emitir, sino lo que el archivo emitido mide: se vuelve a
// leer el `d` escrito, sin volver a pasar por la geometría.
const emitted = measureMarkup(markup);

const entry = {
  file: relative(options.input),
  stem,
  image: { width: image.width, height: image.height },
  alpha: {
    useful: true,
    opaqueShare: round(stats.opaqueShare, 4),
    transparentShare: round(stats.transparentShare, 4),
    partialShare: round(stats.partialShare, 4),
    maxOpaqueShare: ALPHA_RULES.maxOpaqueShare,
  },
  mask: {
    subjectPixels,
    subjectShare: round(subjectPixels / mask.length, 4),
    minAlpha: ALPHA_RULES.minAlpha,
    tolerance: ALPHA_RULES.tolerance,
  },
  geometry: {
    rings: silhouetteRings.length,
    contours: strokeCounts.contourCount,
    holes: strokeCounts.holeCount,
  },
  px: {
    width: round(pxBox.width, 2),
    height: round(pxBox.height, 2),
    area: round(pxArea, 1),
    perimeter: round(pxPerimeter, 1),
  },
  physical: scale
    ? {
        scale: round(scale, 6),
        nominalWidthMm: options.widthMm,
        widthMm: round(cutBox.width, 3),
        heightMm: round(cutBox.height, 3),
        kerfMm: options.kerfMm,
        areaMm2: round(cutArea, 3),
        perimeterMm: round(cutLength, 3),
      }
    : null,
  emitted: {
    unit: unit ?? "px",
    area: round(emitted.area, 3),
    perimeter: round(emitted.perimeter, 3),
    areaError: round(deviation(emitted.area, cutArea), 4),
    perimeterError: round(deviation(emitted.perimeter, cutLength), 4),
    svg: relative(svgPath),
    dxf: relative(dxfPath),
  },
  ms: Date.now() - started,
};

fs.mkdirSync(path.dirname(options.json), { recursive: true });
fs.writeFileSync(options.json, `${JSON.stringify([entry], null, 2)}\n`);

printRow(entry);
console.log(`\nsilueta → ${entry.emitted.svg}`);
console.log(`DXF     → ${entry.emitted.dxf}`);
console.log(`informe → ${relative(options.json)}`);
console.log(`error de lo emitido: ${percent(entry.emitted.perimeterError)} % perímetro, ${percent(entry.emitted.areaError)} % área`);

function printRow(row) {
  const name = row.stem.padEnd(30).slice(0, 30);
  const numbers = [
    `P ${format(row.emitted.perimeter)} ${row.emitted.unit}`,
    `A ${format(row.emitted.area)} ${row.emitted.unit}²`,
    `${row.geometry.rings} anillos (${row.geometry.holes} con agujero)`,
  ];
  if (row.physical) {
    numbers.push(
      `${format(row.physical.widthMm)}×${format(row.physical.heightMm)} mm`,
      `kerf ${row.physical.kerfMm} mm`,
    );
  }
  console.log(`${name} ${numbers.join("  ")}`);
}

/** Área y perímetro de un SVG emitido, leídos de sus `d`. */
function measureMarkup(source) {
  let area = 0;
  let perimeter = 0;
  for (const match of source.matchAll(/\sd="([^"]*)"/g)) {
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
  // Los agujeros vienen con el giro invertido (si no, no restarían con ninguna regla de relleno),
  // así que la suma con signo ya descuenta su área.
  return { area: Math.abs(area), perimeter };
}

/** Área de un conjunto de anillos, con los agujeros restados por el sentido de giro. */
function ringsArea(rings) {
  let area = 0;
  for (const ring of rings) area += signedArea(ring);
  return Math.abs(area);
}

function signedArea(points) {
  let area = 0;
  for (let i = 0; i < points.length - 1; i++) {
    area += points[i][0] * points[i + 1][1] - points[i + 1][0] * points[i][1];
  }
  return area / 2;
}

function countOnes(mask) {
  let total = 0;
  for (const value of mask) total += value ? 1 : 0;
  return total;
}

function format(value) {
  return String(value).padStart(9);
}

function relative(file) {
  return path.relative(process.cwd(), file).replace(/\\/g, "/");
}

function deviation(actual, expected) {
  return expected > 0 ? Math.abs(actual - expected) / expected : 0;
}

function percent(value) {
  return (value * 100).toFixed(1).replace(".", ",");
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseArgs(args) {
  const parsed = {
    input: null,
    output: path.join("bench", "out", "alpha"),
    json: path.join("bench", "out", "alpha-report.json"),
    widthMm: null,
    kerfMm: 0,
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
      case "--width-mm":
        parsed.widthMm = Number(args[++i]);
        break;
      case "--kerf-mm":
        parsed.kerfMm = Number(args[++i]);
        break;
      case "--help":
        console.log(
          "uso: node bench/alpha-cut.mjs --in imagen.png [--out dir] [--json file] " +
            "[--width-mm n] [--kerf-mm n]",
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

  return parsed;
}
