// 강화소: an original enhancement mini-game. Buy a "황금 주권" (gold share certificate) and enhance it level by level.
// Each try costs money; it succeeds, stays, drops a level (10+), or breaks (12+). Sell any time for its current value.
// Tuned so that every try is slightly unfavourable (about 5% house edge): you can win big on luck, but it is no money printer.
// Lives outside src/engine on purpose: it uses Math.random and has nothing to do with the deterministic world.
export const MAX_LV = 20;
const PS = [0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.42, 0.4, 0.37, 0.35, 0.32, 0.3, 0.3, 0.3, 0.28, 0.25, 0.2];
const BREAK = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.02, 0.03, 0.04, 0.06, 0.08, 0.1, 0.12, 0.15];
const GROW = (lv) => (lv < 10 ? 1.5 : lv < 15 ? 1.6 : 1.75);
const EDGE = 1.05;
export const TIERS = [100_000, 1_000_000, 10_000_000, 100_000_000];

export function valueAt(base, lv) { let v = base; for (let i = 0; i < lv; i++) v *= GROW(i); return Math.round(v); }
export function odds(lv) {
  const s = PS[lv], b = BREAK[lv], f = 1 - s - b, drop = lv >= 10 ? f * 0.5 : 0;
  return { success: s, stay: f - drop, drop, break: b };
}
export function costAt(base, lv) { return Math.round(valueAt(base, lv) * PS[lv] * (GROW(lv) - 1) * EDGE); }

export const newForge = () => ({ item: null, stats: { spent: 0, earned: 0, best: 0, broke: 0, tries: 0 } });
export function buyItem(f, base) { f.item = { base, lv: 0 }; f.stats.spent += base; }
// returns 'success' | 'stay' | 'drop' | 'break'
export function enhance(f, rnd = Math.random) {
  const it = f.item; if (!it || it.lv >= MAX_LV) return null;
  const o = odds(it.lv), c = costAt(it.base, it.lv), x = rnd();
  f.stats.spent += c; f.stats.tries++;
  let res;
  if (x < o.success) { it.lv++; res = 'success'; f.stats.best = Math.max(f.stats.best, it.lv); }
  else if (x < o.success + o.break) { f.item = null; f.stats.broke++; res = 'break'; }
  else if (x < o.success + o.break + o.drop) { it.lv--; res = 'drop'; }
  else res = 'stay';
  return { res, cost: c };
}
export function sellItem(f) { const it = f.item; if (!it) return 0; const v = valueAt(it.base, it.lv); f.stats.earned += v; f.item = null; return v; }
