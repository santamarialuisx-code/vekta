#!/usr/bin/env node
// Línea central del trazo para grabado y plotter de pluma.
//
//   node bench/stroke.mjs                        # todas las imágenes de line art del banco
//   node bench/stroke.mjs --only K1              # una sola
//   node bench/stroke.mjs --tolerance 0.5 --out bench/out/stroke
//
// Un trazador de contornos entrega la frontera de la tinta: dos curvas por trazo. Un grabador y un
// plotter necesitan la cresta, no el borde. Esto toma el mismo line art que el preset del experimento
// 07 (misma máscara, mismo umbral de Otsu) y emite, por imagen:
//
//   <slug>--centerline.svg   un `path` con `stroke` y sin `fill` (una polilínea por subpath)
//
// y un informe con polilíneas, nodos, longitud de la línea central y el perímetro del contorno del
// mismo trazado, que es la cifra contra la que hay que comparar: en un trazo fino el contorno mide
// aproximadamente el doble que su línea central, porque pasa dos veces por el mismo sitio.
//
// El perímetro de contorno no se estima a ojo: se traza la misma imagen con el modo binario del motor
// y se mide su `d` con `svg-shapes.mjs` + `path-to-polyline.mjs`, las mismas piezas con las que el
// experimento 02 mide perímetros de corte.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { decodeImage } from "./lib/image-io.mjs";
import { LINE_ART_SCALE, lineArtOptions, lineArtSignals, looksLikeLineArt } from "./lib/lineart.mjs";
import { pathToPolylines, polylineLength } from "./lib/path-to-polyline.mjs";
import { inkMask, simplifyPolyline, thin, traceSkeleton } from "./lib/skeleton.mjs";
import { subpixelOptions } from "./lib/subpixel.mjs";
import { svgMetrics } from "./lib/svg-metrics.mjs";
import { svgShapes } from "./lib/svg-shapes.mjs";
import { INPUTS, slug } from "./lib/variants.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const options = parseArgs(process.argv.slice(2));

/** Grosor con el que se dibuja la línea central. Una sola pasada de pluma: 1 px. */
const STROKE_WIDTH = 1;

// Con `--inputs` la carpeta la pone quien llama: es lo que usa la prueba de integración y lo que
// sirve para barrer un lote propio. Igual que en `auto-trace.mjs`.
const inputs = options.inputs
  ? fs
      .readdirSync(options.inputs)
      .filter((file) => /\.(png|jpe?g|gif|bmp)$/i.test(file))
      .sort()
      .map((file) => ({ file, category: "lote", source: path.join(options.inputs, file) }))
  : INPUTS.filter((input) => !options.only || input.file.includes(options.only));

if (inputs.length === 0) {
  console.error(options.inputs ? `no hay imágenes en ${options.inputs}` : `ninguna imagen coincide con ${options.only}`);
  process.exit(1);
}

fs.mkdirSync(options.output, { recursive: true });
const outName = path.basename(options.output);
const report = [];

