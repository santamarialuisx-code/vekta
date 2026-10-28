// Genera un SVG por (imagen × variante) y vuelca las métricas estructurales.
// Uso: node bench/run.mjs [filtro-de-fichero]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vtracer from "@visioncortex/vtracer";
import { svgMetrics } from "./lib/svg-metrics.mjs";
import { VARIANTS, INPUTS, slug } from "./lib/variants.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const IN = path.join(here, "inputs");
const OUT = path.join(here, "out");
const SVG_DIR = path.join(OUT, "svg");
fs.mkdirSync(SVG_DIR, { recursive: true });

const filter = process.argv[2];
const inputs = INPUTS.filter((i) => !filter || i.file.includes(filter));

const results = [];

for (const input of inputs) {
  const filePath = path.join(IN, input.file);
  if (!fs.existsSync(filePath)) {
    console.log("MISSING", input.file);
    continue;
  }
  const buf = fs.readFileSync(filePath);
  const imgSlug = slug(input.file);

  for (const variant of VARIANTS) {
    const t0 = Date.now();
    let svg;
    try {
      svg = vtracer.convertBuffer(new Uint8Array(buf), variant.opts);
    } catch (e) {
      console.log("ERROR", imgSlug, variant.id, e.message);
      continue;
    }
    const ms = Date.now() - t0;
    const name = `${imgSlug}__${variant.id}.svg`;
    fs.writeFileSync(path.join(SVG_DIR, name), svg);
    const m = svgMetrics(svg);
    results.push({
      image: input.file,
      imgSlug,
      category: input.category,
      variant: variant.id,
      variantLabel: variant.label,
      opts: variant.opts,
      ms,
      svg: `svg/${name}`,
      ...m,
    });
    console.log(
      `${imgSlug.padEnd(34)} ${variant.id.padEnd(18)} ${String(ms).padStart(5)}ms  ` +
        `paths=${String(m.paths).padStart(5)}  nodos=${String(m.nodes).padStart(6)}  ` +
        `colores=${String(m.colors).padStart(3)}  ${(m.bytes / 1024).toFixed(0)}KB`,
    );
  }
}

fs.writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify(results, null, 2));
console.log(`\n${results.length} SVGs en ${path.relative(process.cwd(), SVG_DIR)}`);
console.log(`métricas en ${path.relative(process.cwd(), path.join(OUT, "metrics.json"))}`);
