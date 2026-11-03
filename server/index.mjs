// Production server: serves the built game (dist/) and the multiplayer relay on one port.
//   npm run build && npm start        (PORT env var, default 8080)
// Any Node host works (Render, Railway, Fly.io, a VPS). No database, no accounts.
// The same file runs inside the single-file executable (npm run build:exe); then dist/ comes from embedded assets.
import http from 'node:http';
import os from 'node:os';
import { exec } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachRelay } from './relay.mjs';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };

// --- where files come from: embedded assets in the .exe, or dist/ on disk ---
const sea = (() => { try { const m = process.getBuiltinModule && process.getBuiltinModule('node:sea'); return m && m.isSea() ? m : null; } catch { return null; } })();
let files;
if (sea) {
  const list = JSON.parse(sea.getAsset('manifest.json', 'utf8'));
  const set = new Set(list);
  files = {
    async get(p) {
      if (p.endsWith('/')) p += 'index.html';
      if (!set.has(p)) p = '/index.html'; // single-page app fallback
      return { body: Buffer.from(sea.getAsset('dist' + p)), path: p };
    },
  };
} else {
  const root = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
  files = {
    async get(p) {
      let file = normalize(join(root, p));
      if (!file.startsWith(root)) return null;
      try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); }
      catch { file = join(root, 'index.html'); }
      return { body: await readFile(file), path: file };
    },
  };
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/healthz') { res.writeHead(200).end('ok'); return; }
  try {
    const f = await files.get(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!f) { res.writeHead(403).end(); return; }
    const hashed = f.path.includes('/assets/');
    res.writeHead(200, { 'content-type': TYPES[extname(f.path)] || 'application/octet-stream', 'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache' });
    res.end(f.body);
  } catch { res.writeHead(404).end('not found — run `npm run build` first'); }
});
attachRelay(server, '/relay');

// addresses friends on the same Wi-Fi / LAN can open
const lanUrls = (port) => Object.values(os.networkInterfaces()).flat()
  .filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => 'http://' + a.address + ':' + port);

const openBrowser = (url) => {
  const cmd = process.platform === 'win32' ? 'start "" "' + url + '"' : process.platform === 'darwin' ? 'open "' + url + '"' : 'xdg-open "' + url + '"';
  exec(cmd, () => {});
};

// try PORT (default 8080); if it's taken, the next few ports
const want = Number(process.env.PORT) || 8080;
const listen = (port, left) => {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && left > 0) listen(port + 1, left - 1);
    else { console.error('서버를 열 수 없어요:', e.message); if (sea) setTimeout(() => process.exit(1), 15000); else process.exit(1); }
  });
  server.listen(port, () => {
    const local = 'http://localhost:' + port;
    console.log('');
    console.log('  되감기 서버가 켜졌어요   ' + local + '   (실시간 중계 /relay)');
    const lan = lanUrls(port);
    if (lan.length) console.log('  같은 와이파이의 친구는:  ' + lan.join('  '));
    if (sea) {
      console.log('');
      console.log('  이 창을 닫으면 게임 서버가 꺼져요.');
      if (process.env.REWIND_NO_OPEN !== '1') openBrowser(local);
    }
  });
};
listen(want, sea ? 10 : 0);
