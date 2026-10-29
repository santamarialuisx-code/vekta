// La varita del fondo: qué parte del lienzo es fondo.
//
// Un JPG no trae alfa, y un PNG exportado con fondo blanco tampoco lo usa: ahí el fondo es un color,
// no una máscara. Se decide con la geometría que el diseñador ya dibujó sin saberlo: **el fondo es
// lo que se alcanza caminando desde el borde del lienzo sin cruzar un cambio de color**. Es la misma
// operación que el balde de un editor de píxeles, y por eso se comporta como el usuario espera:
// respeta los huecos cerrados (un ojo de la figura no es fondo) y no toca el sujeto.
//
// Cuatro decisiones, y ninguna es una perilla de calidad:
//
// - **El color semilla es la moda del borde**, no una esquina. Una esquina puede caer en una sombra,
//   en un marco o en el antialiasing de la figura, y decidir el fondo entero por un píxel es una
//   apuesta. El borde completo es la muestra más honesta de «lo de fuera».
// - **Un fondo puede ser dos colores.** El damero de transparencia que un JPEG deja quemado son dos
//   tonalidades que se alternan: con una sola semilla se va media trama y queda la otra media. Por
//   eso `borderSeeds` devuelve las dos cuando el borde las reparte, y el rellenado las recorre
//   juntas. La conectividad sigue protegiendo lo que está encerrado (la barriga de un dibujo), así
//   que dos semillas no son dos veces más peligro.
// - **La tolerancia es euclídea en sRGB** (0..441) y se expone en 0..255 para que la UI hable en el
//   mismo número que los píxeles. Lo que hay que tolerar es ruido de compresión y de papel, no una
//   diferencia perceptual: en OKLab, un ΔE pequeño ya separa dos tintas planas que el usuario
//   considera «el mismo fondo».
// - **La máscara tiene que ser un fondo, no la imagen.** Por debajo de `minShare` es una mota (un
//   borde sucio, una sombra en una esquina); por encima de `maxShare` es que la imagen *es* ese
//   color y no hay sujeto que recortar. En los dos casos se devuelve una máscara vacía: es más
//   honesto no quitar nada que vaciar el lienzo.
//
// El módulo no traza ni conoce el motor: devuelve una máscara 0/1 y una copia del RGBA con alfa 0
// donde hay fondo. A partir de ahí el resto del pipeline ya sabe qué hacer — `quantize` ignora los
// píxeles con alfa bajo y vtracer no genera geometría para ellos.

/** Criterios públicos, para que la página y las pruebas hablen del mismo número. */
export const BACKGROUND_RULES = {
  /** Distancia euclídea en sRGB (0..441) para considerar que un píxel es del color del fondo. */
  tolerance: 28,
  /** Por debajo de esta proporción la máscara es una mota, no un fondo. */
  minShare: 0.005,
  /** Por encima de esta proporción la máscara es la imagen entera: no hay sujeto que recortar. */
  maxShare: 0.995,
  /**
   * Proporción mínima del perímetro que tiene que ocupar la segunda tonalidad para tratarla como
   * parte del fondo. 0,15 = 15 %: un damero reparte el borde casi mitad y mitad; un papel con ruido
   * deja la segunda tonalidad en migajas.
   */
  seedShare: 0.15,
  /**
   * Píxeles que se come la máscara hacia dentro del sujeto.
   *
   * Cero por defecto: crecer cambia la geometría de la pieza y quien corta tiene derecho a saberlo.
   * Vale 1 cuando el fondo viene de un JPEG: el antialiasing deja un fleco de 1-2 px entre el fondo
   * y la figura que no es ni una cosa ni la otra, y sin comérselo el trazado lo convierte en un
   * anillo de piezas (medido en el Yoshi: 2 085 paths con fleco, 24 sin él).
   */
  grow: 0,
};

