// Pruebas de OKLab: ida y vuelta sin pérdida visible y distancias coherentes.
// OKLab es la base de la cuantización: si el espacio o la conversión están mal, el criterio de
// "ΔE pequeño pero área grande" deja de significar lo que dice.

import test from "node:test";
import assert from "node:assert/strict";

import {
  deltaE,
  linearToSrgb,
  oklabToHex,
  oklabToRgb,
  rgbToOklab,
  srgbToLinear,
} from "../lib/oklab.mjs";

const near = (actual, expected, eps) =>
  assert.ok(Math.abs(actual - expected) <= eps, `esperaba ${expected} ± ${eps}, obtuve ${actual}`);

test("la curva sRGB es ida y vuelta exacta en los extremos y monótona", () => {
  near(srgbToLinear(0), 0, 1e-12);
  near(srgbToLinear(1), 1, 1e-12);
  near(linearToSrgb(srgbToLinear(0.25)), 0.25, 1e-12);
  let previous = -1;
  for (let i = 0; i <= 255; i++) {
    const linear = srgbToLinear(i / 255);
    assert.ok(linear > previous);
    previous = linear;
  }
});

test("blanco y negro caen donde dice la definición de OKLab", () => {
  const white = rgbToOklab(255, 255, 255);
  const black = rgbToOklab(0, 0, 0);

  near(white[0], 1, 1e-6);
  near(white[1], 0, 1e-6);
  near(white[2], 0, 1e-6);
  near(black[0], 0, 1e-12);
  near(black[1], 0, 1e-12);
  near(black[2], 0, 1e-12);
});

test("los primarios coinciden con los valores publicados de OKLab", () => {
  const red = rgbToOklab(255, 0, 0);
  const green = rgbToOklab(0, 255, 0);
  const blue = rgbToOklab(0, 0, 255);

  near(red[0], 0.628, 0.01);
  near(red[1], 0.2249, 0.01);
  near(red[2], 0.1258, 0.01);
  near(green[0], 0.8664, 0.01);
  near(green[1], -0.2339, 0.01);
  near(green[2], 0.1795, 0.01);
  near(blue[0], 0.452, 0.01);
  near(blue[1], -0.0324, 0.01);
  near(blue[2], -0.3115, 0.01);
});

test("sRGB → OKLab → sRGB vuelve al mismo byte en una muestra amplia", () => {
  for (const color of [
    [0, 0, 0],
    [255, 255, 255],
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [128, 128, 128],
    [240, 146, 147],
    [238, 146, 147],
    [18, 52, 86],
    [250, 128, 7],
  ]) {
    const lab = rgbToOklab(...color);
    const back = oklabToRgb(...lab);
    back.forEach((value, index) => {
      const expected = color[index];
      assert.ok(
        Math.abs(value - expected) <= 1,
        `${color} → ${lab} → ${back} (canal ${index})`,
      );
    });
  }
});

test("ΔE es la distancia euclídea y ordena como el ojo", () => {
  near(deltaE([0, 0, 0], [1, 0, 0]), 1, 1e-12);
  const pink = rgbToOklab(240, 146, 147);
  const pinkAlmost = rgbToOklab(243, 147, 147);
  const green = rgbToOklab(0, 255, 0);

  assert.ok(deltaE(pink, pinkAlmost) < 0.01);
  assert.ok(deltaE(pink, green) > 0.3);
  // #F09293 y #F39393 son el caso real de vtracer: mismo color, grupos distintos.
  assert.ok(deltaE(pink, pinkAlmost) < deltaE(pink, green) / 30);
});

test("oklabToHex emite hex de 6 dígitos y satura fuera de gama", () => {
  assert.equal(oklabToHex(rgbToOklab(255, 255, 255)), "#ffffff");
  assert.equal(oklabToHex(rgbToOklab(0, 0, 0)), "#000000");
  assert.match(oklabToHex(rgbToOklab(240, 146, 147)), /^#[0-9a-f]{6}$/);
  // Fuera de gama se satura por canal: no hay mapeo de gama, y eso está bien para un banco.
  assert.match(oklabToHex([1, 3, 0]), /^#ff[0-9a-f]{4}$/);
  assert.match(oklabToHex([0, -3, -3]), /^#[0-9a-f]{6}$/);
});
