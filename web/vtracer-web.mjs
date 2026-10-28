// Trazador en el navegador: vtracer (WebAssembly) sin bundler, sin `require` y sin copiar el glue.
//
// El paquete publica el glue de `wasm-pack --target nodejs` (`pkg/vtracer_wasm.js`). Ese fichero es
// universal —TextEncoder, TextDecoder, DataView, reflexión sobre objetos JS— salvo su arranque,
// donde lee el `.wasm` del disco con `require('fs')` y `__dirname`. Importarlo tal cual no arranca
// en el navegador: no hay `require`. Y reescribir aquí las 36 funciones `__wbg_*` del import object
// sería duplicar 250 líneas que el paquete mantiene por nosotros.
//
// Así que el cargador recorta el glue por la costura correcta:
//
//   1. descarga `pkg/vtracer_wasm.js` y descarta su arranque de Node (desde `const wasmPath =`);
//   2. evalúa lo demás como módulo propio (Blob + `import`) para quedarse con `__wbg_get_imports`,
//      que es exactamente el import object que el `.wasm` pide: un módulo, `./vtracer_wasm_bg.js`,
//      y 36 funciones;
//   3. descarga `pkg/vtracer_wasm_bg.wasm` e instancia con `WebAssembly.instantiate`, que es
//      asíncrono a propósito: `new WebAssembly.Module` en el hilo principal está limitado a 4 KB en
//      Chrome y el motor pesa 653 KB, así que el camino síncrono del glue de Node no sirve;
//   4. enlaza la instancia (`wasm = instance.exports`), llama a `__wbindgen_start()` y expone
//      `vectorizeRgba` / `vectorizeBytes` con las mismas firmas que `index.d.ts`.
//
// El paquete no se toca: se lee tal cual se instaló. Si el glue cambia de forma y ya no tiene la
// costura, el cargador falla con un mensaje explícito en vez de devolver un SVG a medias.

const GLUE_URL = new URL("../pkg/vtracer_wasm.js", import.meta.url);
const WASM_URL = new URL("../pkg/vtracer_wasm_bg.wasm", import.meta.url);

/** Primera sentencia del glue que ya es Node: `const wasmPath = \`${__dirname}/…\``. */
const NODE_TAIL = "const wasmPath =";

let pending = null;

/**
 * Carga e instancia el motor una sola vez.
 *
 * @returns {Promise<{
 *   vectorizeRgba: (rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, options?: object) => string,
 *   vectorizeBytes: (data: Uint8Array, options?: object) => string,
 * }>}
 */
export function loadVtracer() {
  pending ??= boot();
  return pending;
}

async function boot() {
  const [glue, bytes] = await Promise.all([loadGlue(), download(WASM_URL)]);
  const { instance } = await WebAssembly.instantiate(bytes, glue.imports());
  glue.link(instance.exports);
  instance.exports.__wbindgen_start();

  return {
    vectorizeRgba: (rgba, width, height, options = {}) => glue.call("vectorize_rgba", [rgba, width, height, options]),
    vectorizeBytes: (data, options = {}) => glue.call("vectorize_bytes", [data, options]),
  };
}

/** Descarga el glue, le quita el arranque de Node y lo evalúa como módulo. */
async function loadGlue() {
  const response = await fetch(GLUE_URL);
  if (!response.ok) {
    throw new Error(`no pude descargar el glue del trazador (${response.status}): ${GLUE_URL}`);
  }
  const source = await response.text();

  const seam = source.indexOf(NODE_TAIL);
  if (seam < 0) {
    throw new Error(`el glue del trazador cambió: no encuentro «${NODE_TAIL}» en ${GLUE_URL}`);
  }

  // El glue escribe en `exports` porque es CommonJS: aquí `exports` es un objeto local que
  // devolvemos envuelto en funciones. `wasm` nace vacío porque el import object se construye antes
  // de instanciar y solo lee la instancia cuando el motor lo llama, ya enlazada.
  const wrapper = [
    "const exports = {};",
    "let wasm;",
    source.slice(0, seam),
    "export const imports = () => __wbg_get_imports();",
    "export const link = (instanceExports) => { wasm = instanceExports; };",
    "export const call = (name, args) => exports[name](...args);",
  ].join("\n");

  const url = URL.createObjectURL(new Blob([wrapper], { type: "text/javascript" }));
  try {
    return await import(url);
  } catch (error) {
    throw new Error(`no pude evaluar el glue del trazador: ${error.message}`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Bytes del `.wasm`, con un error que dice qué URL falló (y no un `CompileError` sin contexto). */
async function download(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`no pude descargar el motor (${response.status}): ${url}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}
