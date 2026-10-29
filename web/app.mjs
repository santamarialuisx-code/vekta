// Página de trazado: imagen → señales → SVG, todo dentro del navegador.
//
// El flujo es el del producto, no el del banco: primero se mide la imagen (`lineArtSignals`), la
// regla decide si es line art (`looksLikeLineArt`) y el trazado sale del preset que ya se midió en
// los experimentos 07 y 08. «Auto» es el modo por defecto porque es el que decide con números; los
// otros dos existen para forzar el camino y comparar.
//
// Para color hay tres caminos, y el que manda por defecto lo elige la imagen, no el usuario:
//
// - **plano** — la paleta se poda (experimento 16): un dibujo de seis colores sale con seis, sin la
//   rampa de antialiasing que antes gastaba las ranuras. Es el camino de la ilustración plana y el
//   que deja piezas grandes y borrables.
// - **refit** — píxel + curvas (experimento 15): el camino de la foto, donde sí hay gradientes.
// - **binario** — line art, con el Otsu de la propia imagen (experimento 07).
//
// Encima del trazado hay dos cosas que el usuario toca sin volver a trazar:
//
// - **Quitar fondo.** El alfa de un PNG ya es una máscara y el motor la respeta; cuando el lienzo es
//   opaco (JPG, PNG con fondo blanco) la máscara se deduce con una varita desde el borde
//   (`backgroundMask`) y se aplica como alfa 0 antes de medir. Nada de esto inventa geometría: el
//   pipeline sigue siendo el mismo, solo cambia qué píxeles son sujeto.
// - **Borrar piezas.** El motor ya emite una pieza por región (un `<path fill="#…">` cada una), así
//   que el SVG trazado *es* el mapa de segmentos que edita Vector Magic, solo que a nivel de path.
//   Se pinta en línea en el DOM (no en un `<img>`, que no recibe clics), se selecciona con el ratón
//   y se borra una pieza o todas las del mismo color, o se rellena con otro de la paleta. Es el
//   editor de segmentos de Vector Magic, con las piezas que el motor ya emitió.
//
// Nada sale del navegador: la imagen se lee con `createImageBitmap`, se rasteriza en un canvas, se
// vectoriza en wasm y se descarga desde un Blob. No hay subida, ni servidor de aplicación, ni nada
// guardado entre visitas. El servidor estático solo reparte ficheros: si el navegador pudiera leer
// píxeles de `file://` sin taint de CORS, ni siquiera haría falta.

import { alphaHasTransparency, alphaStats } from "../bench/lib/alpha.mjs";
import { applyBackgroundMask, backgroundMask, borderSeeds } from "../bench/lib/background.mjs";
import { colorTraceOptions } from "../bench/lib/color-presets.mjs";
import { REFIT_DEFAULTS, refitSvg } from "../bench/lib/color-refit.mjs";
import { LINE_ART_SCALE, lineArtOptions, lineArtSignals, looksLikeLineArt } from "../bench/lib/lineart.mjs";
import { FLAT_RULES, flatPalette, nearestPalette, quantize, renderQuantized } from "../bench/lib/quantize.mjs";
import { subpixelFrame, rescaleSvg } from "../bench/lib/subpixel-transform.mjs";
import { svgMetrics } from "../bench/lib/svg-metrics.mjs";
import { loadVtracer } from "./vtracer-web.mjs";

/** `simplify` del camino de color con curvas: el del preset de póster/foto del experimento 08. */
const COLOR_SIMPLIFY = 0.8;

/** Estados de deshacer que se guardan. Cada uno es el SVG completo: 20 × ~150 KB es asumible. */
const HISTORY_LIMIT = 20;

/**
 * Techo de memoria del historial, en caracteres (≈ 2 bytes cada uno).
 *
 * Un trazado de color de una foto ronda los 3,4 MB: veinte copias serían 68 MB de RAM en un móvil
 * solo para poder deshacer. Se descarta lo más viejo antes que quedarse sin memoria.
 */
const HISTORY_CHARS = 12_000_000;

const DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

const SVG_NS = "http://www.w3.org/2000/svg";

