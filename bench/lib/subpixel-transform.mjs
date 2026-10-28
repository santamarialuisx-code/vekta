// Transform subpíxel: la ampliación de la imagen y el reescalado del `d`, sin motor.
//
// Esta mitad del subpíxel es geometría pura: no importa `@visioncortex/vtracer` ni nada de Node.
// Existe separada de `subpixel.mjs` por un contrato concreto: `web/app.mjs` la importa tal cual en
// el navegador, donde un `import vtracer from "@visioncortex/vtracer"` no se puede resolver sin
// bundler. Lo que sí necesita motor (trazar la imagen ampliada) vive en `subpixel.mjs`.
//
// La razón del método, en una línea: el motor decide «esto es tinta / esto es papel» píxel a píxel
// sobre la rejilla original, así que un trazo de 1,5 px se convierte en un contorno entero. Aquí se
// amplía la luminancia con interpolación bilineal (`upsampleLuminance`) y, después de trazar, la
// geometría se devuelve a la rejilla original dividiendo por el factor (`scalePathData`).
//
// Ojo con la escala: `scalePathData` reescala *cualquier* `d` por un factor, no solo al volver. El
// transform tiene que ser exacto en las dos direcciones y en todos los comandos, incluidos los
// relativos (`h`, `v`, `s`, `t`…) y los radios de arco (`A`), que no son coordenadas pero se miden
// en las mismas unidades.

import { parsePath } from "./path-to-polyline.mjs";

/**
 * Decimales fijos de salida del transform.
 *
 * No es una perilla de calidad: a escala 4 el paso fino es 0,25 de píxel, y 2 decimales lo
 * representan con error ≤ 0,005. El límite lo pone el tamaño del SVG, no la fidelidad.
 */
export const FIXED_DECIMALS = 2;

/**
 * Qué argumentos de cada comando son longitudes (y por tanto se multiplican).
 *
 * Todo lo que no está aquí se copia tal cual, y eso es deliberado:
 * - `A` lleva `rx ry rotación large-arc sweep x y`: los radios sí son longitudes, la rotación es un
 *   ángulo y los dos flags son booleanos. Multiplicarlos rompería el arco.
 * - `H` y `V` llevan una sola coordenada, no dos.
 */
const LENGTH_ARGS = {
  M: [0, 1],
  L: [0, 1],
  H: [0],
  V: [0],
  C: [0, 1, 2, 3, 4, 5],
  S: [0, 1, 2, 3],
  Q: [0, 1, 2, 3],
  T: [0, 1],
  A: [0, 1, 5, 6],
  Z: [],
};

/** Número con redondeo fijo y sin ceros de relleno: `2.5` cabe, `2.50` solo engorda el SVG. */
function formatNumber(value) {
  const rounded = Number(value.toFixed(FIXED_DECIMALS));
  // `-0` es un número válido en JS y un residuo feo en el SVG.
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/**
 * Reescala todas las coordenadas de un `d` por `factor`, en precisión fija.
 *
 * Acepta comandos absolutos y relativos, mayúsculas y minúsculas: en ambos casos la coordenada es
 * una longitud en el mismo sistema, solo cambia el origen. Las repeticiones implícitas (`M0 0 10 10`)
 * se expanden al parsear, así que la salida lleva un comando por segmento.
 */
export function scalePathData(d, factor) {
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new Error(`el factor de escala debe ser un número positivo, recibió ${factor}`);
  }

  const out = [];
  for (const { cmd, args } of parsePath(d)) {
    const lengths = LENGTH_ARGS[cmd.toUpperCase()];
    if (!lengths) throw new Error(`comando SVG no soportado: "${cmd}"`);

    if (args.length === 0) {
      out.push(cmd);
      continue;
    }

    const scaled = args.slice();
    for (const index of lengths) scaled[index] = args[index] * factor;
    out.push(`${cmd} ${scaled.map(formatNumber).join(" ")}`);
  }
  return out.join(" ");
}

/**
 * Amplía una imagen de luminancia por un factor entero con interpolación bilineal.
 *
 * El mapeo es por centros de píxel —`origen = (destino + 0,5) / scale − 0,5`— para que la imagen
 * ampliada ocupe exactamente el mismo rectángulo que la original. Es lo que hace que dividir la
 * geometría trazada por `scale` la devuelva al marco de la imagen original sin medio píxel de
 * desplazamiento. Los bordes se replican, así que ampliar no inventa un marco oscuro.
 */
export function upsampleLuminance(gray, width, height, scale) {
  if (!Number.isInteger(scale) || scale < 1) {
    throw new Error(`la escala debe ser un entero ≥ 1, recibió ${scale}`);
  }
  if (!width || !height || gray.length < width * height) {
    throw new Error("el buffer no tiene width × height muestras de luminancia");
  }

  const outWidth = width * scale;
  const outHeight = height * scale;
  const out = new Float32Array(outWidth * outHeight);

  const at = (x, y) => gray[y * width + x];
  const clampX = (v) => Math.min(width - 1, Math.max(0, v));
  const clampY = (v) => Math.min(height - 1, Math.max(0, v));

  for (let y = 0; y < outHeight; y++) {
    const sourceY = clampY((y + 0.5) / scale - 0.5);
    const y0 = Math.floor(sourceY);
    const y1 = clampY(y0 + 1);
    const fy = sourceY - y0;

    for (let x = 0; x < outWidth; x++) {
      const sourceX = clampX((x + 0.5) / scale - 0.5);
      const x0 = Math.floor(sourceX);
      const x1 = clampX(x0 + 1);
      const fx = sourceX - x0;

      const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx;
      const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx;
      out[y * outWidth + x] = top * (1 - fy) + bottom * fy;
    }
  }

  return { width: outWidth, height: outHeight, gray: out };
}

