#!/usr/bin/env node
// Pipeline completo: decodificar → cuantizar en OKLab → trazar.
//
//   npm run bench:pipeline                 # default + cutout-opt, 16 colores
//   node bench/pipeline.mjs --colors 8 --variants cutout-opt
//
// Compara contra el trazado directo con las mismas opciones: así la única diferencia es la
// paleta, y cualquier cambio en nodos o SSIM se le puede atribuir.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import vtracer from "@visioncortex/vtracer";

import { decodeImage } from "./lib/image-io.mjs";
import { quantize, renderQuantized } from "./lib/quantize.mjs";
import { svgMetrics } from "./lib/svg-metrics.mjs";
import { INPUTS, VARIANTS, slug } from "./lib/variants.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const options = parseArgs(process.argv.slice(2));

const variants = VARIANTS.filter((variant) => options.variants.includes(variant.id));
if (variants.length === 0) {
  console.error(`no hay variantes que coincidan con ${options.variants.join(",")}`);
  process.exit(1);
}

const inputs = INPUTS.filter((input) => !options.only || input.file.includes(options.only));
fs.mkdirSync(options.output, { recursive: true });

const report = [];
for (const input of inputs) {
  const source = path.join(here, "inputs", input.file);
  const buffer = fs.readFileSync(source);
  const image = decodeImage(buffer);
  const palette = quantize(image.rgba, image.width, image.height, { maxColors: options.colors });
  const rendered = renderQuantized(image.rgba, image.width, image.height, palette);
  const imgSlug = slug(input.file);

  for (const variant of variants) {
    for (const mode of ["base", "quantized"]) {
      const started = Date.now();
      let svg;
      try {
        // La paleta se pasa explícita: si se deja que vtracer vuelva a agrupar, deriva los
        // colores unos pocos niveles y fragmenta el SVG en decenas de grupos casi iguales.
        svg =
          mode === "base"
            ? vtracer.convertBuffer(new Uint8Array(buffer), variant.opts)
            : vtracer.convertPixels(new Uint8Array(rendered), image.width, image.height, {
                ...variant.opts,
                palette: palette.paletteHex,
              });
      } catch (error) {
        console.log("ERROR", imgSlug, variant.id, mode, error.message);
        continue;
      }
      const ms = Date.now() - started;
      const name = `${imgSlug}__${variant.id}__${mode}.svg`;
      fs.writeFileSync(path.join(options.output, name), svg);
      const metrics = svgMetrics(svg);

      const entry = {
        image: input.file,
        imgSlug,
        category: input.category,
        variant: variant.id,
        variantLabel: variant.label,
        mode,
        colors: palette.palette.length,
        meanDeltaE: round(palette.meanDeltaE, 4),
        p95DeltaE: round(palette.p95DeltaE, 4),
        ms,
        svg: `pipeline/${name}`,
        ...metrics,
      };

      report.push(entry);
      console.log(
        `${imgSlug.padEnd(34)} ${variant.id.padEnd(12)} ${mode.padEnd(10)} ` +
          `${String(ms).padStart(5)}ms  nodos=${String(metrics.nodes).padStart(6)}  ` +
          `colores=${String(metrics.colors).padStart(3)}  ${(metrics.bytes / 1024).toFixed(0)}KB`,
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
    colors: 16,
    variants: ["default", "cutout-opt"],
    output: path.join("bench", "out", "pipeline"),
    json: path.join("bench", "out", "pipeline-report.json"),
    only: null,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--colors":
        parsed.colors = Number(args[++i]);
        break;
      case "--variants":
        parsed.variants = args[++i].split(",").map((value) => value.trim());
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
          "uso: node bench/pipeline.mjs [--colors n] [--variants a,b] [--only texto] [--out dir] [--json file]",
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
