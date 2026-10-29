// ¿Esta imagen es line art?
//
// El modo binario del motor (`clustering: 'bw'`) es una máquina de hacer tinta: colapsa la imagen a
// dos niveles y traza la frontera. Sobre un escaneo es exactamente lo que hace falta (el papel y el
// gris del lápiz no son información de corte), pero sobre una foto borra todo lo que no sea una
// silueta, y sobre una ilustración de color se come la paleta. Aplicarlo sin preguntar es destruir
// el trabajo de tres experimentos.
//
// La decisión se toma con números que ya están en la imagen, no con un cuestionario:
//
// - `neutralShare` — proporción de píxeles sin croma (|max−min| < 20). Un escaneo a lápiz es gris;
//   una ilustración o una foto, no tanto. Es el discriminador fuerte.
// - `inkShare` — proporción de píxeles por debajo del umbral de Otsu. El line art es tinta sobre
//   papel: poca tinta y mucho fondo. Una foto en blanco y negro también es neutra, pero su Otsu
//   parte la imagen por la mitad, y ese 50 % la delata.
// - `otsu` y `separability` — umbral de Otsu y cuánta de la varianza total explica. Se publica
//   porque el barrido lo usa como umbral de referencia del modo fijo.
// - `edgeDensity` — proporción de píxeles con gradiente fuerte (Sobel). Informativo: el line art
//   tiene muchas aristas y poca tinta, que es justo lo que hace que el modo binario ahorre nodos.
//
// El alfa se mide antes que todo lo demás, porque cambia lo que significan las tres señales. Un PNG
// recortado guarda negro (0, 0, 0, 0) donde no hay sujeto: leído en crudo, ese negro es tinta para
// el histograma y neutro para la regla, así que el clasificador veía una foto y el modo binario
// trazaba un lienzo negro completo. Aquí el fondo transparente **se compone sobre papel blanco**
// —lo que es, papel— y solo los píxeles visibles cuentan para `neutralShare`. Con un PNG opaco
// nada cambia: alfa 255 no altera ni un decimal.

import { ALPHA_RULES } from "./alpha.mjs";

/** Criterios de decisión. Públicos para que el barrido y las pruebas hablen del mismo número. */
export const LINE_ART_RULES = {
  /** Croma máximo (max−min en sRGB) para considerar un píxel neutro. */
  neutralChroma: 20,
  /** Un line art es casi todo neutro: escaneo a lápiz, tinta, grabado. */
  minNeutralShare: 0.9,
  /** Y casi todo fondo: si el 40 % del área es «tinta», es una foto en blanco y negro. */
  maxInkShare: 0.4,
  /** Gradiente mínimo (Sobel) para contar un píxel como arista. */
  edgeMagnitude: 40,
};

/** Luminancia perceptual (Rec. 601) de un RGBA8. */
export function luminance(rgba, width, height) {
  const n = width * height;
  if (rgba.length < n * 4) throw new Error("el buffer no tiene width × height × 4 bytes");

  const gray = new Float32Array(n);
  for (let i = 0, p = 0; p < n; i += 4, p++) {
    gray[p] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  }
  return gray;
}

/** Histograma de 256 bins normalizado de una imagen de luminancia. */
export function luminanceHistogram(gray) {
  const hist = new Float64Array(256);
  for (let p = 0; p < gray.length; p++) hist[Math.min(255, Math.max(0, Math.round(gray[p])))] += 1;
  for (let i = 0; i < 256; i++) hist[i] /= gray.length || 1;
  return hist;
}

/**
 * Umbral de Otsu sobre 256 bins.
 *
 * Devuelve `separability` = varianza entre clases / varianza total, en 0..1. No es un test de
 * unimodalidad: una gaussiana ronda 0,64 y un histograma plano 0,75, porque Otsu siempre parte por
 * la mitad de lo que haya. Lo que sí mide es si hay dos picos limpios: un bimodal de verdad pasa de
 * 0,95. Se publica como contexto del umbral, no como criterio de decisión.
 */