/** `[r, g, b]` → `#rrggbb` en minúsculas, el formato que emite el trazador. */
export function hexOf(color) {
  return `#${color.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Los colores del perímetro del lienzo, del más frecuente al menos.
 *
 * Se mira el borde completo (arriba y abajo, izquierda y derecha) y se devuelven los colores exactos
 * de 8 bits: sin cuantizar, porque el ruido de un JPG alrededor del color de papel ya lo absorbe la
 * tolerancia del rellenado, y cuantizar aquí elegiría un color que no está en ningún píxel.
 *
 * @returns {{ color: number[], hex: string, share: number }[]} `share` es la proporción del borde
 *   que tiene ese color exacto.
 */
export function borderColors(rgba, width, height, { top = 2 } = {}) {
  const pixels = requireRgba(rgba, width, height);

  const counts = new Map();
  let total = 0;
  const visit = (x, y) => {
    const i = (y * width + x) * 4;
    const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total++;
  };

  for (let x = 0; x < width; x++) {
    visit(x, 0);
    if (height > 1) visit(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    visit(0, y);
    if (width > 1) visit(width - 1, y);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, Math.max(1, top))
    .map(([key, count]) => {
      const color = [(key >> 16) & 255, (key >> 8) & 255, key & 255];
      return { color, hex: hexOf(color), share: count / (total || pixels) };
    });
}

/**
 * El color más frecuente del borde del lienzo.
 *
 * Un `share` bajo avisa de que el borde no es uniforme (foto, marco).
 */
export function dominantBorderColor(rgba, width, height) {
  return borderColors(rgba, width, height, { top: 1 })[0];
}

/**
 * Las semillas del fondo: una, o dos si el borde reparte su superficie entre dos tonalidades.
 *
 * El caso de dos semillas es el damero de transparencia quemado en un JPEG. Se exige que la segunda
 * ocupe al menos `seedShare` del perímetro para no convertir el ruido de un papel en una semilla.
 *
 * @returns {string[]} colores `#rrggbb`
 */
export function borderSeeds(rgba, width, height, { minShare = BACKGROUND_RULES.seedShare } = {}) {
  const colors = borderColors(rgba, width, height, { top: 2 });
  if (colors.length < 2 || colors[1].share < minShare) return [colors[0].hex];
  return colors.map((entry) => entry.hex);
}

/**
 * Máscara del fondo por rellenado desde los bordes (4-conexo, iterativo).
 *
 * El rellenado es en anchura con una pila explícita `Int32Array`: una recursión sobre 3,6 Mpx no
 * cabe en la pila de JavaScript, y una `Array` de posiciones duplica la memoria del lienzo.
 *
 * @param {Uint8Array|Uint8ClampedArray} rgba
 * @param {{ tolerance?: number, minShare?: number, maxShare?: number, grow?: number, seeds?: string[] | number[][] }} [settings]
 *   `seeds` son los colores del fondo; por defecto, la moda del borde. `grow` dilata la máscara
 *   hacia dentro del sujeto para comerse el fleco de antialiasing de un JPEG.
 * @returns {{
 *   mask: Uint8Array, color: number[], hex: string, seeds: string[], seedShare: number,
 *   share: number, applied: boolean, tolerance: number, grow: number,
 * }} `mask` es 0/1 por píxel; si `applied` es falso viene a ceros.
 */
export function backgroundMask(rgba, width, height, settings = {}) {
  const pixels = requireRgba(rgba, width, height);

  const tolerance = settings.tolerance ?? BACKGROUND_RULES.tolerance;
  const minShare = settings.minShare ?? BACKGROUND_RULES.minShare;
  const maxShare = settings.maxShare ?? BACKGROUND_RULES.maxShare;
  const grow = settings.grow ?? BACKGROUND_RULES.grow;

  if (!(tolerance >= 0 && tolerance <= 441)) {
    throw new Error(`la tolerancia debe estar entre 0 y 441, recibí ${tolerance}`);
  }
  if (!(minShare >= 0 && minShare <= 1) || !(maxShare >= 0 && maxShare <= 1)) {
    throw new Error("minShare y maxShare deben estar entre 0 y 1");
  }

  const dominant = dominantBorderColor(rgba, width, height);
  const seeds = settings.seeds === undefined ? [dominant.color] : normalizeSeeds(settings.seeds);
  const limit = tolerance * tolerance;

  let mask = new Uint8Array(pixels);
  const seen = new Uint8Array(pixels);
  const stack = new Int32Array(pixels);
  let top = 0;

  const push = (p) => {
    if (seen[p]) return;
    seen[p] = 1;
    stack[top++] = p;
  };

  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }

  const near = (i) => {
    for (const [r, g, b] of seeds) {
      const dr = rgba[i] - r;
      const dg = rgba[i + 1] - g;
      const db = rgba[i + 2] - b;
      if (dr * dr + dg * dg + db * db <= limit) return true;
    }
    return false;
  };

  let count = 0;
  while (top > 0) {
    const p = stack[--top];
    if (!near(p * 4)) continue;

    mask[p] = 1;
    count++;

    const x = p % width;
    const y = (p - x) / width;
    if (x > 0) push(p - 1);
    if (x < width - 1) push(p + 1);
    if (y > 0) push(p - width);
    if (y < height - 1) push(p + width);
  }

  if (grow > 0) {
    mask = growMask(mask, width, height, grow);
    count = 0;
    for (const value of mask) count += value;
  }

  const share = count / pixels;
  const applied = share >= minShare && share <= maxShare;
  if (!applied) mask.fill(0);

  return {
    mask,
    color: seeds[0],
    hex: hexOf(seeds[0]),
    seeds: seeds.map(hexOf),
    seedShare: dominant.share,
    share,
    applied,
    tolerance,
    grow,
  };
}

