// Reajuste de curvas sobre etiquetas de píxel: la última milla del experimento 15.
//
// El modo `pixel` del motor (experimento 14) sigue la frontera del raster y alcanza a Vector Magic en
// fidelidad, pero entrega una escalera: 64 036 nodos y bordes que no se escalan. El modo `spline`
// entrega curvas limpias pero se separa del borde real (0,9577 de techo). Vector Magic hace las dos
// cosas en dos etapas —etiquetas alineadas al píxel y suavizado subpíxel después—, y esto es la
// segunda etapa, hecha aquí en vez de pedirle al motor que la haga.
//
// El método es el clásico de Potrace/Schneider, adaptado a lo que ya tenemos:
//
//   1. **Anillos** — se lee el `d` del modo píxel (`M/H/V/L/Z`, absolutos y relativos).
//   2. **Simplificación** — Ramer–Douglas–Peucker con tolerancia declarada, empezando en la esquina
//      más aguda para no cortar una esquina por la mitad.
//   3. **Esquinas** — un vértice cuyo giro pasa de `cornerAngle` se conserva: no se suaviza.
//   4. **Ajuste** — entre esquinas se ajusta una Bézier cúbica por mínimos cuadrados (Schneider),
//      y si el error supera `fitError` se parte por el punto peor y se repite. El error se mide
//      contra el anillo **suavizado**, que es la estimación del borde real (el centro de la rampa de
//      antialiasing). Contra la escalera de píxel, la curva entregada queda a `fitError` ±0,1 px:
//      una curva correcta se separa de la escalera por construcción.
//   5. **Cierre** — el anillo termina en `Z`, así que cada región sigue siendo un relleno.
//
// Es geometría pura: no importa el motor ni Node, así que el navegador puede usarla igual que
// `subpixel-transform.mjs`.

import { parsePath } from "./path-to-polyline.mjs";

/** Ajustes por defecto, medidos en el experimento 15. */
export const FIT_DEFAULTS = {
  rdpTolerance: 0.6,
  fitError: 0.6,
  cornerAngle: 60,
  /** Pasadas de media móvil (1,2,1) sobre el anillo antes de simplificar: quitan la escalera. */
  smoothPasses: 2,
  /** Vértices a cada lado para medir un giro: con ventana 2, un escalón no es una esquina. */
  cornerWindow: 2,
  decimals: 2,
};

/** Profundidad máxima de partición de un tramo (evita recursión infinita en anillos ruidosos). */
const MAX_DEPTH = 12;
/** Muestras por curva para medir el error contra el anillo original. */
const ERROR_SAMPLES = 16;

/**
 * Lee anillos de un `d` de polígonos (`M`, `L`, `H`, `V`, `Z`).
 *
 * Los comandos de curva se rechazan a propósito: si un `d` trae `C/S/Q/T/A`, no es una etiqueta de
 * píxel y el error de ajuste que se mide después no significaría nada.
 *
 * @param {string} d
 * @returns {number[][][]} un anillo por subcamino, sin repetir el primer punto al final
 */
export function ringsFromPath(d) {
  const rings = [];
  let ring = null;
  let cx = 0;
  let cy = 0;

  const flush = () => {
    if (ring && ring.length >= 3) rings.push(ring);
    ring = null;
  };

  for (const { cmd, args } of parsePath(d)) {
    const upper = cmd.toUpperCase();
    const relative = cmd !== upper;

    switch (upper) {
      case "M": {
        flush();
        const x = relative ? cx + args[0] : args[0];
        const y = relative ? cy + args[1] : args[1];
        ring = [[x, y]];
        cx = x;
        cy = y;
        break;
      }
      case "L": {
        const x = relative ? cx + args[0] : args[0];
        const y = relative ? cy + args[1] : args[1];
        ring?.push([x, y]);
        cx = x;
        cy = y;
        break;
      }
      case "H": {
        const x = relative ? cx + args[0] : args[0];
        ring?.push([x, cy]);
        cx = x;
        break;
      }
      case "V": {
        const y = relative ? cy + args[0] : args[0];
        ring?.push([cx, y]);
        cy = y;
        break;
      }
      case "Z":
        cx = ring?.[0]?.[0] ?? cx;
        cy = ring?.[0]?.[1] ?? cy;
        flush();
        break;
      default:
        throw new Error(`comando de curva en una etiqueta de píxel: "${cmd}"`);
    }
  }
  flush();

  return rings;
}

