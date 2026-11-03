// The World: generates the market one trading day at a time, lazily, as the clock moves.
// Same seed → same history. Only the state at the start of the current day needs saving;
// the day itself is regenerated deterministically on load.
import { DAY, T0, kst, dateOf, isTradingDay, nextTradingDay, prevTradingDay, sessionsFor, usDST } from './calendar.js';
import { rngFor, gauss, pick } from './rng.js';
import { ANCHORS, BASE_VOL, VOL_WINDOWS, KEYS, FACTORS, NEWS_LIST, COMP_EVENTS, BACKDROP_END, AMP } from './backdrop.js';
import { ROSTER, ETFS, futureIpos } from './companies.js';
import { regimeFor, futureEvent, futureEffect, RUMORS, BROKERS } from './future.js';
import { BROAD_ANCHORS, BROAD_VOL, BROAD_FROM_SEMI, BROAD_KEYS, THEMES } from './themes.js';

const PPM = 6; // one price point every 10 seconds
const PEERS = ['인비디아', '매크로디바이스', 'TMI세미', '와이드컴', '나노크론', '로우닉스'];
export const MARKETS = {
  kr: { id: 'kr', name: '국내', cur: 'KRW', limit: 0.3, idxName: '코스비 반도체', bidxName: '코스비', volBase: 1.6e6 },
  us: { id: 'us', name: '해외', cur: 'USD', limit: null, idxName: '필라테스 반도체', bidxName: '나스닭', volBase: 3.5e7 },
};
export const IDX = { kr: 'idx_kr', us: 'idx_us' };
export const BIDX = { kr: 'bidx_kr', us: 'bidx_us' };

function krTick(p) { return p < 2000 ? 1 : p < 5000 ? 5 : p < 20000 ? 10 : p < 50000 ? 50 : p < 200000 ? 100 : p < 500000 ? 500 : 1000; }
export function roundPx(mk, p, mode, etf) {
  if (mk === 'kr') { const t = etf ? 5 : krTick(p); const v = mode === 'up' ? Math.ceil(p / t) * t : mode === 'down' ? Math.floor(p / t) * t : Math.round(p / t) * t; return Math.max(t, v); }
  const c = mode === 'up' ? Math.ceil(p * 100 - 1e-9) : mode === 'down' ? Math.floor(p * 100 + 1e-9) : Math.round(p * 100);
  return Math.max(0.01, c / 100);
}

function interpAnchors(arr, t) {
  if (t <= arr[0][0]) return arr[0][1];
  for (let i = 1; i < arr.length; i++) if (t <= arr[i][0]) { const f = (t - arr[i - 1][0]) / (arr[i][0] - arr[i - 1][0]); return Math.exp(Math.log(arr[i - 1][1]) + (Math.log(arr[i][1]) - Math.log(arr[i - 1][1])) * f); }
  return arr[arr.length - 1][1];
}
const ANCH = Object.fromEntries(Object.entries(ANCHORS).map(([k, v]) => [k, v.map(([d, l]) => [T0(d), l])]));
const BANCH = Object.fromEntries(Object.entries(BROAD_ANCHORS).map(([k, v]) => [k, v.map(([d, l]) => [T0(d), l])]));

function bridge(rng, n, x0, x1, sig) {
  const w = new Float64Array(n + 1), cv = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) { const s = sig(i); w[i] = w[i - 1] + s * gauss(rng); cv[i] = cv[i - 1] + s * s; }
  const out = new Float64Array(n + 1), tot = cv[n] || 1;
  for (let i = 0; i <= n; i++) { const f = cv[i] / tot; out[i] = x0 + (x1 - x0) * f + (w[i] - f * w[n]); }
  out[0] = x0; out[n] = x1;
  return out;
}
function sampleT(r) { const u = r(); return u < 0.45 ? r() * 0.2 : u < 0.75 ? 0.8 + r() * 0.2 : 0.2 + r() * 0.6; }
function regularPath(rng, n, D) { // log prices hitting O, H, L, C
  const lnO = Math.log(D.O), lnH = Math.log(D.H), lnL = Math.log(D.L), lnC = Math.log(D.C), sp = D.spec;
  const at = (f) => Math.round(f * (n - 1));
  let iH, iL;
  if (sp.hi != null && sp.lo != null) { iH = at(sp.hi); iL = at(sp.lo); }
  else if (sp.lo != null) { iL = at(sp.lo); iH = at(sp.lo < 0.5 ? 0.75 + rng() * 0.23 : rng() * 0.2); }
  else if (sp.hi != null) { iH = at(sp.hi); iL = at(sp.hi < 0.5 ? 0.75 + rng() * 0.23 : rng() * 0.2); }
  else {
    const firstLow = rng() < (D.C >= D.O ? 0.65 : 0.35);
    let a = sampleT(rng), b = sampleT(rng); if (a > b) [a, b] = [b, a];
    if (firstLow) { iL = at(a); iH = at(b); } else { iH = at(a); iL = at(b); }
  }
  const cl = (i) => Math.min(n - 4, Math.max(3, i)); iH = cl(iH); iL = cl(iL);
  if (Math.abs(iH - iL) < 6) { if (iH < iL) iL = Math.min(n - 4, iH + 6); else iH = Math.min(n - 4, iL + 6); }
  const A = [[0, lnO], iH < iL ? [iH, lnH] : [iL, lnL], iH < iL ? [iL, lnL] : [iH, lnH], [n - 1, lnC]];
  const base = Math.max(lnH - lnL, 0.004) * 0.022, sig = (k) => { const x = k / (n - 1); return base * (0.55 + 1.8 * ((1 - x) ** 6 + x ** 6)); };
  const path = new Float64Array(n);
  for (let a = 0; a < 3; a++) {
    const [s0, v0] = A[a], [s1, v1] = A[a + 1], len = s1 - s0; if (len <= 0) continue;
    const seg = bridge(rng, len, v0, v1, (k) => sig(s0 + k));
    for (let k = 0; k <= len; k++) path[s0 + k] = seg[k];
  }
  const isA = new Set(A.map((a) => a[0]));
  for (let i = 0; i < n; i++) {
    if (isA.has(i)) continue;
    let v = path[i];
    if (v > lnH) v = lnH - (v - lnH) * 0.6; if (v < lnL) v = lnL + (lnL - v) * 0.6;
    path[i] = Math.min(lnH, Math.max(lnL, v));
  }
  return path;
}
function overlay(arr, i0, m, t1, t2, rev) {
  if (!m) return;
  const N = arr.length;
  for (let i = i0; i < N; i++) { const x = i - i0; arr[i] += m * (1 - Math.exp(-x / t1)) * (rev + (1 - rev) * Math.exp(-x / t2)); }
}
const deep = (o) => JSON.parse(JSON.stringify(o));
const COMP_NEWS = COMP_EVENTS.filter((e) => e.text).map((e) => ({ ...e, at: kst(e.at) })).sort((a, b) => a.at - b.at);

