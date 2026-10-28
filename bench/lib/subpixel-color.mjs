// Muestreo subpíxel en el pipeline de color.
//
// El hueco contra Vector Magic no es el mismo en todas las categorías: 0,015 en póster, 0,046 en
// ilustración y 0,157 en foto. El experimento 12 demostró en line art que buena parte del hueco era
// de **muestreo**: el motor decide tinta/papel (o «este píxel es de este color») sobre la rejilla
// original, así que un borde de 1,5 px se convierte en un escalón.
//
// Aquí se hace lo mismo con color, en tres variantes que separan las dos decisiones:
//
// - `baseline`: lo de siempre. Paleta y asignación a 1×, trazar a 1×. Es el control.
// - `render`: paleta y asignación a 1×, se amplía el *render cuantizado* y se traza a 3×. El motor ve
//   rampas entre colores de la paleta y puede poner el borde entre píxeles.
// - `source`: paleta a 1×, se amplía la **imagen original** y cada píxel ampliado se asigna a la
//   paleta ya decidida, en OKLab. La decisión de qué colores no se toca; la de dónde cambia, sí.
// - `full`: se amplía la imagen, se cuantiza **a 3×** y se traza. La paleta también se decide con el
//   muestreo fino, al precio de que los colores intermedios de la interpolación compiten por ranuras.
//
// En las tres variantes subpíxel el `d` vuelve dividido por la escala, así que el SVG queda en el
// marco de la imagen original y es comparable con el render del competidor.

import vtracer from "@visioncortex/vtracer";

import { colorTraceOptions } from "./color-presets.mjs";
import { nearestPalette, quantize, renderQuantized } from "./quantize.mjs";
import { rescaleSvg, upsampleRgba } from "./subpixel-transform.mjs";

// El muestreo es del transform puro (lo comparte el line art y lo puede usar el navegador), pero el
// pipeline de color lo expone porque es su primer paso.
export { upsampleRgba };

export const COLOR_VARIANTS = ["baseline", "render", "source", "full"];

/**
 * Traza una imagen de color con el trazador inyectado y devuelve el SVG en el marco original.
 *
 * @param {(rgba: Uint8Array, width: number, height: number, options: object) => string} trace
 * @param {{ rgba: Uint8Array, width: number, height: number }} image
 * @param {{ scale?: number, variant?: string, maxColors?: number, simplify?: number, mode?: string }} [settings]
 * @returns {{ svg: string, paletteSize: number, scale: number }}
 */
export function traceColorSubpixel(trace, image, settings = {}) {
  const { rgba, width, height } = image ?? {};
  const { scale = 3, variant = "source", maxColors = 12, simplify = 0.6, mode = "curvas" } = settings;

  if (!rgba || !width || !height) throw new Error("hace falta la imagen (rgba, width, height)");
  if (typeof trace !== "function") {
    throw new Error("hace falta una función de trazado (rgba, width, height, options) → SVG");
  }
  if (!COLOR_VARIANTS.includes(variant)) {
    throw new Error(`variante de color desconocida: "${variant}" (usa ${COLOR_VARIANTS.join(", ")})`);
  }
  if (!Number.isInteger(scale) || scale < 1) {
    throw new Error(`la escala debe ser un entero ≥ 1, recibió ${scale}`);
  }

  if (variant === "baseline") {
    const palette = quantize(rgba, width, height, { maxColors });
    const rendered = renderQuantized(rgba, width, height, palette);
    const svg = trace(rendered, width, height, colorTraceOptions(palette.paletteHex, { mode, simplify }));
    return { svg, paletteSize: palette.palette.length, scale: 1 };
  }

  if (variant === "full") {
    const frame = upsampleRgba(rgba, width, height, scale);
    const palette = quantize(frame.rgba, frame.width, frame.height, { maxColors });
    const rendered = renderQuantized(frame.rgba, frame.width, frame.height, palette);
    const svg = trace(rendered, frame.width, frame.height, colorTraceOptions(palette.paletteHex, { mode, simplify }));
    return {
      svg: rescaleSvg(svg, width, height, 1 / scale),
      paletteSize: palette.palette.length,
      scale,
    };
  }

  // Las dos variantes que conservan la paleta decidida a 1×.
  const palette = quantize(rgba, width, height, { maxColors });
  let frame;
  let rendered;

  if (variant === "render") {
    const base = renderQuantized(rgba, width, height, palette);
    frame = upsampleRgba(base, width, height, scale);
    rendered = frame.rgba;
  } else {
    frame = upsampleRgba(rgba, width, height, scale);
    const indices = nearestPalette(frame.rgba, palette.palette);
    rendered = renderQuantized(frame.rgba, frame.width, frame.height, { palette: palette.palette, indices });
  }

  const svg = trace(rendered, frame.width, frame.height, colorTraceOptions(palette.paletteHex, { mode, simplify }));
  return { svg: rescaleSvg(svg, width, height, 1 / scale), paletteSize: palette.palette.length, scale };
}

/** El camino de Node: `traceColorSubpixel` con el motor nativo. */
export function subpixelColorOptions(image, settings = {}) {
  return traceColorSubpixel(
    (rgba, width, height, options) => vtracer.convertPixels(rgba, width, height, options),
    image,
    settings,
  );
}
