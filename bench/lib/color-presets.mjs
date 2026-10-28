// Presets de color: dos formas de entregar la misma imagen, medidas contra Vector Magic.
//
// `curvas` es el camino de siempre: Béziers ajustadas (`mode: spline`) y regiones recortadas unas de
// otras (`hierarchical: cutout`). Es la salida para cortar y para escalar: pocos nodos, bordes
// limpios, geometría que un plotter puede seguir.
//
// `fidelidad` es la respuesta a una pregunta concreta: ¿por qué Vector Magic reproduce el raster y
// nosotros no? El experimento 14 midió que el hueco no era paleta ni muestreo, era el ajuste de
// curvas: trazando píxel a píxel (`mode: pixel`) el SSIM sube de 0,9351 a 0,9774 en ilustración y de
// 0,9518 a 0,9631 en póster, al nivel del competidor (0,9808 / 0,9672), y el archivo pesa menos.
// El precio es geométrico: los bordes son escalones de píxel y no se escalan con dignidad.
//
// La paleta no cambia entre modos para ilustración y póster; en foto el modo fidelidad necesita más
// ranuras (24): con 12, el 0,7729 del modo pixel se queda corto.

/** Opciones del motor por modo, sin la paleta ni el `simplify`. */
export const COLOR_MODES = {
  curvas: { mode: "spline", hierarchical: "cutout" },
  fidelidad: { mode: "pixel", filterSpeckle: 2 },
};

/**
 * Ranuras de paleta del modo fidelidad por categoría.
 *
 * Ilustración y póster tienen pocas regiones reales y no ganan con más; foto sí: 24 colores llevan el
 * Ángel de 0,7841 a 0,8365, por encima del render de Vector Magic (0,8267).
 */
export const FIDELITY_COLORS = {
  illustration: 12,
  poster: 16,
  photo: 24,
};

/** Nombre del modo por defecto (el de siempre). */
export const DEFAULT_COLOR_MODE = "curvas";

/**
 * Opciones que se pasan al motor para un modo de color.
 *
 * La paleta va **explícita**: si se deja que vtracer agrupe, deriva los colores y fragmenta el SVG
 * (experimento 03). `simplify` solo tiene efecto en el modo de curvas; en `pixel` el motor lo ignora,
 * así que no se envía.
 *
 * @param {string[]} paletteHex colores `#rrggbb` ya decididos
 * @param {{ mode?: string, simplify?: number }} [settings]
 */
export function colorTraceOptions(paletteHex, settings = {}) {
  const { mode = DEFAULT_COLOR_MODE, simplify = 0.6 } = settings;
  const preset = COLOR_MODES[mode];
  if (!preset) {
    throw new Error(`modo de color desconocido: "${mode}" (usa ${Object.keys(COLOR_MODES).join(", ")})`);
  }
  if (!Array.isArray(paletteHex) || paletteHex.length === 0) {
    throw new Error("hace falta una paleta con al menos un color");
  }

  const options = { ...preset, optimize: 2, palette: paletteHex };
  if (preset.mode !== "pixel") options.simplify = simplify;
  return options;
}
