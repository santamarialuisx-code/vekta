// Página de trazado: imagen → señales → SVG, todo dentro del navegador.
//
// El flujo es el del producto, no el del banco: primero se mide la imagen (`lineArtSignals`), la
// regla decide si es line art (`looksLikeLineArt`) y el trazado sale del preset que ya se midió en
// los experimentos 07 y 08. «Auto» es el modo por defecto porque es el que decide con números; los
// otros dos existen para forzar el camino y comparar.
//
// Nada sale del navegador: la imagen se lee con `createImageBitmap`, se rasteriza en un canvas, se
// vectoriza en wasm y se descarga desde un Blob. No hay subida, ni servidor de aplicación, ni nada
// guardado entre visitas. El servidor estático solo reparte ficheros: si el navegador pudiera leer
// píxeles de `file://` sin taint de CORS, ni siquiera haría falta.

import { LINE_ART_SCALE, lineArtOptions, lineArtSignals, looksLikeLineArt } from "../bench/lib/lineart.mjs";
import { quantize, renderQuantized } from "../bench/lib/quantize.mjs";
import { subpixelFrame, rescaleSvg } from "../bench/lib/subpixel-transform.mjs";
import { svgMetrics } from "../bench/lib/svg-metrics.mjs";
import { loadVtracer } from "./vtracer-web.mjs";

/** Preset de color del banco: el de póster/foto del experimento 08. */
const COLOR_PRESET = { mode: "spline", hierarchical: "cutout", optimize: 2, simplify: 0.8 };

const ui = {
  zona: document.querySelector("#zona"),
  archivo: document.querySelector("#archivo"),
  modo: document.querySelector("#modo"),
  colores: document.querySelector("#colores"),
  ancho: document.querySelector("#ancho"),
  vista: document.querySelector("#vista"),
  vacio: document.querySelector("#vacio"),
  medidas: document.querySelector("#medidas"),
  decision: document.querySelector("#decision"),
  estado: document.querySelector("#estado"),
  error: document.querySelector("#error"),
  svg: document.querySelector("#descargar-svg"),
  mm: document.querySelector("#descargar-mm"),
};

const state = {
  /** Nombre del fichero sin extensión: lo usan las descargas. */
  name: "imagen",
  width: 0,
  height: 0,
  rgba: null,
  signals: null,
  /** Resultado de `looksLikeLineArt` para la imagen cargada. */
  verdict: null,
  svg: null,
  /** Milisegundos del bloque de trazado, medidos con `performance.now()`. */
  ms: 0,
  previewUrl: null,
};

// --- entrada ---------------------------------------------------------------

ui.zona.addEventListener("dragover", (event) => {
  event.preventDefault();
  ui.zona.classList.add("activa");
});
ui.zona.addEventListener("dragleave", () => ui.zona.classList.remove("activa"));
ui.zona.addEventListener("drop", (event) => {
  event.preventDefault();
  ui.zona.classList.remove("activa");
  const [file] = event.dataTransfer.files;
  if (file) run(() => readImage(file));
});
ui.zona.addEventListener("click", () => ui.archivo.click());
ui.archivo.addEventListener("change", () => {
  const [file] = ui.archivo.files;
  if (file) run(() => readImage(file));
});
ui.modo.addEventListener("change", () => {
  if (state.rgba) run(trace);
});
ui.colores.addEventListener("change", () => {
  if (state.rgba && resolvedMode() === "paleta") run(trace);
});

// --- imagen ----------------------------------------------------------------

async function readImage(file) {
  state.name = file.name.replace(/\.[^.]+$/, "") || "imagen";
  ui.estado.textContent = `leyendo ${file.name}…`;

  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
  state.rgba = data;
  state.width = width;
  state.height = height;
  state.svg = null;

  await trace();
}

// --- trazado ---------------------------------------------------------------

async function trace() {
  const mode = ui.modo.value;
  const signals = lineArtSignals(state.rgba, state.width, state.height);
  const verdict = looksLikeLineArt(signals);
  state.signals = signals;
  state.verdict = verdict;
  const puesto = resolvedMode();

  ui.estado.textContent = "descargando el trazador…";
  const { vectorizeRgba } = await loadVtracer();

  ui.estado.textContent = "trazando…";
  // Dos frames para que el estado se pinte antes de que el wasm bloquee el hilo.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const started = performance.now();
  let svg;
  if (puesto === "binario") {
    // Line art: se traza a `LINE_ART_SCALE`× (el motor ve un borde suave, no un escalón de píxel) y
    // la geometría vuelve al marco de la imagen. Es el mismo camino que `bench/auto-trace.mjs`; la
    // ampliación es JS puro, así que no hace falta otra dependencia en el cliente.
    const frame = subpixelFrame(signals, LINE_ART_SCALE);
    const traced = vectorizeRgba(frame.rgba, frame.width, frame.height, lineArtOptions(signals));
    svg = rescaleSvg(traced, state.width, state.height, 1 / LINE_ART_SCALE);
  } else {
    // Paleta explícita: cuantizar en OKLab, repintar con esos colores y trazar con la lista fija.
    const maxColors = clampColors(ui.colores.value);
    const palette = quantize(state.rgba, state.width, state.height, { maxColors });
    const rendered = renderQuantized(state.rgba, state.width, state.height, palette);
    svg = vectorizeRgba(rendered, state.width, state.height, { ...COLOR_PRESET, palette: palette.paletteHex });
  }
  state.ms = Math.round(performance.now() - started);

  state.svg = svg;
  show({ mode, puesto, verdict, svg });
}