export class World {
  constructor({ seed, startT, ext = true }) {
    this.seed = String(seed); this.ext = ext; this.startT = startT;
    this.clock = startT + 7 * 3600;
    this.sessCache = new Map();
    this.days = { kr: [], us: [] };
    this.hist = {};
    this.newsLog = [];
    this.pending = [];
    this.newsUpto = this.clock; // news with t <= newsUpto have been queued
    this.realPtr = 0;
    this.listeners = new Set();
    this.comp = new Map();
    [...ROSTER.map((c) => ({ ...c, ipoT: c.ipo ? T0(c.ipo) : null })), ...ETFS].forEach((c) => this.comp.set(c.id, c));
    this.ms = { kr: this.initMarket('kr'), us: this.initMarket('us') };
    this.snap = { kr: null, us: null };
    this.realPtr = NEWS_LIST.findIndex((n) => kst(n.at) > this.clock);
    if (this.realPtr < 0) this.realPtr = NEWS_LIST.length;
  }

  initMarket(mk) {
    let next = dateOf(this.startT); while (!isTradingDay(mk, next)) next += DAY;
    const lvl = interpAnchors(ANCH[mk], prevTradingDay(mk, next)), blvl = interpAnchors(BANCH[mk], prevTradingDay(mk, next));
    const comp = {}, etf = {};
    for (const c of this.comp.values()) {
      if (c.mk !== mk) continue;
      if (c.etf) etf[c.id] = { close: c.price, iRef: c.base === 'broad' ? blvl : lvl };
      else if (!c.ipoT || c.ipoT < next) comp[c.id] = { close: c.price, last: c.price };
    }
    return { next, idx: { close: lvl, last: lvl }, bidx: { close: blvl, last: blvl }, comp, etf };
  }

  /* ---------- calendar helpers ---------- */
  sessions(mk, d) {
    const key = mk + d;
    let s = this.sessCache.get(key);
    if (!s) {
      s = isTradingDay(mk, d) ? sessionsFor(mk, d, this.ext).map((x) => ({ ...x, t0: d + x.start * 60, t1: d + x.end * 60 })) : [];
      this.sessCache.set(key, s);
    }
    return s;
  }
  sessionAt(mk, t) {
    for (const d of [dateOf(t), dateOf(t) - DAY]) for (const s of this.sessions(mk, d)) if (t >= s.t0 && t < s.t1) return s;
    return null;
  }
  anyOpen(t) { return !!(this.sessionAt('kr', t) || this.sessionAt('us', t)); }
  nextEdge(t, startsOnly) { // next session start (or start/end) strictly after t
    let best = Infinity;
    for (const mk of ['kr', 'us']) for (let d = dateOf(t) - DAY; d <= dateOf(t) + 12 * DAY; d += DAY) {
      for (const s of this.sessions(mk, d)) {
        if (s.t0 > t && s.t0 < best) best = s.t0;
        if (!startsOnly && s.t1 > t && s.t1 < best) best = s.t1;
      }
    }
    return best;
  }

