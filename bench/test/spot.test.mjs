// Separación de tintas: cada color es una capa con nombre, área y orden de impresión. El orden
// importa en serigrafía, así que se fija por área descendente y no por orden de aparición.

import test from "node:test";
import assert from "node:assert/strict";

import { printOrder, spotLayers } from "../lib/spot.mjs";

const square = (x, y, size) => `M${x} ${y} H${x + size} V${y + size} H${x} Z`;

// Áreas a mano: verde 400, rojo 100, azul 25.
const shapes = [
  { d: square(0, 0, 10), fill: "#ff0000" },
  { d: square(20, 0, 20), fill: "#00ff00" },
  { d: square(50, 0, 5), fill: "#0000ff" },
];

test("una capa por color, nombrada y ordenada por área descendente", () => {
  const layers = spotLayers(shapes);

  assert.deepEqual(
    layers.map((layer) => [layer.name, layer.color, layer.area, layer.order]),
    [
      ["CUT-1", "#00ff00", 400, 1],
      ["CUT-2", "#ff0000", 100, 2],
      ["CUT-3", "#0000ff", 25, 3],
    ],
  );
  assert.ok(layers.every((layer) => layer.rings.length > 0));
});

test("los nombres pedidos se asignan en orden de impresión", () => {
  const layers = spotLayers(shapes, { names: ["fondo", "medio", "detalle"] });
  assert.deepEqual(
    layers.map((layer) => [layer.order, layer.name, layer.color]),
    [
      [1, "fondo", "#00ff00"],
      [2, "medio", "#ff0000"],
      [3, "detalle", "#0000ff"],
    ],
  );
});

test("el área descuenta los agujeros", () => {
  const withHole = [{ d: `${square(0, 0, 10)} ${square(3, 3, 4)}`, fill: "#000000" }];
  const [layer] = spotLayers(withHole);
  assert.ok(Math.abs(layer.area - 84) < 1e-6, `área ${layer.area}`);
  assert.equal(layer.rings.length, 2);
});

test("la escala se aplica al área y a la geometría", () => {
  const [layer] = spotLayers([{ d: square(0, 0, 10), fill: "#000000" }], { scale: 2 });
  assert.ok(Math.abs(layer.area - 400) < 1e-6, `área ${layer.area}`);
  const xs = layer.rings[0].map(([x]) => x);
  assert.equal(Math.max(...xs), 20);
});

test("printOrder ordena sin tocar la entrada", () => {
  const layers = [
    { name: "CUT-1", color: "#0000ff", area: 25, rings: [] },
    { name: "CUT-2", color: "#00ff00", area: 400, rings: [] },
    { name: "CUT-3", color: "#ff0000", area: 100, rings: [] },
  ];
  const ordered = printOrder(layers);

  assert.deepEqual(
    ordered.map((layer) => [layer.name, layer.order]),
    [
      ["CUT-2", 1],
      ["CUT-3", 2],
      ["CUT-1", 3],
    ],
  );
  assert.deepEqual(
    layers.map((layer) => layer.order),
    [undefined, undefined, undefined],
  );
});

test("un nombre de más o de menos se rechaza con un mensaje en español", () => {
  assert.throws(() => spotLayers(shapes, { names: ["uno"] }), /3 colores y 1 nombre/);
  assert.throws(
    () => spotLayers(shapes, { names: ["a", "b", "c", "d"] }),
    /3 colores y 4 nombres/,
  );
  assert.throws(() => spotLayers(shapes, { names: ["a", "a", "c"] }), /repetido/);
});
