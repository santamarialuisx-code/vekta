#!/usr/bin/env node
// Barrido de muestreo subpíxel en color: ¿se cierra el hueco de fidelidad contra Vector Magic?
//
//   node bench/color-subpixel.mjs
//   node bench/color-subpixel.mjs --only gum-tree --variant source,full
//   node bench/color-subpixel.mjs --colors 12,24,48,96     # profundidad tonal a 1×
//
// El experimento 12 compró +0,026 de SSIM en line art trazando a 3× y devolviendo la geometría a la
// rejilla. Aquí se prueba lo mismo en el camino de color, con tres formas de aplicarlo (ver
// `lib/subpixel-color.mjs`): ampliar el render cuantizado, ampliar la imagen y asignar la paleta ya
// decidida, o cuantizar también a 3×. `--colors` hace la pregunta contraria: cuánto del hueco es
// profundidad tonal y no muestreo.
//
// El SSIM se mide después en `bw.html`, que ya sabe rasterizar SVG y comparar contra el original; las
// filas llevan la misma forma que `bw-sweep.mjs` para que la página no cambie.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { classifyImage, imageSignals, tracePreset } from "./lib/category.mjs";
import { decodeImage } from "./lib/image-io.mjs";
import { COLOR_VARIANTS, subpixelColorOptions } from "./lib/subpixel-color.mjs";
import { svgMetrics } from "./lib/svg-metrics.mjs";
import { INPUTS, slug } from "./lib/variants.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const options = parseArgs(process.argv.slice(2));

// Solo las imágenes de color: el line art ya está medido y su camino es binario.
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
  const paletteSizes = options.colors ?? [preset.colors];

  console.log(
    `\n${imgSlug}  ${image.width}×${image.height}  ${category}  ` +
      `simplify ${preset.simplify}  paletas ${paletteSizes.join(", ")}`,
  );

  for (const variant of options.variant) {
    for (const colors of paletteSizes) {
      // El baseline es el camino actual y va a 1×; el resto se muestrea a la escala pedida.
      const scale = variant === "baseline" ? 1 : options.scale;
      const config = `${variant}/x${scale}/c${colors}`;
      const started = Date.now();
      let result;
      try {
        result = subpixelColorOptions(image, {
          variant,
          scale,
          maxColors: colors,
          simplify: preset.simplify,
        });
      } catch (error) {
        console.log(`  ${config.padEnd(20)} ERROR ${error.message}`);
        continue;
      }
      const ms = Date.now() - started;

      const name = `${imgSlug}__color-${variant}-x${scale}-c${colors}.svg`;
      fs.writeFileSync(path.join(options.output, name), result.svg);
      const metrics = svgMetrics(result.svg);

      report.push({
        image: input.file,
        imgSlug,
        config,
        kind: "color",
        lineArt: false,
        category,
        threshold: signals.threshold,
        scale,
        colors,
        simplify: preset.simplify,
        paletteSize: result.paletteSize,
        nodes: metrics.nodes,
        fills: metrics.colors,
        bytes: metrics.bytes,
        ms,
        svg: `${outName}/${name}`,
      });

      console.log(
        `  ${config.padEnd(20)}  nodos=${String(metrics.nodes).padStart(7)}  ` +
          `rellenos=${String(metrics.colors).padStart(3)}  ` +
          `${String(Math.round(metrics.bytes / 1024)).padStart(6)}KB  ${String(ms).padStart(6)}ms`,
      );
    }
  }
}

fs.writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\n${report.length} SVGs en ${path.relative(process.cwd(), options.output)}`);
console.log(`informe → ${path.relative(process.cwd(), options.json)}`);
console.log("SSIM y PSNR: npm run bench:serve y abrir /bw.html?json=out/color-subpixel.json");

function parseArgs(args) {
  const parsed = {
    variant: ["baseline", "render", "source", "full"],
    scale: 3,
    colors: null,
    output: path.join("bench", "out", "color-subpixel"),
    json: path.join("bench", "out", "color-subpixel.json"),
    only: null,
  };

  let variantsGiven = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--variant": {
        const variants = args[++i].split(",");
        for (const variant of variants) {
          if (!COLOR_VARIANTS.includes(variant)) {
            console.error(`variante desconocida: ${variant} (usa ${COLOR_VARIANTS.join(", ")})`);
            process.exit(1);
          }
        }
        parsed.variant = variants;
        variantsGiven = true;
        break;
      }
      case "--colors":
        parsed.colors = args[++i].split(",").map(Number);
        if (parsed.colors.some((n) => !Number.isInteger(n) || n < 2)) {
          console.error("--colors espera enteros ≥ 2 separados por comas");
          process.exit(1);
        }
        break;
      case "--scale":
        parsed.scale = Number(args[++i]);
        if (!Number.isInteger(parsed.scale) || parsed.scale < 2) {
          console.error("la escala tiene que ser un entero ≥ 2 (1× es el baseline)");
          process.exit(1);
        }
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
          "uso: node bench/color-subpixel.mjs [--variant baseline,render,source,full] [--scale 3] [--colors 12,24,48] [--only texto] [--out dir] [--json file]",
        );
        process.exit(0);
        break;
      default:
        console.error(`opción desconocida: ${args[i]}`);
        process.exit(1);
    }
  }

  // Con `--colors` y sin `--variant` el barrido es de profundidad tonal: solo el camino actual a 1×.
  if (parsed.colors && !variantsGiven) parsed.variant = ["baseline"];

  return parsed;
}
