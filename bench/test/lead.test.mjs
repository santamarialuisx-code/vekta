// La entrada de herramienta no es cosmética: si la perforación cae sobre el contorno, la marca
// queda en la pieza. Estas pruebas fijan largo, ángulo y lado (fuera del material) sobre una
// geometría con respuesta a mano.

import test from "node:test";
import assert from "node:assert/strict";

import { addLead, isOpenPath } from "../lib/lead.mjs";

const square = (size, x = 0, y = 0) => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
  [x, y],
];

const vector = (from, to) => [to[0] - from[0], to[1] - from[1]];
const norm = ([dx, dy]) => Math.hypot(dx, dy);
const angleBetween = (a, b) => {
  const cosine = (a[0] * b[0] + a[1] * b[1]) / (norm(a) * norm(b));
  return (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI;
};

// Rayo horizontal: cuenta cuántas aristas cruza el punto.
const inside = (ring, [x, y]) => {
  let hits = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y === yj > y) continue;
    if (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hits++;
  }
  return hits % 2 === 1;
};

// Distancia de un punto al contorno: los puntos que caen justo sobre el borde no son "dentro".
const distanceToRing = (ring, [x, y]) => {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : ((x - ax) * dx + (y - ay) * dy) / lengthSquared;
    const clamped = Math.min(1, Math.max(0, t));
    best = Math.min(best, Math.hypot(x - (ax + dx * clamped), y - (ay + dy * clamped)));
  }
  return best;
};

const samples = (from, to, count = 200) => {
  const points = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    points.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
  }
  return points;
};

test("sin ángulo, la entrada y la salida continúan la tangente del contorno", () => {
  const piece = square(100);
  const [path] = addLead([piece], { lengthMm: 5, angleDeg: 0 });

  // Ataque en el primer vértice convexo (0,0): la entrada llega desde atrás del borde de salida
  // y la salida continúa el borde de llegada, las dos por fuera del cuadrado.
  assert.deepEqual(path, [
    [-5, 0],
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
    [0, 0],
    [0, -5],
  ]);

  // El anillo original no se muta.
  assert.deepEqual(piece, square(100));
});

test("la entrada y la salida miden lo pedido y forman el ángulo pedido", () => {
  const piece = square(100);
  const [path] = addLead([piece], { lengthMm: 5, angleDeg: 45 });

  const vertex = path[1];
  const leadIn = vector(path[0], vertex);
  const leadOut = vector(path.at(-2), path.at(-1));

  assert.ok(Math.abs(norm(leadIn) - 5) < 1e-9, `entrada ${norm(leadIn)}`);
  assert.ok(Math.abs(norm(leadOut) - 5) < 1e-9, `salida ${norm(leadOut)}`);

  // El borde de salida del cuadrado va hacia +X y el de llegada hacia -Y.
  assert.ok(Math.abs(angleBetween(leadIn, [1, 0]) - 45) < 1e-9, "ángulo de entrada");
  assert.ok(Math.abs(angleBetween(leadOut, [0, -1]) - 45) < 1e-9, "ángulo de salida");
});

test("con 0° las entradas son tangentes y con 90° perpendiculares al contorno", () => {
  const piece = square(100);

  const [tangent] = addLead([piece], { lengthMm: 4, angleDeg: 0 });
  assert.ok(Math.abs(angleBetween(vector(tangent[0], tangent[1]), [1, 0])) < 1e-9);
  assert.ok(Math.abs(angleBetween(vector(tangent.at(-2), tangent.at(-1)), [0, -1])) < 1e-9);

  const [normal] = addLead([piece], { lengthMm: 4, angleDeg: 90 });
  assert.ok(Math.abs(angleBetween(vector(normal[0], normal[1]), [1, 0]) - 90) < 1e-9);
  assert.ok(Math.abs(angleBetween(vector(normal.at(-2), normal.at(-1)), [0, -1]) - 90) < 1e-9);
  // A 90° la entrada viene de la normal exterior del borde de salida: x = 0, y < 0.
  assert.ok(Math.abs(normal[0][0]) < 1e-9 && normal[0][1] < 0, `entrada ${normal[0]}`);
});

test("ningún punto de la entrada ni de la salida cae dentro de la pieza", () => {
  const piece = square(100);
  const ring = piece.slice(0, -1);

  for (const angleDeg of [0, 15, 30, 45, 60, 75, 90]) {
    const [path] = addLead([piece], { lengthMm: 10, angleDeg });
    const leadIn = samples(path[0], path[1]);
    const leadOut = samples(path.at(-2), path.at(-1));

    for (const point of [...leadIn, ...leadOut]) {
      if (distanceToRing(ring, point) < 1e-9) continue; // toca el borde: no entra
      assert.ok(!inside(ring, point), `punto ${point} dentro de la pieza con ${angleDeg}°`);
    }
  }
});

test("el largo se pide en mm y la geometría puede venir en píxeles", () => {
  // 200 px por lado, escala 0,5 mm/px → 5 mm de entrada son 10 px.
  const [path] = addLead([square(200)], { lengthMm: 5, angleDeg: 0, scale: 0.5 });
  assert.ok(Math.abs(norm(vector(path[0], path[1])) - 10) < 1e-9);
  assert.ok(Math.abs(norm(vector(path.at(-2), path.at(-1))) - 10) < 1e-9);
});

test("la trayectoria emitida queda abierta", () => {
  const [path] = addLead([square(100)], { lengthMm: 3, angleDeg: 30 });
  assert.notDeepEqual(path[0], path.at(-1));
  assert.equal(path.length, 4 + 1 + 2); // 4 vértices + cierre en el ataque + 2 extremos de entrada
  assert.equal(isOpenPath(path), true);
});

test("con 45° en una esquina recta los extremos coinciden y la trayectoria sigue abierta", () => {
  const [path] = addLead([square(100)], { lengthMm: 5, angleDeg: 45 });
  // La entrada y la salida caen sobre la misma diagonal del scrap de la esquina.
  assert.ok(
    Math.abs(path[0][0] - path.at(-1)[0]) < 1e-12 && Math.abs(path[0][1] - path.at(-1)[1]) < 1e-12,
    `${path[0]} vs ${path.at(-1)}`,
  );
  // Aun así, el vértice de ataque se repite en el recorrido: la polilínea es abierta.
  assert.equal(isOpenPath(path), true);
  // Un anillo cerrado, en cambio, no tiene entrada.
  assert.equal(isOpenPath([...square(100)]), false);
});

test("un anillo degenerado se devuelve sin entrada", () => {
  const flat = [
    [0, 0],
    [1, 0],
    [0, 0],
  ];
  assert.deepEqual(addLead([flat], { lengthMm: 3, angleDeg: 45 }), [
    [
      [0, 0],
      [1, 0],
    ],
  ]);
});

test("un agujero convexo se devuelve cerrado: no hay entrada que no toque material", () => {
  // Agujero con giro contrario, como lo devuelve `unionRings`: el material es el exterior.
  const hole = [
    [0, 0],
    [0, 10],
    [10, 10],
    [10, 0],
    [0, 0],
  ];
  const [path] = addLead([hole], { lengthMm: 2, angleDeg: 0 });
  assert.deepEqual(path, hole);
  assert.equal(isOpenPath(path), false);
});

test("largo y ángulo fuera de rango se rechazan con un mensaje en español", () => {
  assert.throws(() => addLead([square(10)], { lengthMm: 0 }), /largo de la entrada debe ser positivo/);
  assert.throws(() => addLead([square(10)], { lengthMm: 2, angleDeg: 120 }), /entre 0 y 90/);
});
