// Statischer Entwicklungs-Server über die Repo-Wurzel (kein Paket nötig).
// Freier Port per listen(0), damit parallele Worktrees nicht auf einem festen Port kollidieren.
//   als Modul:  const s = await serve();  s.url  …  await s.close();
//   als CLI:    node tools/serve.mjs [port]      (ohne Angabe: freier Port)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
};

/** Startet den Server. port 0 = freier Port. Liefert { url, port, close }. */
export function serve({ root = ROOT, port = 0, host = 'localhost' } = {}) {
  const base = path.resolve(root);
  const server = http.createServer((req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
    let file = path.resolve(base, '.' + rel);
    // nichts außerhalb der Wurzel, keine versteckten Ordner (.git, .claude …)
    if ((file !== base && !file.startsWith(base + path.sep)) || path.relative(base, file).split(path.sep).some((s) => s.startsWith('.'))) {
      res.writeHead(404).end(); return;
    }
    try { if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html'); } catch { /* unten 404 */ }
    fs.readFile(file, (e, buf) => {
      if (e) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404'); return; }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : buf);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const p = server.address().port;
      resolve({
        port: p,
        url: `http://${host}:${p}/`,
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
      });
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const s = await serve({ port: Number(process.argv[2] ?? 0) });
  console.log(`serve: ${ROOT} → ${s.url}  (Strg+C beendet)`);
}
