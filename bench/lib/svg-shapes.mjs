// Extracción de formas rellenas desde un SVG, con herencia de `fill` y `fill-rule`.
//
// El trazador agrupa paths por color (`<g fill="#...">`), así que leer el color efectivo es
// requisito para saber qué formas son contiguas y cuáles se pueden unir. No se interpretan
// `transform` ni CSS externo: la salida de vtracer no los emite, y aceptarlos a medias daría
// una medición silenciosamente equivocada.

const TAG = /<\s*(\/?)\s*([A-Za-z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)(\/?)\s*>/g;
const ATTRIBUTE = /([A-Za-z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const SKIPPED = new Set(["defs", "clippath", "mask", "symbol", "marker", "pattern"]);
const SHAPES = new Set(["path", "polygon"]);

/** Devuelve `[{ tag, d, fill, fillRule }]` con el estilo ya resuelto. */
export function svgShapes(svg) {
  const shapes = [];
  const stack = [];
  let skipDepth = 0;

  for (const match of String(svg ?? "").matchAll(TAG)) {
    const closing = match[1] === "/";
    const tag = match[2].toLowerCase();
    const selfClosing = match[4] === "/" || match[0].endsWith("/>");

    if (skipDepth > 0) {
      if (!closing && !selfClosing && SKIPPED.has(tag)) skipDepth++;
      else if (closing) skipDepth--;
      continue;
    }

    if (closing) {
      stack.pop();
      continue;
    }

    const attributes = parseAttributes(match[3]);
    const parent = stack.at(-1) ?? { fill: "#000000", fillRule: "nonzero" };
    const style = parseStyle(attributes.style);

    const context = {
      fill: style.fill ?? attributes.fill ?? parent.fill,
      fillRule: style["fill-rule"] ?? attributes["fill-rule"] ?? parent.fillRule,
    };

    if (SKIPPED.has(tag)) {
      if (!selfClosing) skipDepth = 1;
      continue;
    }

    const d =
      tag === "path" ? attributes.d : tag === "polygon" ? polygonData(attributes.points) : undefined;

    if (SHAPES.has(tag) && d) {
      const fill = normalizeFill(context.fill);
      if (fill !== "none") {
        shapes.push({
          tag,
          d,
          fill,
          fillRule: context.fillRule === "evenodd" ? "evenodd" : "nonzero",
        });
      }
    }

    if (!selfClosing) stack.push(context);
  }

  return shapes;
}

function parseAttributes(source) {
  const attributes = {};
  for (const match of source.matchAll(ATTRIBUTE)) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? "";
  }
  return attributes;
}

function parseStyle(source) {
  const style = {};
  for (const declaration of String(source ?? "").split(";")) {
    const separator = declaration.indexOf(":");
    if (separator === -1) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    if (property && value) style[property] = value;
  }
  return style;
}

function normalizeFill(value) {
  return String(value ?? "").trim().toLowerCase();
}

function polygonData(points) {
  const numbers = String(points ?? "")
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  if (numbers.length < 6 || numbers.length % 2 !== 0) return undefined;
  const pairs = [];
  for (let i = 0; i < numbers.length; i += 2) pairs.push([numbers[i], numbers[i + 1]]);
  const [first] = pairs;
  const d = [`M${first[0]} ${first[1]}`, ...pairs.slice(1).map((p) => `L${p[0]} ${p[1]}`), "Z"];
  return d.join(" ");
}
