// Línea central del trazo: máscara de tinta → esqueleto de 1 px → polilíneas.
//
// Un trazador de contornos devuelve la **frontera** de la tinta: dos curvas por cada trazo, una a
// cada lado, más la cáscara de cada letra. Para grabado y para un plotter de pluma eso es el doble
// de recorrido y, en un trazo fino, dos pasadas sobre el mismo surco. Lo que hace falta es la
// **cresta** del trazo: la curva de un píxel de ancho que pasa por el medio.
//
// El camino es el clásico de tres pasos, sin dependencias:
//
//   1. `inkMask`   — binariza por luminancia. La convención es la del motor (experimento 07): es
//                    tinta lo que queda *por debajo* del umbral, y el umbral del preset ya viene
//                    desplazado (`lineArtOptions`), así que aquí no se vuelve a decidir el corte.
//   2. `thin`      — adelgazado de Zhang–Suen. Borra píxeles de frontera en dos subpasos hasta que
//                    no cambia nada, conservando la conectividad. Una franja de 2 px queda en una
//                    sola fila. Al final devuelve los extremos que el adelgazado se come, para que
//                    la línea central llegue hasta donde llega la tinta.
//   3. `traceSkeleton` — convierte el mapa de bits en polilíneas cortando en los nodos (grado ≠ 2).
//                    Un cruce no es «una línea que pasa»: es un nodo de grado 4, y mezclarlo daría
//                    una polilínea que da la vuelta en el cruce.
//
// `simplifyPolyline` (Ramer–Douglas–Peucker) y `polylineLength` convierten las escaleras de píxel en
// segmentos con un número de nodos que un plotter puede recorrer.
//
// Lo que este módulo **no** hace: no engorda ni corrige grosores (un trazo de 8 px y uno de 3 px dan
// la misma línea central, que es lo que se quiere para grabar pero no para reproducir el dibujo), no
// separa trazos que se tocan y no distingue texto de dibujo. Y no devuelve el eje medial: el
// adelgazado conserva la topología, así que un relleno grande colapsa a un punto en lugar de dar la
// X de sus diagonales. Las limitaciones están medidas en `docs/experimento-09-linea-central.md`.

// Se importa aquí arriba, aunque se use al final del archivo: `polylineLength` ya existe y se mide
// igual en todo el banco (perímetros de contorno, uniones), así que se reexporta en lugar de duplicar
// la fórmula y arriesgar dos longitudes distintas para lo mismo.
import { polylineLength } from "./path-to-polyline.mjs";

export { polylineLength };

// Vecinos en el orden de Zhang–Suen (P2..P9), en sentido horario desde el norte. El mismo orden se
// usa para recorrer: así el trazo es predecible y reproducible entre corridas.
const NEIGHBORS = [
  [0, -1], // P2 N
  [1, -1], // P3 NE
  [1, 0], // P4 E
  [1, 1], // P5 SE
  [0, 1], // P6 S
  [-1, 1], // P7 SW
  [-1, 0], // P8 W
  [-1, -1], // P9 NW
];

/** Índice de vecino a partir de un desplazamiento (dx, dy) en −1..1. */
const DIRECTION = new Int8Array(9).fill(-1);
NEIGHBORS.forEach(([dx, dy], index) => {
  DIRECTION[(dx + 1) * 3 + (dy + 1)] = index;
});

// Se importa arriba, junto a las constantes, aunque se use al final del archivo: `polylineLength`
// ya existe y se mide igual en todo el banco (perímetros de contorno, uniones), así que se reexporta
// en lugar de duplicar la fórmula y arriesgar dos longitudes distintas para lo mismo.

/**
 * Máscara de tinta: 1 donde la luminancia está por debajo de `threshold`, 0 en el resto.
 *
 * `gray` es una imagen de luminancia (`luminance()` de `lineart.mjs`), no RGBA: la decisión de qué
 * es tinta se toma una sola vez, en el mismo espacio en el que se midió el umbral de Otsu.
 */
