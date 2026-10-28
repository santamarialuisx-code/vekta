// Humo del CLI de fidelidad en color: el contrato de la línea de órdenes.
//
// El barrido completo traza tres imágenes con modo píxel (cientos de miles de nodos en foto), así que
// aquí no se barre nada: se comprueba que la ayuda nombra los dos modos y que una opción desconocida
// se rechaza. Si el analizador se rompe, el CI lo dice en milisegundos.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../color-fidelity.mjs", import.meta.url));
const TIMEOUT_MS = 20_000;

function runInScratch(args) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "vekta-color-fidelity-"));
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

test("color-fidelity.mjs --help imprime el uso y sale con código 0", () => {
  const result = runInScratch(["--help"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /uso:/);
  assert.match(result.stdout, /curvas,fidelidad/);
  assert.equal(result.stderr, "");
});

test("color-fidelity.mjs rechaza una opción desconocida con código 1", () => {
  const result = runInScratch(["--no-existe"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /opción desconocida: --no-existe/);
});
