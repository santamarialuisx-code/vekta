// Lectura y escritura de imágenes sin dependencias nativas.
//
// El banco necesita píxeles crudos para cuantizar antes de trazar. `jpeg-js` y `pngjs` son JS
// puro, así que la única parte específica de plataforma queda aislada aquí: en el navegador se
// sustituye por `createImageBitmap` + `getImageData` y el resto del pipeline no cambia.

import jpeg from "jpeg-js";
import { PNG } from "pngjs";

const PNG_MAGIC = 0x89504e47;
const JPEG_MAGIC = 0xffd8;

/** Detecta el formato por cabecera y devuelve `{ width, height, rgba }`. */
export function decodeImage(buffer) {
  const bytes = Buffer.from(buffer);

  if (bytes.length >= 8 && bytes.readUInt32BE(0) === PNG_MAGIC) {
    const png = PNG.sync.read(bytes);
    return { width: png.width, height: png.height, rgba: new Uint8Array(png.data) };
  }

  if (bytes.length >= 2 && bytes.readUInt16BE(0) === JPEG_MAGIC) {
    const raw = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
    return { width: raw.width, height: raw.height, rgba: new Uint8Array(raw.data) };
  }

  throw new Error("formato de imagen no soportado (solo PNG y JPEG)");
}

/** Codifica `{ width, height, rgba }` como PNG RGBA. */
export function encodePng({ width, height, rgba }) {
  return PNG.sync.write({ width, height, data: Buffer.from(rgba) }, { colorType: 6 });
}
