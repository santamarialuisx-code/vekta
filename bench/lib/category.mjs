// ¿Qué clase de imagen es? Line art, ilustración, póster o foto.
//
// `lib/lineart.mjs` resuelve la pregunta binaria que necesitaba el experimento 07: ¿tinta o color?
// El experimento 04, en cambio, midió un preset distinto para cada una de las cuatro categorías del
// banco, y `auto-trace.mjs` solo sabía elegir entre el modo binario y un preset de color único. Esta
// pieza cierra ese hueco con señales que ya están en la imagen, sin preguntar nada:
//
// - `distinctColors` — colores distintos tras cuantizar cada canal a 32 niveles (5 bits). Un arte
//   plano gasta pocas ranuras; una foto reparte el color por todo el cubo.
// - `luminanceEntropy` — entropía de Shannon del histograma de luminancia, normalizada 0..1
//   (dividida por los 8 bits del histograma). Mide cuánto se reparte el tono, no cuántos colores hay.
// - `meanChroma` — croma medio en OKLab, √(a²+b²), el mismo espacio en el que cuantiza el motor. Un
//   póster es color saturado de borde a borde; una ilustración suele tener fondo neutro.
// - `edgeDensity` — se publica como contexto: una foto tiene más aristas que un plano, pero un
//   escaneo técnico también, así que no decide (experimento 07).
// - `neutralShare` e `inkShare` — se reutilizan de `lineart.mjs`; la primera condición de la regla
//   es, literalmente, `looksLikeLineArt`.
//
// La regla es una cascada, no un clasificador:
//
//   1. line art    · `looksLikeLineArt` (neutro ≥ 90 % y tinta ≤ 40 %)
//   2. foto        · neutra pero no line art (foto en blanco y negro), o > 2 000 colores, o
//                    entropía > 0,85
//   3. póster      · croma medio ≥ 0,07 en OKLab (color plano saturado)
//   4. ilustración · el resto: paleta corta, croma bajo y fondo neutro
//
// Los umbrales están en el punto medio de los huecos que dejan las cuatro imágenes del banco. Ese es
// exactamente el riesgo: con cuatro casos no se puede generalizar. Es una regla con caso de prueba,
// no un clasificador, y `docs/experimento-08-clasificacion.md` lo deja escrito.

import {
  LINE_ART_RULES,
  LINE_ART_SCALE,
  lineArtOptions,
  lineArtSignals,
  looksLikeLineArt,
} from "./lineart.mjs";
import { rgbToOklab } from "./oklab.mjs";

/** Criterios de la cascada. Públicos para que el CLI y las pruebas hablen del mismo número. */
export const CATEGORY_RULES = {
  /** Bits por canal para contar colores: 32 niveles, 32 768 combinaciones. */
  quantizeBits: 5,
  /** Por encima de esta paleta a 32 niveles ya no es arte plano: es una foto. */
  photoMinColors: 2000,
  /** O el tono se reparte casi por completo (entropía de luminancia normalizada, 0..1). */
  photoMinEntropy: 0.85,
  /** Croma medio mínimo (OKLab) de un póster: color saturado de borde a borde. */
  posterMinMeanChroma: 0.07,
};

/**
 * Presets medidos en el experimento 04 (paleta × `simplify`, caída de SSIM ≤ 0,005).
 *
 * El line art conserva aquí el preset de **color** que midió ese experimento (16 colores,
 * `simplify` 1,2), pero `auto-trace.mjs` no lo usa para trazar: el experimento 07 demostró que el
 * modo binario con el Otsu de la propia imagen gana en trazo y en nodos. `tracePreset()` es el que
 * resuelve esa diferencia y devuelve el preset efectivo.
 */
export const CATEGORY_PRESETS = {
  "line-art": { colors: 16, simplify: 1.2 },
  illustration: { colors: 12, simplify: 0.6 },
  poster: { colors: 16, simplify: 0.8 },
  photo: { colors: 12, simplify: 0.8 },
};

/**
 * Señales de categoría de una imagen, en una pasada de píxel más el histograma de lineart.
 *
 * Devuelve también las señales de `lineArtSignals` (`threshold`, `separability`, `inkShare`,
 * `neutralShare`, `edgeDensity`, `gray`, `histogram`) porque la primera condición de la regla es
 * `looksLikeLineArt` y `auto-trace` necesita el umbral de Otsu para el modo binario.
 */