const ui = {
  zona: document.querySelector("#zona"),
  archivo: document.querySelector("#archivo"),
  modo: document.querySelector("#modo"),
  colores: document.querySelector("#colores"),
  ancho: document.querySelector("#ancho"),
  fondo: document.querySelector("#fondo"),
  fondoTol: document.querySelector("#fondo-tol"),
  borde: document.querySelector("#borde"),
  bordePx: document.querySelector("#borde-px"),
  vista: document.querySelector("#vista"),
  vacio: document.querySelector("#vacio"),
  seleccion: document.querySelector("#seleccion"),
  relleno: document.querySelector("#relleno"),
  rellenar: document.querySelector("#rellenar"),
  borrarPieza: document.querySelector("#borrar-pieza"),
  borrarColor: document.querySelector("#borrar-color"),
  deshacer: document.querySelector("#deshacer"),
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
  /** Resultado de `flatPalette` (paleta plana podada) o null si no se calculó. */
  flat: null,
  /** Lo que se usó al trazar en plano: `{ count, residual, cap }`, para la línea de decisión. */
  plano: null,
  /** ¿El PNG trae alfa de verdad (no un 255 global)? Si sí, el fondo ya está resuelto. */
  transparent: false,
  /** Damero de transparencia detectado en el borde: `{ seeds, share }` o null. */
  checkerboard: null,
  /** Fondo quitado con la varita: `{ rgba, hex, share, tolerance, applied }` o null. */
  background: null,
  svg: null,
  /** Modo efectivo del último trazado, para el rótulo de estado. */
  puesto: null,
  /** Milisegundos del bloque de trazado, medidos con `performance.now()`. */
  ms: 0,
  /** Pila de SVG anteriores para deshacer. */
  history: [],
  /** Pieza seleccionada en la vista, como elemento del DOM. */
  selected: null,
  /** Piezas del SVG actual, en orden de pintado. */
  shapes: [],
  edited: false,
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
  if (state.rgba && resolvedMode() !== "binario") run(trace);
});
ui.fondo.addEventListener("change", () => {
  if (state.rgba) run(trace);
});
ui.fondoTol.addEventListener("change", () => {
  if (state.rgba && ui.fondo.checked) run(trace);
});
// El borde blanco no cambia el dibujo: se vuelve a componer sobre el SVG que ya está en pantalla.
ui.borde.addEventListener("change", () => {
  if (!state.svg) return;
  refreshDieCut();
  updateStatus();
});
ui.bordePx.addEventListener("change", () => {
  if (!state.svg || !ui.borde.checked) return;
  refreshDieCut();
  updateStatus();
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
  state.background = null;
  state.transparent = alphaHasTransparency(data);
  state.checkerboard = detectCheckerboard();
  // El selector de fondo no tiene nada que hacer si el alfa ya es la máscara; y si el lienzo trae
  // un damero quemado, el fondo ya está decidido: se quita solo.
  ui.fondo.disabled = state.transparent;
  ui.fondo.checked = Boolean(state.checkerboard);

  await trace();
}

// --- trazado ---------------------------------------------------------------

async function trace() {
  const mode = ui.modo.value;
  const pixels = workingRgba();
  const signals = lineArtSignals(pixels, state.width, state.height);
  const verdict = looksLikeLineArt(signals);
  state.signals = signals;
  state.verdict = verdict;
  // La paleta plana se mide una vez por imagen y fondo: es la que decide si el dibujo es plano
  // (`residual`) y la que se usa si toca trazar por ahí. En line art no se calcula: no hay color.
  state.flat = verdict.lineArt ? null : flatPalette(pixels, state.width, state.height);
  state.plano = null;
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
    // `signals.gray` ya viene compuesto sobre papel blanco: el fondo transparente no es tinta.
    const frame = subpixelFrame(signals, LINE_ART_SCALE);
    const traced = vectorizeRgba(frame.rgba, frame.width, frame.height, lineArtOptions(signals));
    svg = rescaleSvg(traced, state.width, state.height, 1 / LINE_ART_SCALE);
  } else if (puesto === "plano") {
    // Paleta plana: los colores del dibujo, sin la rampa de antialiasing. El tope de «colores» se
    // aplica después de la poda —los colores vienen ordenados por área—, así que subirlo no inventa
    // colores y bajarlo funde los más pequeños en el más cercano.
    const flat = state.flat ?? flatPalette(pixels, state.width, state.height);
    if (flat.count === 0) throw new Error("no quedó nada visible: el fondo se comió la imagen");
    const cap = Math.max(2, clampColors(ui.colores.value));
    const palette = flat.palette.slice(0, Math.min(cap, flat.count));
    const paletteHex = palette.map(toHex);
    const rendered = renderQuantized(pixels, state.width, state.height, {
      indices: nearestPalette(pixels, palette),
      palette,
      paletteHex,
    });
    svg = vectorizeRgba(
      rendered,
      state.width,
      state.height,
      colorTraceOptions(paletteHex, { mode: "curvas", simplify: COLOR_SIMPLIFY }),
    );
    state.plano = { count: palette.length, residual: flat.residual, cap };
  } else {
    // Paleta explícita: cuantizar en OKLab, repintar con esos colores y trazar con la lista fija.
    // «fidelidad» es el modo píxel del experimento 14: sigue la frontera del raster en vez de ajustar
    // curvas, y es el que se mide al nivel del competidor en ilustración, póster y foto.
    const maxColors = clampColors(ui.colores.value);
    const palette = quantize(pixels, state.width, state.height, { maxColors });
    if (palette.paletteHex.length === 0) {
      throw new Error("no quedó nada visible: el fondo se comió la imagen");
    }
    const rendered = renderQuantized(pixels, state.width, state.height, palette);
    svg = vectorizeRgba(
      rendered,
      state.width,
      state.height,
      colorTraceOptions(palette.paletteHex, {
        mode: puesto === "curvas" ? "curvas" : "fidelidad",
        simplify: COLOR_SIMPLIFY,
      }),
    );
    // `refit` es el modo píxel con curvas ajustadas encima (experimento 15).
    if (puesto === "refit") svg = refitSvg(svg, REFIT_DEFAULTS);
  }
  state.ms = Math.round(performance.now() - started);

  state.svg = svg;
  state.puesto = puesto;
  state.history = [];
  state.edited = false;
  show({ mode, puesto, verdict, svg });
}

