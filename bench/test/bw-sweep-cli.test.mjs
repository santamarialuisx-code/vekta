// Humo del CLI del barrido binario: solo el contrato de la línea de órdenes.
//
// Existe para el CI. El barrido completo tarda minutos y traza imágenes, así que aquí no se barre
// nada: se comprueba que `--help` explica el uso y que una opción desconocida se rechaza. Si el
// analizador de argumentos se rompe, el CI lo dice en milisegundos en vez de esperar a que alguien
// descubra que `npm run bench:bw` ya no arranca.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../bw-sweep.mjs", import.meta.url));

// El CLI carga el motor nativo al importarse. Un límite holgado evita que un cuelgue deje la suite
// esperando para siempre, sin acercarse a lo que costaría trazar una sola imagen.
const TIMEOUT_MS = 20_000;

/**
 * Ejecuta el CLI en un directorio de trabajo aparte.
 *
 * El `cwd` se aparta a propósito: las rutas por defecto del barrido son relativas y apuntan a
 * `bench/out/`. Si una regresión hiciera que `--help` o un error de opción barrieran de verdad,
 * escribiría en el directorio temporal y la aserción de «no escribe nada» lo delata, en lugar de
 * ensuciar el árbol de trabajo o depender de ficheros que ya existen en él.
 */
function runInScratch(args) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "vekta-bw-sweep-"));
  try {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: scratch,
      encoding: "utf8",
      timeout: TIMEOUT_MS,
    });
    assert.equal(result.error, undefined, `no se pudo ejecutar la CLI: ${result.error?.message}`);
    assert.deepEqual(fs.readdirSync(scratch), [], "la CLI no debe escribir nada en este caso");
    return result;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

test("bw-sweep.mjs --help imprime el uso y sale con código 0", () => {
  const result = runInScratch(["--help"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /uso:/);
  // La ayuda no es un aviso: si escribiera por stderr, el CI la tomaría por un error.
  assert.equal(result.stderr, "");
});

test("bw-sweep.mjs rechaza una opción desconocida con código 1 y un mensaje claro", () => {
  const result = runInScratch(["--no-existe"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /opción desconocida: --no-existe/);
  // Fallar en silencio por stdout dejaría el diagnóstico invisible al ojo humano.
  assert.equal(result.stdout, "");
});
