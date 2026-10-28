// Servidor estático mínimo para el banco de pruebas.
// Necesario para que el navegador pueda leer píxeles de canvas sin taint de CORS
// (file:// no permite getImageData sobre imágenes locales).

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
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
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const rel = urlPath === "/" ? "compare.html" : urlPath.slice(1);
  const full = path.join(here, rel);
  if (!full.startsWith(here)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404).end("not found: " + rel);
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(full).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(data);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`bench en http://127.0.0.1:${PORT}/`);
  console.log(`  comparación: http://127.0.0.1:${PORT}/compare.html`);
  console.log(`  métricas:    http://127.0.0.1:${PORT}/metrics.html`);
});
