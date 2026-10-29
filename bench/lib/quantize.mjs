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

/**
 * Criterios de la paleta plana, medidos en el experimento 16.
 *
 * `maxResidual` es la frontera entre arte plano y foto: en el banco, el Yoshi (0,050) y Gum Tree
 * (0,013) quedan por debajo; el póster con cielo degradado (0,089) y la foto del Ángel (0,086) por
 * encima. No es un número universal: es el umbral que separa estos casos y hay que barrerlo.
 */
export const FLAT_RULES = {
  /** Colores del cuantizado fino: el techo de lo que la poda puede considerar. */
  colors: 24,
  /** Distancia máxima (OKLab) de un color a la recta entre otros dos para tratarlo como mezcla. */
  rampTolerance: 0.05,
  /** La pareja que absorbe tiene que pesar al menos esto veces más que el color absorbido. */
  massRatio: 3,
  /** Dos clústeres a menos de esta distancia son el mismo color. */
  nearDuplicate: 0.02,
  /** Área mínima (px) para que un color sobreviva aunque no sea rampa. */
  minCount: 300,
  /** Por debajo de este residual la imagen es arte plano. */
  maxResidual: 0.06,
};

/**
 * Poda los colores que no son colores, sino mezclas.
 *
 * El antialiasing de un contorno deja una docena de tonos entre el negro y el verde. Ninguno es una
 * decisión de diseño: cada uno es una mezcla lineal de otros dos que sí lo son. Aquí se detecta eso
 * —distancia del color a la recta que une otros dos clústeres en OKLab— y se suma al extremo más
 * cercano. Un color plano pequeño (el amarillo de una suela, el rojo de una silla) no cae sobre esa
 * recta y sobrevive.
 *
 * @param {{ rgb: number[], lab: number[], count: number }[]} clusters
 * @returns {{ rgb: number[], lab: number[], count: number }[]} nueva lista, ordenada por área
 */
export function pruneRamp(clusters, settings = {}) {
  if (!Array.isArray(clusters) || clusters.length === 0) {
    throw new Error("hacen falta clústeres con su área para podar la paleta");
  }

  const { rampTolerance, massRatio, nearDuplicate, minCount } = { ...FLAT_RULES, ...settings };
  let alive = clusters.map((cluster) => ({ ...cluster }));

  for (let round = 0; round < clusters.length + 1; round++) {
    let changed = false;

    // 1. Duplicados: dos clústeres que son el mismo color.
    for (let i = 0; i < alive.length && !changed; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        if (deltaE(alive[i].lab, alive[j].lab) >= nearDuplicate) continue;
        const [keep, drop] = alive[i].count >= alive[j].count ? [i, j] : [j, i];
        alive[keep].count += alive[drop].count;
        alive.splice(drop, 1);
        changed = true;
        break;
      }
    }
    if (changed) continue;

    // 2. Rampas: un color que es mezcla de otros dos más grandes.
    outer: for (let k = 0; k < alive.length; k++) {
      const candidate = alive[k];
      for (let i = 0; i < alive.length; i++) {
        for (let j = i + 1; j < alive.length; j++) {
          if (i === k || j === k) continue;
          const a = alive[i];
          const b = alive[j];
          if (a.count + b.count < massRatio * candidate.count) continue;
          if (distanceToSegment(candidate.lab, a.lab, b.lab) > rampTolerance) continue;
          const target = deltaE(candidate.lab, a.lab) <= deltaE(candidate.lab, b.lab) ? i : j;
          alive[target].count += candidate.count;
          alive.splice(k, 1);
          changed = true;
          break outer;
        }
      }
    }
    if (changed) continue;

    // 3. Motes: un color que ocupa menos que una uña no puede gastar una ranura.
    if (alive.length > 1) {
      let smallest = -1;
      for (let i = 0; i < alive.length; i++) {
        if (alive[i].count < minCount && (smallest < 0 || alive[i].count < alive[smallest].count)) smallest = i;
      }
      if (smallest >= 0) {
        const victim = alive[smallest];
        let target = -1;
        let best = Infinity;
        for (let i = 0; i < alive.length; i++) {
          if (i === smallest) continue;
          const distance = deltaE(victim.lab, alive[i].lab);
          if (distance < best) {
            best = distance;
            target = i;
          }
        }
        alive[target].count += victim.count;
        alive.splice(smallest, 1);
        continue;
      }
    }

    if (!changed) break;
  }

  return alive.sort((a, b) => b.count - a.count);
}

