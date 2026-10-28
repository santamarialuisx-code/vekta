#!/usr/bin/env node
// Barrido de muestreo subpíxel: trazar ampliado y devolver la geometría a la rejilla original.
//
//   node bench/subpixel-sweep.mjs --only K1
//   node bench/subpixel-sweep.mjs --all --scale 1,2
//
// El experimento 05 dejó un hueco de 0,032 de SSIM contra Vector Magic y demostró que no se cierra
// con parámetros: `pathPrecision` de 2 a 8 produce exactamente la misma salida. La hipótesis de este
// barrido es que el problema está en el muestreo, no en los decimales: el motor decide tinta/papel
// píxel a píxel, así que un borde de 1,5 px se convierte en un contorno entero. Ampliando la
// luminancia con interpolación bilineal (escala 2, 3, 4) el corte de Otsu puede caer en 0,5, 0,33 o
// 0,25 de píxel; después la geometría se divide por la escala y el SVG queda en el marco original.
//
// El SSIM y el F1 de tinta se miden después en `bw.html`: hace falta un canvas para rasterizar. Este
// CLI deja el SVG en disco y en el JSON lo justo para esa medición: `image`, `svg`, `threshold`,
// `nodes`, `bytes` y `ms`. Nada más, para que la página no dependa de detalles internos del barrido.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { decodeImage } from "./lib/image-io.mjs";
import { lineArtSignals, looksLikeLineArt } from "./lib/lineart.mjs";
import { subpixelOptions } from "./lib/subpixel.mjs";
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
  const imgSlug = slug(input.file);
  const signals = lineArtSignals(image.rgba, image.width, image.height);
  const verdict = looksLikeLineArt(signals);

  console.log(
    `\n${imgSlug}  ${image.width}×${image.height}  otsu=${signals.threshold} ` +
      `tinta=${(signals.inkShare * 100).toFixed(1)} %  neutro=${(signals.neutralShare * 100).toFixed(0)} %`,
  );
  console.log(`  decisión: ${verdict.lineArt ? "LINE ART" : "no line art"} — ${verdict.reason}`);

  // La escala subpíxel solo tiene sentido donde el borde es tinta sobre papel. En una foto el
  // contorno ya no es la pregunta, y en una ilustración de color este barrido destruye la paleta:
  // se corre solo con `--all`, que es una decisión explícita y no un accidente del barrido.
  if (!verdict.lineArt && !options.all) {
    console.log("  omitida: no es line art (usa --all para trazarla igual)");
    continue;
  }

  for (const scale of options.scale) {
    const started = Date.now();
    let svg;
    try {
      svg = subpixelOptions(signals, { scale });
    } catch (error) {
      console.log(`  escala ${scale}×  ERROR ${error.message}`);
      continue;
    }
    const ms = Date.now() - started;

    const name = `${imgSlug}__subpixel-x${scale}.svg`;
    fs.writeFileSync(path.join(options.output, name), svg);
    const metrics = svgMetrics(svg);

    report.push({
      image: input.file,
      svg: `${outName}/${name}`,
      threshold: signals.threshold,
      nodes: metrics.nodes,
      bytes: metrics.bytes,
      ms,
    });

    console.log(
      `  escala ${String(scale).padStart(2)}×  nodos=${String(metrics.nodes).padStart(7)}  ` +
        `${String(Math.round(metrics.bytes / 1024)).padStart(5)}KB  ${String(ms).padStart(6)}ms`,
    );
  }
}

fs.writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\n${report.length} SVGs en ${path.relative(process.cwd(), options.output)}`);
console.log(`informe → ${path.relative(process.cwd(), options.json)}`);
console.log("SSIM y F1 de tinta: npm run bench:serve y abrir /bw.html");

function parseArgs(args) {
  const parsed = {
    scale: [1, 2, 3, 4],
    output: path.join("bench", "out", "subpixel-sweep"),
    json: path.join("bench", "out", "subpixel-sweep.json"),
    only: null,
    all: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--scale":
        parsed.scale = args[++i].split(",").map(Number);
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
      case "--all":
        parsed.all = true;
        break;
      case "--help":
        console.log(
          "uso: node bench/subpixel-sweep.mjs [--scale 1,2,3,4] [--only texto] [--all] [--out dir] [--json file]",
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
