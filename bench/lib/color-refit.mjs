// Reajuste de curvas sobre un SVG de etiquetas de píxel: el paso que convierte la fidelidad del modo
// píxel en curvas.
//
// El experimento 15 midió que el modo `pixel` alcanza a Vector Magic (0,9776 en ilustración) pero
// entrega una escalera de 64 036 nodos, y que el modo `spline` entrega curvas limpias pero se queda en
// 0,9351. Este paso se queda con lo bueno de los dos: toma el SVG del modo píxel, lee sus anillos y
// sustituye cada `d` por Béziers ajustadas (`curve-fit.mjs`), con las esquinas conservadas.
//
// Es geometría pura —no importa el motor ni Node—, así que la demo del navegador puede usarla igual
// que `subpixel-transform.mjs`.

import { fitCurves, ringsFromPath } from "./curve-fit.mjs";

/**
 * Ajustes por defecto del reajuste, medidos en el experimento 15.
 *
 * `0,25` de tolerancia de simplificación y de error de ajuste: en Gum Tree da 11 527 nodos, 295 KB y
 * SSIM 0,9766 (el modo píxel da 0,9776 con 64 036 nodos). Bajar a 0,2 compra +0,0008 de SSIM por
 * +9 % de nodos; subir a 0,3 ahorra 7 % por −0,0009.
 */
export const REFIT_DEFAULTS = {
  rdpTolerance: 0.25,
  fitError: 0.25,
  cornerAngle: 60,
};

/**
 * Sustituye la geometría de cada `<path>` de un SVG por curvas ajustadas a sus anillos.
 *
 * Conserva todo lo demás del elemento (el relleno manda: el SVG sigue siendo una región pintada por
 * forma) y el orden de las formas, que en el modo píxel es el orden de pintado.
 *
 * @param {string} svg SVG con geometría de polígonos (`M/H/V/L/Z`)
 * @param {{ rdpTolerance?: number, fitError?: number, cornerAngle?: number }} [settings]
 * @returns {string}
 */
export function refitSvg(svg, settings = {}) {
  if (typeof svg !== "string") throw new Error("hace falta un SVG en texto");

  let paths = 0;
  const refit = svg.replace(/<path\b([^>]*?)\sd="([^"]*)"([^>]*?)\/?>/g, (whole, before, d, after) => {
    const rings = ringsFromPath(d);
    if (rings.length === 0) return whole;
    paths++;
    return `<path${before} d="${fitCurves(rings, settings)}"${after}/>`;
  });

  if (paths === 0) throw new Error("el SVG no tiene formas que reajustar");
  return refit;
}
