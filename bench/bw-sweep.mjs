#!/usr/bin/env node
// Barrido del modo binario: umbral fijo, Bradley–Roth adaptativo y sus alrededores.
//
//   npm run bench:bw                                  # barrido completo sobre el line art + prueba en el resto
//   node bench/bw-sweep.mjs --only K1 --simplify 0,1.2
//
// El pipeline de color trata un escaneo como si fuera una ilustración: 16 colores para reproducir
// el tono del papel y el gris del lápiz, que en una máquina de corte no significan nada. El modo
// binario del motor (`clustering: 'bw'`) colapsa la imagen a tinta/fondo y traza esa frontera.
//
// Lo que se barre aquí es lo que el banco nunca tocó: el umbral fijo, el adaptativo de Bradley–Roth
// (`adaptive`, `adaptiveWindow`, `adaptiveT`) y lo que hace falta encima para bajar nodos.
//
// El SSIM se mide después en `bw.html`: hace falta un canvas para rasterizar el SVG. Este CLI deja
// en el JSON todo lo que la página necesita, incluido el umbral de Otsu de cada imagen.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import vtracer from "@visioncortex/vtracer";

import { decodeImage } from "./lib/image-io.mjs";
import { lineArtOptions, lineArtSignals, looksLikeLineArt } from "./lib/lineart.mjs";
import { quantize, renderQuantized } from "./lib/quantize.mjs";
import { svgMetrics } from "./lib/svg-metrics.mjs";
import { INPUTS, slug } from "./lib/variants.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const options = parseArgs(process.argv.slice(2));

/** Base común: mosaico sin costuras y optimización de salida, igual que el resto del banco. */
const BASE = { mode: "spline", hierarchical: "cutout", optimize: 2 };

/**
 * Configuraciones a evaluar.
 *
 * `probe: true` marca las que se corren también sobre las imágenes que no son line art: no hace
 * falta el barrido completo ahí, hace falta demostrar cuánto las degrada el modo binario.
 */
function configs(simplifyLevels) {
  const list = [
    {
      id: "color-16-simplify-1.2",
      label: "pipeline de color (línea base del experimento 04)",
      probe: true,
      kind: "color",
      opts: { ...BASE, simplify: 1.2 },
    },
  ];

  for (const threshold of [96, 112, 128, 144, 160, 176, 192]) {
    list.push({
      id: `bw-fixed-${threshold}`,
      label: `binario, umbral fijo ${threshold}`,
      probe: threshold === 128,
      kind: "bw-fixed",
      opts: { ...BASE, clustering: "bw", binaryThreshold: threshold },
    });
  }

  for (const adaptiveT of [10, 15, 25, 35]) {
    for (const adaptiveWindow of [0, 16, 32, 64]) {
      list.push({
        id: `bw-adaptive-w${adaptiveWindow}-t${adaptiveT}`,
        label: `binario adaptativo, ventana ${adaptiveWindow || "auto"}, sensibilidad ${adaptiveT}`,
        probe: adaptiveWindow === 0 && adaptiveT === 15,
        kind: "bw-adaptive",
        adaptiveWindow,
        adaptiveT,
        opts: { ...BASE, clustering: "bw", adaptive: true, adaptiveWindow, adaptiveT },
      });
    }
  }

  // Umbral = Otsu de la propia imagen. Es el preset: no hay número mágico que mantener, y en K1 el
  // Otsu (135) cae justo en la banda que gana el barrido de umbral fijo (128–144). La variante 0,8
  // es la que se entrega (`LINE_ART_PRESET`), así que se corre también sobre el resto de imágenes.
  for (const simplify of simplifyLevels) {
    list.push({
      id: `bw-otsu-simplify-${simplify}`,
      label: simplify === 0.8
        ? `preset de line art (Otsu + simplify ${simplify})`
        : `binario Otsu + simplify ${simplify}`,
      probe: simplify === 0.8,
      kind: "bw-otsu-simplify",
      opts: simplify === 0.8 ? { ...BASE, clustering: "bw" } : { ...BASE, clustering: "bw", simplify },
    });
  }

  for (const filterSpeckle of [8, 16, 32]) {
    list.push({
      id: `bw-otsu-simplify-1.2-fs${filterSpeckle}`,
      label: `binario Otsu + simplify 1.2 + filterSpeckle ${filterSpeckle}`,
      probe: false,
      kind: "bw-otsu-speckle",
      opts: { ...BASE, clustering: "bw", simplify: 1.2, filterSpeckle },
    });
  }

  for (const mode of ["polygon", "pixel"]) {
    list.push({
      id: `bw-otsu-simplify-1.2-${mode}`,
      label: `binario Otsu + simplify 1.2, modo ${mode}`,
      probe: false,
      kind: "bw-otsu-mode",
      opts: { ...BASE, mode, clustering: "bw", simplify: 1.2 },
    });
  }

  for (const simplify of simplifyLevels) {
    list.push({
      id: `bw-adaptive-simplify-${simplify}`,
      label: `binario adaptativo + simplify ${simplify}`,
      probe: simplify === 1.2,
      kind: "bw-adaptive-simplify",
      opts: { ...BASE, clustering: "bw", adaptive: true, simplify },
    });
  }

  for (const filterSpeckle of [2, 4, 8]) {
    list.push({
      id: `bw-adaptive-simplify-1.2-fs${filterSpeckle}`,
      label: `binario adaptativo + simplify 1.2 + filterSpeckle ${filterSpeckle}`,
      probe: false,
      kind: "bw-adaptive-speckle",
      opts: { ...BASE, clustering: "bw", adaptive: true, simplify: 1.2, filterSpeckle },
    });
  }

  for (const mode of ["pixel", "polygon"]) {
    list.push({
      id: `bw-adaptive-simplify-1.2-${mode}`,
      label: `binario adaptativo + simplify 1.2, modo ${mode}`,
      probe: false,
      kind: "bw-adaptive-mode",
      opts: { ...BASE, mode, clustering: "bw", adaptive: true, simplify: 1.2 },
    });
  }

  return list;
}

