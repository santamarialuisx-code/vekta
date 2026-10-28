// Barrido fino sobre la imagen de referencia (Gum Tree) buscando el ajuste que
// más se acerque al resultado de Vector Magic: colores planos, pocas capas,
// nodos justos. Genera SVGs + un JSON con los parámetros de cada uno.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vtracer from "@visioncortex/vtracer";
import { svgMetrics } from "./lib/svg-metrics.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const IN = path.join(here, "inputs", "Gum Tree Vector.jpg");
const DIR = path.join(here, "out", "sweep");
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const buf = fs.readFileSync(IN);

const BASES = [
  { name: "cutout", opts: { hierarchical: "cutout", mode: "spline", simplify: 1.5, optimize: 2 } },
  { name: "stacked", opts: { mode: "spline", simplify: 1.5, optimize: 2 } },
];

const GRID = {
  colorPrecision: [3, 4, 5, 6],
  layerDifference: [16, 32, 64, 96],
  filterSpeckle: [4, 8],
};

const rows = [];
for (const base of BASES) {
  for (const cp of GRID.colorPrecision)
    for (const ld of GRID.layerDifference)
      for (const fs2 of GRID.filterSpeckle) {
        const id = `${base.name}_cp${cp}_ld${ld}_sp${fs2}`;
        const opts = {
          ...base.opts,
          colorPrecision: cp,
          layerDifference: ld,
          filterSpeckle: fs2,
        };
        const t0 = Date.now();
        let svg;
        try {
          svg = vtracer.convertBuffer(new Uint8Array(buf), opts);
        } catch (e) {
          console.log("ERR", id, e.message);
          continue;
        }
        const ms = Date.now() - t0;
        const file = `${id}.svg`;
        fs.writeFileSync(path.join(DIR, file), svg);
        const m = svgMetrics(svg);
        rows.push({ id, base: base.name, cp, ld, sp: fs2, ms, svg: `sweep/${file}`, ...m });
      }
}

fs.writeFileSync(path.join(here, "out", "sweep.json"), JSON.stringify(rows, null, 2));
rows.sort((a, b) => a.colors - b.colors || a.nodes - b.nodes);
console.log("id".padEnd(28), "colores  paths  nodos     KB");
for (const r of rows) {
  console.log(
    r.id.padEnd(28),
    String(r.colors).padStart(7),
    String(r.paths).padStart(6),
    String(r.nodes).padStart(6),
    String(Math.round(r.bytes / 1024)).padStart(6) + "KB",
  );
}
console.log(`\n${rows.length} variantes en out/sweep/`);
