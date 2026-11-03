// Brokerage account: KRW and USD cash, positions, market and limit orders, watchlist.
import { krSellTax } from './calendar.js';
import { roundPx } from './world.js';

export const FEES = { kr: 0.00015, us: 0.001 }; // commission per side (approx.)
export const FX_SPREAD = 0.002;                 // currency exchange spread (approx.)
const SPREAD = { reg: 0.0005, ext: 0.003 };

export function newAccount(krw) {
  return { krw, usd: 0, pos: {}, trades: [], eq: [], startKrw: krw, watch: [], orders: [], holdKrw: 0, holdUsd: 0, nextOid: 1, fills: [] };
}
export function normalizeAccount(a) { // older saves
  const d = newAccount(a.startKrw || a.krw || 0);
  for (const k of Object.keys(d)) if (a[k] === undefined) a[k] = d[k];
  for (const p of Object.values(a.pos)) if (p.locked === undefined) p.locked = 0;
  return a;
}
export const availKrw = (a) => Math.max(0, a.krw - (a.holdKrw || 0));
export const availUsd = (a) => Math.max(0, a.usd - (a.holdUsd || 0));
const freeShares = (a, id) => (a.pos[id] ? a.pos[id].q - (a.pos[id].locked || 0) : 0);

export function toggleWatch(a, id) {
  const i = a.watch.indexOf(id);
  if (i >= 0) a.watch.splice(i, 1); else a.watch.push(id);
}

export function fillPrice(world, id, side) {
  const inst = world.instrument(id), q = world.quote(id);
  if (q.price == null || !q.sess) return null;
  const ipoDay = inst.ipoT && Math.floor(world.clock / 86400) * 86400 - inst.ipoT < 86400 * 1.5;
  const sp = ipoDay ? 0.005 : q.sess.ext ? SPREAD.ext : SPREAD.reg;
  return roundPx(inst.mk, q.price * (side === 'buy' ? 1 + sp / 2 : 1 - sp / 2), side === 'buy' ? 'up' : 'down', inst.etf);
}
const taxFor = (inst, side, world) => (side === 'sell' && inst.mk === 'kr' && !inst.etf ? krSellTax(world.clock) : 0);

// Estimate a market order without executing it. pct is of buying power (buy) or of free shares (sell).
export function quoteOrder(acct, world, id, side, qtyOrPct, byPct) {
  const inst = world.instrument(id), mk = inst.mk, fx = world.fx();
  if (world.isHalted && world.isHalted(id)) return { ok: false, reason: '거래정지 중이라 주문할 수 없어요.' };
  const px = fillPrice(world, id, side);
  if (px == null) return { ok: false, reason: '지금은 이 종목이 거래되지 않는 시간이에요.' };
  return sizeOrder(acct, world, inst, side, px, qtyOrPct, byPct, fx);
}
function sizeOrder(acct, world, inst, side, px, qtyOrPct, byPct, fx) {
  const mk = inst.mk, fee = FEES[mk], tax = taxFor(inst, side, world);
  if (side === 'buy') {
    // US buys can use KRW: the shortfall is converted automatically.
    const power = mk === 'kr' ? availKrw(acct) : availUsd(acct) + availKrw(acct) / (fx * (1 + FX_SPREAD));
    const qty = byPct ? Math.floor((power * qtyOrPct) / (px * (1 + fee))) : Math.floor(qtyOrPct);
    const cost = qty * px * (1 + fee);
    if (cost > power + 1e-6) return { ok: false, reason: '주문 가능 금액이 부족해요.', px, qty };
    const convertKrw = mk === 'us' && cost > availUsd(acct) ? (cost - availUsd(acct)) * fx * (1 + FX_SPREAD) : 0;
    return { ok: qty > 0, reason: qty > 0 ? null : '살 수 있는 수량이 없어요.', px, qty, gross: qty * px, fees: qty * px * fee, tax: 0, total: cost, convertKrw };
  }
  const free = freeShares(acct, inst.id);
  const qty = byPct ? (qtyOrPct >= 1 ? free : Math.floor(free * qtyOrPct)) : Math.min(free, Math.floor(qtyOrPct));
  const gross = qty * px;
  return { ok: qty > 0, reason: qty > 0 ? null : '팔 수 있는 수량이 없어요.', px, qty, gross, fees: gross * fee, tax: gross * tax, total: gross * (1 - fee - tax) };
}

