// OKLab: el espacio donde «dos colores se parecen» se mide con una distancia que el ojo
// reconoce. La cuantización y la limpieza de regiones deciden con ΔE; si el espacio fuera sRGB,
// un mismo ΔE numérico significaría cosas distintas en sombras y en luces.
//
// Conversión según Björn Ottosson (https://bottosson.github.io/posts/oklab/).

const LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** sRGB 0..1 → luz lineal. */
export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Luz lineal 0..1 → sRGB. */
export function linearToSrgb(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

/** sRGB de 8 bits → OKLab [L, a, b]. */
export function rgbToOklab(r, g, b) {
  const lr = LINEAR[r & 0xff];
  const lg = LINEAR[g & 0xff];
  const lb = LINEAR[b & 0xff];

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab [L, a, b] → sRGB de 8 bits, saturado a la gama visible. */
export function oklabToRgb(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    toByte(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toByte(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toByte(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** OKLab → `#rrggbb`. */
export function oklabToHex(lab) {
  const [r, g, b] = oklabToRgb(lab[0], lab[1], lab[2]);
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

/** Distancia euclídea en OKLab: el ΔE que usan el cuantizador y la limpieza. */
export function deltaE(a, b) {
  const dL = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dL * dL + da * da + db * db);
}

function toByte(linear) {
  const value = Math.round(linearToSrgb(Math.min(1, Math.max(0, linear))) * 255);
  return value < 0 ? 0 : value > 255 ? 255 : value;
}
