// Aplanado de `path` SVG a polilíneas, con error acotado en píxeles.
//
// Existe porque la salida de un trazador es teselada: para medir cuántas veces se recorre un
// borde hay que comparar longitudes de contorno con longitudes de unión booleana, y eso exige
// geometría, no comandos. El aplanado de Bézier es adaptativo (subdivisión de De Casteljau)
// para que `tolerance` sea una cota real de desviación y no un número de segmentos arbitrario.

const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
const COMMAND = /[MmLlHhVvCcSsQqTtAaZz]/;
const NUMBER = /^[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/;

/** Tokeniza el atributo `d` en comandos con sus argumentos, expandiendo repeticiones implícitas. */
export function parsePath(d) {
  const source = String(d ?? "");
  const raw = [];

  let index = 0;
  let current = null;
  while (index < source.length) {
    const char = source[index];

    if (char === "," || /\s/.test(char)) {
      index++;
      continue;
    }

    if (/[A-Za-z]/.test(char)) {
      if (!COMMAND.test(char)) {
        throw new Error(`comando SVG desconocido "${char}" en la posición ${index}`);
      }
      current = { cmd: char, args: [] };
      raw.push(current);
      index++;
      continue;
    }

    const match = NUMBER.exec(source.slice(index));
    if (!match) {
      throw new Error(`token inesperado "${char}" en la posición ${index}`);
    }
    if (!current) {
      throw new Error("el path debe empezar por un comando");
    }
    current.args.push(Number(match[0]));
    index += match[0].length;
  }

  return expandImplicit(raw);
}

function expandImplicit(raw) {
  const out = [];
  for (const { cmd, args } of raw) {
    const arity = ARITY[cmd.toUpperCase()];

    if (arity === 0) {
      if (args.length) throw new Error(`"${cmd}" no admite argumentos`);
      out.push({ cmd, args: [] });
      continue;
    }

    if (args.length < arity || args.length % arity !== 0) {
      throw new Error(`"${cmd}" espera múltiplos de ${arity} argumentos, recibió ${args.length}`);
    }

    // Tras un moveto, las coordenadas sobrantes son linetos de la misma relatividad.
    const repeat = cmd === "M" ? "L" : cmd === "m" ? "l" : cmd;

    for (let offset = 0; offset < args.length; offset += arity) {
      out.push({
        cmd: offset === 0 ? cmd : repeat,
        args: args.slice(offset, offset + arity),
      });
    }
  }
  return out;
}

/** Longitud euclídea de una polilínea. */
export function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return total;
}

/**
 * Convierte un `d` en subpaths aplanados.
 * Devuelve `[{ points, closed }]`; `points` incluye el punto de cierre cuando el subpath cierra.
 */
export function pathToPolylines(d, { tolerance = 0.25 } = {}) {
  if (!(tolerance > 0)) throw new Error("tolerance debe ser positiva");

  const commands = parsePath(d);
  const lines = [];

  let cursor = [0, 0];
  let start = [0, 0];
  let points = null;
  let lastCubic = null;
  let lastQuad = null;

  const flush = (closed) => {
    if (points && points.length >= 2) lines.push({ points, closed });
    points = null;
  };

  const push = (point) => {
    const last = points.at(-1);
    if (!last || last[0] !== point[0] || last[1] !== point[1]) points.push(point);
    cursor = point;
  };

  for (const { cmd, args } of commands) {
    const upper = cmd.toUpperCase();
    const relative = cmd !== upper;
    const ox = relative ? cursor[0] : 0;
    const oy = relative ? cursor[1] : 0;

    switch (upper) {
      case "M": {
        flush(false);
        const point = [ox + args[0], oy + args[1]];
        points = [point];
        cursor = point;
        start = point;
        lastCubic = null;
        lastQuad = null;
        break;
      }

      case "L": {
        if (!points) points = [cursor];
        push([ox + args[0], oy + args[1]]);
        lastCubic = null;
        lastQuad = null;
        break;
      }

      case "H": {
        if (!points) points = [cursor];
        push([relative ? cursor[0] + args[0] : args[0], cursor[1]]);
        lastCubic = null;
        lastQuad = null;
        break;
      }

      case "V": {
        if (!points) points = [cursor];
        push([cursor[0], relative ? cursor[1] + args[0] : args[0]]);
        lastCubic = null;
        lastQuad = null;
        break;
      }

      case "C": {
        if (!points) points = [cursor];
        const c1 = [ox + args[0], oy + args[1]];
        const c2 = [ox + args[2], oy + args[3]];
        const end = [ox + args[4], oy + args[5]];
        flattenCubic(cursor, c1, c2, end, tolerance, points);
        cursor = end;
        lastCubic = c2;
        lastQuad = null;
        break;
      }

      case "S": {
        if (!points) points = [cursor];
        const c1 = lastCubic
          ? [2 * cursor[0] - lastCubic[0], 2 * cursor[1] - lastCubic[1]]
          : cursor;
        const c2 = [ox + args[0], oy + args[1]];
        const end = [ox + args[2], oy + args[3]];
        flattenCubic(cursor, c1, c2, end, tolerance, points);
        cursor = end;
        lastCubic = c2;
        lastQuad = null;
        break;
      }

      case "Q": {
        if (!points) points = [cursor];
        const c1 = [ox + args[0], oy + args[1]];
        const end = [ox + args[2], oy + args[3]];
        flattenQuadratic(cursor, c1, end, tolerance, points);
        cursor = end;
        lastQuad = c1;
        lastCubic = null;
        break;
      }

      case "T": {
        if (!points) points = [cursor];
        const c1 = lastQuad
          ? [2 * cursor[0] - lastQuad[0], 2 * cursor[1] - lastQuad[1]]
          : cursor;
        const end = [ox + args[0], oy + args[1]];
        flattenQuadratic(cursor, c1, end, tolerance, points);
        cursor = end;
        lastQuad = c1;
        lastCubic = null;
        break;
      }

      case "A": {
        if (!points) points = [cursor];
        const end = [ox + args[5], oy + args[6]];
        const cubics = arcToCubics(cursor, args[0], args[1], args[2], args[3], args[4], end);
        for (const [c1, c2, point] of cubics) {
          flattenCubic(cursor, c1, c2, point, tolerance, points);
          cursor = point;
        }
        cursor = end;
        lastCubic = null;
        lastQuad = null;
        break;
      }

      case "Z": {
        if (points) {
          push(start);
          flush(true);
        }
        cursor = start;
        lastCubic = null;
        lastQuad = null;
        break;
      }
    }
  }

  flush(false);
  return lines;
}