for (const input of inputs) {
  // El cronómetro abarca todo lo que cuesta la imagen, señales de line art incluidas: es la cifra que
  // se compara con el contorno del motor, que también se traza desde cero.
  const started = Date.now();
  const image = decodeImage(fs.readFileSync(input.source ?? path.join(here, "inputs", input.file)));
  const imgSlug = slug(input.file);
  const signals = lineArtSignals(image.rgba, image.width, image.height);
  const verdict = looksLikeLineArt(signals);

  // Adelgazar una foto no da una línea central: da una maraña de crestas de tono. Solo se procesa lo
  // que el banco ya reconoce como line art, y lo demás se deja escrito en el informe.
  if (!verdict.lineArt) {
    console.warn(`${imgSlug}: no es line art (${verdict.reason}), se omite`);
    report.push({
      image: input.file,
      imgSlug,
      category: input.category,
      lineArt: false,
      reason: verdict.reason,
      skipped: true,
    });
    continue;
  }

  const tracedOptions = lineArtOptions(signals);

  const mask = inkMask(signals.gray, image.width, image.height, tracedOptions.binaryThreshold);
  const skeleton = thin(mask, image.width, image.height);
  const raw = traceSkeleton(skeleton, image.width, image.height);
  // RDP convierte la escalera de píxel en segmentos: sin esto un trazo diagonal en 45° llega al SVG
  // con un nodo por píxel.
  const polylines = raw.map((points) => simplifyPolyline(points, options.tolerance));

  const centerlineLength = polylines.reduce((total, points) => total + polylineLength(points), 0);
  const closed = polylines.filter((points) => points.length > 2 && samePoint(points[0], points.at(-1)));
  // Trazos de menos de 3 px: casi todos son espuelas del adelgazado en los remates. Se cuentan
  // porque son la diferencia entre «un dibujo» y «un dibujo más miles de motas» para el plotter.
  const shortPolylines = polylines.filter((points) => polylineLength(points) < 3).length;

  const markup = centerlineSvg({ width: image.width, height: image.height, polylines });
  const name = `${imgSlug}--centerline.svg`;
  fs.writeFileSync(path.join(options.output, name), markup);
  const metrics = svgMetrics(markup);

  const ms = Date.now() - started;

  // Misma imagen, mismo umbral, contorno del motor: la vara contra la que se compara la línea central.
  const contourStarted = Date.now();
  const contour = contourPerimeter(signals);
  const contourMs = Date.now() - contourStarted;

  const entry = {
    image: input.file,
    imgSlug,
    category: input.category,
    lineArt: true,
    threshold: tracedOptions.binaryThreshold,
    inkPixels: countInk(mask),
    skeletonPixels: countInk(skeleton),
    polylines: polylines.length,
    closedPolylines: closed.length,
    shortPolylines,
    simplifiedPoints: polylines.reduce((total, points) => total + points.length, 0),
    rawPoints: raw.reduce((total, points) => total + points.length, 0),
    nodes: metrics.nodes,
    centerlineLength: round(centerlineLength, 2),
    contourPerimeter: contour.perimeter === null ? null : round(contour.perimeter, 2),
    // Cuántas veces hay que recorrer el contorno para igualar la línea central: ~2 en un trazo fino.
    // Sin tinta no hay longitud que comparar, y un `Infinity` en el informe no es una medición.
    contourRatio:
      contour.perimeter === null || centerlineLength === 0
        ? null
        : round(contour.perimeter / centerlineLength, 3),
    contourError: contour.error,
    tolerance: options.tolerance,
    strokeWidth: STROKE_WIDTH,
    svg: `${outName}/${name}`,
    ms,
    contourMs,
  };

  report.push(entry);
  printRow(entry);
}

fs.writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);

const measured = report.filter((entry) => entry.lineArt);
console.log(`\n${measured.length} líneas centrales en ${path.relative(process.cwd(), options.output)}`);
console.log(`informe → ${path.relative(process.cwd(), options.json)}`);

if (measured.length > 0) {
  const centerlineLength = measured.reduce((total, entry) => total + entry.centerlineLength, 0);
  const contourPerimeter = measured.reduce((total, entry) => total + (entry.contourPerimeter ?? 0), 0);
  console.log(
    `longitud de línea central ${format(centerlineLength)} px · ` +
      `contorno ${format(contourPerimeter)} px · ` +
      `ratio ${centerlineLength > 0 ? (contourPerimeter / centerlineLength).toFixed(2) : "—"}`,
  );
}

/**
 * SVG de la línea central: `stroke` y ningún `fill`.
 *
 * El `fill` es lo que convierte el archivo en un contorno relleno; si aparece, el grabador vuelve a
 * tener dos bordes por trazo. Todas las polilíneas van en un solo `path`, una por subpath (`M`), que
 * es como lo leen tanto un plotter como un CAM.
 */