/**
 * Dilata la máscara `radius` píxeles (8-conexo), hacia dentro del sujeto.
 *
 * Es el paso que mata el fleco de antialiasing: los píxeles del borde de un JPEG son mezcla del
 * fondo y de la figura, no son de ninguno de los dos, y si quedan opacos el trazado los convierte en
 * un anillo de piezas diminutas. Se dilata en 8-conexo porque un borde diagonal en 4-conexo deja
 * huecos por donde el fleco sobrevive.
 *
 * @returns {Uint8Array} máscara nueva; la de entrada no se toca
 */
export function growMask(mask, width, height, radius) {
  if (!mask || mask.length !== width * height) {
    throw new Error("la máscara debe tener width × height valores, uno por píxel");
  }
  if (!Number.isInteger(radius) || radius < 0) {
    throw new Error(`el radio de crecimiento debe ser un entero ≥ 0, recibí ${radius}`);
  }
  if (radius === 0) return Uint8Array.from(mask);

  let current = mask;
  for (let step = 0; step < radius; step++) {
    const next = Uint8Array.from(current);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        if (current[p]) continue;
        let touching = false;
        for (let dy = -1; dy <= 1 && !touching; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            if (current[ny * width + nx]) {
              touching = true;
              break;
            }
          }
        }
        if (touching) next[p] = 1;
      }
    }
    current = next;
  }
  return Uint8Array.from(current);
}

/**
 * Copia del RGBA con alfa 0 donde la máscara marca fondo.
 *
 * No muta la entrada: el llamador guarda el original para deshacer, y volver a trazar con otro modo
 * no puede depender de si la vez anterior se quitó el fondo.
 *
 * @returns {Uint8Array} RGBA8 nuevo, mismo tamaño
 */
export function applyBackgroundMask(rgba, mask) {
  if (!mask || mask.length * 4 !== rgba.length) {
    throw new Error("la máscara debe tener width × height valores, uno por píxel");
  }

  const out = new Uint8Array(rgba.length);
  out.set(rgba);
  for (let p = 0; p < mask.length; p++) {
    if (mask[p]) out[p * 4 + 3] = 0;
  }
  return out;
}

/** `#rrggbb` o `[r, g, b]` → `[r, g, b]`; cualquier otra cosa es un error, no un color por defecto. */
function normalizeSeeds(seeds) {
  if (!Array.isArray(seeds) || seeds.length === 0) {
    throw new Error("hace falta al menos una semilla de fondo");
  }

  return seeds.map((seed) => {
    if (Array.isArray(seed) && seed.length === 3 && seed.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
      return [...seed];
    }
    if (typeof seed === "string" && /^#[0-9a-f]{6}$/i.test(seed.trim())) {
      const value = seed.trim().slice(1);
      return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
    }
    throw new Error(`semilla de fondo inválida: ${JSON.stringify(seed)} (usa "#rrggbb" o [r, g, b])`);
  });
}

/** Valida el buffer y devuelve el número de píxeles, para que los errores hablen claro. */
function requireRgba(rgba, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("width y height deben ser enteros positivos");
  }
  const pixels = width * height;
  if (!rgba || rgba.length !== pixels * 4) {
    throw new Error(`el buffer no tiene width × height × 4 bytes (${pixels * 4} esperados)`);
  }
  return pixels;
}
