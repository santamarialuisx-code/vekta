#!/usr/bin/env node
// Experimento 15: reajuste de curvas sobre las etiquetas de píxel.
//
//   npm run bench:refit
//   node bench/curve-refit.mjs --only gum-tree --configs 0.6:0.6:60,0.9:0.9:60
//
// El modo `pixel` alcanza a Vector Magic en fidelidad pero entrega una escalera (64 036 nodos en
// Gum Tree); el modo `spline` entrega curvas limpias pero se separa del borde. Esto hace la segunda
// etapa de Vector Magic aquí: traza en `pixel` y encaja Béziers subpíxel sobre esas fronteras, con
// las esquinas conservadas y un error declarado contra la escalera.
//
// La vara es doble: SSIM (en `bw.html`, contra el original) y nodos. El objetivo del experimento es
// ≥0,97 de SSIM con ≤20 000 nodos en Gum Tree.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import vtracer from "@visioncortex/vtracer";

import { classifyImage, imageSignals, tracePreset } from "./lib/category.mjs";
import { FIDELITY_COLORS, colorTraceOptions } from "./lib/color-presets.mjs";
import { fitCurves, ringsFromPath } from "./lib/curve-fit.mjs";
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
  const colors = FIDELITY_COLORS[category] ?? preset.colors;

  const started = Date.now();
  const palette = quantize(image.rgba, image.width, image.height, { maxColors: colors });
  const rendered = renderQuantized(image.rgba, image.width, image.height, palette);
  // La etiqueta de píxel se traza una vez por imagen; el reajuste se barre sobre ella.
  const pixelSvg = vtracer.convertPixels(
    new Uint8Array(rendered),
    image.width,
    image.height,
    colorTraceOptions(palette.paletteHex, { mode: "fidelidad" }),
  );
  const traceMs = Date.now() - started;

  // Se conservan los rellenos y se cambia solo la geometría.
  const shapes = [...pixelSvg.matchAll(/<path d="([^"]*)" fill="([^"]*)"\s*\/>/g)].map((match) => ({
    d: match[1],
    fill: match[2],
  }));
  const root = pixelSvg.match(/<svg\b[^>]*>/)?.[0] ?? "";
  if (shapes.length === 0) {
    console.error(`${imgSlug}: el motor no emitió formas con relleno`);
    process.exitCode = 1;
    continue;
  }

  console.log(
    `\n${imgSlug}  ${image.width}×${image.height}  ${category}  ${colors} col  ` +
      `${shapes.length} formas  traza ${traceMs}ms`,
  );

  for (const config of options.configs) {
    const refitStarted = Date.now();
    let pathData = "";
    try {
      pathData = shapes
        .map((shape) => {
          const rings = ringsFromPath(shape.d);
          return (
            `<path d="${fitCurves(rings, {
              rdpTolerance: config.rdp,
              fitError: config.fit,
              cornerAngle: config.angle,
            })}" fill="${shape.fill}"/>`
          );
        })
        .join("\n");
    } catch (error) {
      console.log(`  ${label(config)}  ERROR ${error.message}`);
      continue;
    }
    const refitMs = Date.now() - refitStarted;
    const svg = `${root}\n${pathData}\n</svg>`;

    const name = `${imgSlug}__refit-${config.rdp}-${config.fit}-${config.angle}.svg`;
    fs.writeFileSync(path.join(options.output, name), svg);
    const metrics = svgMetrics(svg);

    report.push({
      image: input.file,
      imgSlug,
      config: `refit/${config.rdp}-${config.fit}-${config.angle}`,
      kind: "color",
      lineArt: false,
      category,
      colors,
      rdp: config.rdp,
      fitError: config.fit,
      cornerAngle: config.angle,
      threshold: signals.threshold,
      nodes: metrics.nodes,
      fills: metrics.colors,
      bytes: metrics.bytes,
      ms: traceMs + refitMs,
      svg: `${outName}/${name}`,
    });

    console.log(
      `  ${label(config).padEnd(22)}  nodos=${String(metrics.nodes).padStart(7)}  ` +
        `rellenos=${String(metrics.colors).padStart(3)}  ` +
        `${String(Math.round(metrics.bytes / 1024)).padStart(6)}KB  ${String(refitMs).padStart(6)}ms`,
    );
  }
}

fs.writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\n${report.length} SVGs en ${path.relative(process.cwd(), options.output)}`);
console.log(`informe → ${path.relative(process.cwd(), options.json)}`);
console.log("SSIM y PSNR: npm run bench:serve y abrir /bw.html?json=out/curve-refit.json");

function label(config) {
  return `r${config.rdp} f${config.fit} a${config.angle}`;
}

function parseArgs(args) {
  const parsed = {
    // `rdp:fit:angle` — tolerancia de simplificación, error de ajuste y umbral de esquina.
    configs: [
      { rdp: 0.4, fit: 0.4, angle: 60 },
      { rdp: 0.6, fit: 0.6, angle: 60 },
      { rdp: 0.9, fit: 0.9, angle: 60 },
      { rdp: 0.6, fit: 0.9, angle: 60 },
      { rdp: 0.6, fit: 0.6, angle: 45 },
    ],
    output: path.join("bench", "out", "curve-refit"),
    json: path.join("bench", "out", "curve-refit.json"),
    only: null,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--configs":
        parsed.configs = args[++i].split(",").map((entry) => {
          const [rdp, fit, angle] = entry.split(":").map(Number);
          if (![rdp, fit, angle].every((value) => Number.isFinite(value) && value > 0)) {
            console.error(`configuración inválida: ${entry} (usa rdp:fit:angle)`);
            process.exit(1);
          }
          return { rdp, fit, angle };
        });
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
          "uso: node bench/curve-refit.mjs [--configs 0.4:0.4:60,...] [--only texto] [--out dir] [--json file]",
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