function convertToUsd(acct, world, usdNeeded) {
  if (usdNeeded <= 0) return 0;
  const krw = usdNeeded * world.fx() * (1 + FX_SPREAD);
  acct.krw -= krw; acct.usd += usdNeeded;
  return krw;
}
function settle(acct, world, inst, side, qty, px, fromHold) {
  const mk = inst.mk, fee = FEES[mk], tax = taxFor(inst, side, world);
  const p = acct.pos[inst.id] || (acct.pos[inst.id] = { q: 0, cost: 0, locked: 0 });
  let total, realized = null;
  if (side === 'buy') {
    total = qty * px * (1 + fee);
    if (mk === 'kr') acct.krw -= total; else acct.usd -= total;
    p.q += qty; p.cost += total;
  } else {
    total = qty * px * (1 - fee - tax);
    const avg = p.cost / p.q;
    p.cost -= avg * qty; p.q -= qty; if (fromHold) p.locked -= qty;
    if (mk === 'kr') acct.krw += total; else acct.usd += total;
    realized = total - avg * qty;
    if (p.q <= 0) delete acct.pos[inst.id];
  }
  acct.krw = Math.max(0, acct.krw); acct.usd = Math.max(0, acct.usd);
  const tr = { t: world.clock, id: inst.id, side, qty, px, total, realized, sess: world.quote(inst.id).sess?.id || null, limit: !!fromHold };
  acct.trades.push(tr); if (acct.trades.length > 500) acct.trades.shift();
  return tr;
}

export function execute(acct, world, id, side, qtyOrPct, byPct) {
  const q = quoteOrder(acct, world, id, side, qtyOrPct, byPct);
  if (!q.ok) return q;
  const inst = world.instrument(id);
  if (side === 'buy' && inst.mk === 'us') convertToUsd(acct, world, q.total - availUsd(acct));
  return { ...q, trade: settle(acct, world, inst, side, q.qty, q.px, false) };
}

/* ---------- limit orders (day orders: valid until the end of that market's trading day) ---------- */
export function limitBand(world, id) { // KR: ±30% of previous close (ETFs scale with leverage). US: none.
  const inst = world.instrument(id), prev = world.quote(id).prev;
  if (inst.mk !== 'kr' || !prev) return null;
  const lim = inst.etf ? 0.3 * Math.abs(inst.k) : 0.3;
  return { lo: roundPx('kr', prev * (1 - lim), 'up', inst.etf), hi: roundPx('kr', prev * (1 + lim), 'down', inst.etf) };
}
export function tickOf(world, id, px) {
  const inst = world.instrument(id);
  if (inst.mk === 'us') return 0.01;
  if (inst.etf) return 5;
  return px < 2000 ? 1 : px < 5000 ? 5 : px < 20000 ? 10 : px < 50000 ? 50 : px < 200000 ? 100 : px < 500000 ? 500 : 1000;
}
export function quoteLimit(acct, world, id, side, limitPx, qtyOrPct, byPct) {
  const inst = world.instrument(id), fx = world.fx();
  if (!(limitPx > 0)) return { ok: false, reason: '주문 가격을 입력해 주세요.' };
  const px = roundPx(inst.mk, limitPx, side === 'buy' ? 'down' : 'up', inst.etf);
  const band = limitBand(world, id);
  if (band && (px < band.lo || px > band.hi)) return { ok: false, reason: '가격제한폭(전일 종가 ±' + (inst.etf ? 30 * Math.abs(inst.k) : 30) + '%) 밖의 가격이에요.', px };
  return sizeOrder(acct, world, inst, side, px, qtyOrPct, byPct, fx);
}
export function placeLimit(acct, world, id, side, limitPx, qtyOrPct, byPct) {
  const q = quoteLimit(acct, world, id, side, limitPx, qtyOrPct, byPct);
  if (!q.ok) return q;
  const inst = world.instrument(id);
  let hold = 0;
  if (side === 'buy') {
    if (inst.mk === 'kr') { hold = q.total; acct.holdKrw += hold; }
    else { convertToUsd(acct, world, q.total - availUsd(acct)); hold = q.total; acct.holdUsd += hold; }
  } else {
    acct.pos[id].locked = (acct.pos[id].locked || 0) + q.qty;
  }
  const o = { oid: acct.nextOid++, id, side, qty: q.qty, px: q.px, t: world.clock, exp: world.tradingDayEnd(inst.mk), hold };
  acct.orders.push(o);
  return { ...q, order: o };
}
function release(acct, o) {
  const inst = o.mk;
  if (o.side === 'buy') { if (o.usd) acct.holdUsd = Math.max(0, acct.holdUsd - o.hold); else acct.holdKrw = Math.max(0, acct.holdKrw - o.hold); }
  else if (acct.pos[o.id]) acct.pos[o.id].locked = Math.max(0, (acct.pos[o.id].locked || 0) - o.qty);
  return inst;
}
export function cancelOrder(acct, world, oid) {
  const i = acct.orders.findIndex((o) => o.oid === oid);
  if (i < 0) return false;
  const o = acct.orders[i];
  release(acct, { ...o, usd: world.instrument(o.id).mk === 'us' });
  acct.orders.splice(i, 1);
  return true;
}
// Fill any limit order whose price was touched between t0 and t1. Returns fill/expiry events.
export function processOrders(acct, world, t0, t1) {
  const out = [];
  for (const o of [...acct.orders]) {
    const inst = world.instrument(o.id), usdSide = inst.mk === 'us';
    const r = world.isHalted && world.isHalted(o.id) ? null : world.priceRange(o.id, t0, Math.min(t1, o.exp));
    let fillPx = null;
    if (r) {
      if (o.side === 'buy' && r.min <= o.px) fillPx = r.first <= o.px ? r.first : o.px;
      if (o.side === 'sell' && r.max >= o.px) fillPx = r.first >= o.px ? r.first : o.px;
    }
    if (fillPx != null) {
      release(acct, { ...o, usd: usdSide });
      const tr = settle(acct, world, inst, o.side, o.qty, fillPx, o.side === 'sell' ? false : false);
      tr.limit = true;
      acct.orders.splice(acct.orders.indexOf(o), 1);
      out.push({ kind: 'fill', o, trade: tr });
    } else if (t1 >= o.exp) {
      release(acct, { ...o, usd: usdSide });
      acct.orders.splice(acct.orders.indexOf(o), 1);
      out.push({ kind: 'expire', o });
    }
  }
  if (out.length) { acct.fills.push(...out.map((e) => ({ kind: e.kind, id: e.o.id, side: e.o.side, qty: e.o.qty, px: e.trade ? e.trade.px : e.o.px, t: world.clock }))); if (acct.fills.length > 100) acct.fills.splice(0, acct.fills.length - 100); }
  return out;
}