export function otsuThreshold(hist) {
  if (hist.length !== 256) throw new Error("el histograma debe tener 256 bins");

  let total = 0;
  let weighted = 0;
  for (let i = 0; i < 256; i++) {
    total += hist[i];
    weighted += i * hist[i];
  }
  if (total === 0) throw new Error("histograma vacío");

  let mean = 0;
  for (let i = 0; i < 256; i++) mean += i * hist[i] / total;
  let variance = 0;
  for (let i = 0; i < 256; i++) variance += (i - mean) ** 2 * hist[i] / total;

  let backgroundWeight = 0;
  let backgroundSum = 0;
  let best = -1;
  let threshold = 128;

  for (let t = 0; t < 256; t++) {
    backgroundWeight += hist[t];
    if (backgroundWeight === 0) continue;

    const foregroundWeight = total - backgroundWeight;
    if (foregroundWeight <= 0) break;

    backgroundSum += t * hist[t];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (weighted - backgroundSum) / foregroundWeight;
    const between = (backgroundWeight / total) * (foregroundWeight / total) *
      (backgroundMean - foregroundMean) ** 2;

    if (between > best) {
      best = between;
      threshold = t;
    }
  }

  return {
    threshold,
    separability: variance > 0 ? Math.max(0, best / variance) : 0,
    inkShare: (() => {
      let ink = 0;
      for (let i = 0; i <= threshold; i++) ink += hist[i];
      return ink / total;
    })(),
  };
}

/**
 * Proporción de píxeles sin croma: un escaneo a lápiz es gris, una ilustración no.
 *
 * `visible` es la máscara de píxeles con sujeto (alfa sobre el umbral). El fondo transparente es
 * blanco, y el blanco es neutro: contarlo haría que cualquier ilustración recortada pasara por
 * line art con solo tener mucho margen. Sin máscara se cuentan todos los píxeles, que es lo que
 * quiere una imagen opaca.
 */
export function neutralShare(rgba, chroma = LINE_ART_RULES.neutralChroma, visible = null) {
  const pixels = Math.floor(rgba.length / 4);
  if (pixels === 0) return 0;

  let considered = 0;
  let neutral = 0;
  for (let p = 0, i = 0; p < pixels; p++, i += 4) {
    if (visible && !visible[p]) continue;
    considered++;
    const max = Math.max(rgba[i], rgba[i + 1], rgba[i + 2]);
    const min = Math.min(rgba[i], rgba[i + 1], rgba[i + 2]);
    if (max - min < chroma) neutral++;
  }
  return considered > 0 ? neutral / considered : 0;
}

/** Proporción de píxeles con gradiente fuerte (Sobel, interiores). */
export function edgeDensity(gray, width, height, magnitude = LINE_ART_RULES.edgeMagnitude) {
  if (width < 3 || height < 3) return 0;

  let edges = 0;
  let seen = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx =
        -gray[i - width - 1] - 2 * gray[i - 1] - gray[i + width - 1] +
        gray[i - width + 1] + 2 * gray[i + 1] + gray[i + width + 1];
      const gy =
        -gray[i - width - 1] - 2 * gray[i - width] - gray[i - width + 1] +
        gray[i + width - 1] + 2 * gray[i + width] + gray[i + width + 1];
      if (Math.hypot(gx, gy) > magnitude) edges++;
      seen++;
    }
  }
  return seen > 0 ? edges / seen : 0;
}

/**
 * Todas las señales de una imagen, en una sola pasada de histograma.
 *
 * `gray` sale **compuesta sobre papel blanco**: donde el alfa no llega al umbral el valor es 255,
 * y el antialiasing del borde se mezcla con el papel. Eso es exactamente lo que necesita
 * `subpixelFrame`, que traza `gray` tal cual, y evita que el fondo transparente entre al motor como
 * tinta.
 */
export function lineArtSignals(rgba, width, height) {
  const gray = luminance(rgba, width, height);
  const pixels = width * height;

  const visible = new Uint8Array(pixels);
  let visibleCount = 0;
  for (let p = 0, i = 3; p < pixels; p++, i += 4) {
    const alpha = rgba[i];
    if (alpha >= ALPHA_RULES.minAlpha) {
      visible[p] = 1;
      visibleCount++;
    }
    if (alpha < 255) gray[p] = gray[p] * (alpha / 255) + 255 * (1 - alpha / 255);
  }

  const histogram = luminanceHistogram(gray);
  const otsu = otsuThreshold(histogram);

  return {
    width,
    height,
    gray,
    histogram,
    threshold: otsu.threshold,
    separability: otsu.separability,
    inkShare: otsu.inkShare,
    neutralShare: neutralShare(rgba, LINE_ART_RULES.neutralChroma, visible),
    edgeDensity: edgeDensity(gray, width, height),
    /** Proporción del lienzo con sujeto (alfa ≥ 128). 1 en una imagen opaca. */
    visibleShare: visibleCount / pixels,
  };
}