/**
 * ¿El borde del lienzo es un damero de transparencia?
 *
 * Un JPEG exportado desde un PNG con alfa guarda el damero como píxeles: dos grises alternos que
 * ocupan el perímetro casi mitad y mitad. Se detecta con dos condiciones baratas —los dos tonos son
 * neutros y el segundo ocupa al menos el 15 % del borde— y se confirma con la máscara: si quitar ese
 * fondo se lleva menos del 10 % del lienzo, no era un fondo.
 */
function detectCheckerboard() {
  if (state.transparent) return null;
  const seeds = borderSeeds(state.rgba, state.width, state.height);
  if (seeds.length < 2 || !seeds.every(isNeutral)) return null;

  const found = backgroundMask(state.rgba, state.width, state.height, { seeds, tolerance: 20, grow: 1 });
  if (!found.applied || found.share < 0.1) return null;
  return { seeds, share: found.share };
}

/** ¿El color `#rrggbb` no tiene croma? Un damero de transparencia es gris por definición. */
function isNeutral(hex) {
  const value = hex.slice(1);
  const channels = [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16));
  return Math.max(...channels) - Math.min(...channels) < 20;
}

/**
 * Los píxeles que ve el pipeline, ya sin fondo si se pidió quitarlo.
 *
 * El alfa de un PNG es una máscara que ya existe: no hay nada que decidir, y el motor la respeta
 * (un píxel transparente no genera geometría). La varita solo entra cuando el lienzo es opaco, que
 * es el caso de un JPG o de un PNG exportado con fondo blanco.
 */
