// El alfa como línea de corte.
//
// Un PNG con fondo transparente es la entrada más común de un taller, y en esa entrada el alfa no
// es un adorno: es la silueta. Si el lienzo está opaco, «cortar la pieza» es cortar el rectángulo
// del lienzo —lo que le pasó al experimento 02 con las cuatro imágenes del banco—, y ese corte no
// aporta nada. Con alfa, la frontera del sujeto es una decisión de diseño que ya está en el
// archivo, y la silueta por fin es la pieza.
//
// El módulo no traza: mide el alfa, lo convierte en máscara y deja la máscara en la forma que el
// motor entiende (una imagen de gris con dos únicos niveles). El trazado lo hace `bench/alpha-cut.mjs`.
//
// Tres decisiones documentadas:
//
// - **Cuándo el alfa es información.** Un PNG de 8 bits guarda un 255 global aunque la imagen no
//   tenga transparencia, así que «tiene canal alfa» no significa «tiene forma». Se decide por
//   proporción de píxeles opacos: si el 99,5 % o más son 255, el alfa no describe nada y el corte
//   de pieza no tiene sujeto. El umbral tolera el antialiasing de un borde redondeado (que deja
//   alfa parcial en el perímetro) pero no un lienzo lleno.
// - **La tolerancia quita píxeles aislados, no hace un cierre morfológico.** Una mota de un píxel
//   en el alfa (un píxel opaco suelto fuera del sujeto, o un agujero de un píxel dentro) es ruido de
//   exportación, no geometría: nadie corta eso y en el SVG se convierte en un contorno de más. Un
//   cierre morfológico movería el borde entero y se comería las esquinas; un cierre por voto de
//   mayoría también se come las esquinas (en una ventana de 3 × 3 una esquina de 90° está en
//   minoría). La regla es más chica y más honesta: un píxel que no tiene **ni un** vecino de su
//   mismo valor es ruido y se invierte; todo lo demás —borde, esquinas, líneas de un píxel— queda
//   exactamente donde el diseñador lo puso.
// - **El sujeto se pinta negro.** `clustering: 'bw'` considera tinta lo que cae *por debajo* del
//   umbral (`bench/lib/lineart.mjs`), así que la máscara se invierte al pasarla al motor: sujeto
//   0, fondo 255. Con dos únicos niveles, `binaryThreshold: 128` parte exacto entre ellos; no hay
//   gris que decidir y el resultado no depende de Otsu ni del contenido de la imagen.

/**
 * Criterios públicos, para que el CLI, la doc y las pruebas hablen del mismo número.
 */
export const ALPHA_RULES = {
  /** Alfa mínimo (0..255) para que un píxel cuente como sujeto. */
  minAlpha: 128,
  /**
   * Por encima de esta proporción de píxeles opacos (255), el alfa es un relleno global y no una
   * silueta. 0,995 = 99,5 %: deja pasar el antialiasing de un borde redondeado y corta el lienzo
   * lleno, que es exactamente el caso en el que el corte de pieza no tiene sujeto.
   */
  maxOpaqueShare: 0.995,
  /**
   * Radio, en píxeles, dentro del cual un píxel necesita al menos un vecino de su mismo valor.
   * 1 borra las motas y los agujeros de un píxel (no tienen ningún vecino: están solos en su
   * ventana de 3 × 3) sin tocar el borde ni las esquinas de la figura. 0 devuelve la máscara cruda.
   */
  tolerance: 1,
};

/**
 * Opciones de trazado de la máscara.
 *
 * `simplify` 0,8 es el mismo valor que el preset de line art medido en el experimento 07: reduce
 * nodos sin mover el contorno de forma visible. En la dona del banco el perímetro emitido queda a
 * 0,2 % del exacto (experimento 11).
 */
export const ALPHA_TRACE_OPTIONS = {
  mode: "spline",
  hierarchical: "cutout",
  optimize: 2,
  simplify: 0.8,
  clustering: "bw",
  /** Punto medio exacto entre los dos únicos niveles que emite `maskToLuminance`. */
  binaryThreshold: 128,
};

/**
 * Cobertura del alfa. Las tres proporciones suman 1.
 * @returns {{ pixels: number, opaqueShare: number, transparentShare: number, partialShare: number }}
 */
export function alphaStats(rgba) {
  const bytes = requireRgba(rgba);
  const pixels = bytes.length / 4;

  let opaque = 0;
  let transparent = 0;
  for (let i = 3; i < bytes.length; i += 4) {
    if (bytes[i] === 255) opaque++;
    else if (bytes[i] === 0) transparent++;
  }

  return {
    pixels,
    opaqueShare: opaque / pixels,
    transparentShare: transparent / pixels,
    partialShare: (pixels - opaque - transparent) / pixels,
  };
}

/**
 * ¿El alfa describe una forma, o es un 255 global?
 *
 * Devuelve `false` cuando casi todo el lienzo es opaco: en ese caso la silueta sería el rectángulo
 * del lienzo y el corte de pieza no aporta nada (la limitación que dejó abierta el experimento 02).
 */
export function alphaHasTransparency(rgba, { maxOpaqueShare = ALPHA_RULES.maxOpaqueShare } = {}) {
  if (!(maxOpaqueShare >= 0 && maxOpaqueShare <= 1)) {
    throw new Error("maxOpaqueShare debe estar entre 0 y 1");
  }
  return alphaStats(rgba).opaqueShare <= maxOpaqueShare;
}