/**
 * Regla de decisión.
 *
 * Dos condiciones, las dos necesarias: la imagen es prácticamente neutra y la tinta ocupa poco.
 * Una foto en blanco y negro pasa la primera y falla la segunda.
 */
export function looksLikeLineArt(signals) {
  const { neutralShare: neutral, inkShare } = signals;
  const rules = LINE_ART_RULES;

  if (neutral < rules.minNeutralShare) {
    return {
      lineArt: false,
      reason: `color: ${(neutral * 100).toFixed(0)} % de píxeles neutros, mínimo ${(rules.minNeutralShare * 100).toFixed(0)} %`,
    };
  }

  if (inkShare > rules.maxInkShare) {
    return {
      lineArt: false,
      reason: `foto: ${(inkShare * 100).toFixed(0)} % de la imagen cae bajo el umbral, máximo ${(rules.maxInkShare * 100).toFixed(0)} %`,
    };
  }

  return {
    lineArt: true,
    reason: `neutro (${(neutral * 100).toFixed(0)} %) con ${(inkShare * 100).toFixed(0)} % de tinta`,
  };
}

/**
 * Escala de muestreo del preset de line art.
 *
 * El experimento 12 midió el codo en 3×: trazar a 3× y devolver la geometría a la rejilla compra
 * +0,0286 de F1 de tinta (0,9436 → 0,9722) y +0,0256 de SSIM en K1; 4× gana +0,0004 de F1 por
 * +22 % de nodos y 2× afina el trazo de más. La continuación del mismo experimento barrió
 * `simplify` a 3× y dejó el preset en 1,2, que es el que se entrega.
 *
 * La escala es del **muestreo**, no del motor: no viaja dentro de las opciones de `vtracer` (que no
 * la conoce) sino en la composición de `subpixel.mjs`.
 */
export const LINE_ART_SCALE = 3;

/**
 * Preset de line art, medido en el experimento 07 y confirmado a 3× en el 12.
 *
 * `binaryThreshold` no es un número: es el Otsu de la propia imagen, que en K1 (135) cae justo en la
 * banda que gana el barrido de umbral fijo (128–144). Bradley–Roth (`adaptive`) queda fuera a
 * propósito: con el fondo ya uniforme de un escaneo no aporta y cuesta 0,02 de F1 de tinta, porque
 * la media local mezcla el trazo con el papel y engorda o adelgaza el contorno según la zona.
 */
export const LINE_ART_PRESET = {
  mode: "spline",
  hierarchical: "cutout",
  optimize: 2,
  clustering: "bw",
  /**
   * `simplify` 1,2 medido **a 3×** (experimento 12, continuación): F1 de tinta 0,9670 frente a
   * 0,9773 sin simplificar, y 31 500 nodos frente a 100 983. A 1× el mismo 1,2 caía a 0,9326 y por
   * eso el preset se quedaba en 0,8; con el muestreo fino la curva es mucho más plana y 1,2 sigue
   * por encima del 1× sin simplificar (0,9595) con menos nodos que él (31 500 frente a 34 592).
   */
  simplify: 1.2,
};

/**
 * Opciones de trazado para una imagen de line art, con su umbral de Otsu como corte.
 *
 * El umbral se pasa como `Otsu + 1` porque las dos convenciones no coinciden: Otsu devuelve el
 * último nivel que todavía es tinta, y el motor considera tinta lo que está *por debajo* del umbral.
 * Con el valor crudo, una imagen perfectamente bimodal en 50 y 246 pierde justo la tinta: el SVG
 * sale vacío.
 */
export function lineArtOptions(signals, overrides = {}) {
  if (!signals || typeof signals.threshold !== "number") {
    throw new Error("hacen falta las señales de la imagen (lineArtSignals)");
  }
  return {
    ...LINE_ART_PRESET,
    binaryThreshold: Math.min(255, signals.threshold + 1),
    ...overrides,
  };
}