  /* ---------- index skeleton for one trading day ---------- */
  volMult(t) { let m = 1; for (const [a, b, x] of VOL_WINDOWS) if (t >= a && t <= b) m = Math.max(m, x); return m; }
  skeleton(mk, t, prev, kind = 'semi') {
    const broad = kind === 'broad';
    const r = rngFor(this.seed, mk, broad ? 'bsk' : 'sk', t);
    let g, ret, rg = null, spec = {};
    let key = broad ? BROAD_KEYS[mk][t] : KEYS[mk][t];
    if (broad && !key && KEYS[mk][t]) { const k = KEYS[mk][t], f = BROAD_FROM_SEMI[mk]; key = { ...k, g: (k.g || 0) * f, r: k.r * f, rg: k.rg ? k.rg * f : undefined }; }
    const anchors = broad ? BANCH[mk] : ANCH[mk], bvol = broad ? BROAD_VOL[mk] : BASE_VOL[mk];
    if (t <= BACKDROP_END) {
      const vol = bvol * this.volMult(t);
      if (key) { g = (key.g || 0) * AMP; ret = key.r * AMP; spec = key; if (key.rg) rg = key.rg * AMP; }
      else {
        const anc = anchors.find(([d]) => d >= t) || anchors[anchors.length - 1];
        let n = 0; for (let d = t; d <= anc[0]; d += DAY) if (isTradingDay(mk, d)) n++;
        const drift = n > 0 ? (Math.log(anc[1]) - Math.log(prev)) / n : 0;
        ret = drift + vol * AMP * 0.85 * gauss(r);
        g = 0.35 * ret + 0.3 * vol * gauss(r);
      }
    } else {
      const reg = regimeFor(this.seed, t), vol = bvol * reg.vm, f = broad ? 0.6 : 1;
      const fe = futureEffect(this.seed, mk, t);
      ret = reg.drift * f + vol * AMP * gauss(r) + fe.r * AMP * f;
      g = 0.35 * (ret - fe.r * AMP * f) + fe.g * AMP * f + 0.3 * vol * gauss(r);
    }
    const O = prev * (1 + g), C = prev * (1 + ret);
    const vol = bvol * (t <= BACKDROP_END ? this.volMult(t) : 1);
    const range = rg != null ? rg : Math.abs(ret - g) + vol * (0.7 + r() * 0.6) * AMP;
    const extra = Math.max(0.004, range - Math.abs(C - O) / prev), s = 0.3 + 0.4 * r();
    return { t, O, C, H: Math.max(O, C) * (1 + extra * s), L: Math.min(O, C) * (1 - extra * (1 - s)), prev, spec };
  }
  factor(name, t) {
    const r = rngFor(this.seed, 'fac', name, t);
    const F = FACTORS[name] || THEMES[name];
    if (!F || !F.drift) return 0;
    const vol = FACTORS[name] ? 0.006 : (F.vol || 0.012) * 0.6;
    let d = 0;
    if (t <= BACKDROP_END) { for (const [a, b, x] of F.drift) if (t >= a && t <= b) d = FACTORS[name] ? x * 0.5 : x; d += (F.keys[t] || 0); }
    else if (FACTORS[name]) d = regimeFor(this.seed, t)[name];
    else { const b = Math.floor((t - BACKDROP_END) / (28 * DAY)), rr = rngFor(this.seed, 'threg', name, b); d = (rr() - 0.5) * 0.006 + (rr() < 0.04 ? 0.08 : 0) * (rr() < 0.5 ? 1 : -1) * (rngFor(this.seed, 'thk', name, t)() < 0.1 ? 1 : 0); }
    return (d + vol * gauss(r)) * AMP;
  }

  /* ---------- FX: daily anchors with smooth intraday motion ---------- */
  fxDaily(d) {
    if (d <= BACKDROP_END) { const r = rngFor(this.seed, 'fx', d); return interpAnchors(ANCH.fx, d) * (1 + 0.003 * gauss(r)); }
    if (!this._fxF) this._fxF = new Map();
    if (this._fxF.has(d)) return this._fxF.get(d);
    let v = interpAnchors(ANCH.fx, BACKDROP_END), x = BACKDROP_END;
    if (this._fxLast && this._fxLast[0] < d) { [x, v] = this._fxLast; }
    while (x < d) { x += DAY; const r = rngFor(this.seed, 'fxf', x); v = v * Math.exp(0.004 * gauss(r) - 0.01 * Math.log(v / 1380)); this._fxF.set(x, v); }
    this._fxLast = [d, v];
    return v;
  }
  fxAt(t) {
    const d = dateOf(t), f = (t - d) / DAY, a = this.fxDaily(d), b = this.fxDaily(d + DAY);
    const wig = 0.0012 * Math.sin(t / 5400 + (d % 97)) + 0.0006 * Math.sin(t / 1300 + (d % 31));
    return (a + (b - a) * f) * (1 + wig);
  }

  /* ---------- day generation ---------- */
  listedOn(mk, t) {
    const out = [];
    for (const c of this.comp.values()) if (c.mk === mk && !c.etf && (!c.ipoT || c.ipoT <= t)) out.push(c);
    return out;
  }
  refreshRoster(t) {
    for (const c of futureIpos(this.seed, t + 40 * DAY)) if (!this.comp.has(c.id)) this.comp.set(c.id, c);
  }

