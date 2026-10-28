// Escritor DXF mínimo para corte: R2000 (AC1015) con LWPOLYLINE y unidades en milímetros.
//
// R12 sería más compatible todavía, pero no tiene variable de unidades y el archivo saldría
// ambiguo. AC1015 con `$INSUNITS = 4` es lo que leen LightBurn, Inkscape, LibreCAD y QCAD sin que
// el usuario tenga que adivinar la escala. Los anillos llegan en mm y en coordenadas de imagen
// (y hacia abajo), así que aquí se invierte el eje Y, como exige DXF.

const LAYER = "CUT";

/** Convierte anillos cerrados (mm, y hacia abajo) en un DXF de una sola capa. */
export function ringsToDxf(rings, { layer = LAYER } = {}) {
  const entities = rings
    .map((ring) => polyline(ring, layer))
    .filter(Boolean)
    .join("");

  return [
    "0", "SECTION", "2", "HEADER",
    "9", "$ACADVER", "1", "AC1015",
    "9", "$INSUNITS", "70", "4",
    "0", "ENDSEC",
    "0", "SECTION", "2", "ENTITIES",
    entities,
    "0", "ENDSEC",
    "0", "EOF",
    "",
  ].join("\n");
}

function polyline(ring, layer) {
  const points = ring.slice();
  const [first] = points;
  const last = points.at(-1);
  if (last[0] === first[0] && last[1] === first[1]) points.pop();
  if (points.length < 3) return null;

  const lines = [
    "0", "LWPOLYLINE",
    "8", layer,
    "90", String(points.length),
    "70", "1", // cerrada
    "43", "0.0", // ancho constante: el corte no dibuja grosor
  ];

  for (const [x, y] of points) {
    lines.push("10", number(x), "20", number(-y)); // DXF crece hacia arriba
  }

  return lines.join("\n") + "\n";
}

function number(value) {
  const rounded = Number(value.toFixed(4));
  return (Object.is(rounded, -0) ? 0 : rounded).toString();
}
