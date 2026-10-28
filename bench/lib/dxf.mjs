// Escritor DXF mínimo para corte: R2000 (AC1015) con LWPOLYLINE y unidades en milímetros.
//
// R12 sería más compatible todavía, pero no tiene variable de unidades y el archivo saldría
// ambiguo. AC1015 con `$INSUNITS = 4` es lo que leen LightBurn, Inkscape, LibreCAD y QCAD sin que
// el usuario tenga que adivinar la escala. Los anillos llegan en mm y en coordenadas de imagen
// (y hacia abajo), así que aquí se invierte el eje Y, como exige DXF.
//
// Con entrada de herramienta la trayectoria deja de ser cerrada: `closed: false` emite
// LWPOLYLINE abiertas y conserva el vértice repetido, que ahí sí es recorrido.
// Con separación de tintas hay una capa por spot, y entonces el archivo necesita la tabla de capas
// para que LightBurn y QCAD las muestren con su nombre en vez de inventar la capa 0.

const LAYER = "CUT";
const INVALID_LAYER_CHARS = /[<>/\\":;?*|=,`]/g;

/**
 * Convierte anillos (mm, y hacia abajo) en un DXF de una sola capa.
 * @param {number[][][]} rings
 * @param {{ layer?: string, closed?: boolean | ((ring: number[][]) => boolean) }} options
 *   `closed` puede ser un valor o una función por anillo: con entrada de herramienta unos anillos
 *   quedan abiertos y otros cerrados en el mismo archivo
 */
export function ringsToDxf(rings, { layer = LAYER, closed = true } = {}) {
  const entities = (rings ?? [])
    .map((ring) => polyline(ring, layer, isClosed(closed, ring)))
    .filter(Boolean)
    .join("");
  return serialize({ entities });
}

/**
 * Convierte capas con nombre en un DXF de varias capas.
 * @param {{ name: string, rings: number[][][] }[]} layers en el orden en que se quieren imprimir
 * @param {{ closed?: boolean | ((ring: number[][]) => boolean) }} options
 */
export function layersToDxf(layers, { closed = true } = {}) {
  const entities = [];
  const names = [];
  for (const layer of layers ?? []) {
    const name = layerName(layer.name);
    if (!names.includes(name)) names.push(name);
    entities.push(
      (layer.rings ?? [])
        .map((ring) => polyline(ring, name, isClosed(closed, ring)))
        .filter(Boolean)
        .join(""),
    );
  }
  return serialize({ entities: entities.join(""), layerNames: names });
}

function isClosed(closed, ring) {
  return typeof closed === "function" ? closed(ring) : closed;
}

function serialize({ entities, layerNames = null }) {
  const lines = [
    "0", "SECTION", "2", "HEADER",
    "9", "$ACADVER", "1", "AC1015",
    "9", "$INSUNITS", "70", "4",
    "0", "ENDSEC",
  ];
  if (layerNames) lines.push(table(layerNames));
  lines.push(
    "0", "SECTION", "2", "ENTITIES",
    entities,
    "0", "ENDSEC",
    "0", "EOF",
    "",
  );
  return lines.join("\n");
}

function table(layerNames) {
  const lines = ["0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", "70", String(layerNames.length)];
  for (const name of layerNames) {
    lines.push(
      "0", "LAYER",
      "2", name,
      "70", "0", // sin flags: capa normal y visible
      "62", "7", // color por defecto (blanco/negro según el tema)
      "6", "CONTINUOUS",
    );
  }
  lines.push("0", "ENDTAB", "0", "ENDSEC");
  return lines.join("\n") + "\n";
}

function polyline(ring, layer, closed) {
  const points = (ring ?? []).slice();
  if (closed) {
    const [first] = points;
    const last = points.at(-1);
    if (first && last && last[0] === first[0] && last[1] === first[1]) points.pop();
  }
  if (points.length < (closed ? 3 : 2)) return null;

  const lines = [
    "0", "LWPOLYLINE",
    "8", layer,
    "90", String(points.length),
    "70", closed ? "1" : "0",
    "43", "0.0", // ancho constante: el corte no dibuja grosor
  ];

  for (const [x, y] of points) {
    lines.push("10", number(x), "20", number(-y)); // DXF crece hacia arriba
  }

  return lines.join("\n") + "\n";
}

// DXF R2000 no acepta cualquier carácter en el nombre de una capa.
function layerName(name) {
  const clean = String(name ?? "")
    .replace(INVALID_LAYER_CHARS, "-")
    .trim();
  if (!clean) throw new Error("una capa sin nombre no se puede emitir");
  return clean.slice(0, 31); // 31 es el máximo de AC1015
}

function number(value) {
  const rounded = Number(value.toFixed(4));
  return (Object.is(rounded, -0) ? 0 : rounded).toString();
}