/**
 * Ajusta curvas a una lista de anillos y devuelve un `d` en el mismo espacio de coordenadas.
 *
 * @param {number[][][]} rings
 * @param {{ rdpTolerance?: number, fitError?: number, cornerAngle?: number, decimals?: number }} [options]
 * @returns {string}
 */
export function fitCurves(rings, options = {}) {
  if (!Array.isArray(rings) || rings.length === 0) {
    throw new Error("hacen falta anillos (ringsFromPath) para ajustar");
  }
  const settings = { ...FIT_DEFAULTS, ...options };
  const parts = [];

  for (const raw of rings) {
    if (!Array.isArray(raw) || raw.length < 3) {
      throw new Error("un anillo necesita al menos tres puntos");
    }
    const ring = dedupe(raw);
    // La escalera se suaviza antes de simplificar: sin esto el RDP conserva el zigzag de un píxel y
    // cada escalón se convierte en una «esquina», así que no queda ni un tramo que ajustar.
    const smoothed = rotateToSharpest(smoothRing(ring, settings.smoothPasses));
    const simplified = simplifyClosed(smoothed, settings.rdpTolerance);
    parts.push(fitRing(smoothed, simplified, settings));
  }

  return parts.join(" ");
}

// --- anillo ---------------------------------------------------------------

/** Quita puntos consecutivos repetidos y el cierre explícito. */
function dedupe(points) {
  const out = [];
  for (const point of points) {
    const last = out.at(-1);
    if (!last || last[0] !== point[0] || last[1] !== point[1]) out.push([point[0], point[1]]);
  }
  while (out.length > 1 && out[0][0] === out.at(-1)[0] && out[0][1] === out.at(-1)[1]) out.pop();
  return out;
}

/**
 * Media móvil (1,2,1) sobre el anillo cerrado, para quitar el zigzag de la rejilla.
 *
 * Los vértices que giran más de 60° en una ventana de dos píxeles se quedan donde están: son esquinas
 * de verdad (una caja, un ala, una letra) y suavizarlas encogería la figura. En un escalón de un
 * píxel el giro neto de la ventana es pequeño, así que esa zona sí se suaviza.
 */
function smoothRing(points, passes) {
  const cornerMask = points.map((_, index) => turnAngle(points, index, 2) >= 60);
  let current = points;
  for (let pass = 0; pass < passes; pass++) {
    const next = current.map((point, index) => {
      if (cornerMask[index]) return point;
      const previous = current[(index - 1 + current.length) % current.length];
      const following = current[(index + 1) % current.length];
      return [
        (previous[0] + 2 * point[0] + following[0]) / 4,
        (previous[1] + 2 * point[1] + following[1]) / 4,
      ];
    });
    current = next;
  }
  return current;
}

/** Giro (en grados, 0–180) del vértice `index` de un anillo cerrado. */
function turnAngle(points, index, window = 1) {
  const previous = points[(index - window + points.length * (window + 1)) % points.length];
  const current = points[index];
  const next = points[(index + window) % points.length];
  const ax = current[0] - previous[0];
  const ay = current[1] - previous[1];
  const bx = next[0] - current[0];
  const by = next[1] - current[1];
  const length = Math.hypot(ax, ay) * Math.hypot(bx, by);
  if (length === 0) return 0;
  const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / length));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Deja el anillo empezando en su esquina más aguda: el ajuste nunca parte una esquina. */
function rotateToSharpest(points) {
  let best = 0;
  let bestAngle = -1;
  for (let i = 0; i < points.length; i++) {
    const angle = turnAngle(points, i);
    if (angle > bestAngle) {
      bestAngle = angle;
      best = i;
    }
  }
  return best === 0 ? points : [...points.slice(best), ...points.slice(0, best)];
}

/** RDP sobre el anillo cerrado, que empieza y termina en la esquina más aguda. */
function simplifyClosed(points, tolerance) {
  if (tolerance <= 0) return points;
  const open = [...points, points[0]];
  const kept = simplifyOpen(open, tolerance);
  // `simplifyOpen` conserva los dos extremos (el mismo punto): el último sobra.
  return kept.slice(0, -1);
}