  genDay(mk) {
    const ms = this.ms[mk];
    if (!ms.bidx) { const l = interpAnchors(BANCH[mk], prevTradingDay(mk, ms.next)); ms.bidx = { close: l, last: l }; } // saves from before v0.5
    this.snap[mk] = deep(ms);
    const days = this.days[mk];
    if (days.length) { this.pushHist(days[days.length - 1]); }
    const t = ms.next, M = MARKETS[mk];
    this.refreshRoster(t);
    const r = rngFor(this.seed, mk, 'day', t), rb = rngFor(this.seed, mk, 'bday', t);
    const sess = this.sessions(mk, t);
    let off = 0;
    const S = sess.map((s) => { const n = (s.end - s.start) * PPM; const o = { ...s, n, off }; off += n; return o; });
    const N = off;
    const nT = nextTradingDay(mk, t);
    const regPos = S.findIndex((s) => s.id === 'reg');
    const regA = S[regPos].off, regB = regA + S[regPos].n;
    // one index path (log) per base: the semiconductor sector index and the broad market index
    const indexPath = (kind, rng, st) => {
      const sk = this.skeleton(mk, t, st.close, kind), skN = this.skeleton(mk, nT, sk.C, kind);
      const L = new Float64Array(N);
      let lastLn = Math.log(st.last);
      S.forEach((s, si) => {
        let arr;
        if (s.id === 'reg') arr = regularPath(rng, s.n, sk);
        else {
          const target = si < regPos ? lastLn + (Math.log(sk.O) - lastLn) * (si + 1) / regPos
            : Math.log(sk.C) + (Math.log(skN.O) - Math.log(sk.C)) * (sk.spec.pull != null ? sk.spec.pull : 0.5);
          arr = bridge(rng, s.n, lastLn, target, () => 0.00035 * AMP * (kind === 'broad' ? 0.7 : 1)).subarray(1);
        }
        L.set(arr, s.off);
        lastLn = arr[s.n - 1];
      });
      return { L, sk };
    };
    const { L: LI, sk } = indexPath('semi', r, ms.idx);
    const { L: LB, sk: skB } = indexPath('broad', rb, ms.bidx);
    const timeOf = (k) => { for (let i = S.length - 1; i >= 0; i--) if (k >= S[i].off) return S[i].t0 + (k - S[i].off) * 10; return S[0].t0; };
    const listed = this.listedOn(mk, t);
    // rumors & briefs
    const events = [];
    const cnt = 4 + Math.floor(r() * 6);
    for (let c = 0; c < cnt; c++) {
      const k = Math.floor(r() * N), R = pick(r, RUMORS);
      const comp = R[3] === 'stk' || R[3] === null ? pick(r, listed) : null;
      const text = R[1].replace(/\{peer\}/g, pick(r, PEERS)).replace(/\{broker\}/g, pick(r, BROKERS)).replace(/\{co\}/g, comp ? comp.name : '');
      let mag = 0;
      if (R[3] && r() > 0.35) { const tone = R[2] || (r() < 0.5 ? 1 : -1); mag = tone * (r() < 0.65 ? 1 : -1) * (0.004 + r() * 0.016) * AMP * (R[3] === 'idx' ? 0.5 : 1); }
      events.push({ t: timeOf(k), k, mk, tag: R[0], text, major: false, comp: R[3] === 'stk' ? comp.id : null, target: R[3], mag, t1: 6 * (5 + r() * 25), t2: 6 * (60 + r() * 180), rev: r() * 0.5 });
    }
    for (const e of events) if (e.target === 'idx') overlay(LI, e.k, e.mag, e.t1, e.t2, e.rev);
    const idxClose = Math.exp(LI[regB - 1]), bidxClose = Math.exp(LB[regB - 1]);
    // companies
    const P = {}, V = {}, prevClose = {}, daily = {}, stat = {};
    const base = { semi: { L: LI, prev: Math.log(ms.idx.close), last0: Math.log(ms.idx.last) }, broad: { L: LB, prev: Math.log(ms.bidx.close), last0: Math.log(ms.bidx.last) } };
    const facCache = {}, fac = (name) => (facCache[name] ??= this.factor(name, t));
    const compKeys = new Map(COMP_EVENTS.filter((e) => e.t === t).map((e) => [e.comp, e]));
    const regW = (() => { let s = 0; for (let k = 0; k < S[regPos].n; k++) { const x = k / (S[regPos].n - 1); s += 0.5 + 2.2 * (1 - x) ** 5 + 1.4 * x ** 5; } return s; })();
    const dayVolMult = 1 + Math.abs(sk.C / sk.prev - 1) * 14 + Math.abs(sk.O / sk.prev - 1) * 8;
    for (const c of listed) {
      const cr = rngFor(this.seed, c.id, t);
      const ipoToday = c.ipoT === t;
      let st = ms.comp[c.id];
      if (!st) st = ms.comp[c.id] = { close: c.price, last: c.price };
      const pc = st.close; prevClose[c.id] = pc;
      const B = base[c.base === 'semi' ? 'semi' : 'broad'];
      const ck = compKeys.get(c.id);
      let themeR = 0; for (const [name, w] of Object.entries(c.th || {})) if (w) themeR += w * fac(name);
      // company-specific moves mean-revert (z = accumulated idiosyncratic drift), so small caps don't compound forever
      const spk = this.spike(c, t);
      const z = st.z || 0;
      const idio = c.ivol * AMP * gauss(cr) - 0.012 * z + (spk ? spk.r : 0);
      st.z = z + idio;
      let resR = themeR + (c.drift || 0) + idio + (ck ? ck.r * AMP : 0);
      let resG = 0.4 * themeR + 0.35 * c.ivol * gauss(cr) + (spk ? spk.g : 0) + (ck ? ck.g * AMP : 0);
      let lo = mk === 'kr' ? pc * 0.7 : 0, hi = mk === 'kr' ? pc * 1.3 : Infinity;
      if (ipoToday) {
        const newRule = mk === 'kr' && t >= T0('2023-06-26');
        resG = mk === 'kr' ? (newRule ? -0.1 + cr() * 1.6 : -0.1 + cr() * 1.1) : -0.1 + cr() * 0.9;
        resR = resG + 0.15 * gauss(cr);
        if (mk === 'kr') { lo = pc * (newRule ? 0.6 : 0.63); hi = pc * (newRule ? 4 : 2.6); }
        events.push({ t: S[regPos].t0, k: regA, mk, tag: '상장', text: c.name + ' 오늘 상장… 공모가 ' + (mk === 'kr' ? c.price.toLocaleString('ko-KR') + '원' : '$' + c.price), major: true, comp: c.id, target: null, mag: 0 });
      }
      if (spk && spk.kind === 'spike') { const k = regA + Math.floor(cr() * (regB - regA) * 0.7); events.push({ t: timeOf(k), k, mk, tag: '급등', text: c.name + ', 장중 급등… 뚜렷한 이유 안 보여', major: false, comp: c.id, target: null, mag: 0 }); }
      const X = new Float64Array(N);
      const xStart = ipoToday ? resG : Math.log(st.last) - Math.log(pc) - c.beta * (B.last0 - B.prev);
      let xl = xStart;
      S.forEach((s, si) => {
        let arr;
        const sig = (s.ext ? 0.5 : 1) * c.ivol * AMP * 0.0207 * (spk ? 2 : 1);
        if (s.id === 'reg') arr = bridge(cr, s.n, resG, resR, () => sig).subarray(0, s.n);
        else if (si < regPos) arr = bridge(cr, s.n, xl, xl + (resG - xl) * (si + 1) / regPos, () => sig).subarray(1);
        else arr = bridge(cr, s.n, xl, resR + c.ivol * 0.3 * gauss(cr), () => sig).subarray(1);
        X.set(arr, s.off);
        xl = arr[s.n - 1];
      });
      if (ipoToday) for (let k = 0; k < regA; k++) X[k] = NaN; // not trading before the listing session
      for (const e of events) if (e.comp === c.id && e.target === 'stk') overlay(X, e.k, e.mag, e.t1, e.t2, e.rev);
      const arrP = new Float64Array(N), arrV = new Float32Array(N);
      const Vd = M.volBase * (c.mk === 'kr' ? 50000 / c.price : 60 / c.price) * (0.7 + cr() * 0.6) * dayVolMult * (ipoToday ? 6 : 1) * (spk ? (spk.kind === 'spike' ? 8 : 3) : 1);
      let o = 0, h = 0, l = Infinity, cl = pc, rk = 0;
      for (let k = 0; k < N; k++) {
        if (Number.isNaN(X[k])) { arrP[k] = NaN; continue; }
        let p = Math.exp(Math.log(pc) + c.beta * (B.L[k] - B.prev) + X[k]);
        p = roundPx(mk, Math.min(hi, Math.max(lo, p)));
        arrP[k] = p;
        const inReg = k >= regA && k < regB;
        let v;
        if (inReg) { const x = rk++ / (S[regPos].n - 1); v = Vd * (0.5 + 2.2 * (1 - x) ** 5 + 1.4 * x ** 5) / regW; } else v = (Vd * 0.012) / Math.max(1, N - S[regPos].n);
        arrV[k] = v * (0.4 + cr() * 1.2);
        if (inReg) { if (k === regA) o = p; h = Math.max(h, p); l = Math.min(l, p); cl = p; }
      }
      if (mk === 'kr' && !ipoToday && cl >= roundPx('kr', pc * 1.3, 'down') ) events.push({ t: S[regPos].t1 - 60, k: regB - 6, mk, tag: '상한가', text: c.name + ' 상한가 마감', major: false, comp: c.id, target: null, mag: 0 });
      if (mk === 'kr' && !ipoToday && cl <= roundPx('kr', pc * 0.7, 'up')) events.push({ t: S[regPos].t1 - 60, k: regB - 6, mk, tag: '하한가', text: c.name + ' 하한가 마감', major: false, comp: c.id, target: null, mag: 0 });
      P[c.id] = arrP; V[c.id] = arrV;
      stat[c.id] = this.stats(arrP, arrV, regA, regB);
      daily[c.id] = [t, o, h, l, cl, Math.round(stat[c.id].cv[N - 1])];
      st.close = cl; st.last = arrP[N - 1];
    }
    // leveraged ETFs on either index
    for (const c of this.comp.values()) {
      if (!c.etf || c.mk !== mk) continue;
      const st = ms.etf[c.id] || (ms.etf[c.id] = { close: c.price, iRef: c.base === 'broad' ? ms.bidx.close : ms.idx.close });
      prevClose[c.id] = st.close;
      const Lx = c.base === 'broad' ? LB : LI;
      const arrP = new Float64Array(N), arrV = new Float32Array(N);
      let o = 0, h = 0, l = Infinity, cl = st.close;
      const lim = mk === 'kr' ? 0.3 * Math.abs(c.k) : null;
      for (let k = 0; k < N; k++) {
        let L = st.close * (1 + c.k * (Math.exp(Lx[k]) / st.iRef - 1));
        L = Math.max(L, st.close * 0.03);
        if (lim) L = Math.min(st.close * (1 + lim), Math.max(st.close * (1 - lim), L));
        L = roundPx(mk, L, null, true);
        arrP[k] = L;
        arrV[k] = (mk === 'kr' ? 3e6 : 2e7) / Math.max(1, N) * dayVolMult * (0.4 + r() * 1.2);
        if (k >= regA && k < regB) { if (k === regA) o = L; h = Math.max(h, L); l = Math.min(l, L); cl = L; }
      }
      P[c.id] = arrP; V[c.id] = arrV; stat[c.id] = this.stats(arrP, arrV, regA, regB);
      daily[c.id] = [t, o, h, l, cl, Math.round(stat[c.id].cv[N - 1])];
      st.close = cl; st.iRef = c.base === 'broad' ? bidxClose : idxClose;
    }
    // indices as viewable instruments
    const addIndex = (id, L, prevLvl) => {
      const a = new Float64Array(N); for (let k = 0; k < N; k++) a[k] = Math.round(Math.exp(L[k]) * 100) / 100;
      P[id] = a; V[id] = new Float32Array(N); prevClose[id] = prevLvl; stat[id] = this.stats(a, V[id], regA, regB);
      let h = 0, l = Infinity; for (let k = regA; k < regB; k++) { h = Math.max(h, a[k]); l = Math.min(l, a[k]); }
      daily[id] = [t, a[regA], h, l, a[regB - 1], 0];
    };
    addIndex(IDX[mk], LI, ms.idx.close);
    addIndex(BIDX[mk], LB, ms.bidx.close);
    ms.idx.close = idxClose; ms.idx.last = Math.exp(LI[N - 1]);
    ms.bidx.close = bidxClose; ms.bidx.last = Math.exp(LB[N - 1]);
    ms.next = nT;
    events.sort((a, b) => a.t - b.t);
    const day = { mk, t, S, N, regA, regB, P, V, stat, prevClose, daily, startT: S[0].t0, endT: S[S.length - 1].t1, pushed: false, skB };
    days.push(day);
    if (days.length > 2) days.shift();
    for (const e of events) if (e.t > this.clock - 1) this.queue(e); // skip anything before the clock (only on reload)
    return day;
  }
  // Running volume and the regular-session high/low up to each point, so quotes are O(1).
  stats(P, V, regA, regB) {
    const N = P.length, cv = new Float64Array(N), hi = new Float64Array(N), lo = new Float64Array(N);
    let s = 0, h = NaN, l = NaN;
    for (let k = 0; k < N; k++) {
      const p = P[k];
      if (!Number.isNaN(p)) { s += V[k]; if (k >= regA && k < regB) { h = Number.isNaN(h) ? p : Math.max(h, p); l = Number.isNaN(l) ? p : Math.min(l, p); } }
      cv[k] = s; hi[k] = h; lo[k] = l;
    }
    return { cv, hi, lo };
  }
  // Small caps occasionally rip for no clear reason; the next day either follows through or fades.
  spike(c, t) {
    if (!c.small) return null;
    const p = c.mk === 'kr' ? 0.006 : 0.005, kr = c.mk === 'kr';
    const r0 = rngFor(this.seed, 'spk', c.id, t);
    if (r0() < p) { const rr = kr ? 0.12 + r0() * 0.2 : 0.2 + r0() * 0.5; return { kind: 'spike', r: rr, g: rr * 0.25 }; }
    const tp = prevTradingDay(c.mk, t), r1 = rngFor(this.seed, 'spk', c.id, tp);
    if (r1() < p && (!c.ipoT || c.ipoT < tp)) { const r2 = rngFor(this.seed, 'spk2', c.id, t); return r2() < 0.4 ? { kind: 'follow', r: r2() * 0.15, g: 0.04 } : { kind: 'fade', r: -(0.08 + r2() * 0.2), g: -0.04 }; }
    return null;
  }
  pushHist(day) {
    if (day.pushed) return;
    day.pushed = true;
    for (const [id, bar] of Object.entries(day.daily)) { (this.hist[id] || (this.hist[id] = [])).push(bar); }
  }
  queue(e) {
    const p = this.pending;
    let i = p.length; while (i > 0 && p[i - 1].t > e.t) i--;
    p.splice(i, 0, e);
  }
  nextDayStart(mk) { const s = this.sessions(mk, this.ms[mk].next); return s.length ? s[0].t0 : Infinity; }
  ensureDays(t) {
    for (const mk of ['kr', 'us']) { let guard = 0; while (this.nextDayStart(mk) <= t && guard++ < 400) this.genDay(mk); }
  }
  ensureNews(t) {
    if (t <= this.newsUpto) return;
    while (this.realPtr < NEWS_LIST.length) {
      const n = NEWS_LIST[this.realPtr], nt = kst(n.at);
      if (nt > t) break;
      if (nt > this.newsUpto) this.queue({ t: nt, mk: n.mk, tag: n.major ? '속보' : '뉴스', text: n.text, major: n.major, comp: null });
      this.realPtr++;
    }
    for (const e of COMP_NEWS) {
      if (e.at > t) break;
      if (e.at <= this.newsUpto) continue;
      const c = this.comp.get(e.comp);
      this.queue({ t: e.at, mk: c.mk, tag: e.major ? '속보' : '공시', text: e.text.replace(/\{co\}/g, c.name), major: e.major, comp: c.id });
    }
    for (let d = dateOf(this.newsUpto); d <= dateOf(t); d += DAY) {
      const ev = futureEvent(this.seed, d);
      if (ev && ev.t > this.newsUpto && ev.t <= t) this.queue({ t: ev.t, mk: 'all', tag: ev.major ? '속보' : '뉴스', text: ev.text, major: ev.major, comp: null });
      if (d > BACKDROP_END) for (const c of this.comp.values()) {
        if (c.future && c.ipoT - 3 * DAY >= d && c.ipoT - 3 * DAY < d + DAY) {
          const at = d + 9 * 3600; if (at > this.newsUpto && at <= t) this.queue({ t: at, mk: c.mk, tag: '공모', text: c.name + '(' + c.sector + ') 사흘 뒤 상장… 공모가 ' + (c.mk === 'kr' ? c.price.toLocaleString('ko-KR') + '원' : '$' + c.price) + ' 확정', major: false, comp: null });
        }
      }
    }
    this.newsUpto = t;
  }

