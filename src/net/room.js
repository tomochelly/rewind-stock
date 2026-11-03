// Real-time room transport with one small interface and three backends:
//  - "artifact": the claude.ai artifact runtime's `room` capability (when the game runs as a shared Claude artifact)
//  - "supabase": Supabase Realtime presence (for your own deployment; set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY)
//  - "relay": our own WebSocket relay (server/relay.mjs). Runs inside `npm run dev` / `npm start`; elsewhere set VITE_RELAY_URL
// Interface: { kind, setPresence(patch), onPeers(fn) -> unsubscribe, peers(), connected(), leave() }
// A peer is { id, isMe, presence, updatedAt }. Presence is merged per field and limited to ~4 KB.

const roomName = (code) => 'rw-' + String(code).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);

async function artifactRoom(name) {
  const cl = typeof window !== 'undefined' ? window.claude : null;
  if (!cl || typeof cl.use !== 'function') return null;
  const lobby = await cl.use('room');
  if (!lobby) return null;
  const r = await lobby.join(name);
  const norm = (p) => ({ id: p.peer, isMe: p.isMe && p.sameTab, presence: p.presence || {}, updatedAt: p.updatedAt });
  return {
    kind: 'artifact',
    setPresence: (patch) => r.presence(patch).catch(() => {}),
    onPeers: (fn) => r.onPeers((ch) => fn(ch.peers.map(norm)), () => fn([])),
    peers: () => r.peers().map(norm),
    connected: () => r.connected(),
    leave: () => r.leave(),
  };
}

async function supabaseRoom(name) {
  const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
  const url = env.VITE_SUPABASE_URL, key = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(url, key);
  const myId = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2);
  const ch = sb.channel(name, { config: { presence: { key: myId } } });
  const listeners = new Set();
  let current = {}, isConnected = false;
  const list = () => Object.entries(ch.presenceState()).map(([id, metas]) => ({ id, isMe: id === myId, presence: metas[metas.length - 1] || {}, updatedAt: Date.now() }));
  ch.on('presence', { event: 'sync' }, () => { const l = list(); listeners.forEach((f) => f(l)); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 10000);
    ch.subscribe((status) => { if (status === 'SUBSCRIBED') { isConnected = true; clearTimeout(timer); resolve(); } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') isConnected = false; });
  });
  return {
    kind: 'supabase',
    setPresence: (patch) => { current = { ...current, ...patch }; for (const k of Object.keys(current)) if (current[k] === null) delete current[k]; return ch.track(current).catch(() => {}); },
    onPeers: (fn) => { listeners.add(fn); fn(list()); return () => listeners.delete(fn); },
    peers: list,
    connected: () => isConnected,
    leave: () => ch.unsubscribe(),
  };
}

function relayUrl() {
  const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
  if (env.VITE_RELAY_URL) return env.VITE_RELAY_URL;
  if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return null;
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/relay'; // same server that served the page
}

// WebSocket relay. Reconnects on its own and re-sends my presence; peers' `age` (ms since their last update,
// measured on the server) becomes a local updatedAt so clock catch-up is immune to device clock skew.
async function relayRoom(name) {
  const base = relayUrl(); if (!base) return null;
  const url = base + (base.includes('?') ? '&' : '?') + 'ch=' + encodeURIComponent(name);
  const listeners = new Set();
  let ws = null, current = {}, peers = [], isConnected = false, closed = false, retry = 0, timer = null;
  const emit = () => listeners.forEach((f) => f(peers));
  const connect = () => new Promise((resolve, reject) => {
    const sock = new WebSocket(url);
    ws = sock;
    sock.onopen = () => { isConnected = true; retry = 0; if (Object.keys(current).length) sock.send(JSON.stringify({ t: 'p', patch: current })); resolve(); };
    sock.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t !== 'peers') return;
      const now = Date.now();
      peers = m.peers.map((p) => ({ id: p.id, isMe: p.id === m.you, presence: p.presence || {}, updatedAt: now - (p.age || 0) }));
      emit();
    };
    sock.onerror = () => reject(new Error('relay unavailable'));
    sock.onclose = () => {
      isConnected = false;
      if (closed || ws !== sock) return;
      peers = peers.filter((p) => p.isMe); emit();
      clearTimeout(timer);
      timer = setTimeout(() => connect().catch(() => {}), Math.min(10000, 500 * 2 ** retry++));
    };
  });
  try { await Promise.race([connect(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]); }
  catch (e) { closed = true; clearTimeout(timer); try { ws && ws.close(); } catch (e2) { /* never opened */ } throw e; } // no relay here: don't keep retrying
  return {
    kind: 'relay',
    setPresence: (patch) => {
      current = { ...current, ...patch };
      for (const k of Object.keys(current)) if (current[k] === null) delete current[k];
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'p', patch }));
      return Promise.resolve();
    },
    onPeers: (fn) => { listeners.add(fn); fn(peers); return () => listeners.delete(fn); },
    peers: () => peers,
    connected: () => isConnected,
    leave: () => { closed = true; clearTimeout(timer); try { ws && ws.close(); } catch (e) { /* already closed */ } },
  };
}

async function openChannel(name) {
  try { const a = await artifactRoom(name); if (a) return a; } catch (e) { /* not running as an artifact */ }
  try { const s = await supabaseRoom(name); if (s) return s; } catch (e) { /* not configured */ }
  try { const r = await relayRoom(name); if (r) return r; } catch (e) { /* no relay on this host */ }
  return null;
}

export const openRoom = (code) => openChannel(roomName(code));
// Everyone on the start screen listens here; hosts of public rooms advertise their room in their presence.
export const openLobby = () => openChannel('rw-lobby');

export const newRoomCode = () => Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