function workingRgba() {
  if (!ui.fondo.checked || state.transparent) {
    state.background = null;
    return state.rgba;
  }

  const tolerance = clampTolerance(ui.fondoTol.value);
  if (state.background?.tolerance === tolerance) return state.background.rgba;

  // Dos semillas cuando el borde reparte su superficie entre dos tonos (el damero de transparencia
  // que un JPEG deja quemado); `grow: 1` se come el fleco de mezcla del borde, que si no el trazado
  // convierte en un anillo de piezas (experimento 16: 2 085 paths → 24).
  const seeds = borderSeeds(state.rgba, state.width, state.height);
  const found = backgroundMask(state.rgba, state.width, state.height, { seeds, tolerance, grow: 1 });
  const rgba = found.applied ? applyBackgroundMask(state.rgba, found.mask) : state.rgba;
  state.background = {
    rgba,
    hexes: found.seeds,
    share: found.share,
    tolerance,
    applied: found.applied,
  };
  return rgba;
}

/**
 * Modo efectivo: «auto» se resuelve con la regla que ya se calculó para la imagen, y las otras dos
 * opciones se respetan tal cual. Se decide fuera de `trace()` porque el selector de colores necesita
 * saber si el camino es el de paleta sin volver a medir la imagen.
 */
function resolvedMode() {
  if (ui.modo.value !== "auto") return ui.modo.value;
  if (state.verdict?.lineArt) return "binario";
  // Arte plano cuando la paleta podada explica la imagen: pocos colores y poco error. Si no, refit
  // (píxel + curvas), que es lo que necesita una foto con gradientes.
  if (state.flat && state.flat.residual < FLAT_RULES.maxResidual) return "plano";
  return "refit";
}

