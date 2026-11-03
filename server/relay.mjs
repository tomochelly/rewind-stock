// Tiny presence relay: the same contract as Supabase Realtime presence, nothing else.
// A client opens  ws(s)://host/relay?ch=<channel>  and sends {t:'p', patch}. Everyone on that channel
// receives {t:'peers', you, peers:[{id, presence, age}]} whenever anything changes. Leaving = closing the socket.
// No accounts, no storage: when the last person leaves a channel it is gone.
import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';

const MAX_PRESENCE = 4096;        // bytes per peer, same limit the client assumes
const MAX_PEERS = 64;             // per channel
const MAX_CHANNELS = 2000;
const CH_RE = /^[a-z0-9-]{1,48}$/;

export function attachRelay(httpServer, path = '/relay') {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const channels = new Map(); // name -> Map(id -> { ws, presence, at })

  const broadcast = (name) => {
    const ch = channels.get(name); if (!ch) return;
    const now = Date.now();
    const peers = [...ch.entries()].map(([id, p]) => ({ id, presence: p.presence, age: now - p.at }));
    for (const [id, p] of ch) if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'peers', you: id, peers }));
  };

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== path) return; // leave other upgrades (e.g. Vite HMR) alone
    const name = url.searchParams.get('ch') || '';
    const ch = channels.get(name);
    if (!CH_RE.test(name) || (!ch && channels.size >= MAX_CHANNELS) || (ch && ch.size >= MAX_PEERS)) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => join(ws, name));
  });

  function join(ws, name) {
    if (!channels.has(name)) channels.set(name, new Map());
    const ch = channels.get(name), id = randomUUID();
    ch.set(id, { ws, presence: {}, at: Date.now() });
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (buf) => {
      let msg; try { msg = JSON.parse(buf); } catch { return; }
      if (!msg || msg.t !== 'p' || typeof msg.patch !== 'object' || msg.patch === null) return;
      const me = ch.get(id); if (!me) return;
      const next = { ...me.presence, ...msg.patch };
      for (const k of Object.keys(next)) if (next[k] === null) delete next[k];
      if (JSON.stringify(next).length > MAX_PRESENCE) return;
      me.presence = next; me.at = Date.now();
      broadcast(name);
    });
    ws.on('close', () => { ch.delete(id); if (!ch.size) channels.delete(name); else broadcast(name); });
    broadcast(name);
  }

  // drop sockets that vanished without a close (phone sleep, network loss) so stale hosts disappear
  const hb = setInterval(() => {
    for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); }
  }, 10000);
  httpServer.on('close', () => clearInterval(hb));
  return wss;
}
