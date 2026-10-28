#!/usr/bin/env node
// Barrido de geometría: esquinas, splicing y longitud de segmento.
//
//   npm run bench:geometry                 # 3 × 3 × 3 sobre las 4 imágenes
//   node bench/geometry-sweep.mjs --corners 60,90 --splice 45 --length 4
//
// Paleta y simplify quedan fijos para aislar la geometría: lo que se mueve es cómo se decide una
// esquina, cómo se empalman los segmentos cortos y a partir de qué longitud se descarta un tramo.
// Eso es lo que produce el temblor de contorno frente a la curva decidida de Vector Magic.

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
const report = [];

for (const input of inputs) {
  const image = decodeImage(fs.readFileSync(path.join(here, "inputs", input.file)));
  const palette = quantize(image.rgba, image.width, image.height, { maxColors: options.colors });
  const rendered = renderQuantized(image.rgba, image.width, image.height, palette);
  const imgSlug = slug(input.file);

  for (const corner of options.corners) {
    for (const splice of options.splice) {
      for (const length of options.length) {
        const opts = {
          mode: "spline",
          hierarchical: "cutout",
          optimize: 2,
          simplify: options.simplify,
          palette: palette.paletteHex,
          cornerThreshold: corner,
          spliceThreshold: splice,
          lengthThreshold: length,
        };

        const started = Date.now();
        const svg = vtracer.convertPixels(new Uint8Array(rendered), image.width, image.height, opts);
        const ms = Date.now() - started;
        const name = `${imgSlug}__ct${corner}_sp${splice}_lt${length}.svg`;
        fs.writeFileSync(path.join(options.output, name), svg);
        const metrics = svgMetrics(svg);

        report.push({
          image: input.file,
          imgSlug,
          category: input.category,
          colors: options.colors,
          simplify: options.simplify,
          cornerThreshold: corner,
          spliceThreshold: splice,
          lengthThreshold: length,
          ms,
          nodes: metrics.nodes,
          fills: metrics.colors,
          bytes: metrics.bytes,
          svg: `${outName}/${name}`,
        });

        console.log(
          `${imgSlug.padEnd(34)} ct${String(corner).padStart(3)} sp${String(splice).padStart(2)} ` +
            `lt${String(length).padStart(2)}  nodos=${String(metrics.nodes).padStart(6)}  ` +
            `${(metrics.bytes / 1024).toFixed(0)}KB  ${ms}ms`,
        );
      }
    }
  }
}

fs.writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\n${report.length} SVGs en ${path.relative(process.cwd(), options.output)}`);
console.log(`informe → ${path.relative(process.cwd(), options.json)}`);

function parseArgs(args) {
  const parsed = {
    colors: 16,
    simplify: 0.8,
    corners: [60, 90, 120],
    splice: [30, 45, 60],
    length: [4, 6, 8],
    output: path.join("bench", "out", "geometry-sweep"),
    json: path.join("bench", "out", "geometry-sweep.json"),
    only: null,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--corners":
        parsed.corners = args[++i].split(",").map(Number);
        break;
      case "--splice":
        parsed.splice = args[++i].split(",").map(Number);
        break;
      case "--length":
        parsed.length = args[++i].split(",").map(Number);
        break;
      case "--colors":
        parsed.colors = Number(args[++i]);
        break;
      case "--simplify":
        parsed.simplify = Number(args[++i]);
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
          "uso: node bench/geometry-sweep.mjs [--corners 60,90] [--splice 45] [--length 4,6] [--colors 16] [--simplify 0.8]",
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