/** `[r, g, b]` → `#rrggbb`, el formato que emite el motor. */
function toHex([r, g, b]) {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function clampColors(value) {
  const colors = Math.round(Number(value));
  return Number.isFinite(colors) ? Math.min(64, Math.max(2, colors)) : 16;
}

function clampTolerance(value) {
  const tolerance = Math.round(Number(value));
  return Number.isFinite(tolerance) ? Math.min(441, Math.max(0, tolerance)) : 28;
}

// --- salida ----------------------------------------------------------------

function show({ mode, puesto, verdict, svg }) {
  renderPreview(svg);
  renderMetrics(svg);

  const { signals } = state;
  const umbral = puesto === "binario" ? ` por debajo de ${signals.threshold + 1}` : "";

  const porque =
    mode === "auto"
      ? `auto: ${verdict.reason} → ${puesto}`
      : `forzado: ${puesto}. La regla habría dicho ${verdict.reason}`;
  ui.decision.textContent =
    `${porque}. ` +
    `Otsu ${signals.threshold}${umbral}, separabilidad ${signals.separability.toFixed(2)}, ` +
    `aristas ${(signals.edgeDensity * 100).toFixed(0)} %. ` +
    planoLabel() +
    backgroundLabel();

  ui.svg.disabled = false;
  ui.mm.disabled = false;
  updateStatus();
}

/** Qué hizo la paleta plana, en una frase: cuántos colores y con qué error. */
function planoLabel() {
  const plano = state.plano;
  if (!plano) return "";
  const tope = plano.cap < plano.count ? "" : `, tope ${plano.cap}`;
  return (
    `Paleta plana: ${plano.count} colores${tope}, ΔE ${plano.residual.toFixed(3)} ` +
    `(umbral ${FLAT_RULES.maxResidual}). `
  );
}

/** Qué pasó con el fondo, en una frase. Sin fondo que quitar también es una respuesta. */
function backgroundLabel() {
  if (state.transparent) {
    const stats = alphaStats(state.rgba);
    return `Fondo: el PNG ya trae ${(stats.transparentShare * 100).toFixed(0)} % transparente.`;
  }
  if (!ui.fondo.checked) return "Fondo: intacto.";
  if (!state.background?.applied) return "Fondo: la varita no encontró un fondo que quitar.";
  const tonos =
    state.background.hexes.length > 1
      ? `dos tonos (${state.background.hexes.join(" + ")})`
      : state.background.hexes[0];
  return `Fondo: ${tonos} quitado, ${(state.background.share * 100).toFixed(0)} % del lienzo.`;
}

/** Métricas del SVG actual: las mismas filas de siempre, recalculadas después de cada borrado. */
function renderMetrics(svg) {
  const metrics = svgMetrics(svg);
  ui.medidas.innerHTML = [
    row("nodos", count(metrics.nodes)),
    row("rellenos", count(metrics.colors)),
    row("subpaths", count(metrics.subpaths)),
    row("tamaño", `${count(Math.round(metrics.bytes / 1024))} KB`),
    row("traza", `${count(state.ms)} ms`),
    row("lienzo", `${count(state.width)} × ${count(state.height)} px`),
  ].join("");
}

// --- vista y edición -------------------------------------------------------

/**
 * Pinta el SVG en línea (no como `<img src=blob>`): un `<img>` no expone sus paths al ratón, y sin
 * eso no hay forma de saber qué pieza se tocó. El SVG es nuestro —sale del wasm, no de la red—, así
 * que `innerHTML` no abre ninguna puerta.
 */
function renderPreview(svg) {
  // La declaración XML no es un nodo del DOM: en HTML se convierte en un comentario y volvería a
  // salir en la descarga. Se quita aquí y se repone al serializar.
  ui.vista.innerHTML = svg.replace(/^\s*<\?xml[^>]*\?>\s*/, "");

  const root = ui.vista.querySelector("svg");
  if (!root) throw new Error("el SVG no tiene elemento raíz");
  // El motor no emite `viewBox`: sin él el navegador no puede escalar el dibujo al panel, y un
  // trazado de 1400 px se sale de la caja. Con `viewBox` y CSS el SVG se ajusta solo.
  if (!root.getAttribute("viewBox")) {
    root.setAttribute("viewBox", `0 0 ${state.width} ${state.height}`);
  }

  if (ui.borde.checked) insertDieCut(root, clampBorder(ui.bordePx.value));
  // El borde blanco es una copia de la silueta: no entra en `state.shapes`, así que no se puede
  // seleccionar ni borrar por error.
  state.shapes = [...root.querySelectorAll("path")].filter((path) => !path.closest("[data-vk-diecut]"));
  state.selected = null;
  renderPaletteSelect();

  ui.vista.hidden = false;
  ui.vacio.hidden = true;
  renderSelection();
}

ui.vista.addEventListener("click", (event) => {
  if (!state.svg) return;
  const path = typeof event.target.closest === "function" ? event.target.closest("path") : null;
  const editable = path && !path.closest("[data-vk-diecut]");
  selectPath(editable && ui.vista.contains(path) ? path : null);
});

ui.rellenar.addEventListener("click", () => {
  if (!state.selected || !ui.relleno.value) return;
  pushHistory();
  state.selected.setAttribute("fill", ui.relleno.value);
  commitEdit();
});

ui.borrarPieza.addEventListener("click", () => {
  if (!state.selected) return;
  pushHistory();
  state.selected.remove();
  state.selected = null;
  commitEdit();
});

ui.borrarColor.addEventListener("click", () => {
  if (!state.selected) return;
  const fill = fillOf(state.selected);
  const same = state.shapes.filter((shape) => shape.isConnected && fillOf(shape) === fill);
  pushHistory();
  for (const shape of same) shape.remove();
  state.selected = null;
  commitEdit();
});

ui.deshacer.addEventListener("click", () => {
  const previous = state.history.pop();
  if (!previous) return;
  state.svg = previous;
  state.edited = state.history.length > 0;
  renderPreview(previous);
  renderMetrics(previous);
  updateStatus();
});

function selectPath(path) {
  if (state.selected === path) return;
  state.selected?.removeAttribute("data-vk-sel");
  state.selected = path ?? null;
  path?.setAttribute("data-vk-sel", "");
  if (path) ui.relleno.value = fillOf(path);
  renderSelection();
}

/**
 * El selector de relleno: los colores que hay ahora mismo en el dibujo, con cuántas piezas tiene
 * cada uno. Se rehace después de cada edición para que borrar un color también lo saque del
 * selector, y se conserva la elección si sigue existiendo.
 */
function renderPaletteSelect() {
  const counts = new Map();
  for (const shape of state.shapes) {
    if (!shape.isConnected) continue;
    const fill = fillOf(shape);
    counts.set(fill, (counts.get(fill) ?? 0) + 1);
  }

  const previous = ui.relleno.value;
  ui.relleno.innerHTML = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([fill, total]) => `<option value="${fill}">${fill} · ${total}</option>`)
    .join("");
  ui.relleno.disabled = counts.size === 0;
  if (counts.has(previous)) ui.relleno.value = previous;
  ui.rellenar.disabled = !state.selected || counts.size === 0;
}