const inputs = INPUTS.filter((input) => !options.only || input.file.includes(options.only));
if (inputs.length === 0) {
  console.error(`ninguna imagen coincide con ${options.only}`);
  process.exit(1);
}

fs.mkdirSync(options.output, { recursive: true });
const outName = path.basename(options.output);
const allConfigs = configs(options.simplify);
const report = [];
const imageReports = [];

for (const input of inputs) {
  const image = decodeImage(fs.readFileSync(path.join(here, "inputs", input.file)));
  const imgSlug = slug(input.file);
  const signals = lineArtSignals(image.rgba, image.width, image.height);
  const verdict = looksLikeLineArt(signals);

  // La paleta se calcula una vez por imagen: la necesita la línea base de color.
  const palette = quantize(image.rgba, image.width, image.height, { maxColors: 16 });
  const rendered = renderQuantized(image.rgba, image.width, image.height, palette);

  console.log(
    `\n${imgSlug}  ${image.width}×${image.height}  otsu=${signals.threshold} ` +
      `sep=${signals.separability.toFixed(2)}  tinta=${(signals.inkShare * 100).toFixed(1)} %  ` +
      `neutro=${(signals.neutralShare * 100).toFixed(0)} %  bordes=${(signals.edgeDensity * 100).toFixed(1)} %`,
  );
  console.log(`  decisión: ${verdict.lineArt ? "LINE ART" : "no line art"} — ${verdict.reason}`);

  imageReports.push({
    image: input.file,
    imgSlug,
    category: input.category,
    width: image.width,
    height: image.height,
    threshold: signals.threshold,
    separability: round(signals.separability, 4),
    inkShare: round(signals.inkShare, 4),
    neutralShare: round(signals.neutralShare, 4),
    edgeDensity: round(signals.edgeDensity, 4),
    lineArt: verdict.lineArt,
    lineArtReason: verdict.reason,
  });

  const applicable = allConfigs.filter((config) => verdict.lineArt || config.probe);
  for (const config of applicable) {
    let svg;
    const started = Date.now();
    try {
      // El umbral de Otsu es por imagen: se resuelve con `lineArtOptions`, la misma función que usa
      // el preset, para que el barrido mida exactamente lo que se entrega.
      const traceOpts = config.kind.startsWith("bw-otsu")
        ? lineArtOptions(signals, config.opts)
        : config.opts;
      svg =
        config.kind === "color"
          ? vtracer.convertPixels(new Uint8Array(rendered), image.width, image.height, {
              ...traceOpts,
              palette: palette.paletteHex,
            })
          : vtracer.convertPixels(new Uint8Array(image.rgba), image.width, image.height, traceOpts);
    } catch (error) {
      console.log(`  ${config.id.padEnd(34)} ERROR ${error.message}`);
      continue;
    }
    const ms = Date.now() - started;
    const name = `${imgSlug}__${config.id}.svg`;
    fs.writeFileSync(path.join(options.output, name), svg);
    const metrics = svgMetrics(svg);

    report.push({
      image: input.file,
      imgSlug,
      category: input.category,
      lineArt: verdict.lineArt,
      config: config.id,
      label: config.label,
      kind: config.kind,
      threshold: signals.threshold,
      otsuInkShare: round(signals.inkShare, 4),
      ms,
      nodes: metrics.nodes,
      fills: metrics.colors,
      paths: metrics.paths,
      bytes: metrics.bytes,
      svg: `${outName}/${name}`,
    });

    console.log(
      `  ${config.id.padEnd(34)} nodos=${String(metrics.nodes).padStart(7)}  ` +
        `rellenos=${String(metrics.colors).padStart(2)}  ${String(Math.round(metrics.bytes / 1024)).padStart(5)}KB  ` +
        `${String(ms).padStart(5)}ms`,
    );
  }
}

fs.writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(options.images, `${JSON.stringify(imageReports, null, 2)}\n`);
console.log(`\n${report.length} SVGs en ${path.relative(process.cwd(), options.output)}`);
console.log(`informe → ${path.relative(process.cwd(), options.json)}`);
console.log(`señales → ${path.relative(process.cwd(), options.images)}`);
console.log("SSIM y F1 de tinta: npm run bench:serve y abrir /bw.html");

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseArgs(args) {
  const parsed = {
    simplify: [0, 0.8, 1.2, 1.6, 2],
    output: path.join("bench", "out", "bw-sweep"),
    json: path.join("bench", "out", "bw-sweep.json"),
    images: path.join("bench", "out", "bw-sweep-images.json"),
    only: null,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
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
          "uso: node bench/bw-sweep.mjs [--simplify 0,1.2] [--only texto] [--out dir] [--json file]",
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