export function inkMask(gray, width, height, threshold) {
  const pixels = width * height;
  if (gray.length < pixels) throw new Error("la imagen no tiene width × height píxeles");
  if (typeof threshold !== "number" || Number.isNaN(threshold)) {
    throw new Error("hace falta un umbral numérico");
  }

  const mask = new Uint8Array(pixels);
  for (let p = 0; p < pixels; p++) mask[p] = gray[p] < threshold ? 1 : 0;
  return mask;
}

/**
 * Adelgazado de Zhang–Suen.
 *
 * Dos subpasos por iteración, cada uno con sus cuatro condiciones: entre 2 y 6 vecinos, exactamente
 * una transición 0→1 en la vuelta de vecinos (para no romper la línea), y dos productos que marcan
 * el lado noroeste y el sureste. Se borran todos los marcados de un subpaso a la vez; borrar uno a
 * uno sesga el resultado hacia el orden de recorrido.
 *
 * `maxIterations` acota el coste: cada iteración cuesta una pasada por los píxeles que siguen siendo
 * tinta. Con `maxIterations` corto, un relleno grande queda sin adelgazar del todo en lugar de
 * colgar la corrida.
 *
 * El adelgazado se come los extremos de los trazos gruesos: la punta es «frontera» como cualquier
 * otro borde, así que una barra de 5 px de grosor pierde ~2 px por cada punta. Por eso el último paso
 * alarga cada extremo por dentro de la tinta, en la dirección en la que venía la línea, hasta que la
 * tinta se acaba. Sin eso, cada trazo corto de un dibujo saldría más corto que el original.
 */
export function thin(mask, width, height, { maxIterations = 250 } = {}) {
  const pixels = width * height;
  if (mask.length < pixels) throw new Error("la máscara no tiene width × height píxeles");
  if (!(maxIterations >= 0)) throw new Error("maxIterations debe ser no negativo");

  const out = Uint8Array.from(mask.subarray(0, pixels));

  // Solo se recorren los píxeles que siguen siendo tinta: el coste cae rápido en cuanto el trazo
  // se afina, y un fondo blanco enorme no se vuelve a mirar en cada iteración.
  let live = [];
  for (let i = 0; i < pixels; i++) if (out[i]) live.push(i);

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let removed = 0;

    for (const subStep of [0, 1]) {
      const marked = [];
      for (const i of live) {
        if (out[i] && isRemovable(out, width, height, i, subStep)) marked.push(i);
      }
      for (const i of marked) out[i] = 0;
      removed += marked.length;
    }

    if (removed === 0) break;
    live = live.filter((i) => out[i] === 1);
  }

  extendEndpoints(out, mask, width, height);
  return out;
}

/**
 * Alarga cada extremo del esqueleto por dentro de la máscara original.
 *
 * Solo toca píxeles de grado 1: camina en la dirección que marca su único vecino (la tangente del
 * trazo) mientras el píxel siga siendo tinta y no haya esqueleto. La caminata es corta por
 * construcción: la tinta se acaba justo donde acababa el trazo original.
 */
function extendEndpoints(skeleton, mask, width, height) {
  const pixels = width * height;
  const ink = (x, y) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;

  const endpoints = [];
  for (let i = 0; i < pixels; i++) {
    if (!skeleton[i]) continue;
    if (countNeighbours(skeleton, width, height, i) === 1) endpoints.push(i);
  }

  const limit = Math.max(width, height);
  for (const index of endpoints) {
    const x = index % width;
    const y = (index - x) / width;

    let stepX = 0;
    let stepY = 0;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (skeleton[ny * width + nx]) {
        stepX = Math.sign(x - nx);
        stepY = Math.sign(y - ny);
        break;
      }
    }
    if (stepX === 0 && stepY === 0) continue;

    let cx = x + stepX;
    let cy = y + stepY;
    for (let step = 0; step < limit; step++) {
      if (!ink(cx, cy)) break;
      const target = cy * width + cx;
      if (skeleton[target]) break;
      skeleton[target] = 1;
      cx += stepX;
      cy += stepY;
    }
  }
}