/** Rótulo de la barra de edición: qué pieza está seleccionada y cuántas hermanas tiene. */
function renderSelection() {
  const path = state.selected;
  const alive = state.shapes.filter((shape) => shape.isConnected);
  if (!path) {
    ui.seleccion.textContent = !state.svg
      ? "sin piezas que editar"
      : alive.length > 0
        ? "clic en una pieza para seleccionarla"
        : "no quedan piezas: deshaz o vuelve a trazar";
    ui.borrarPieza.disabled = true;
    ui.borrarColor.disabled = true;
    ui.rellenar.disabled = true;
  } else {
    const fill = fillOf(path);
    const same = alive.filter((shape) => fillOf(shape) === fill).length;
    const index = alive.indexOf(path) + 1;
    ui.seleccion.textContent = `pieza ${index} de ${alive.length} · ${fill} · ${same} del mismo color`;
    ui.borrarPieza.disabled = false;
    ui.borrarColor.disabled = same < 2;
    ui.rellenar.disabled = ui.relleno.options.length === 0;
  }
  ui.deshacer.disabled = state.history.length === 0;
}

function pushHistory() {
  const current = serialize();
  if (!current) return;
  state.history.push(current);
  while (state.history.length > HISTORY_LIMIT) state.history.shift();

  let total = state.history.reduce((sum, item) => sum + item.length, 0);
  while (state.history.length > 1 && total > HISTORY_CHARS) {
    total -= state.history.shift().length;
  }
}

/** Cierra una edición: el SVG descargable es el que quedó en pantalla, y las métricas lo siguen. */
function commitEdit() {
  state.svg = serialize();
  state.edited = true;
  renderMetrics(state.svg);
  refreshDieCut();
  renderPaletteSelect();
  renderSelection();
  updateStatus();
}

/**
 * El SVG de la pantalla como texto descargable.
 *
 * Se clona para no arrastrar lo que solo existe para editar (`data-vk-sel`, que es el resaltado) y
 * se repone la declaración XML que `innerHTML` no puede representar.
 */
function serialize() {
  const root = ui.vista.querySelector("svg");
  if (!root) return state.svg;
  const clone = root.cloneNode(true);
  for (const marked of clone.querySelectorAll("[data-vk-sel]")) marked.removeAttribute("data-vk-sel");
  // El borde blanco se compone al descargar: no forma parte del dibujo editable ni del historial.
  for (const halo of clone.querySelectorAll("[data-vk-diecut]")) halo.remove();
  // Un grupo que se quedó sin piezas es un `fill` que ya no pinta nada, pero que las métricas
  // cuentan como relleno y que el usuario ve como un color fantasma en la lista.
  for (const group of clone.querySelectorAll("g")) {
    if (!group.querySelector("path, polygon, rect, circle, ellipse")) group.remove();
  }
  return `${DECLARATION}\n${clone.outerHTML}`;
}

/**
 * Color efectivo de una pieza.
 *
 * El trazador agrupa por color según el modo: `fidelidad`/`refit` ponen el `fill` en cada `path`,
 * pero `curvas` lo pone en un `<g fill="#…">` y deja los paths sin atributo. Leerlo del elemento a
 * secas haría que todas las piezas de un grupo parecieran negras y «Borrar color» se llevara el SVG
 * entero, así que se hereda hacia arriba, igual que hace `bench/lib/svg-shapes.mjs` al medir.
 */