export function imageSignals(rgba, width, height) {
  const base = lineArtSignals(rgba, width, height);
  const pixels = width * height;

  const bits = CATEGORY_RULES.quantizeBits;
  const shift = 8 - bits;
  const side = 1 << bits;
  const colors = new Set();
  let chromaSum = 0;

  for (let p = 0; p < pixels; p++) {
    const i = p * 4;
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];

    // Cuantizar cada canal a 5 bits: dos colores que solo difieren en ruido de compresión no
    // gastan dos ranuras.
    colors.add(((r >> shift) * side + (g >> shift)) * side + (b >> shift));

    const [, a, oklabB] = rgbToOklab(r, g, b);
    chromaSum += Math.hypot(a, oklabB);
  }

  let entropy = 0;
  for (const share of base.histogram) {
    if (share > 0) entropy -= share * Math.log2(share);
  }

  return {
    ...base,
    distinctColors: colors.size,
    luminanceEntropy: entropy / Math.log2(base.histogram.length),
    meanChroma: pixels > 0 ? chromaSum / pixels : 0,
  };
}

/**
 * Regla de decisión en cascada.
 *
 * El orden no es cosmético: una foto saturada también tiene croma alto, y una foto en blanco y
 * negro es neutra como un escaneo. Cada categoría se descarta antes de mirar la siguiente, y el
 * motivo devuelto es la señal que decidió, con su umbral, para poder discutirlo.
 */
export function classifyImage(signals) {
  if (
    !signals ||
    typeof signals.distinctColors !== "number" ||
    typeof signals.luminanceEntropy !== "number" ||
    typeof signals.meanChroma !== "number"
  ) {
    throw new Error("hacen falta las señales de la imagen (imageSignals)");
  }

  const rules = CATEGORY_RULES;
  const verdict = looksLikeLineArt(signals);

  if (verdict.lineArt) {
    return { category: "line-art", reason: `line art: ${verdict.reason}` };
  }

  // Neutra y descartada por `looksLikeLineArt` solo puede ser por tinta: es una foto en blanco y
  // negro. Se reutiliza su motivo, que ya nombra el porcentaje y el máximo.
  if (signals.neutralShare >= LINE_ART_RULES.minNeutralShare) {
    return { category: "photo", reason: verdict.reason };
  }

  if (signals.distinctColors > rules.photoMinColors) {
    return {
      category: "photo",
      reason:
        `foto: ${signals.distinctColors} colores distintos a ${1 << rules.quantizeBits} niveles, ` +
        `máximo ${rules.photoMinColors} para arte plano`,
    };
  }

  if (signals.luminanceEntropy > rules.photoMinEntropy) {
    return {
      category: "photo",
      reason:
        `foto: entropía de luminancia ${percent(signals.luminanceEntropy)}, ` +
        `máximo ${percent(rules.photoMinEntropy)} para arte plano`,
    };
  }

  if (signals.meanChroma >= rules.posterMinMeanChroma) {
    return {
      category: "poster",
      reason:
        `póster: croma medio ${percent(signals.meanChroma)}, ` +
        `mínimo ${percent(rules.posterMinMeanChroma)} para color plano saturado`,
    };
  }

  return {
    category: "illustration",
    reason:
      `ilustración: croma medio ${percent(signals.meanChroma)} ` +
      `con paleta corta (${signals.distinctColors} colores)`,
  };
}

/**
 * Preset efectivo de trazado para una categoría.
 *
 * En line art manda el preset binario del experimento 07 (`clustering: 'bw'` con el Otsu de la
 * imagen) muestreado a `LINE_ART_SCALE` (experimento 12), no el preset de color del experimento 04
 * que guarda `CATEGORY_PRESETS`. En el resto, el preset es el medido, tal cual.
 */
export function tracePreset(category, signals) {
  if (category === "line-art") {
    const options = lineArtOptions(signals);
    return {
      colors: 1,
      simplify: options.simplify,
      clustering: options.clustering,
      binaryThreshold: options.binaryThreshold,
      // La escala con la que se muestrea la imagen; el color traza a 1×.
      scale: LINE_ART_SCALE,
    };
  }

  const preset = CATEGORY_PRESETS[category];
  if (!preset) throw new Error(`categoría desconocida: ${category}`);
  return { colors: preset.colors, simplify: preset.simplify };
}

function percent(value) {
  return `${(value * 100).toFixed(0)} %`;
}
