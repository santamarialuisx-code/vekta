// Añade los resultados del barrido al metrics.json principal para poder medir
// su fidelidad contra el original con metrics.html.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "out");

const base = JSON.parse(fs.readFileSync(path.join(outDir, "metrics.json"), "utf8"));
const sweep = JSON.parse(fs.readFileSync(path.join(outDir, "sweep.json"), "utf8"));

const kept = base.filter((r) => r.imgSlug !== "gum-tree-vector");
const sweepRows = sweep.map((r) => ({
  image: "Gum Tree Vector.jpg",
  imgSlug: "gum-tree-vector",
  category: "logo-aa",
  variant: r.id,
  variantLabel: r.id,
  opts: { colorPrecision: r.cp, layerDifference: r.ld, filterSpeckle: r.sp, base: r.base },
  ms: r.ms,
  svg: r.svg,
  paths: r.paths,
  subpaths: r.subpaths,
  nodes: r.nodes,
  curves: r.curves,
  lines: r.lines,
  colors: r.colors,
  bytes: r.bytes,
}));

fs.writeFileSync(path.join(outDir, "metrics.json"), JSON.stringify([...kept, ...sweepRows], null, 2));
console.log(`metrics.json: ${kept.length} + ${sweepRows.length} = ${kept.length + sweepRows.length} filas`);
