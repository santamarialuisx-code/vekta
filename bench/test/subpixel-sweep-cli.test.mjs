// Humo del CLI del barrido subpíxel: solo el contrato de la línea de órdenes.
//
// Igual que el del barrido binario: el barrido completo traza imágenes de 3,6 MP a 3× y tarda
// segundos, así que aquí no se barre nada. Se comprueba que `--help` explica el uso y que una opción
// desconocida se rechaza. `--simplify` es la perilla que añadió el experimento 14: si desaparece del
// analizador, el barrido vuelve a medir una sola combinación sin avisar.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../subpixel-sweep.mjs", import.meta.url));

// El CLI carga el motor al importarse; un límite holgado evita que un cuelgue deje la suite esperando
// para siempre sin acercarse a lo que costaría trazar una sola imagen.
const TIMEOUT_MS = 20_000;

/** Ejecuta el CLI en un directorio de trabajo aparte, para que no escriba en `bench/out/`. */
function runInScratch(args) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "vekta-subpixel-sweep-"));
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

test("subpixel-sweep.mjs --help imprime el uso y sale con código 0", () => {
  const result = runInScratch(["--help"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /uso:/);
  assert.match(result.stdout, /--simplify/);
  assert.equal(result.stderr, "");
});

test("subpixel-sweep.mjs rechaza una opción desconocida con código 1", () => {
  const result = runInScratch(["--no-existe"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /opción desconocida: --no-existe/);
});