  /* ---------- clock ---------- */
  // Moves time forward by dt seconds of market time; closed periods are skipped instantly.
  // Returns fired news; stops at a major one when pauseOnMajor.
  advance(dt, pauseOnMajor = true) {
    const fired = [];
    let remaining = dt, paused = false, guard = 0;
    while (remaining > 0 && guard++ < 1000) {
      if (!this.anyOpen(this.clock)) {
        const n = this.nextEdge(this.clock, true);
        paused = this.moveTo(n, fired, pauseOnMajor);
        if (paused) break;
        continue;
      }
      const edge = this.nextEdge(this.clock, false);
      const step = Math.min(remaining, edge - this.clock);
      remaining -= step;
      paused = this.moveTo(this.clock + step, fired, pauseOnMajor);
      if (paused) break;
    }
    return { fired, paused };
  }
  moveTo(t, fired, pauseOnMajor) {
    this.ensureDays(t);
    this.ensureNews(t);
    while (this.pending.length && this.pending[0].t <= t) {
      const e = this.pending.shift();
      this.newsLog.push(e); if (this.newsLog.length > 400) this.newsLog.shift();
      fired.push(e);
      if (pauseOnMajor && e.major) { this.clock = Math.max(this.clock, Math.ceil(e.t / 10) * 10); this.ensureDays(this.clock); return true; }
    }
    this.clock = t;
    return false;
  }
  skipTo(t, pauseOnMajor = true) { // jump (next session / next day), still stopping at major news
    const fired = [];
    let paused = false;
    while (this.clock < t && !paused) {
      const step = Math.min(t, this.anyOpen(this.clock) ? this.nextEdge(this.clock, false) : this.nextEdge(this.clock, true));
      paused = this.moveTo(Math.min(step, t), fired, pauseOnMajor);
    }
    return { fired, paused };
  }
  nextSessionStart() { return this.nextEdge(this.clock, true); }
  nextKrDayStart() { // next KR trading day's first session after now
    let d = dateOf(this.clock) + DAY; while (!isTradingDay('kr', d)) d += DAY;
    return this.sessions('kr', d)[0].t0;
  }

