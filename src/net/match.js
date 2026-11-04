// Room rules on top of the transport: who is host, what each player shares, where guests' clocks should be.
// Everything a peer sends is untrusted display data (friends' rooms, not a ranked ladder).
import { valuation } from '../engine/account.js';

export const PRESENCE_V = 2;

// The host drives the clock. If several claim it, the earliest joiner wins; if none does, the earliest joiner takes over.
export function hostOf(peers) {
  const valid = peers.filter((p) => p.presence && p.presence.v === PRESENCE_V && p.presence.seed);
  if (!valid.length) return null;
  const byJoin = (a, b) => (a.presence.joinedAt || 0) - (b.presence.joinedAt || 0) || (a.id < b.id ? -1 : 1);
  const hosts = valid.filter((p) => p.presence.role === 'host').sort(byJoin);
  return hosts[0] || valid.sort(byJoin)[0];
}

export function myPresence(world, acct, info, speed) {
  const v = valuation(acct, world);
  const top = v.rows.sort((a, b) => b.value * (b.inst.mk === 'us' ? v.fx : 1) - a.value * (a.inst.mk === 'us' ? v.fx : 1)).slice(0, 3).map((r) => [r.inst.name.slice(0, 16), r.q]);
  const trades = acct.trades.slice(-3).map((t) => [t.t, t.side === 'buy' ? 'b' : 's', (world.instrument(t.id)?.name || '').slice(0, 16), t.qty]);
  return {
    v: PRESENCE_V, nick: info.nick.slice(0, 16), role: info.role, joinedAt: info.joinedAt, pub: info.pub !== false,
    seed: world.seed, ext: world.ext, mode: world.mode, startT: world.startT, cash: acct.startKrw,
    clock: world.clock, speed, total: Math.round(v.totalKrw), ret: Math.round(v.ret * 10000) / 10000, top, trades,
  };
}

// Where a guest's clock should be now: the host's last clock plus the time it has been running since.
// Extrapolate at most about one update interval: guests can't rewind, so overshooting a host who just paused is permanent.
export function targetClock(host) {
  const p = host.presence;
  const elapsed = Math.max(0, (Date.now() - (host.updatedAt || Date.now())) / 1000);
  return p.clock + Math.min(elapsed, 0.5) * (p.speed || 0);
}