export function exchange(acct, world, dir, amount) { // dir: 'toUsd' (amount in KRW) | 'toKrw' (amount in USD)
  const fx = world.fx();
  if (dir === 'toUsd') { const a = Math.min(amount, availKrw(acct)); acct.krw -= a; acct.usd += a / (fx * (1 + FX_SPREAD)); return a; }
  const a = Math.min(amount, availUsd(acct)); acct.usd -= a; acct.krw += a * fx * (1 - FX_SPREAD); return a;
}

export function valuation(acct, world) {
  const fx = world.fx();
  let krStock = 0, usStock = 0;
  const rows = [];
  for (const [id, p] of Object.entries(acct.pos)) {
    const inst = world.instrument(id); if (!inst) continue;
    const price = world.priceOf(id) ?? p.cost / p.q;
    const value = price * p.q;
    if (inst.mk === 'kr') krStock += value; else usStock += value;
    rows.push({ id, inst, q: p.q, locked: p.locked || 0, avg: p.cost / p.q, price, value, pnl: value - p.cost, ret: value / p.cost - 1 });
  }
  const totalKrw = acct.krw + krStock + (acct.usd + usStock) * fx;
  return { fx, krStock, usStock, totalKrw, ret: totalKrw / acct.startKrw - 1, rows };
}

// 상장폐지: after the last 정리매매 day the shares are gone (worth nothing). Open orders on it are cancelled.
export function sweepDelisted(acct, world) {
  const out = [];
  for (const o of [...acct.orders]) if (world.isDelisted(o.id)) { release(acct, { ...o, usd: world.instrument(o.id).mk === 'us' }); acct.orders.splice(acct.orders.indexOf(o), 1); }
  for (const [id, p] of Object.entries(acct.pos)) {
    if (!world.isDelisted(id)) continue;
    out.push({ id, q: p.q, cost: p.cost });
    delete acct.pos[id];
    acct.fills.push({ kind: 'delist', id, side: 'sell', qty: p.q, px: 0, t: world.clock });
  }
  if (acct.fills.length > 100) acct.fills.splice(0, acct.fills.length - 100);
  const wi = acct.watch.filter((id) => world.isDelisted(id)); for (const id of wi) acct.watch.splice(acct.watch.indexOf(id), 1);
  return out;
}
