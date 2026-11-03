// Surge-stock statistics over a whole campaign: how often small caps run, how far, how often they turn red.
// Usage: node scripts/surge-check.mjs [seed]
import { World, randomStart } from '../src/engine/world.js';
import { T0, dstr } from '../src/engine/calendar.js';

const seed = process.argv[2] || 'check-1';
const w = new World({ seed, startT: randomStart(seed), ext: true });
let halts = 0, gapNews = 0, offer = 0; const tags = {}; let days = 0, genMs = 0;
const END = T0(process.argv[3] || '2027-06-02');
while (w.clock < END) {
  const g0 = performance.now(); const { fired } = w.advance(3600 * 6, false); genMs += performance.now() - g0;
  for (const e of fired) { tags[e.tag] = (tags[e.tag] || 0) + 1; if (e.tag === '거래정지') halts++; if (e.text.includes('프리마켓')) gapNews++; if (e.tag === '공시') offer++; }
}
const S = { us: { d: 0, x50: 0, x100: 0, x300: 0, red: 0, top: [] }, kr: { d: 0, lim: 0, chain2: 0, chain3: 0, wick: 0 } };
for (const mk of ['us', 'kr']) for (const c of w.listed(mk)) {
  if (c.etf || c.index) continue;
  const h = w.hist[c.id] || []; let run = 0;
  for (let i = 1; i < h.length; i++) {
    const pc = h[i - 1][4], [t, o, hi, lo, cl] = h[i]; if (!pc) continue;
    const up = hi / pc - 1, chg = cl / pc - 1;
    if (mk === 'us') {
      S.us.d++;
      if (up >= 0.5) S.us.x50++; if (up >= 1) S.us.x100++; if (up >= 3) S.us.x300++;
      if (up >= 0.5 && chg < 0) S.us.red++;
      if (up >= 1) S.us.top.push([c.name, dstr(t), Math.round(up * 100), Math.round(chg * 100)]);
    } else {
      S.kr.d++;
      if (chg >= 0.295) { S.kr.lim++; run++; if (run === 2) S.kr.chain2++; if (run === 3) S.kr.chain3++; } else run = 0;
      if (up >= 0.295 && chg < 0.15) S.kr.wick++;
    }
  }
}
S.us.top.sort((a, b) => b[2] - a[2]);
console.log('US stock-days', S.us.d, '| intraday +50%', S.us.x50, '+100%', S.us.x100, '+300%', S.us.x300, '| +50% then closed red', S.us.red, '| halts', halts, 'gap news', gapNews, 'offerings', offer);
console.log('US top runs (name, date, intraday high %, close %):'); for (const x of S.us.top.slice(0, 12)) console.log('  ', x.join('  '));
const krDays = new Set(); for (const c of w.listed('kr')) for (const h of (w.hist[c.id] || [])) krDays.add(h[0]);
console.log('KR trading days', krDays.size, '상한가/day', (S.kr.lim / krDays.size).toFixed(2), '| listed now kr', w.listed('kr').length, 'us', w.listed('us').length, '| total ms', Math.round(genMs));
console.log('news tags', JSON.stringify(tags));
console.log('KR stock-days', S.kr.d, '| 상한가', S.kr.lim, '2연상', S.kr.chain2, '3연상', S.kr.chain3, '| 상한가 찍고 풀림', S.kr.wick);
