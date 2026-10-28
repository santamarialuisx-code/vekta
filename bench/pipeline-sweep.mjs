#!/usr/bin/env node
// Barrido de calibración: tamaño de paleta × simplify.
//
//   npm run bench:sweep2                       # 8/12/16/24/32 colores × 6 niveles de simplify
//   node bench/pipeline-sweep.mjs --only K1 --colors 8,16 --simplify 0,1.5
//
// Base: cutout + optimize 2 (el modo que sirve para cortar). Cada combinación escribe un SVG y
// una fila con nodos, rellenos y tiempo; el SSIM se mide después en el navegador, igual que en
// metrics.html, para que sea comparable con los experimentos 01 y 03.

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
if (inputs.length === 0) {
  console.error(`ninguna imagen coincide con ${options.only}`);
  process.exit(1);
}

fs.mkdirSync(options.output, { recursive: true });
const outName = path.basename(options.output);

const baseOptions = { mode: "spline", hierarchical: "cutout", optimize: 2 };
const report = [];

for (const input of inputs) {
  const source = path.join(here, "inputs", input.file);
  const image = decodeImage(fs.readFileSync(source));
  const imgSlug = slug(input.file);

  for (const colors of options.colors) {
    const palette = quantize(image.rgba, image.width, image.height, { maxColors: colors });
    const rendered = renderQuantized(image.rgba, image.width, image.height, palette);

    for (const simplify of options.simplify) {
      const opts = { ...baseOptions, palette: palette.paletteHex };
      if (simplify > 0) opts.simplify = simplify;

      const started = Date.now();
      const svg = vtracer.convertPixels(new Uint8Array(rendered), image.width, image.height, opts);
      const ms = Date.now() - started;
      const name = `${imgSlug}__c${colors}__s${simplify}.svg`;
      fs.writeFileSync(path.join(options.output, name), svg);
      const metrics = svgMetrics(svg);

      const entry = {
        image: input.file,
        imgSlug,
        category: input.category,
        colors,
        paletteSize: palette.palette.length,
        simplify,
        meanDeltaE: round(palette.meanDeltaE, 4),
        ms,
        nodes: metrics.nodes,
        fills: metrics.colors,
        bytes: metrics.bytes,
        svg: `${outName}/${name}`,
      };
      report.push(entry);
      console.log(
        `${imgSlug.padEnd(34)} c${String(colors).padStart(2)} s${String(simplify).padEnd(4)} ` +
          `nodos=${String(metrics.nodes).padStart(6)}  fills=${String(metrics.colors).padStart(3)}  ` +
          `${(metrics.bytes / 1024).toFixed(0)}KB  ${ms}ms`,
      );
    }
  }
}

fs.writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\n${report.length} SVGs en ${path.relative(process.cwd(), options.output)}`);
console.log(`informe → ${path.relative(process.cwd(), options.json)}`);

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseArgs(args) {
  const parsed = {
    colors: [8, 12, 16, 24, 32],
    simplify: [0, 0.8, 1.2, 1.6, 2, 2.5, 3],
    output: path.join("bench", "out", "pipeline-sweep"),
    json: path.join("bench", "out", "pipeline-sweep.json"),
    only: null,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--colors":
        parsed.colors = args[++i].split(",").map(Number);
        break;
      case "--simplify":
        parsed.simplify = args[++i].split(",").map(Number);
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
        console.log(
          "uso: node bench/pipeline-sweep.mjs [--colors 8,16] [--simplify 0,1.5] [--only texto]",
        );
        process.exit(0);
        break;
      default:
        console.error(`opción desconocida: ${args[i]}`);
        process.exit(1);
    }
  }

  return parsed;
}