function centerlineSvg({ width, height, polylines }) {
  const d = polylines
    .filter((points) => points.length >= 2)
    .map((points) =>
      points
        .map(([x, y], index) => `${index === 0 ? "M" : "L"}${round(x, 2)} ${round(y, 2)}`)
        .join(" "),
    )
    .join(" ");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<path d="${d}" fill="none" stroke="#000000" stroke-width="${STROKE_WIDTH}" ` +
      'stroke-linecap="round" stroke-linejoin="round"/>',
    "</svg>",
    "",
  ].join("\n");
}

/**
 * Perímetro del contorno del mismo trazado, medido sobre el SVG del motor.
 *
 * Es el contorno que se entregaría: el preset de line art completo, con su muestreo subpíxel
 * (`LINE_ART_SCALE`), no un trazado a 1× que ya no es el que sale del producto. Si el preset cambia,
 * esta comparación cambia con él.
 *
 * Devuelve `{ perimeter, error }`. Si el motor falla o no emite formas rellenas, `perimeter` es
 * `null` y el motivo viaja en el informe: es preferible una comparación ausente y explicada a un
 * número inventado. Es la medición tal cual, sumando contornos externos y agujeros, que es lo que
 * costaría recorrer el contorno con la herramienta.
 */
function contourPerimeter(signals) {
  try {
    const svg = subpixelOptions(signals, { scale: LINE_ART_SCALE });
    const shapes = svgShapes(svg);
    if (shapes.length === 0) return { perimeter: null, error: "el motor no emitió formas rellenas" };

    let perimeter = 0;
    for (const shape of shapes) {
      for (const line of pathToPolylines(shape.d, { tolerance: 0.25 })) {
        perimeter += polylineLength(line.points);
      }
    }
    return { perimeter, error: null };
  } catch (error) {
    return { perimeter: null, error: error.message };
  }
}

function countInk(mask) {
  let count = 0;
  for (const value of mask) count += value ? 1 : 0;
  return count;
}

function samePoint(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}

function printRow(entry) {
  const name = entry.imgSlug.padEnd(24).slice(0, 24);
  const contour = entry.contourPerimeter === null ? "      —" : format(entry.contourPerimeter);
  const ratio = entry.contourRatio === null ? "  —" : entry.contourRatio.toFixed(2);
  console.log(
    `${name} trazos=${String(entry.polylines).padStart(5)}  cerrados=${String(entry.closedPolylines).padStart(3)}  ` +
      `cortos=${String(entry.shortPolylines).padStart(5)}  nodos=${String(entry.nodes).padStart(6)}  ` +
      `centro=${format(entry.centerlineLength).padStart(9)} px  ` +
      `contorno=${contour.padStart(9)} px  ×${ratio}  ${String(entry.ms).padStart(5)} ms`,
  );
}

function format(value) {
  return String(Math.round(value));
}

function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseArgs(args) {
  const parsed = {
    only: null,
    output: path.join("bench", "out", "stroke"),
    json: path.join("bench", "out", "stroke-report.json"),
    tolerance: 1,
    inputs: null,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--only":
        parsed.only = args[++i];
        break;
      case "--out":
        parsed.output = args[++i];
        break;
      case "--json":
        parsed.json = args[++i];
        break;
      case "--tolerance":
        parsed.tolerance = Number(args[++i]);
        break;
      case "--inputs":
        parsed.inputs = args[++i];
        break;
      case "--help":
        console.log(
          "uso: node bench/stroke.mjs [--only texto] [--tolerance px] [--inputs dir] [--out dir] [--json file]",
        );
        process.exit(0);
        break;
      default:
        console.error(`opción desconocida: ${args[i]}`);
        process.exit(1);
    }
  }

  if (!(parsed.tolerance >= 0)) {
    console.error("--tolerance tiene que ser un número no negativo");
    process.exit(1);
  }

  return parsed;
}
