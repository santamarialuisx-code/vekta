// Cuantización perceptiva y ponderada por área.
//
// El agrupamiento jerárquico de vtracer decide por umbral de color: dos regiones con ΔE diminuto
// se fusionan aunque una sea una nube de 200×200 y la otra un píxel de ruido. Aquí se decide al
// revés: solo los colores que ocupan área pueden gastar una ranura de paleta, y la distancia se
// mide en OKLab, donde ΔE es perceptualmente comparable entre sombras y luces.

import { deltaE, oklabToRgb, rgbToOklab } from "./oklab.mjs";

const DEFAULTS = {
  maxColors: 16,
  minClusterShare: 0.002, // 0,2 % de los píxeles visibles: por debajo no es una región
  maxIterations: 16,
  sampleLimit: 20000,
  alphaThreshold: 8,
};

/**
 * @param {Uint8Array|Uint8ClampedArray} rgba píxeles RGBA8
 * @returns {{
 *   palette: number[][], indices: Uint8Array, paletteHex: string[],
 *   droppedClusters: number, iterations: number, visiblePixels: number,
 *   meanDeltaE: number, p95DeltaE: number
 * }}
 */
export function quantize(rgba, width, height, options = {}) {
  const settings = { ...DEFAULTS, ...options };
  const pixels = width * height;
  const histogram = buildHistogram(rgba, pixels, settings.alphaThreshold);

  let visible = 0;
  for (const entry of histogram.values()) visible += entry.count;

  if (visible === 0) {
    return {
      palette: [],
      paletteHex: [],
      indices: new Uint8Array(pixels).fill(TRANSPARENT),
      droppedClusters: 0,
      iterations: 0,
      visiblePixels: 0,
      sourceColors: 0,
      meanDeltaE: 0,
      p95DeltaE: 0,
    };
  }

  const entries = [...histogram.values()];
  const minCount = Math.max(1, settings.minClusterShare * visible);
  const candidates = entries.filter((entry) => entry.count >= minCount);
  const seeds = pickSeeds(candidates.length > 0 ? candidates : entries, settings.maxColors);

  const sample = sampleEntries(entries, settings.sampleLimit);
  const refined = refine(sample, seeds, settings.maxIterations);

  // Un clúster puede quedar por debajo de la cuota después de Lloyd: se descarta y se reasigna.
  const { centroids, dropped } = dropSmallClusters(entries, refined.centroids, minCount);

  const palette = centroids.map((lab) => oklabToRgb(lab[0], lab[1], lab[2]));
  const paletteHex = palette.map(([r, g, b]) =>
    `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`,
  );
  // El ΔE que importa es contra el color que se emite (ya redondeado a 8 bits), no contra el
  // centroide en coma flotante: es el error que verá quien mire la imagen.
  const emittedLabs = palette.map(([r, g, b]) => rgbToOklab(r, g, b));

  // Asignación final: una vez por color distinto, no una vez por píxel.
  const indexByKey = new Map();
  let means = 0;
  const deltas = [];
  for (const entry of entries) {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < emittedLabs.length; i++) {
      const distance = squaredDistance(entry.lab, emittedLabs[i]);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    indexByKey.set(entry.key, best);
    const error = Math.sqrt(bestDistance);
    means += error * entry.count;
    deltas.push({ error, count: entry.count });
  }

  const indices = new Uint8Array(pixels).fill(TRANSPARENT);
  for (let p = 0; p < pixels; p++) {
    const i = p * 4;
    if (rgba[i + 3] < settings.alphaThreshold) continue;
    indices[p] = indexByKey.get((rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]);
  }

  return {
    palette,
    paletteHex,
    indices,
    droppedClusters: dropped,
    iterations: refined.iterations,
    visiblePixels: visible,
    sourceColors: entries.length,
    meanDeltaE: means / visible,
    p95DeltaE: weightedPercentile(deltas, 0.95, visible),
  };
}

/** Aplica la paleta a los píxeles; lo transparente queda transparente. */
export function renderQuantized(rgba, width, height, result) {
  const pixels = width * height;
  const out = new Uint8Array(pixels * 4);
  for (let p = 0; p < pixels; p++) {
    const i = p * 4;
    const index = result.indices[p];
    if (rgba[i + 3] < 8 || index === TRANSPARENT || !result.palette[index]) {
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 0;
      continue;
    }
    const color = result.palette[index];
    out[i] = color[0];
    out[i + 1] = color[1];
    out[i + 2] = color[2];
    out[i + 3] = rgba[i + 3];
  }
  return out;
}

const TRANSPARENT = 255;

/** Histograma de colores visibles con su conteo y su Lab: el peso es el área. */
function buildHistogram(rgba, pixels, alphaThreshold) {
  const histogram = new Map();
  for (let p = 0; p < pixels; p++) {
    const i = p * 4;
    if (rgba[i + 3] < alphaThreshold) continue;
    const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    const entry = histogram.get(key);
    if (entry) {
      entry.count++;
    } else {
      histogram.set(key, {
        key,
        count: 1,
        lab: rgbToOklab(rgba[i], rgba[i + 1], rgba[i + 2]),
      });
    }
  }
  return histogram;
}