/**
 * Máscara 0/1 del sujeto: 1 donde el alfa llega al umbral, 0 donde no.
 *
 * `tolerance` es el radio de aislamiento que limpia motas: un píxel sin ningún vecino de su mismo
 * valor en ese radio se invierte (una mota opaca desaparece, un agujero de un píxel se rellena). En
 * el borde de la imagen la ventana se recorta en vez de inventar fondo fuera del lienzo, así que un
 * sujeto pegado al borde no pierde píxeles. Con `tolerance: 0` la máscara es la del umbral, sin
 * excepciones.
 *
 * @returns {Uint8Array} un byte por píxel, en orden de filas
 */
export function alphaMask(
  rgba,
  width,
  height,
  { tolerance = ALPHA_RULES.tolerance, minAlpha = ALPHA_RULES.minAlpha } = {},
) {
  const bytes = requireRgba(rgba);
  const pixels = requireSize(width, height, bytes);
  if (!(minAlpha >= 0 && minAlpha <= 255)) throw new Error("minAlpha debe estar entre 0 y 255");
  if (!Number.isInteger(tolerance) || tolerance < 0) {
    throw new Error(`tolerance debe ser un entero ≥ 0, recibí ${tolerance}`);
  }

  const mask = new Uint8Array(pixels);
  for (let p = 0; p < pixels; p++) mask[p] = bytes[p * 4 + 3] >= minAlpha ? 1 : 0;

  return tolerance > 0 ? despeckle(mask, width, height, tolerance) : mask;
}

/**
 * Máscara → imagen de gris que el motor acepta tal cual.
 *
 * El sujeto va a negro (tinta) y el fondo a blanco (papel), con alfa opaco: `clustering: 'bw'` con
 * `binaryThreshold: 128` traza entonces exactamente la frontera de la máscara. El resultado tiene
 * la misma forma que devuelve `decodeImage`, así que se pasa al trazador sin adaptadores.
 *
 * @returns {{ width: number, height: number, rgba: Uint8Array }}
 */
export function maskToLuminance(mask, width, height) {
  const pixels = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || pixels <= 0) {
    throw new Error("width y height deben ser enteros positivos");
  }
  if (mask.length !== pixels) {
    throw new Error(`la máscara debe tener width × height = ${pixels} valores, tiene ${mask.length}`);
  }

  const rgba = new Uint8Array(pixels * 4);
  for (let p = 0; p < pixels; p++) {
    const value = mask[p] ? 0 : 255;
    const i = p * 4;
    rgba[i] = value;
    rgba[i + 1] = value;
    rgba[i + 2] = value;
    rgba[i + 3] = 255;
  }
  return { width, height, rgba };
}

/**
 * Alfa sobre blanco, para el camino de color.
 *
 * Un PNG transparente guarda negro donde no hay sujeto, y cuantizar eso mete una región negra que
 * no está en la imagen: el trazador de color vería un borde que el taller no diseñó. Componer sobre
 * blanco deja la imagen opaca —lo que el camino de color espera— sin tocar el original.
 *
 * @returns {Uint8Array} RGBA8 nuevo, con alfa 255 en todos los píxeles
 */
export function flattenOntoWhite(rgba, width, height) {
  const bytes = requireRgba(rgba);
  const pixels = requireSize(width, height, bytes);

  const flat = new Uint8Array(pixels * 4);
  for (let i = 0; i < pixels * 4; i += 4) {
    const alpha = bytes[i + 3];
    const keep = alpha / 255;
    const paper = 255 * (1 - keep);
    flat[i] = Math.round(bytes[i] * keep + paper);
    flat[i + 1] = Math.round(bytes[i + 1] * keep + paper);
    flat[i + 2] = Math.round(bytes[i + 2] * keep + paper);
    flat[i + 3] = 255;
  }
  return flat;
}

/**
 * Invierte los píxeles aislados: sin ningún vecino del mismo valor en el radio dado.
 *
 * No es un filtro de mayoría, y la diferencia importa: en una ventana de 3 × 3 una esquina de 90°
 * tiene 4 vecinos propios y 5 del fondo, así que una mayoría la borraría. Aquí sólo desaparece lo
 * que está completamente solo.
 */
function despeckle(mask, width, height, radius) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const value = mask[index];
      let supported = false;
      for (let dy = -radius; dy <= radius && !supported; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          if (ny * width + nx === index) continue;
          if (mask[ny * width + nx] === value) {
            supported = true;
            break;
          }
        }
      }
      out[index] = supported ? value : 1 - value;
    }
  }
  return out;
}

function requireRgba(rgba) {
  const bytes = rgba instanceof Uint8Array ? rgba : new Uint8Array(rgba ?? []);
  if (bytes.length === 0 || bytes.length % 4 !== 0) {
    throw new Error("el buffer debe ser RGBA8 (4 bytes por píxel)");
  }
  return bytes;
}

function requireSize(width, height, bytes) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("width y height deben ser enteros positivos");
  }
  if (bytes.length < width * height * 4) {
    throw new Error("el buffer no tiene width × height × 4 bytes");
  }
  return width * height;
}