/**
 * Amplía una imagen RGBA por un factor entero con interpolación bilineal.
 *
 * Mismo mapeo por centros de píxel que la luminancia (y por eso las dos ampliaciones coinciden en
 * las imágenes grises), pero canal a canal, alfa incluido: el color no puede perder la transparencia.
 */
export function upsampleRgba(rgba, width, height, scale) {
  if (!Number.isInteger(scale) || scale < 1) {
    throw new Error(`la escala debe ser un entero ≥ 1, recibió ${scale}`);
  }
  if (!width || !height || rgba.length < width * height * 4) {
    throw new Error("el buffer no tiene width × height × 4 bytes");
  }

  const outWidth = width * scale;
  const outHeight = height * scale;
  const out = new Uint8Array(outWidth * outHeight * 4);

  const at = (x, y) => (y * width + x) * 4;
  const clampX = (v) => Math.min(width - 1, Math.max(0, v));
  const clampY = (v) => Math.min(height - 1, Math.max(0, v));

  for (let y = 0; y < outHeight; y++) {
    const sourceY = clampY((y + 0.5) / scale - 0.5);
    const y0 = Math.floor(sourceY);
    const y1 = clampY(y0 + 1);
    const fy = sourceY - y0;
    const row0 = at(0, y0);
    const row1 = at(0, y1);

    for (let x = 0; x < outWidth; x++) {
      const sourceX = clampX((x + 0.5) / scale - 0.5);
      const x0 = Math.floor(sourceX);
      const x1 = clampX(x0 + 1);
      const fx = sourceX - x0;

      const i0 = row0 + x0 * 4;
      const i1 = row0 + x1 * 4;
      const i2 = row1 + x0 * 4;
      const i3 = row1 + x1 * 4;
      const o = (y * outWidth + x) * 4;

      for (let c = 0; c < 4; c++) {
        const top = rgba[i0 + c] * (1 - fx) + rgba[i1 + c] * fx;
        const bottom = rgba[i2 + c] * (1 - fx) + rgba[i3 + c] * fx;
        out[o + c] = Math.round(top * (1 - fy) + bottom * fy);
      }
    }
  }

  return { width: outWidth, height: outHeight, rgba: out };
}

/** Luminancia → RGBA gris opaco, que es lo que come el motor. */
function toGrayRgba(gray) {
  const rgba = new Uint8Array(gray.length * 4);
  for (let p = 0, i = 0; p < gray.length; p++, i += 4) {
    const value = Math.max(0, Math.min(255, Math.round(gray[p])));
    rgba[i] = value;
    rgba[i + 1] = value;
    rgba[i + 2] = value;
    rgba[i + 3] = 255;
  }
  return rgba;
}

/**
 * La imagen que ve el motor: la luminancia original ampliada `scale`×, en RGBA gris opaco.
 *
 * Es el único paso que comparten el banco y el navegador. Todo lo demás del subpíxel es el mismo
 * `d` multiplicado por un factor, y eso no necesita motor.
 */
export function subpixelFrame(signals, scale = 1) {
  if (!signals || !signals.gray || !signals.width || !signals.height) {
    throw new Error("hacen falta las señales de la imagen (lineArtSignals)");
  }

  const upsampled = upsampleLuminance(signals.gray, signals.width, signals.height, scale);
  return {
    width: upsampled.width,
    height: upsampled.height,
    rgba: toGrayRgba(upsampled.gray),
  };
}

/**
 * Deja la geometría de un SVG en el marco de otra imagen: `viewBox` y `width`/`height` de destino y
 * todos los `d` divididos por el factor.
 *
 * El motor no emite `viewBox` (solo `width`/`height`), así que hay que añadirlo: sin él, cualquier
 * página que mida el SVG con `svgMetrics` o lo compare con la imagen original no tiene con qué
 * relacionar sus unidades.
 */
export function rescaleSvg(svg, width, height, factor) {
  const framed = svg.replace(/<svg\b[^>]*>/, (tag) => {
    const sized = tag
      .replace(/\sviewBox="[^"]*"/, "")
      .replace(/\swidth="[^"]*"/, ` width="${width}"`)
      .replace(/\sheight="[^"]*"/, ` height="${height}"`);
    return sized.replace(/\s*>$/, ` viewBox="0 0 ${width} ${height}">`);
  });

  if (factor === 1) return framed;
  return framed.replace(/(\sd=")([^"]*)(")/g, (_, pre, d, post) => pre + scalePathData(d, factor) + post);
}