/**
 * Semillas por lejanía, restringidas a colores con área suficiente.
 * Es la decisión central del método: el ruido de un píxel no puede gastar una ranura.
 */
function pickSeeds(entries, maxColors) {
  if (entries.length === 0) return [];

  const byCount = [...entries].sort((a, b) => b.count - a.count || a.key - b.key);
  const seeds = [byCount[0].lab.slice()];

  while (seeds.length < Math.min(maxColors, entries.length)) {
    let bestEntry = null;
    let bestScore = 0;
    for (const entry of entries) {
      let nearest = Infinity;
      for (const seed of seeds) {
        const distance = squaredDistance(entry.lab, seed);
        if (distance < nearest) nearest = distance;
      }
      if (nearest > bestScore) {
        bestScore = nearest;
        bestEntry = entry;
      }
    }
    if (!bestEntry || bestScore <= 0) break;
    seeds.push(bestEntry.lab.slice());
  }

  return seeds;
}

function sampleEntries(entries, limit) {
  if (entries.length <= limit) return entries;
  const sorted = [...entries].sort((a, b) => a.key - b.key);
  const stride = sorted.length / limit;
  const sample = [];
  for (let i = 0; i < limit; i++) sample.push(sorted[Math.floor(i * stride)]);
  return sample;
}

/** Lloyd ponderado por área sobre la muestra. */
function refine(sample, seeds, maxIterations) {
  let centroids = seeds.map((lab) => lab.slice());
  if (centroids.length === 0) return { centroids, iterations: 0 };

  const assignment = new Int32Array(sample.length).fill(-1);
  let iterations = 0;

  for (; iterations < maxIterations; iterations++) {
    const sums = centroids.map(() => [0, 0, 0, 0]);
    let changed = false;

    for (let i = 0; i < sample.length; i++) {
      const lab = sample[i].lab;
      let best = 0;
      let bestDistance = Infinity;
      for (let j = 0; j < centroids.length; j++) {
        const distance = squaredDistance(lab, centroids[j]);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = j;
        }
      }
      if (assignment[i] !== best) {
        assignment[i] = best;
        changed = true;
      }
      const sum = sums[best];
      const weight = sample[i].count;
      sum[0] += lab[0] * weight;
      sum[1] += lab[1] * weight;
      sum[2] += lab[2] * weight;
      sum[3] += weight;
    }

    centroids = centroids.map((centroid, index) =>
      sums[index][3] > 0
        ? [sums[index][0] / sums[index][3], sums[index][1] / sums[index][3], sums[index][2] / sums[index][3]]
        : centroid,
    );

    if (!changed) break;
  }

  return { centroids, iterations };
}

function dropSmallClusters(entries, centroids, minCount) {
  let current = centroids.map((lab) => lab.slice());
  let dropped = 0;

  while (current.length > 1) {
    const weights = new Array(current.length).fill(0);
    for (const entry of entries) {
      let best = 0;
      let bestDistance = Infinity;
      for (let i = 0; i < current.length; i++) {
        const distance = squaredDistance(entry.lab, current[i]);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = i;
        }
      }
      weights[best] += entry.count;
    }

    const keep = [];
    for (let i = 0; i < current.length; i++) {
      if (weights[i] >= minCount && weights[i] > 0) keep.push(current[i]);
      else dropped++;
    }

    if (keep.length === current.length) break;
    current = keep.length > 0 ? keep : [current[0]];

    // Recalcular medias con los clústeres que quedan.
    const sums = current.map(() => [0, 0, 0, 0]);
    for (const entry of entries) {
      let best = 0;
      let bestDistance = Infinity;
      for (let i = 0; i < current.length; i++) {
        const distance = squaredDistance(entry.lab, current[i]);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = i;
        }
      }
      const sum = sums[best];
      sum[0] += entry.lab[0] * entry.count;
      sum[1] += entry.lab[1] * entry.count;
      sum[2] += entry.lab[2] * entry.count;
      sum[3] += entry.count;
    }
    current = current.map((centroid, index) =>
      sums[index][3] > 0
        ? [sums[index][0] / sums[index][3], sums[index][1] / sums[index][3], sums[index][2] / sums[index][3]]
        : centroid,
    );
  }

  return { centroids: current, dropped };
}

function weightedPercentile(deltas, percentile, total) {
  const sorted = [...deltas].sort((a, b) => a.error - b.error);
  const target = percentile * total;
  let seen = 0;
  for (const item of sorted) {
    seen += item.count;
    if (seen >= target) return item.error;
  }
  return sorted.length > 0 ? sorted.at(-1).error : 0;
}

function squaredDistance(a, b) {
  const dL = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return dL * dL + da * da + db * db;
}
