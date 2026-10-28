#!/usr/bin/env node
// Trazar cada imagen con el preset que le toca, decidido con números.
//
//   npm run bench:auto                       # decide y traza las 4 imágenes
//   node bench/auto-trace.mjs --only K1      # una sola
//
// Es el camino del producto: la entrada no se pregunta, se mide. `lib/category.mjs` clasifica la
// imagen en line art, ilustración, póster o foto, y el preset sale de esa categoría (experimento
// 04). El line art mantiene el camino binario del experimento 07: cuantizar en OKLab y pasar la
// paleta explícita no sirve para un escaneo. El informe deja la decisión, el motivo y el resultado.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import vtracer from "@visioncortex/vtracer";

import { classifyImage, imageSignals, tracePreset } from "./lib/category.mjs";
import { decodeImage } from "./lib/image-io.mjs";
import { lineArtOptions } from "./lib/lineart.mjs";
import { quantize, renderQuantized } from "./lib/quantize.mjs";
import { svgMetrics } from "./lib/svg-metrics.mjs";
import { INPUTS, slug } from "./lib/variants.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const options = parseArgs(process.argv.slice(2));

// Con `--inputs` la carpeta la pone quien llama: es lo que usa la prueba de integración y lo que
// sirve para barrer un lote propio sin tocar el código.
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
  const image = decodeImage(fs.readFileSync(input.source ?? path.join(here, "inputs", input.file)));
  const imgSlug = slug(input.file);
  const signals = imageSignals(image.rgba, image.width, image.height);
  const verdict = classifyImage(signals);
  const category = verdict.category;
  const preset = tracePreset(category, signals);
  const simplify = options.simplify === null ? preset.simplify : options.simplify;

  let svg;
  let paletteSize = 0;
  const started = Date.now();
  try {
    if (category === "line-art") {
      // Sin paleta: el modo binario produce un único relleno, que es justo lo que evita el doble
      // corte y lo que una máquina puede seguir sin separar tintas.
      svg = vtracer.convertPixels(
        new Uint8Array(image.rgba),
        image.width,
        image.height,
        lineArtOptions(signals, { simplify }),
      );
    } else {
      // Paleta y `simplify` salen de la categoría; `--colors` y `--simplify` los sobrescriben.
      const maxColors = options.colors === null ? preset.colors : options.colors;
      const palette = quantize(image.rgba, image.width, image.height, { maxColors });
      const rendered = renderQuantized(image.rgba, image.width, image.height, palette);
      paletteSize = palette.palette.length;
      svg = vtracer.convertPixels(new Uint8Array(rendered), image.width, image.height, {
        mode: "spline",
        hierarchical: "cutout",
        optimize: 2,
        simplify,
        palette: palette.paletteHex,
      });
    }
  } catch (error) {
    console.error(`ERROR ${imgSlug}: ${error.message}`);
    process.exitCode = 1;
    continue;
  }
  const ms = Date.now() - started;

  const name = `${imgSlug}__auto.svg`;
  fs.writeFileSync(path.join(options.output, name), svg);
  const metrics = svgMetrics(svg);

  report.push({
    image: input.file,
    imgSlug,
    // `sourceCategory` es la etiqueta del banco (`scan`, `logo-aa`…); `category` es la decisión.
    sourceCategory: input.category,
    category,
    decision: category === "line-art" ? "line-art" : "color",
    reason: verdict.reason,
    preset: { ...preset, simplify },
    threshold: signals.threshold,
    separability: round(signals.separability, 4),
    inkShare: round(signals.inkShare, 4),
    neutralShare: round(signals.neutralShare, 4),
    distinctColors: signals.distinctColors,
    luminanceEntropy: round(signals.luminanceEntropy, 4),
    meanChroma: round(signals.meanChroma, 4),
    edgeDensity: round(signals.edgeDensity, 4),
    paletteSize,
    ms,
    nodes: metrics.nodes,
    fills: metrics.colors,
    bytes: metrics.bytes,
    svg: `${outName}/${name}`,
  });

  console.log(
    `${imgSlug.padEnd(34)} ${category.padEnd(12)} ${presetLabel(preset, simplify).padEnd(14)} ` +
      `nodos=${String(metrics.nodes).padStart(6)}  rellenos=${String(metrics.colors).padStart(2)}  ` +
      `${String(Math.round(metrics.bytes / 1024)).padStart(5)}KB  ${String(ms).padStart(5)}ms  ${verdict.reason}`,
  );
}

fs.writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\n${report.length} SVGs en ${path.relative(process.cwd(), options.output)}`);
console.log(`informe → ${path.relative(process.cwd(), options.json)}`);

function presetLabel(preset, simplify) {
  if (preset.clustering === "bw") return `bw / ${decimal(simplify)}`;
  return `${preset.colors} col / ${decimal(simplify)}`;
}

function decimal(value) {
  return value.toFixed(1).replace(".", ",");
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseArgs(args) {
  const parsed = {
    // `null` = usar el preset de la categoría; el valor solo existe si se pasa la opción.
    colors: null,
    simplify: null,
    output: path.join("bench", "out", "auto"),
    json: path.join("bench", "out", "auto-report.json"),
    only: null,
    inputs: null,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
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
      case "--inputs":
        parsed.inputs = args[++i];
        break;
      case "--help":
        console.log(
          "uso: node bench/auto-trace.mjs [--colors n] [--simplify x] [--only texto] " +
            "[--inputs dir] [--out dir] [--json file]\n" +
            "  --colors y --simplify sobrescriben el preset elegido para la categoría",
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