  /* ---------- queries ---------- */
  curDay(mk) { const d = this.days[mk]; return d.length ? d[d.length - 1] : null; }
  indexIn(day, t) {
    if (!day || t < day.startT) return -1;
    let k = -1;
    for (const s of day.S) {
      if (t < s.t0) return k;
      if (t < s.t1) return s.off + Math.floor((t - s.t0) / 10);
      k = s.off + s.n - 1;
    }
    return day.N - 1;
  }
  instrument(id) {
    if (id === IDX.kr || id === IDX.us) { const mk = id === IDX.kr ? 'kr' : 'us'; return { id, mk, name: MARKETS[mk].idxName, sector: '업종 지수', index: true }; }
    if (id === BIDX.kr || id === BIDX.us) { const mk = id === BIDX.kr ? 'kr' : 'us'; return { id, mk, name: MARKETS[mk].bidxName, sector: '대표 지수', index: true }; }
    return this.comp.get(id);
  }
  listed(mk) {
    const t = this.clock, out = [];
    for (const c of this.comp.values()) {
      if (c.mk !== mk) continue;
      if (c.etf) { out.push(c); continue; }
      const day = this.curDay(mk);
      if (day ? (c.id in day.P && (!c.ipoT || this.priceOf(c.id) != null)) : (!c.ipoT || c.ipoT < this.ms[mk].next)) out.push(c);
    }
    return out;
  }
  upcoming(mk) { // IPOs announced (within 3 days) but not trading yet
    return [...this.comp.values()].filter((c) => c.mk === mk && c.ipoT && this.priceOf(c.id) == null && c.ipoT - 3 * DAY <= this.clock && c.ipoT + DAY > this.clock);
  }
  priceOf(id, t = this.clock) {
    const inst = this.instrument(id); if (!inst) return null;
    const day = this.curDay(inst.mk);
    if (day && day.P[id]) {
      const k = this.indexIn(day, t);
      if (k < 0) return day.prevClose[id];
      const v = day.P[id][k];
      return Number.isNaN(v) ? null : v;
    }
    if (inst.index) return id.startsWith('b') ? this.ms[inst.mk].bidx.close : this.ms[inst.mk].idx.close;
    const st = inst.etf ? this.ms[inst.mk].etf[id] : this.ms[inst.mk].comp[id];
    return st ? st.close : null;
  }
  quote(id) {
    const inst = this.instrument(id), price = this.priceOf(id);
    const day = this.curDay(inst.mk);
    const prev = day && day.prevClose[id] != null ? day.prevClose[id] : price;
    const sess = this.sessionAt(inst.mk, this.clock);
    let vol = 0, hi = null, lo = null;
    if (day && day.P[id]) {
      const k = this.indexIn(day, this.clock), s = day.stat[id];
      if (k >= 0) { vol = s.cv[k]; if (!Number.isNaN(s.hi[k])) { hi = s.hi[k]; lo = s.lo[k]; } }
    }
    return { id, price, prev, chg: price != null && prev ? price / prev - 1 : 0, sess, vol, hi, lo, turnover: vol * (price || 0) };
  }
  // Intraday bars for the previous + current day up to now. tf in minutes.
  intraday(id, tf) {
    const inst = this.instrument(id), out = [];
    for (const day of this.days[inst.mk]) {
      if (!day.P[id]) continue;
      const last = day === this.curDay(inst.mk) ? this.indexIn(day, this.clock) : day.N - 1;
      const P = day.P[id], V = day.V[id];
      let cur = null, prevP = null;
      for (let k = 0; k <= last; k++) {
        const p = P[k]; if (Number.isNaN(p)) continue;
        const s = day.S.find((x) => k >= x.off && k < x.off + x.n);
        const t = s.t0 + (k - s.off) * 10, b = Math.floor(t / (tf * 60)) * tf * 60;
        if (!cur || cur.time !== b) { if (cur) out.push(cur); const o = prevP ?? p; cur = { time: b, open: o, high: Math.max(o, p), low: Math.min(o, p), close: p, value: 0, ext: s.ext }; }
        cur.high = Math.max(cur.high, p); cur.low = Math.min(cur.low, p); cur.close = p; cur.value += V[k]; prevP = p;
      }
      if (cur) out.push(cur);
    }
    return out;
  }
  dailyBars(id) {
    const inst = this.instrument(id);
    const out = (this.hist[id] || []).map(([t, o, h, l, c, v]) => ({ time: t, open: o, high: h, low: l, close: c, value: v }));
    const prev = this.days[inst.mk].length > 1 ? this.days[inst.mk][0] : null;
    if (prev && !prev.pushed && prev.daily[id]) { const [t, o, h, l, c, v] = prev.daily[id]; out.push({ time: t, open: o, high: h, low: l, close: c, value: v }); }
    const day = this.curDay(inst.mk);
    if (day && day.P[id]) {
      const k = this.indexIn(day, this.clock);
      if (k >= day.regA) {
        const P = day.P[id], end = Math.min(k, day.regB - 1);
        let h = -Infinity, l = Infinity, v = 0;
        for (let i = day.regA; i <= end; i++) { h = Math.max(h, P[i]); l = Math.min(l, P[i]); v += day.V[id][i]; }
        out.push({ time: day.t, open: P[day.regA], high: h, low: l, close: P[end], value: v });
      }
    }
    return out;
  }
  spark(id, n = 36) {
    const inst = this.instrument(id), day = this.curDay(inst.mk);
    if (!day || !day.P[id]) return [];
    const k = this.indexIn(day, this.clock); if (k < 0) return [];
    const P = day.P[id], out = [], step = Math.max(1, Math.floor(day.N / n));
    for (let i = 0; i <= k; i += step) if (!Number.isNaN(P[i])) out.push(P[i]);
    if (!Number.isNaN(P[k])) out.push(P[k]);
    return out;
  }
  tradingDayEnd(mk) { // end of the trading day an order placed now belongs to
    const day = this.curDay(mk);
    if (day && this.clock < day.endT) return day.endT;
    const s = this.sessions(mk, this.ms[mk].next);
    return s.length ? s[s.length - 1].t1 : this.clock + DAY;
  }
  // First / min / max traded price in (t0, t1], or null when nothing traded.
  priceRange(id, t0, t1) {
    const inst = this.instrument(id); if (!inst || t1 <= t0) return null;
    let first = null, min = Infinity, max = -Infinity;
    for (const day of this.days[inst.mk]) {
      const P = day.P[id]; if (!P || t1 < day.startT || t0 >= day.endT) continue;
      const a = t0 < day.startT ? 0 : this.indexIn(day, t0) + 1, b = t1 >= day.endT ? day.N - 1 : this.indexIn(day, t1);
      for (let k = Math.max(0, a); k <= b; k++) { const p = P[k]; if (Number.isNaN(p)) continue; if (first == null) first = p; if (p < min) min = p; if (p > max) max = p; }
    }
    return first == null ? null : { first, min, max };
  }
  marketState(mk) {
    const s = this.sessionAt(mk, this.clock);
    if (s) return { open: true, sess: s };
    let best = null;
    for (let d = dateOf(this.clock) - DAY; d <= dateOf(this.clock) + 12 * DAY && !best; d += DAY) for (const x of this.sessions(mk, d)) if (x.t0 > this.clock) { best = x; break; }
    return { open: false, next: best };
  }
  isUsDst() { return usDST(dateOf(this.clock)); }
  fx() { return this.fxAt(this.clock); }