/** Ramer–Douglas–Peucker iterativo sobre una polilínea abierta. */
function simplifyOpen(points, tolerance) {
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [first, last] = stack.pop();
    let worst = -1;
    let worstDistance = tolerance;
    for (let i = first + 1; i < last; i++) {
      const distance = distanceToSegment(points[i], points[first], points[last]);
      if (distance > worstDistance) {
        worstDistance = distance;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([first, worst], [worst, last]);
    }
  }

  return points.filter((_, index) => keep[index]);
}

// --- ajuste ---------------------------------------------------------------

/**
 * Ajusta un anillo ya simplificado y devuelve su subcamino.
 *
 * El error se mide contra `boundary`, que es el anillo **suavizado**: la estimación del borde real
 * (el centro de la rampa de antialiasing), no la escalera de píxel. Medir contra la escalera
 * castigaría justo el suavizado que quita los escalones: una curva correcta se separa de ella hasta
 * medio píxel por construcción.
 */
function fitRing(boundary, simplified, settings) {
  const index = buildRingIndex(boundary);
  // Una astilla de uno o dos píxeles no tiene tramo que ajustar: se emite tal cual, sin inventarle
  // curvas que la harían desaparecer.
  if (simplified.length < 3) {
    const points = simplified.length >= 2 ? simplified : boundary;
    return (
      `M ${format(points[0][0], settings.decimals)} ${format(points[0][1], settings.decimals)} ` +
      points.slice(1).map((point) => `L ${format(point[0], settings.decimals)} ${format(point[1], settings.decimals)} `).join("") +
      "Z"
    ).replace(/\s+/g, " ").trim();
  }

  const corners = [];
  for (let i = 0; i < simplified.length; i++) {
    if (turnAngle(simplified, i, settings.cornerWindow) >= settings.cornerAngle) corners.push(i);
  }
  // Un anillo suave no tiene esquinas y uno con una sola esquina necesita un segundo corte para
  // tener tramos con extremos distintos. El segundo corte va en el punto más lejano del primero.
  if (corners.length === 0) corners.push(0);
  if (corners.length === 1) {
    const opposite = farthestIndex(simplified, corners[0]);
    corners.push(opposite === corners[0] ? (corners[0] + 1) % simplified.length : opposite);
    corners.sort((a, b) => a - b);
  }

  const segments = [];
  for (let c = 0; c < corners.length; c++) {
    const from = corners[c];
    const to = corners[(c + 1) % corners.length];
    const points = cyclicSlice(simplified, from, to);
    segments.push(...fitRun(index, points, settings, 0));
  }

  const start = simplified[corners[0]];
  // El último tramo vuelve al punto de partida y lo cierra la `Z`; si además es una recta, emitirlo
  // duplicaría un nodo por anillo.
  const last = segments.at(-1);
  if (last?.type === "line" && last.to[0] === start[0] && last.to[1] === start[1]) segments.pop();

  const out = [`M ${format(start[0], settings.decimals)} ${format(start[1], settings.decimals)}`];
  for (const segment of segments) out.push(emit(segment, settings.decimals));
  out.push("Z");
  return out.join(" ");
}

