// Public lobby: one shared channel where the host of every public room advertises it.
// Anyone on the start screen sees the list and can join without being sent a code.
// Like room presence, everything here is self-reported display data from other players.
import { openLobby } from './room.js';

export const LOBBY_V = 1;

// What a host advertises. Kept tiny; the room channel itself carries the real state.
export function lobbyAd(world, acct, rm) {
  const players = rm.peers.filter((p) => p.presence && p.presence.v === 2).length || 1;
  return {
    lobby: LOBBY_V, code: rm.code, nick: String(rm.nick || '').slice(0, 16), n: players,
    clock: world.clock, startT: world.startT, ext: !!world.ext, cash: acct.startKrw, speed: rm.speed || 0, since: rm.createdAt || rm.joinedAt,
  };
}

// Peers -> list of open rooms, one per code (during a host hand-over two people may advertise the same room briefly).
export function lobbyRooms(peers) {
  const byCode = new Map();
  for (const p of peers) {
    const a = p.presence;
    if (p.isMe || !a || a.lobby !== LOBBY_V || typeof a.code !== 'string' || !/^[A-Z0-9]{6}$/.test(a.code)) continue;
    const prev = byCode.get(a.code);
    if (!prev || (p.updatedAt || 0) > prev.updatedAt) {
      byCode.set(a.code, {
        code: a.code, nick: String(a.nick || '익명').slice(0, 16), n: Math.max(1, Math.min(99, Number(a.n) || 1)),
        clock: Number(a.clock) || 0, startT: Number(a.startT) || 0, ext: !!a.ext, cash: Number(a.cash) || 0,
        speed: Number(a.speed) || 0, since: Number(a.since) || 0, updatedAt: p.updatedAt || 0,
      });
    }
  }
  return [...byCode.values()].sort((a, b) => b.n - a.n || b.since - a.since);
}

// Lazily opened lobby connection. watch() for the start screen, advertise()/withdraw() for hosts during play.
export function lobbyLink(onStatus) {
  let t = null, opening = false, closed = false, failed = false, watcher = null, unsub = null, pendingAd = null;
  const ensure = () => {
    if (t || opening || closed || failed) return;
    opening = true;
    openLobby().then((x) => {
      opening = false;
      if (closed) { if (x) x.leave(); return; }
      if (!x) { failed = true; if (onStatus) onStatus(false); return; }
      t = x; if (onStatus) onStatus(true);
      if (watcher) unsub = t.onPeers(watcher);
      if (pendingAd) { t.setPresence(pendingAd); pendingAd = null; }
    }, () => { opening = false; failed = true; if (onStatus) onStatus(false); });
  };
  const withdraw = () => { pendingAd = null; if (!t) return; if (unsub) unsub(); unsub = null; try { t.leave(); } catch (e) { /* gone */ } t = null; };
  return {
    watch(fn) { watcher = fn; ensure(); },
    advertise(ad) { if (t) t.setPresence(ad); else { pendingAd = ad; ensure(); } },
    withdraw,
    close() { closed = true; withdraw(); },
  };
}