  /* ---------- save / load ---------- */
  toSave() {
    const hist = {};
    for (const [id, rows] of Object.entries(this.hist)) {
      const inst = this.instrument(id), kr = inst && inst.mk === 'kr', n = rows.length;
      const out = [];
      for (let i = 0; i < n; i++) {
        const r = rows[i], old = n - i > 250;
        if (old && i % 5) continue; // older history: weekly closes only
        const row = old ? [r[0], r[4]] : [r[0], r[1], r[2], r[3], r[4], Math.round(r[5] / 1000)];
        out.push(row.map((v, j) => (j === 0 || j === 5 ? v : kr ? Math.round(v) : Math.round(v * 100) / 100)));
      }
      hist[id] = out;
    }
    return {
      v: 1, seed: this.seed, ext: this.ext, startT: this.startT, clock: this.clock,
      snap: deep(this.snap), msNow: deep(this.ms), hist,
      newsLog: this.newsLog.slice(-120),
      futureIds: [...this.comp.values()].filter((c) => c.future).map((c) => c.id),
    };
  }
  static fromSave(o) {
    const w = new World({ seed: o.seed, startT: o.startT, ext: o.ext });
    w.hist = {};
    for (const [id, rows] of Object.entries(o.hist || {})) w.hist[id] = rows.map((r) => (r.length === 2 ? [r[0], r[1], r[1], r[1], r[1], 0] : [r[0], r[1], r[2], r[3], r[4], r[5] * 1000]));
    w.newsLog = o.newsLog || [];
    w.refreshRoster(o.clock);
    w.clock = o.clock;
    w.newsUpto = o.clock;
    w.realPtr = NEWS_LIST.findIndex((n) => kst(n.at) > o.clock); if (w.realPtr < 0) w.realPtr = NEWS_LIST.length;
    for (const mk of ['kr', 'us']) {
      if (o.snap && o.snap[mk]) { w.ms[mk] = deep(o.snap[mk]); w.genDay(mk); }
      else w.ms[mk] = deep(o.msNow[mk]);
    }
    w.ensureDays(w.clock);
    return w;
  }
}

export function randomStart(seed) {
  const r = rngFor(String(seed), 'start');
  const a = T0('2019-06-03'), b = T0('2019-12-02');
  let t = a + Math.floor(r() * ((b - a) / DAY)) * DAY;
  while (!isTradingDay('kr', t)) t += DAY;
  return t;
}
