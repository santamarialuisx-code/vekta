// Métricas estructurales de un SVG: paths, nodos, colores, tamaño.
// "Nodos" = comandos de dibujo en el atributo `d` (M, L, C, Q...). Es el proxy
// estándar de "cuántos puntos tiene que tocar el usuario / cuánto pesa la curva".

const CMD = /[MmLlHhVvCcSsQqTtAaZz]/g;

export function svgMetrics(svg) {
  const paths = svg.match(/<path\b/g) || [];
  const ds = [...svg.matchAll(/\sd="([^"]*)"/g)].map((m) => m[1]);

  let nodes = 0;
  let moveTo = 0;
  let curves = 0;
  let lines = 0;

  for (const d of ds) {
    const cmds = d.match(CMD) || [];
    for (const c of cmds) {
      const u = c.toUpperCase();
      if (u === "Z") continue; // cierre de subpath, no es un nodo
      nodes++;
      if (u === "M") moveTo++;
      else if (u === "C" || u === "S" || u === "Q" || u === "T") curves++;
      else if (u === "L" || u === "H" || u === "V") lines++;
    }
  }

  const fills = new Set();
  for (const m of svg.matchAll(/fill="([^"]+)"/g)) fills.add(m[1].toLowerCase());
  for (const m of svg.matchAll(/fill:\s*([^;"]+)/g)) fills.add(m[1].trim().toLowerCase());

  const vb = svg.match(/viewBox="([^"]+)"/);
  const w = svg.match(/\bwidth="([^"]+)"/);
  const h = svg.match(/\bheight="([^"]+)"/);

  return {
    bytes: svg.length,
    paths: paths.length,
    subpaths: moveTo,
    nodes,
    curves,
    lines,
    colors: fills.size,
    viewBox: vb ? vb[1] : null,
    width: w ? w[1] : null,
    height: h ? h[1] : null,
    hasUnits: /\bwidth="[\d.]+(mm|cm|in|pt)"/.test(svg),
  };
}
