// Entrada y salida de herramienta (lead-in / lead-out).
//
// Un contorno se corta cerrado y la herramienta tiene que perforar en algún punto. Si perfora
// sobre el contorno o dentro de la pieza, la marca queda a la vista. La entrada y la salida son dos
// segmentos que llegan al contorno desde el scrap, de modo que la perforación caiga fuera del
// material.
//
// Criterio del lado: `unionRings` y `offsetRings` devuelven los anillos con el material a la
// izquierda del sentido de giro (contornos con área positiva, agujeros con área negativa, igual que
// distingue el kerf). Entonces el scrap, para una dirección de avance `t = (tx, ty)`, es siempre la
// derecha: `n = (ty, -tx)`. Ese es el lado al que se abren la entrada y la salida, sin mirar el
// signo del área: para un agujero, el scrap es el hueco, y la derecha del giro cae dentro del
// hueco.
//
// Punto de ataque: el vértice del anillo donde el scrap ocupa más ángulo (el más convexo desde el
// material, calculado con el signo del área como el kerf), del más cerrado al más abierto. La
// entrada va hacia atrás de la tangente y la salida hacia delante, las dos inclinadas `angleDeg`
// hacia el scrap, así que con 0° son tangentes puras y con 90° perpendiculares al contorno.
//
// Un vértice sólo se acepta si los dos segmentos quedan en el scrap y no cortan ninguna arista del
// anillo. Si ninguno sirve, el anillo se devuelve cerrado: en un agujero convexo (un cuadrado, un
// círculo) no hay vértice desde el que entrar tangencialmente sin tocar material, y una
// perpendicular inventada sería peor que no entrar. Queda fuera también comprobar el cruce contra
// los demás anillos de la pieza y redondear el punto de ataque.

const EPS = 1e-9;
const SAMPLES = 9; // puntos por segmento para decidir de qué lado del anillo cae

/**
 * Añade entrada y salida a cada anillo que tenga un punto de ataque limpio.
 * @param {number[][][]} rings anillos cerrados, en unidades de la geometría
 * @param {{ lengthMm: number, angleDeg?: number, scale?: number }} options
 *   `lengthMm` en mm; `angleDeg` entre 0 (tangencial puro) y 90 (perpendicular al contorno);
 *   `scale` son mm por unidad de la geometría (1 si ya viene en mm)
 * @returns {number[][][]} anillos abiertos (primera y última coordenada no coinciden) o cerrados
 *   cuando no hay entrada posible
 */
export function addLead(rings, { lengthMm, angleDeg = 0, scale = 1 } = {}) {
  if (!(lengthMm > 0)) {
    throw new Error(`el largo de la entrada debe ser positivo, recibí ${lengthMm}`);
  }
  if (!(angleDeg >= 0 && angleDeg <= 90)) {
    throw new Error(`el ángulo de la entrada debe estar entre 0 y 90 grados, recibí ${angleDeg}`);
  }
  if (!(scale > 0)) {
    throw new Error(`la escala debe ser positiva, recibí ${scale}`);
  }

  const length = lengthMm / scale;
  const phi = (angleDeg * Math.PI) / 180;
  return (rings ?? []).map((ring) => openWithLead(ring, length, phi));
}

function openWithLead(ring, length, phi) {
  const points = withoutClosure(ring);
  if (points.length < 3) return points;

  const area = signedArea(points);
  if (Math.abs(area) < EPS) return points;

  const ring_ = { points, area };
  for (const index of attackCandidates(points, area)) {
    const lead = buildLead(points, index, { length, phi });
    if (isClean(ring_, lead)) return assemble(points, index, lead);
  }
  // Sin punto de ataque limpio se devuelve cerrado: mejor sin entrada que con una entrada que
  // pinche el material.
  return [...points, points[0]];
}

// Entrada hacia atrás del borde de salida y salida hacia delante del borde de llegada, las dos
// inclinadas hacia el scrap.
function buildLead(points, index, { length, phi }) {
  const count = points.length;
  const vertex = points[index];
  const next = points[(index + 1) % count];
  const previous = points[(index - 1 + count) % count];

  const outgoing = unit(subtract(next, vertex));
  const incoming = unit(subtract(vertex, previous));
  const cosine = Math.cos(phi);
  const sine = Math.sin(phi);

  const leadInDirection = unit(
    add(scale(outgoing, -cosine), scale(scrapNormal(outgoing), sine)),
  );
  const leadOutDirection = unit(
    add(scale(incoming, cosine), scale(scrapNormal(incoming), sine)),
  );

  return {
    vertex,
    leadIn: [cleanPoint(add(vertex, scale(leadInDirection, length))), vertex],
    leadOut: [vertex, cleanPoint(add(vertex, scale(leadOutDirection, length)))],
  };
}

// El scrap queda a la derecha del sentido de giro, para contornos y para agujeros.
function scrapNormal(direction) {
  return [direction[1], -direction[0]];
}