/** Número de vecinos de 8 de un píxel, contando solo tinta. */
function countNeighbours(mask, width, height, index) {
  const x = index % width;
  const y = (index - x) / width;

  let count = 0;
  for (const [dx, dy] of NEIGHBORS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < width && ny < height && mask[ny * width + nx]) count++;
  }
  return count;
}

/** Ventana de 8 vecinos reutilizada: `thin` es síncrona y no reentrante, y en una imagen de
 * 3000×1200 reservar 8 bytes por píxel y por subpaso son millones de reservas inútiles. */
const WINDOW = new Uint8Array(8);

/** Condiciones de borrado de un píxel en uno de los dos subpasos de Zhang–Suen. */
function isRemovable(mask, width, height, index, subStep) {
  const x = index % width;
  const y = (index - x) / width;

  const p = WINDOW;
  for (let k = 0; k < 8; k++) {
    const nx = x + NEIGHBORS[k][0];
    const ny = y + NEIGHBORS[k][1];
    p[k] = nx < 0 || ny < 0 || nx >= width || ny >= height ? 0 : mask[ny * width + nx];
  }

  // P2 N, P3 NE, P4 E, P5 SE, P6 S, P7 SW, P8 W, P9 NW. Las cuatro diagonales no entran en las
  // condiciones de Zhang–Suen, así que se dejan fuera del destructuring a propósito.
  const [n, , e, , s, , w] = p;

  let neighbors = 0;
  let transitions = 0;
  for (let k = 0; k < 8; k++) {
    neighbors += p[k];
    if (p[k] === 0 && p[(k + 1) % 8] === 1) transitions++;
  }

  if (neighbors < 2 || neighbors > 6 || transitions !== 1) return false;

  if (subStep === 0) return n * e * s === 0 && e * s * w === 0;
  return n * e * w === 0 && n * s * w === 0;
}

/**
 * Convierte un esqueleto de 1 px en polilíneas `[[x, y], …]`.
 *
 * Se corta en todo píxel cuyo grado (número de vecinos de 8, descontando el diagonal redundante) sea
 * distinto de 2: los extremos (grado 1) y los nudos (grado 3 o más). Recorrer un nudo sin cortar
 * produce una polilínea que entra en el cruce, gira y sale por otro brazo, que es imposible de grabar
 * sin levantar la pluma.
 *
 * Un ciclo cerrado sale con el primer punto repetido al final, igual que en `path-to-polyline.mjs`.
 * Los píxeles aislados (grado 0) se descartan: no son una línea y una polilínea de un punto no
 * tiene longitud.
 */