/** Vértice más lejano del dado: el segundo corte de un anillo con una sola esquina. */
function farthestIndex(points, index) {
  const origin = points[index];
  let best = index;
  let bestDistance = -1;
  for (let i = 0; i < points.length; i++) {
    const distance = Math.hypot(points[i][0] - origin[0], points[i][1] - origin[1]);
    if (distance > bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/** Tramo del anillo simplificado entre dos esquinas, extremos incluidos. */
function cyclicSlice(points, from, to) {
  const out = [];
  let index = from;
  while (true) {
    out.push(points[index]);
    if (index === to) break;
    index = (index + 1) % points.length;
  }
  return out;
}

/**
 * Ajusta un tramo con una o más cúbicas, partiendo por el punto donde más se separa de la escalera
 * original. El error se mide contra el anillo de entrada, que es el contrato del módulo.
 */
function fitRun(index, points, settings, depth) {
  if (points.length === 2) {
    return [{ type: "line", from: points[0], to: points[1] }];
  }

  const cubic = fitSingleCubic(points);
  const worst = maxError(index, cubic);

  if (worst.error <= settings.fitError || depth >= MAX_DEPTH) {
    return [{ type: "cubic", points: cubic }];
  }

  const splitPoint = nearestIndex(points, worst.point);
  const split = splitPoint > 0 && splitPoint < points.length - 1 ? splitPoint : Math.floor(points.length / 2);
  return [
    ...fitRun(index, points.slice(0, split + 1), settings, depth + 1),
    ...fitRun(index, points.slice(split), settings, depth + 1),
  ];
}

/** Una cúbica por mínimos cuadrados con tangentes de cuerda (Schneider, sin reparametrizar). */
function fitSingleCubic(points) {
  const first = points[0];
  const last = points.at(-1);
  // La tangente se toma del vecino inmediato: el anillo ya viene suavizado, así que no hay escalón
  // que confunda la dirección. Con dos puntos de distancia, un tramo corto apuntaba a la cuerda.
  const tangent1 = normalize([points[1][0] - first[0], points[1][1] - first[1]]);
  const tangent2 = normalize([points.at(-2)[0] - last[0], points.at(-2)[1] - last[1]]);

  const u = chordLengthParameterize(points);
  const bezier = generateBezier(points, u, tangent1, tangent2);
  if (bezier) return bezier;

  // Sin solución estable, el tercio de la cuerda: la curva de siempre, sin sorpresas.
  const distance = Math.hypot(last[0] - first[0], last[1] - first[1]) / 3;
  return [
    first,
    [first[0] + tangent1[0] * distance, first[1] + tangent1[1] * distance],
    [last[0] + tangent2[0] * distance, last[1] + tangent2[1] * distance],
    last,
  ];
}

function chordLengthParameterize(points) {
  const u = [0];
  for (let i = 1; i < points.length; i++) {
    u.push(u[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  const total = u.at(-1) || 1;
  return u.map((value) => value / total);
}

/** Puntos de control por mínimos cuadrados para las tangentes dadas (null si degenera). */
function generateBezier(points, u, tangent1, tangent2) {
  const first = points[0];
  const last = points.at(-1);
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;

  for (let i = 0; i < points.length; i++) {
    const t = u[i];
    const mt = 1 - t;
    const b0 = mt * mt * mt;
    const b1 = 3 * t * mt * mt;
    const b2 = 3 * t * t * mt;
    const b3 = t * t * t;
    const a1 = [tangent1[0] * b1, tangent1[1] * b1];
    const a2 = [tangent2[0] * b2, tangent2[1] * b2];
    c00 += a1[0] * a1[0] + a1[1] * a1[1];
    c01 += a1[0] * a2[0] + a1[1] * a2[1];
    c11 += a2[0] * a2[0] + a2[1] * a2[1];
    const tmp = [
      points[i][0] - (first[0] * (b0 + b1) + last[0] * (b2 + b3)),
      points[i][1] - (first[1] * (b0 + b1) + last[1] * (b2 + b3)),
    ];
    x0 += a1[0] * tmp[0] + a1[1] * tmp[1];
    x1 += a2[0] * tmp[0] + a2[1] * tmp[1];
  }

  const determinant = c00 * c11 - c01 * c01;
  if (Math.abs(determinant) < 1e-12) return null;

  const alpha1 = (x0 * c11 - x1 * c01) / determinant;
  const alpha2 = (c00 * x1 - c01 * x0) / determinant;
  const chord = Math.hypot(last[0] - first[0], last[1] - first[1]);
  if (!Number.isFinite(alpha1) || !Number.isFinite(alpha2)) return null;
  if (alpha1 < 1e-3 * chord || alpha2 < 1e-3 * chord) return null;

  return [
    first,
    [first[0] + tangent1[0] * alpha1, first[1] + tangent1[1] * alpha1],
    [last[0] + tangent2[0] * alpha2, last[1] + tangent2[1] * alpha2],
    last,
  ];
}

/** Punto y error máximo de la cúbica contra el anillo original. */
function maxError(index, cubic) {
  let error = 0;
  let point = cubic[0];
  for (let i = 0; i <= ERROR_SAMPLES; i++) {
    const sample = pointOnCubic(cubic, i / ERROR_SAMPLES);
    const distance = distanceToRing(sample, index);
    if (distance > error) {
      error = distance;
      point = sample;
    }
  }
  return { error, point };
}

function pointOnCubic(cubic, t) {
  const mt = 1 - t;
  const b0 = mt * mt * mt;
  const b1 = 3 * t * mt * mt;
  const b2 = 3 * t * t * mt;
  const b3 = t * t * t;
  return [
    b0 * cubic[0][0] + b1 * cubic[1][0] + b2 * cubic[2][0] + b3 * cubic[3][0],
    b0 * cubic[0][1] + b1 * cubic[1][1] + b2 * cubic[2][1] + b3 * cubic[3][1],
  ];
}

/**
 * Índice espacial del anillo: una rejilla de celdas con los segmentos que las cruzan.
 *
 * Sin esto, medir el error de cada cúbica contra un anillo de 500 puntos cuesta O(puntos × muestras ×
 * segmentos) y el reajuste de una ilustración tarda 16 s. Con la rejilla, el segmento más cercano está
 * en la celda del punto o en las de al lado, porque el error tolerado es menor que el lado de celda.
 */
function buildRingIndex(ring, cell = 4) {
  const cells = new Map();
  const key = (x, y) => `${x}:${y}`;

  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const minX = Math.floor(Math.min(a[0], b[0]) / cell);
    const maxX = Math.floor(Math.max(a[0], b[0]) / cell);
    const minY = Math.floor(Math.min(a[1], b[1]) / cell);
    const maxY = Math.floor(Math.max(a[1], b[1]) / cell);
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        const id = key(x, y);
        const list = cells.get(id);
        if (list) list.push(i);
        else cells.set(id, [i]);
      }
    }
  }

  return { ring, cells, cell };
}

/** Distancia mínima de un punto al anillo, mirando solo las celdas cercanas. */
function distanceToRing(point, index) {
  const { ring, cells, cell } = index;
  const cx = Math.floor(point[0] / cell);
  const cy = Math.floor(point[1] / cell);
  let best = Infinity;

  // Se buscan anillos de celdas y se para cuando lo mejor encontrado ya no puede superarse: tras
  // mirar el anillo `radius`, lo no mirado está al menos a `radius * cell`. Si la zona está vacía
  // (punto fuera del anillo), barrido completo.
  for (let radius = 0; radius <= 2; radius++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      for (let y = cy - radius; y <= cy + radius; y++) {
        const list = cells.get(`${x}:${y}`);
        if (!list) continue;
        for (const i of list) {
          const distance = distanceToSegment(point, ring[i], ring[(i + 1) % ring.length]);
          if (distance < best) best = distance;
        }
      }
    }
    if (radius >= 1 && best <= radius * cell) return best;
  }
  if (best !== Infinity) return best;

  for (let i = 0; i < ring.length; i++) {
    const distance = distanceToSegment(point, ring[i], ring[(i + 1) % ring.length]);
    if (distance < best) best = distance;
  }
  return best;
}

function nearestIndex(points, target) {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < points.length; i++) {
    const distance = Math.hypot(points[i][0] - target[0], points[i][1] - target[1]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

function normalize([x, y]) {
  const length = Math.hypot(x, y);
  return length === 0 ? [0, 0] : [x / length, y / length];
}

function distanceToSegment(point, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point[0] - a[0], point[1] - a[1]);
  let t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
}

// --- salida ---------------------------------------------------------------

function emit(segment, decimals) {
  const [from, c1, c2, to] = segment.type === "cubic"
    ? segment.points
    : [segment.from, null, null, segment.to];

  if (segment.type === "line") {
    return `L ${format(to[0], decimals)} ${format(to[1], decimals)}`;
  }
  return (
    `C ${format(c1[0], decimals)} ${format(c1[1], decimals)} ` +
    `${format(c2[0], decimals)} ${format(c2[1], decimals)} ` +
    `${format(to[0], decimals)} ${format(to[1], decimals)}`
  );
}

function format(value, decimals) {
  const rounded = Number(value.toFixed(decimals));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}