function isClean(ring, lead) {
  return (
    !crossesAnyEdge(lead.leadIn, ring.points) &&
    !crossesAnyEdge(lead.leadOut, ring.points) &&
    !entersMaterial(ring, lead.leadIn) &&
    !entersMaterial(ring, lead.leadOut)
  );
}

// La trayectoria es el anillo recorrido desde el ataque, cerrando otra vez en él, con la entrada
// delante y la salida detrás. El vértice repetido es intencional: la herramienta pasa dos veces.
function assemble(points, index, lead) {
  const ordered = [...points.slice(index), ...points.slice(0, index)];
  return [lead.leadIn[0], ...ordered, lead.vertex, lead.leadOut[1]];
}

// Vértices ordenados por el ángulo de scrap: el giro se mide con el signo del área, así que los
// convexos desde el material van primero y los de un agujero se hunden en el hueco.
function attackCandidates(points, area) {
  const count = points.length;
  const sign = area > 0 ? 1 : -1;
  const turns = [];

  for (let index = 0; index < count; index++) {
    const previous = points[(index - 1 + count) % count];
    const vertex = points[index];
    const next = points[(index + 1) % count];
    const turn = cross(subtract(vertex, previous), subtract(next, vertex)) * sign;
    turns.push({ index, turn });
  }

  return turns.sort((a, b) => b.turn - a.turn || a.index - b.index).map((entry) => entry.index);
}

// Un segmento no puede cortar el anillo fuera del vértice de ataque: las aristas que lo tocan se
// excluyen porque comparten ese punto.
function crossesAnyEdge([from, to], points) {
  const count = points.length;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    const isVertexEdge = samePoint(points[i], from) || samePoint(points[i], to);
    if (isVertexEdge) continue;
    if (segmentsCross(from, to, points[i], points[j])) return true;
  }
  return false;
}

// ¿Algún punto del segmento cae del lado del material? El material está dentro del anillo cuando el
// área es positiva y fuera cuando es negativa.
function entersMaterial(ring, [from, to]) {
  for (let i = 1; i <= SAMPLES; i++) {
    const t = i / (SAMPLES + 1);
    const point = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
    const inside = pointInRing(ring.points, point);
    if (ring.area > 0 ? inside : !inside) return true;
  }
  return false;
}

function segmentsCross(a, b, c, d) {
  const first = cross(subtract(b, a), subtract(c, a));
  const second = cross(subtract(b, a), subtract(d, a));
  const third = cross(subtract(d, c), subtract(a, c));
  const fourth = cross(subtract(d, c), subtract(b, c));

  if (
    ((first > EPS && second < -EPS) || (first < -EPS && second > EPS)) &&
    ((third > EPS && fourth < -EPS) || (third < -EPS && fourth > EPS))
  ) {
    return true;
  }

  // Colineales: hay cruce sólo si los tramos se solapan, no si se tocan en un punto.
  if (Math.abs(first) <= EPS && Math.abs(second) <= EPS) {
    return between(a, b, c) || between(a, b, d) || between(c, d, a) || between(c, d, b);
  }
  return false;
}

function between(a, b, point) {
  const direction = subtract(b, a);
  const lengthSquared = direction[0] ** 2 + direction[1] ** 2;
  if (lengthSquared < EPS) return false;
  const t = ((point[0] - a[0]) * direction[0] + (point[1] - a[1]) * direction[1]) / lengthSquared;
  return t > EPS && t < 1 - EPS;
}

function pointInRing(points, [x, y]) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y === yj > y) continue;
    if (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function withoutClosure(ring) {
  const points = (ring ?? []).map(([x, y]) => cleanPoint([x, y]));
  if (points.length > 1) {
    const first = points[0];
    const last = points.at(-1);
    if (samePoint(first, last)) points.pop();
  }
  return points;
}

function signedArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

function samePoint(a, b) {
  return Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;
}

/**
 * ¿La trayectoria de `addLead` quedó abierta? No alcanza con comparar el primer punto con el
 * último: en un vértice recto con 45° la entrada y la salida caen sobre la misma diagonal y los
 * extremos coinciden. Lo que sí es cierto siempre es que un anillo abierto repite el vértice de
 * ataque: es el primer punto de la geometría y el penúltimo del recorrido.
 * @param {number[][]} ring
 * @returns {boolean}
 */
export function isOpenPath(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return false;
  return samePoint(ring[1], ring.at(-2));
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1]];
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1]];
}

function scale(vector, factor) {
  return [vector[0] * factor, vector[1] * factor];
}

function cross(a, b) {
  return a[0] * b[1] - a[1] * b[0];
}

function unit(vector) {
  const length = Math.hypot(vector[0], vector[1]);
  if (length < EPS) return [0, 0];
  return [vector[0] / length, vector[1] / length];
}

// Un -0 emitido en SVG o DXF es ruido, no una coordenada distinta.
function cleanPoint([x, y]) {
  return [Object.is(x, -0) ? 0 : x, Object.is(y, -0) ? 0 : y];
}
