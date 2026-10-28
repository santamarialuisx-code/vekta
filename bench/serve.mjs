// Servidor estático mínimo para el banco de pruebas.
// Necesario para que el navegador pueda leer píxeles de canvas sin taint de CORS
// (file:// no permite getImageData sobre imágenes locales).
//
// Reparte cuatro rutas y nada más:
//   /            → `bench/` (las páginas de medición)
//   /web/        → `web/` (la página de trazado)
//   /bench/      → `bench/` otra vez, para que los imports relativos del código fuente
//                  (`web/app.mjs` → `../bench/lib/lineart.mjs`) valgan tal cual se leen en el repo
//   /pkg/        → `node_modules/@visioncortex/vtracer/pkg/` (el glue y el `.wasm` que carga
//                  `web/vtracer-web.mjs`; el glue del paquete es de Node y no se puede importar
//                  desde `/web/`, pero el cargador lo descarga desde aquí y le quita el arranque
//                  de Node)

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const PORT = Number(process.env.PORT || 8787);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
};

// Prefijos servidos fuera de `bench/`. El orden importa: gana el primero que encaje.
const MOUNTS = [
  { prefix: "/web/", root: path.join(repo, "web") },
  { prefix: "/bench/", root: here },
  { prefix: "/pkg/", root: path.join(repo, "node_modules", "@visioncortex", "vtracer", "pkg") },
];

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const target = resolve(urlPath);
  if (!target) {
    res.writeHead(403).end("forbidden");
    return;
  }
  fs.readFile(target, (err, data) => {
    if (err) {
      res.writeHead(404).end("not found: " + urlPath);
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(target).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(data);
  });
});

/**
 * Ruta del fichero que corresponde a una URL, o `null` si se sale de su raíz.
 *
 * El `path.relative` es lo que hace la comprobación de verdad: un `startsWith` sobre la cadena deja
 * pasar `bench-otro/` porque también empieza por `bench`.
 */
function resolve(urlPath) {
  const mount = MOUNTS.find((entry) => urlPath.startsWith(entry.prefix));
  if (mount) {
    const full = path.join(mount.root, urlPath.slice(mount.prefix.length) || "index.html");
    return within(mount.root, full) ? full : null;
  }
  const rel = urlPath === "/" ? "compare.html" : urlPath.slice(1);
  return within(here, path.join(here, rel)) ? path.join(here, rel) : null;
}

function within(root, full) {
  const rel = path.relative(root, full);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`bench en http://127.0.0.1:${PORT}/`);
  console.log(`  trazador:    http://127.0.0.1:${PORT}/web/index.html`);
  console.log(`  comparación: http://127.0.0.1:${PORT}/compare.html`);
  console.log(`  métricas:    http://127.0.0.1:${PORT}/metrics.html`);
});
