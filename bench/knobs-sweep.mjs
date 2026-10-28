#!/usr/bin/env node
// Barrido de los knobs que quedan: precisión de path, filtro de motas y diferencia de capa.
//
//   npm run bench:knobs -- --only Gum
//
// Complementa a geometry-sweep: si los umbrales de esquina/splicing no mueven el SSIM, hay que
// descartar el resto de la superficie de parámetros antes de concluir que el hueco es del motor.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import vtracer from "@visioncortex/vtracer";

import { decodeImage } from "./lib/image-io.mjs";
import { quantize, renderQuantized } from "./lib/quantize.mjs";
import { svgMetrics } from "./lib/svg-metrics.mjs";
import { INPUTS, slug } from "./lib/variants.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const options = parseArgs(process.argv.slice(2));

const inputs = INPUTS.filter((input) => !options.only || input.file.includes(options.only));
fs.mkdirSync(options.output, { recursive: true });
const outName = path.basename(options.output);
const report = [];

for (const input of inputs) {
  const image = decodeImage(fs.readFileSync(path.join(here, "inputs", input.file)));
  const palette = quantize(image.rgba, image.width, image.height, { maxColors: options.colors });
  const rendered = renderQuantized(image.rgba, image.width, image.height, palette);
  const imgSlug = slug(input.file);

  for (const pathPrecision of options.pathPrecision) {
    for (const filterSpeckle of options.speckle) {
      for (const layerDifference of options.layerDifference) {
        const opts = {
          mode: "spline",
          hierarchical: "cutout",
          optimize: 2,
          simplify: 0.8,
          palette: palette.paletteHex,
          pathPrecision,
          filterSpeckle,
          layerDifference,
        };
        const started = Date.now();
        const svg = vtracer.convertPixels(new Uint8Array(rendered), image.width, image.height, opts);
        const ms = Date.now() - started;
        const name = `${imgSlug}__pp${pathPrecision}_fs${filterSpeckle}_ld${layerDifference}.svg`;
        fs.writeFileSync(path.join(options.output, name), svg);
        const metrics = svgMetrics(svg);
        report.push({
          image: input.file,
          imgSlug,
          pathPrecision,
          filterSpeckle,
          layerDifference,
          ms,
          nodes: metrics.nodes,
          fills: metrics.colors,
          bytes: metrics.bytes,
          svg: `${outName}/${name}`,
        });
        console.log(
          `${imgSlug.padEnd(34)} pp${pathPrecision} fs${String(filterSpeckle).padStart(2)} ` +
            `ld${String(layerDifference).padStart(3)}  nodos=${String(metrics.nodes).padStart(6)}  ` +
            `${(metrics.bytes / 1024).toFixed(0)}KB  ${ms}ms`,
        );
      }
    }
  }
}

fs.writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\n${report.length} SVGs en ${path.relative(process.cwd(), options.output)}`);

function parseArgs(args) {
  const parsed = {
    colors: 16,
    pathPrecision: [2, 3, 5, 8],
    speckle: [0, 2, 4, 8],
    layerDifference: [4, 16, 64],
    output: path.join("bench", "out", "knobs-sweep"),
    json: path.join("bench", "out", "knobs-sweep.json"),
    only: null,
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--path-precision":
        parsed.pathPrecision = args[++i].split(",").map(Number);
        break;
      case "--speckle":
        parsed.speckle = args[++i].split(",").map(Number);
        break;
      case "--layer-diff":
        parsed.layerDifference = args[++i].split(",").map(Number);
        break;
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
      default:
        console.error(`opción desconocida: ${args[i]}`);
        process.exit(1);
    }
  }
  return parsed;
}