/**
 * Modo efectivo: «auto» se resuelve con la regla que ya se calculó para la imagen, y las otras dos
 * opciones se respetan tal cual. Se decide fuera de `trace()` porque el selector de colores necesita
 * saber si el camino es el de paleta sin volver a medir la imagen.
 */
function resolvedMode() {
  if (ui.modo.value !== "auto") return ui.modo.value;
  return state.verdict?.lineArt ? "binario" : "paleta";
}

function clampColors(value) {
  const colors = Math.round(Number(value));
  return Number.isFinite(colors) ? Math.min(64, Math.max(2, colors)) : 16;
}

// --- salida ----------------------------------------------------------------

function show({ mode, puesto, verdict, svg }) {
  const metrics = svgMetrics(svg);
  const { signals } = state;
  const umbral = puesto === "binario" ? ` por debajo de ${signals.threshold + 1}` : "";

  ui.medidas.innerHTML = [
    row("nodos", count(metrics.nodes)),
    row("rellenos", count(metrics.colors)),
    row("subpaths", count(metrics.subpaths)),
    row("tamaño", `${count(Math.round(metrics.bytes / 1024))} KB`),
    row("traza", `${count(state.ms)} ms`),
    row("lienzo", `${count(state.width)} × ${count(state.height)} px`),
  ].join("");

  const porque =
    mode === "auto"
      ? `auto: ${verdict.reason} → ${puesto}`
      : `forzado: ${puesto}. La regla habría dicho ${verdict.reason}`;
  ui.decision.textContent =
    `${porque}. ` +
    `Otsu ${signals.threshold}${umbral}, separabilidad ${signals.separability.toFixed(2)}, ` +
    `aristas ${(signals.edgeDensity * 100).toFixed(0)} %.`;

  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  ui.vista.src = state.previewUrl;
  ui.vista.hidden = false;
  ui.vacio.hidden = true;

  ui.svg.disabled = false;
  ui.mm.disabled = false;
  ui.estado.textContent = `${state.name} · ${puesto}`;
}

ui.svg.addEventListener("click", () => save(state.svg, `${state.name}.svg`));

ui.mm.addEventListener("click", () => {
  run(async () => {
    const millimeters = Number(ui.ancho.value);
    if (!(millimeters > 0)) throw new Error("el ancho en milímetros tiene que ser positivo");
    const target = withMillimeters(state.svg, millimeters);
    save(target, `${state.name}-${trim(millimeters)}mm.svg`);
  });
});

/**
 * El motor emite `width`/`height` en píxeles y ningún `viewBox`: con unidades físicas hay que
 * fijarlo, o el navegador interpretaría cada unidad del `d` como un milímetro y la pieza saldría
 * 3000 mm de ancha.
 */
function withMillimeters(svg, widthMm) {
  const rootTag = svg.match(/<svg\b[^>]*>/);
  if (!rootTag) throw new Error("el SVG no tiene elemento raíz");
  const pixelsWide = Number(/\swidth="([\d.]+)"/.exec(rootTag[0])?.[1]);
  const pixelsHigh = Number(/\sheight="([\d.]+)"/.exec(rootTag[0])?.[1]);
  if (!(pixelsWide > 0 && pixelsHigh > 0)) {
    throw new Error("el SVG no trae width/height en píxeles");
  }

  const heightMm = (widthMm * pixelsHigh) / pixelsWide;
  const root = rootTag[0]
    .replace(/\swidth="[^"]*"/, ` width="${trim(widthMm)}mm"`)
    .replace(/\sheight="[^"]*"/, ` height="${trim(heightMm)}mm"`)
    .replace(/\s*>$/, ` viewBox="0 0 ${pixelsWide} ${pixelsHigh}">`);

  return svg.slice(0, rootTag.index) + root + svg.slice(rootTag.index + rootTag[0].length);
}

function save(content, name) {
  const url = URL.createObjectURL(new Blob([content], { type: "image/svg+xml" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // El navegador ya se quedó con el Blob: se libera cuando la descarga está lanzada.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// --- utilidades ------------------------------------------------------------

/** Envuelve una tarea para que un fallo se lea en la página y no solo en la consola. */
function run(task) {
  ui.error.textContent = "";
  return task().catch((error) => {
    ui.error.textContent = error.message;
    ui.estado.textContent = "error";
    console.error(error);
  });
}

/** Miles con espacio fino, igual que los informes del banco: 17 749. */
function count(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, "\u2009");
}

function trim(value) {
  return Number(value.toFixed(2)).toString();
}

function row(label, value) {
  return `<div><dt>${label}</dt><dd>${value}</dd></div>`;
}
