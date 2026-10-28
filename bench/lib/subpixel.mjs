// Estimación de borde por debajo del píxel: la mitad que necesita el motor.
//
// El experimento 05 dejó un hueco de 0,032 de SSIM contra Vector Magic y demostró que **no se
// cierra con parámetros**: `pathPrecision` de 2 a 8 produce exactamente la misma salida, porque el
// problema no son los decimales del `d`, es el muestreo. El motor decide «esto es tinta / esto es
// papel» píxel a píxel sobre la rejilla original, así que un trazo de 1,5 px se convierte en un
// contorno entero y el antialiasing se tira a la basura.
//
// La geometría del transform —ampliar la luminancia y devolver el `d` a la rejilla— vive en
// `subpixel-transform.mjs`, que no importa el motor y por eso lo puede usar la demo del navegador.
// Aquí queda lo único que sí lo necesita: componer las dos mitades con un trazador inyectado.
//
// El umbral es el Otsu de la **imagen original**: la interpolación bilineal es lineal en intensidad,
// así que la rampa entre papel y tinta cruza el mismo nivel que cruzaba el borde duro. Cambiar el
// umbral al de la imagen ampliada movería el corte y volvería a medir otra cosa.

import vtracer from "@visioncortex/vtracer";

import { lineArtOptions } from "./lineart.mjs";
import { rescaleSvg, subpixelFrame } from "./subpixel-transform.mjs";

export {
  FIXED_DECIMALS,
  rescaleSvg,
  scalePathData,
  subpixelFrame,
  upsampleLuminance,
} from "./subpixel-transform.mjs";

/**
 * Traza una imagen de line art a `scale`× con el trazador que se le pase y la devuelve al marco
 * original.
 *
 * El trazador entra como argumento para que el mismo camino corra en Node (`vtracer.convertPixels`)
 * y en el navegador (el wasm cargado a mano): si esto llamara al motor directamente, `web/app.mjs`
 * no podría reutilizarlo sin arrastrar el paquete de Node.
 *
 * @param {(rgba: Uint8Array, width: number, height: number, options: object) => string} trace
 * @param {{ width: number, height: number, gray: Float32Array, threshold: number }} signals
 * @param {{ scale?: number } & object} [overrides] `scale` más los ajustes del preset (`simplify`).
 */
export function traceSubpixel(trace, signals, { scale = 1, ...overrides } = {}) {
  if (!signals || typeof signals.threshold !== "number") {
    throw new Error("hacen falta las señales de la imagen (lineArtSignals)");
  }
  if (typeof trace !== "function") {
    throw new Error("hace falta una función de trazado (rgba, width, height, options) → SVG");
  }

  const frame = subpixelFrame(signals, scale);
  const svg = trace(frame.rgba, frame.width, frame.height, lineArtOptions(signals, overrides));

  return rescaleSvg(svg, signals.width, signals.height, 1 / scale);
}

/** El camino de Node: `traceSubpixel` con el motor nativo. */
export function subpixelOptions(signals, overrides = {}) {
  return traceSubpixel(
    (rgba, width, height, options) => vtracer.convertPixels(rgba, width, height, options),
    signals,
    overrides,
  );
}
