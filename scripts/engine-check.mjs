// Engine sanity check: runs a whole campaign headless and checks determinism and save/load.
// Usage: node scripts/engine-check.mjs [seed]
import { World, randomStart, IDX } from '../src/engine/world.js';
import { T0, dstr } from '../src/engine/calendar.js';
import { newAccount, execute, valuation } from '../src/engine/account.js';

const seed = process.argv[2] || 'check-1';
const mode = process.argv[3] || 'history'; // or 'unknown'
const t0 = Date.now();
const start = randomStart(seed);
const w = new World({ seed, startT: start, ext: true, mode });
console.log('start', dstr(start), 'mode', mode);

const checkpoints = ['2020-02-19', '2020-03-18', '2021-12-27', '2022-10-14', '2024-07-10', '2025-04-08', '2026-06-22', '2026-11-03', '2027-06-01']; const extra=['ecp','ggo','gsd','ionp','hpa','hde','ros'];
let ci = 0, news = 0, majors = 0, bad = 0;
const acct = newAccount(10_000_000);
let traded = false;
while (w.clock < T0('2027-06-02')) {
  const { fired } = w.advance(3600 * 6, false);
  news += fired.length; majors += fired.filter((e) => e.major).length;
  if (!traded && w.anyOpen(w.clock) && w.marketState('us').open) { const r = execute(acct, w, 'ltk', 'buy', 0.3, true); traded = r.ok; }
  for (const mk of ['kr', 'us']) for (const c of w.listed(mk)) { const p = w.priceOf(c.id); if (p != null && !(p > 0 && Number.isFinite(p))) bad++; }
  while (ci < checkpoints.length && w.clock >= T0(checkpoints[ci]) + 86400) {
    const q = (id) => { const v = w.priceOf(id); return v == null ? '-' : (v >= 1000 ? Math.round(v) : v.toFixed(2)); };
    console.log(checkpoints[ci], '나스닭', q('bidx_us'), '코스비', q('bidx_kr'), 'idxUS', q(IDX.us), 'idxKR', q(IDX.kr), '에고', q('ecp'), '게임고', q('ggo'), 'LNTK', q('ltk'), 'KPLR', q('kpl'), '도담', q('ddm'), '세움', q('sem'), 'US3X', q('us3x'), 'fx', w.fx().toFixed(0),
      'listed', w.listed('kr').length + w.listed('us').length);
    ci++;
  }
}
const v = valuation(acct, w);
console.log('news', news, 'major', majors, 'badPrices', bad, 'account total', Math.round(v.totalKrw), 'ms', Date.now() - t0);

// save/load determinism: save mid-day, reload, advance both by the same amount, compare
const w2 = new World({ seed, startT: start, ext: true, mode });
w2.advance(86400 * 400, false); w2.advance(3600 * 5 + 1234, false);
const saved = JSON.stringify(w2.toSave());
const w3 = World.fromSave(JSON.parse(saved));
w2.advance(86400 * 3, false); w3.advance(86400 * 3, false);
const ids = [...w2.listed('kr'), ...w2.listed('us')].map((c) => c.id);
const same = ids.every((id) => w2.priceOf(id) === w3.priceOf(id)) && w2.clock === w3.clock;
console.log('save size KB', Math.round(saved.length / 1024), 'reload deterministic', same, dstr(w2.clock));