/**
 * La paleta de un dibujo plano: cuantiza fino, poda las mezclas y devuelve los colores de verdad.
 *
 * Devuelve también `residual` —el error medio (OKLab) de la imagen contra la paleta podada—, que es
 * la señal que distingue arte plano de foto: 0,013–0,050 en plano, 0,086–0,089 en foto y degradado.
 *
 * @returns {{ palette: number[][], paletteHex: string[], count: number, residual: number, merged: number }}
 */
export function flatPalette(rgba, width, height, options = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("width y height deben ser enteros positivos");
  }
  const pixels = width * height;
  if (!rgba || rgba.length !== pixels * 4) {
    throw new Error(`el buffer no tiene width × height × 4 bytes (${pixels * 4} esperados)`);
  }

  const settings = { ...FLAT_RULES, ...options };
  const alphaThreshold = settings.alphaThreshold ?? 8;

  const fine = quantize(rgba, width, height, { maxColors: settings.colors, alphaThreshold });
  if (fine.palette.length === 0) {
    return { palette: [], paletteHex: [], count: 0, residual: 0, merged: 0 };
  }

  const counts = new Array(fine.palette.length).fill(0);
  for (const index of fine.indices) if (index !== TRANSPARENT) counts[index]++;

  const clusters = fine.palette
    .map((rgb, index) => ({ rgb, lab: rgbToOklab(rgb[0], rgb[1], rgb[2]), count: counts[index] }))
    .filter((cluster) => cluster.count > 0);

  const pruned = pruneRamp(clusters, settings);
  const palette = pruned.map((cluster) => cluster.rgb);
  const labs = pruned.map((cluster) => cluster.lab);

  // El error que importa es contra los píxeles visibles, no contra la paleta fina: es lo que verá
  // quien mire el dibujo.
  let error = 0;
  let visible = 0;
  for (const entry of buildHistogram(rgba, pixels, alphaThreshold).values()) {
    let best = Infinity;
    for (const lab of labs) {
      const distance = squaredDistance(entry.lab, lab);
      if (distance < best) best = distance;
    }
    error += Math.sqrt(best) * entry.count;
    visible += entry.count;
  }

  return {
    palette,
    paletteHex: palette.map(([r, g, b]) => `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`),
    count: palette.length,
    residual: visible > 0 ? error / visible : 0,
    merged: clusters.length - pruned.length,
  };
}

/** Distancia de un punto a la recta que une otros dos, en OKLab. */
function distanceToSegment(point, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap = [point[0] - a[0], point[1] - a[1], point[2] - a[2]];
  const length = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / length));
  const closest = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
  return Math.hypot(point[0] - closest[0], point[1] - closest[1], point[2] - closest[2]);
}

const TRANSPARENT = 255;

/**
 * Asigna cada píxel al color más cercano de una paleta ya decidida, en OKLab.
 *
 * Es lo que permite separar las dos decisiones del color: **qué colores** (la paleta, decidida una vez
 * sobre la imagen original) y **dónde cambia uno por otro** (la asignación, que se puede hacer sobre
 * una imagen ampliada y así poner el borde entre píxeles). El cálculo se hace una vez por color
 * distinto, no una vez por píxel: la imagen ampliada tiene decenas de miles de colores, no millones.
 *
 * @param {Uint8Array|Uint8ClampedArray} rgba
 * @param {number[][]} palette colores `[r, g, b]` de 8 bits
 * @returns {Uint8Array} un índice por píxel; `TRANSPARENT` donde no hay nada visible
 */
export function nearestPalette(rgba, palette, alphaThreshold = 8) {
  if (!Array.isArray(palette) || palette.length === 0) {
    throw new Error("hace falta una paleta con al menos un color");
  }

  const labs = palette.map(([r, g, b]) => rgbToOklab(r, g, b));
  const pixels = Math.floor(rgba.length / 4);
  const indices = new Uint8Array(pixels).fill(TRANSPARENT);
  const cache = new Map();

  for (let p = 0; p < pixels; p++) {
    const i = p * 4;
    if (rgba[i + 3] < alphaThreshold) continue;

    const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    let best = cache.get(key);
    if (best === undefined) {
      const lab = rgbToOklab(rgba[i], rgba[i + 1], rgba[i + 2]);
      best = 0;
      let bestDistance = Infinity;
      for (let k = 0; k < labs.length; k++) {
        const distance = squaredDistance(lab, labs[k]);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = k;
        }
      }
      cache.set(key, best);
    }
    indices[p] = best;
  }

  return indices;
}

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
