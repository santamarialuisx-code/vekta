#!/usr/bin/env node
// Experimento 14: ¿se cierra el hueco de fidelidad en color sin cambiar de motor?
//
//   npm run bench:fidelity
//   node bench/color-fidelity.mjs --only gum-tree
//
// Compara los dos modos de entrega sobre el mismo pipeline (cuantizar en OKLab → render → trazar con
// la paleta explícita):
//
// - `curvas`: `mode: spline` + `hierarchical: cutout`, el preset de los experimentos 04/08.
// - `fidelidad`: `mode: pixel`, que no ajusta curvas y sigue la frontera de píxel.
//
// El SSIM y el PSNR se miden después en `bw.html` contra el original; las filas llevan la misma forma
// que `bw-sweep.mjs` para que la página no cambie. La referencia del competidor está en
// `docs/experimento-13-vectormagic-foto.md`.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import vtracer from "@visioncortex/vtracer";

import { classifyImage, imageSignals, tracePreset } from "./lib/category.mjs";
import { FIDELITY_COLORS, colorTraceOptions } from "./lib/color-presets.mjs";
import { decodeImage } from "./lib/image-io.mjs";
import { quantize, renderQuantized } from "./lib/quantize.mjs";
import { svgMetrics } from "./lib/svg-metrics.mjs";
import { INPUTS, slug } from "./lib/variants.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const options = parseArgs(process.argv.slice(2));

const inputs = INPUTS.filter((input) => input.category !== "scan").filter(
  (input) => !options.only || slug(input.file).includes(options.only) || input.file.includes(options.only),
);
if (inputs.length === 0) {
  console.error(`ninguna imagen de color coincide con ${options.only}`);
  process.exit(1);
}

fs.mkdirSync(options.output, { recursive: true });
const outName = path.basename(options.output);
const report = [];

for (const input of inputs) {
  const image = decodeImage(fs.readFileSync(path.join(here, "inputs", input.file)));
  const imgSlug = slug(input.file);
  const signals = imageSignals(image.rgba, image.width, image.height);
  const category = classifyImage(signals).category;
  const preset = tracePreset(category, signals);

  console.log(`\n${imgSlug}  ${image.width}×${image.height}  ${category}  simplify ${preset.simplify}`);

  for (const mode of options.mode) {
    // La paleta del modo fidelidad crece en foto; en el resto es la misma que la de curvas.
    const colors = mode === "fidelidad" ? (FIDELITY_COLORS[category] ?? preset.colors) : preset.colors;
    const started = Date.now();
    const palette = quantize(image.rgba, image.width, image.height, { maxColors: colors });
    const rendered = renderQuantized(image.rgba, image.width, image.height, palette);
    const svg = vtracer.convertPixels(
      new Uint8Array(rendered),
      image.width,
      image.height,
      colorTraceOptions(palette.paletteHex, { mode, simplify: preset.simplify }),
    );
    const ms = Date.now() - started;

    const name = `${imgSlug}__${mode}.svg`;
    fs.writeFileSync(path.join(options.output, name), svg);
    const metrics = svgMetrics(svg);

    report.push({
      image: input.file,
      imgSlug,
      config: mode,
      kind: "color",
      lineArt: false,
      category,
      colors,
      simplify: preset.simplify,
      paletteSize: palette.palette.length,
      threshold: signals.threshold,
      nodes: metrics.nodes,
      fills: metrics.colors,
      bytes: metrics.bytes,
      ms,
      svg: `${outName}/${name}`,
    });

    console.log(
      `  ${mode.padEnd(10)}  ${String(colors).padStart(2)} col  ` +
        `nodos=${String(metrics.nodes).padStart(7)}  rellenos=${String(metrics.colors).padStart(3)}  ` +
        `${String(Math.round(metrics.bytes / 1024)).padStart(6)}KB  ${String(ms).padStart(5)}ms`,
    );
  }
}

fs.writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\n${report.length} SVGs en ${path.relative(process.cwd(), options.output)}`);
console.log(`informe → ${path.relative(process.cwd(), options.json)}`);
console.log("SSIM y PSNR: npm run bench:serve y abrir /bw.html?json=out/color-fidelity.json");

function parseArgs(args) {
  const parsed = {
    mode: ["curvas", "fidelidad"],
    output: path.join("bench", "out", "color-fidelity"),
    json: path.join("bench", "out", "color-fidelity.json"),
    only: null,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--mode": {
        const modes = args[++i].split(",");
        for (const mode of modes) {
          if (!["curvas", "fidelidad"].includes(mode)) {
            console.error(`modo desconocido: ${mode} (usa curvas, fidelidad)`);
            process.exit(1);
          }
        }
        parsed.mode = modes;
        break;
      }
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
        console.log("uso: node bench/color-fidelity.mjs [--mode curvas,fidelidad] [--only texto] [--out dir] [--json file]");
        process.exit(0);
        break;
      default:
        console.error(`opción desconocida: ${args[i]}`);
        process.exit(1);
    }
  }

  return parsed;
}
