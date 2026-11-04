import { World, randomStart, IDX, BIDX } from './src/engine/world.js';
import { dstr, DAY, T0 } from './src/engine/calendar.js';
const seed = process.argv[2] || 'check-1', st = randomStart(seed);
const w = new World({ seed, startT: st, ext: true, mode: 'unknown' });
for (const x of w.warp.segs) console.log(x.gap ? 'GAP ' : 'CH  ', dstr(x.g0), '→', dstr(x.g1), x.gap ? '' : '| story ' + dstr(x.s0) + '→' + dstr(x.s1) + ' k=' + x.k.toFixed(2));
console.log('story ends at game', dstr(w.warp.gEnd));
let big = 0, n = 0, last = 0; const t0 = Date.now();
while (w.clock < T0('2023-01-01')) {
  const { fired } = w.advance(6 * 3600, false);
  for (const e of fired) if (e.major) { n++; if (n <= 25) console.log('  ', dstr(e.t), e.text.slice(0, 50)); }
  if (w.clock - last > 120 * DAY) { last = w.clock; console.log(dstr(w.clock), 'story', dstr(w.st(Math.floor(w.clock / DAY) * DAY)), '나스닭', Math.round(w.priceOf(BIDX.us)), '코스비', Math.round(w.priceOf(BIDX.kr)), '반도체US', Math.round(w.priceOf(IDX.us))); }
}
console.log('majors', n, 'ms', Date.now() - t0);