function flattenCubic(p0, p1, p2, p3, tolerance, out, depth = 0) {
  if (depth >= 18 || cubicIsFlat(p0, p1, p2, p3, tolerance)) {
    appendPoint(out, p3);
    return;
  }

  const p01 = midpoint(p0, p1);
  const p12 = midpoint(p1, p2);
  const p23 = midpoint(p2, p3);
  const p012 = midpoint(p01, p12);
  const p123 = midpoint(p12, p23);
  const p0123 = midpoint(p012, p123);

  flattenCubic(p0, p01, p012, p0123, tolerance, out, depth + 1);
  flattenCubic(p0123, p123, p23, p3, tolerance, out, depth + 1);
}

function flattenQuadratic(p0, p1, p2, tolerance, out) {
  // Elevación a cúbica: exacta, y reutiliza el aplanado con cota de error.
  const c1 = [p0[0] + (2 / 3) * (p1[0] - p0[0]), p0[1] + (2 / 3) * (p1[1] - p0[1])];
  const c2 = [p2[0] + (2 / 3) * (p1[0] - p2[0]), p2[1] + (2 / 3) * (p1[1] - p2[1])];
  flattenCubic(p0, c1, c2, p2, tolerance, out);
}

function cubicIsFlat(p0, p1, p2, p3, tolerance) {
  const chord = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
  if (chord < tolerance) {
    return (
      Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) <= tolerance &&
      Math.hypot(p2[0] - p0[0], p2[1] - p0[1]) <= tolerance
    );
  }
  return (
    distanceToSegment(p1, p0, p3) <= tolerance && distanceToSegment(p2, p0, p3) <= tolerance
  );
}

function distanceToSegment(point, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point[0] - a[0], point[1] - a[1]);
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared),
  );
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
}

function midpoint(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function appendPoint(out, point) {
  const last = out.at(-1);
  if (!last || last[0] !== point[0] || last[1] !== point[1]) out.push(point);
}

/** Arco SVG (F.6.5) a cúbicas, con corrección de radios inválidos. */
function arcToCubics(from, rx, ry, rotation, largeArc, sweep, to) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  rx = Math.abs(rx);
  ry = Math.abs(ry);

  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) {
    return [[[x1, y1], [x2, y2], [x2, y2]]];
  }

  const phi = (rotation * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }

  const numerator =
    rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const sign = largeArc === sweep ? -1 : 1;
  const coefficient = denominator === 0 ? 0 : sign * Math.sqrt(Math.max(0, numerator / denominator));

  const cxp = coefficient * ((rx * y1p) / ry);
  const cyp = coefficient * (-(ry * x1p) / rx);
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const theta1 = vectorAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = vectorAngle(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry,
  );
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;

  const segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const step = delta / segments;
  const alpha = (4 / 3) * Math.tan(step / 4);

  const cubics = [];
  let theta = theta1;
  for (let i = 0; i < segments; i++) {
    const next = theta + step;
    const c1 = ellipsePoint(cx, cy, rx, ry, cosPhi, sinPhi, theta, alpha, 1);
    const c2 = ellipsePoint(cx, cy, rx, ry, cosPhi, sinPhi, next, alpha, -1);
    const end = ellipsePoint(cx, cy, rx, ry, cosPhi, sinPhi, next, 0, 0);
    cubics.push([c1, c2, i === segments - 1 ? to : end]);
    theta = next;
  }
  return cubics;
}

function vectorAngle(ux, uy, vx, vy) {
  const dot = ux * vx + uy * vy;
  const lengths = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  const ratio = lengths === 0 ? 1 : Math.min(1, Math.max(-1, dot / lengths));
  const angle = Math.acos(ratio);
  return ux * vy - uy * vx < 0 ? -angle : angle;
}

function ellipsePoint(cx, cy, rx, ry, cosPhi, sinPhi, theta, alpha, direction) {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const x = cosPhi * rx * cos - sinPhi * ry * sin + cx;
  const y = sinPhi * rx * cos + cosPhi * ry * sin + cy;
  if (direction === 0) return [x, y];
  const dx = -cosPhi * rx * sin - sinPhi * ry * cos;
  const dy = -sinPhi * rx * sin + cosPhi * ry * cos;
  return [x + direction * alpha * dx, y + direction * alpha * dy];
}
