// Cloudflare Workers entry: serves dist/ as static assets and runs the presence relay at /relay
// with one Durable Object per channel. Same wire protocol as server/relay.mjs, so the client needs no changes:
//   ws(s)://host/relay?ch=<channel>  ->  send {t:'p', patch}  <-  {t:'peers', you, peers:[{id, presence, age}]}
// Uses the WebSocket Hibernation API: an idle room costs nothing while sockets stay open.

const MAX_PRESENCE = 4096; // bytes per peer
const MAX_PEERS = 64;      // per channel
const MAX_MSG = 16 * 1024;
const CH_RE = /^[a-z0-9-]{1,48}$/;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/healthz') return new Response('ok');
    if (url.pathname === '/relay') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      const ch = url.searchParams.get('ch') || '';
      if (!CH_RE.test(ch)) return new Response('bad channel', { status: 400 });
      return env.RELAY.get(env.RELAY.idFromName(ch)).fetch(req);
    }
    return env.ASSETS.fetch(req); // only reached if run_worker_first matched; normally assets are served directly
  },
};

export class RelayChannel {
  constructor(ctx) { this.ctx = ctx; }

  async fetch() {
    if (this.ctx.getWebSockets().length >= MAX_PEERS) return new Response('room full', { status: 503 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: crypto.randomUUID(), presence: {}, at: Date.now() });
    this.broadcast();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, data) {
    if (typeof data !== 'string' || data.length > MAX_MSG) return;
    let msg; try { msg = JSON.parse(data); } catch { return; }
    if (!msg || msg.t !== 'p' || typeof msg.patch !== 'object' || msg.patch === null) return;
    const me = ws.deserializeAttachment(); if (!me) return;
    const next = { ...me.presence, ...msg.patch };
    for (const k of Object.keys(next)) if (next[k] === null) delete next[k];
    if (JSON.stringify(next).length > MAX_PRESENCE) return;
    ws.serializeAttachment({ ...me, presence: next, at: Date.now() });
    this.broadcast();
  }

  async webSocketClose(ws) { this.drop(ws); }
  async webSocketError(ws) { this.drop(ws); }

  drop(ws) {
    try { ws.serializeAttachment(null); ws.close(1000); } catch { /* already closed */ }
    this.broadcast(ws);
  }

  broadcast(skip) {
    const now = Date.now();
    const socks = this.ctx.getWebSockets().filter((s) => s !== skip && s.deserializeAttachment());
    const peers = socks.map((s) => { const p = s.deserializeAttachment(); return { id: p.id, presence: p.presence, age: now - p.at }; });
    for (const s of socks) {
      try { s.send(JSON.stringify({ t: 'peers', you: s.deserializeAttachment().id, peers })); } catch { /* closing */ }
    }
  }
}