export function traceSkeleton(mask, width, height) {
  const pixels = width * height;
  if (mask.length < pixels) throw new Error("la máscara no tiene width × height píxeles");

  // Un vecino diagonal es redundante cuando alguno de los dos píxeles ortogonales que los une
  // también es tinta: la conexión ya está hecha por ese píxel, y contarla otra vez inventa un nodo de
  // grado 3 en mitad de una curva suave. Sin este filtro, el escalón de un círculo se lee como un
  // cruce falso y un anillo sale partido en trozos de 1 px.
  const isInk = (x, y) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;

  const neighboursOf = (index) => {
    const x = index % width;
    const y = (index - x) / width;
    const list = [];
    for (const [dx, dy] of NEIGHBORS) {
      if (!isInk(x + dx, y + dy)) continue;
      if (dx !== 0 && dy !== 0 && (isInk(x + dx, y) || isInk(x, y + dy))) continue;
      list.push((y + dy) * width + (x + dx));
    }
    return list;
  };

  const degree = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i++) {
    if (mask[i]) degree[i] = neighboursOf(i).length;
  }

  const coordinate = (index) => {
    const x = index % width;
    return [x, (index - x) / width];
  };

  const direction = (from, to) => {
    const fx = from % width;
    const fy = (from - fx) / width;
    const tx = to % width;
    const ty = (to - tx) / width;
    return DIRECTION[(tx - fx + 1) * 3 + (ty - fy + 1)];
  };

  // Una arista es no dirigida: se marca en los dos sentidos para no recorrerla dos veces.
  const seen = new Uint8Array(pixels);
  const hasEdge = (from, to) => (seen[from] & (1 << direction(from, to))) !== 0;
  const markEdge = (from, to) => {
    seen[from] |= 1 << direction(from, to);
    seen[to] |= 1 << direction(to, from);
  };

  const walk = (start, first) => {
    const points = [coordinate(start)];
    markEdge(start, first);

    let previous = start;
    let current = first;
    points.push(coordinate(current));

    // Mientras el píxel sea de paso, se sigue el único vecino que no es el de vuelta.
    while (degree[current] === 2) {
      const next = neighboursOf(current).find((j) => j !== previous && !hasEdge(current, j));
      if (next === undefined) break;
      markEdge(current, next);
      previous = current;
      current = next;
      points.push(coordinate(current));
    }

    return points;
  };

  const polylines = [];

  // Extremos y nudos: cada arista que sale de ellos es el principio de una polilínea.
  for (let i = 0; i < pixels; i++) {
    if (!mask[i] || degree[i] === 0 || degree[i] === 2) continue;
    for (const j of neighboursOf(i)) {
      if (hasEdge(i, j)) continue;
      polylines.push(walk(i, j));
    }
  }

  // Ciclos aislados: sin extremos ni nudos, el recorrido anterior no los ve. Se empieza por
  // cualquiera de sus píxeles y se da la vuelta entera hasta volver al punto de partida.
  for (let i = 0; i < pixels; i++) {
    if (!mask[i] || degree[i] !== 2 || seen[i] !== 0) continue;
    const first = neighboursOf(i)[0];
    if (first === undefined) continue;
    polylines.push(walk(i, first));
  }

  return polylines;
}

/**
 * Longitud total de la línea central de una máscara, en píxeles.
 *
 * Sustituye a la suma de perímetros de contorno cuando lo que se compara es «cuánto tiene que
 * recorrer la herramienta». `tolerance` simplifica antes de medir: la escalera de píxel de una
 * diagonal mide √2 por paso y sobreestima un trazo diagonal hasta un 8 %.
 *
 * El ancho y el alto son argumentos obligatorios porque un `Uint8Array` no lleva su forma: la
 * máscara sola no permite saber dónde termina una fila.
 */
export function maskLength(mask, width, height, { tolerance = 0 } = {}) {
  let total = 0;
  for (const points of traceSkeleton(mask, width, height)) {
    total += polylineLength(tolerance > 0 ? simplifyPolyline(points, tolerance) : points);
  }
  return total;
}

/**
 * Ramer–Douglas–Peucker: se queda con los puntos que no se pueden aproximar sin salirse de
 * `tolerance` píxeles. Iterativo (pila explícita) para que un contorno de miles de puntos no
 * reviente la pila de llamadas.
 *
 * Conserva siempre el primero y el último punto. En una polilínea cerrada esos dos coinciden, así
 * que el cierre se mantiene y la forma no se abre.
 */
export function simplifyPolyline(points, tolerance = 1) {
  if (!(tolerance >= 0)) throw new Error("la tolerancia debe ser no negativa");
  if (points.length <= 2) return points.map(([x, y]) => [x, y]);

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop();

    let farthest = -1;
    let farthestDistance = 0;
    for (let i = first + 1; i < last; i++) {
      const distance = distanceToSegment(points[i], points[first], points[last]);
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthest = i;
      }
    }

    if (farthest >= 0 && farthestDistance > tolerance) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }

  return points.filter((_, index) => keep[index] === 1).map(([x, y]) => [x, y]);
}

/** Distancia de un punto al segmento `a`–`b` (misma fórmula que el aplanado de `path-to-polyline`). */
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