function fillOf(element) {
  let node = element;
  while (node && typeof node.getAttribute === "function") {
    const fill = node.getAttribute("fill");
    if (fill) return fill.trim().toLowerCase();
    node = node.parentElement;
  }
  return "#000000";
}

function updateStatus() {
  if (!state.puesto) {
    ui.estado.textContent = "sin imagen";
    return;
  }
  const borde = ui.borde.checked ? ` · borde ${clampBorder(ui.bordePx.value)} px` : "";
  ui.estado.textContent = `${state.name} · ${state.puesto}${state.edited ? " · editado" : ""}${borde}`;
}

/**
 * El borde blanco de una pegatina: la silueta del dibujo, engordada y pintada de blanco por detrás.
 *
 * No hace falta geometría booleana (que en este repo vive en Clipper, y Clipper es de Node): se
 * clona cada pieza en un grupo blanco con un trazo centrado del doble del ancho pedido. La mitad
 * exterior del trazo es el borde; la mitad interior queda tapada por el dibujo, que se pinta encima.
 * El resultado es la unión de todas las piezas desplazada hacia fuera, con las esquinas redondeadas.
 */
function insertDieCut(root, widthPx) {
  const paths = [...root.querySelectorAll("path")].filter((path) => !path.closest("[data-vk-diecut]"));
  if (paths.length === 0) return;

  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("data-vk-diecut", "");
  group.setAttribute("fill", "#ffffff");
  group.setAttribute("stroke", "#ffffff");
  group.setAttribute("stroke-width", String(widthPx * 2));
  group.setAttribute("stroke-linejoin", "round");
  group.setAttribute("stroke-linecap", "round");

  for (const path of paths) {
    const copy = path.cloneNode(false);
    copy.removeAttribute("fill");
    copy.removeAttribute("stroke");
    copy.removeAttribute("data-vk-sel");
    group.appendChild(copy);
  }

  root.insertBefore(group, root.firstChild);
}

/** Vuelve a componer el borde sobre el SVG que está en pantalla (después de una edición). */
function refreshDieCut() {
  const root = ui.vista.querySelector("svg");
  if (!root) return;
  for (const old of root.querySelectorAll("[data-vk-diecut]")) old.remove();
  if (ui.borde.checked) insertDieCut(root, clampBorder(ui.bordePx.value));
}

/** El SVG descargable: el dibujo tal cual, con el borde blanco si está pedido. */
function withDieCut(svg) {
  if (!ui.borde.checked || !svg) return svg;

  const host = document.createElement("div");
  host.innerHTML = svg.replace(/^\s*<\?xml[^>]*\?>\s*/, "");
  const root = host.querySelector("svg");
  if (!root) return svg;

  insertDieCut(root, clampBorder(ui.bordePx.value));
  // El marcador es nuestro: en el archivo descargado sobra.
  for (const halo of root.querySelectorAll("[data-vk-diecut]")) halo.removeAttribute("data-vk-diecut");
  return `${DECLARATION}\n${root.outerHTML}`;
}

function clampBorder(value) {
  const width = Math.round(Number(value));
  return Number.isFinite(width) ? Math.min(200, Math.max(1, width)) : 8;
}

ui.svg.addEventListener("click", () => save(withDieCut(state.svg), `${state.name}.svg`));

ui.mm.addEventListener("click", () => {
  run(async () => {
    const millimeters = Number(ui.ancho.value);
    if (!(millimeters > 0)) throw new Error("el ancho en milímetros tiene que ser positivo");
    const target = withMillimeters(withDieCut(state.svg), millimeters);
    save(target, `${state.name}-${trim(millimeters)}mm.svg`);
  });
});

/**
 * El motor emite `width`/`height` en píxeles y ningún `viewBox`: con unidades físicas hay que
 * fijarlo, o el navegador interpretaría cada unidad del `d` como un milímetro y la pieza saldría
 * 3000 mm de ancha.
 *
 * El `viewBox` que la vista añade para escalar el SVG viaja en el texto editado, así que aquí se
 * quita antes de reponerlo: dos `viewBox` en la misma etiqueta es un archivo inválido.
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
    .replace(/\sviewBox="[^"]*"/, "")
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
