// "미지의 국면" 모드: 실제 역사를 챕터로 나눠 순서는 지키되, 챕터마다 길이를 섞어요(대체로 짧게).
// 챕터 사이엔 가끔 잔잔한 구간(이야기 시간이 멈춤)이 끼어요. 시세 엔진은 "이야기 날짜"로 고증 데이터를 읽고,
// 달력(장 시간·휴장일·제도 변화)은 게임 날짜를 그대로 써요. 역사 모드에서는 둘이 같아요(warp = null).
import { T0, DAY } from './calendar.js';
import { rngFor } from './rng.js';
import { BACKDROP_END } from './backdrop.js';

// chapter boundaries (story dates): calm 2019 → pre-crash → crash → rebound → liquidity rally → meme peak → late bull → bear →
// recovery → AI rally → carry-trade unwind → chop → tariff shock → memory super-cycle → peak & selloff
export const CHAPTERS = ['2019-06-03', '2020-01-20', '2020-02-19', '2020-03-23', '2020-11-02', '2021-02-16', '2021-11-19', '2022-10-14',
  '2023-01-03', '2024-07-10', '2024-08-16', '2025-03-24', '2025-05-01', '2026-06-22', '2026-11-03'].map(T0);

export function makeWarp(seed, startT) {
  const r = rngFor(String(seed), 'warp');
  const s0 = T0('2019-06-03') + Math.floor(r() * 150) * DAY;
  const segs = [];
  let g = startT;
  for (let i = 0; i < CHAPTERS.length - 1; i++) {
    const b = CHAPTERS[i + 1];
    if (b <= s0) continue;
    const a = Math.max(CHAPTERS[i], s0);
    if (segs.length && r() < 0.35) { const len = (10 + Math.floor(r() * 50)) * DAY; segs.push({ g0: g, g1: g + len, s0: a, s1: a, gap: true }); g += len; }
    const k = 0.35 + 0.8 * r() ** 1.6; // game days per story day: mostly faster than history (avg ~0.65), now and then a bit slower
    const len = Math.max(DAY, Math.round(((b - a) / DAY) * k) * DAY);
    segs.push({ g0: g, g1: g + len, s0: a, s1: b, k: len / (b - a), gap: false });
    g += len;
  }
  return { segs, gEnd: g, s0 };
}

const seg = (w, t) => { const s = w.segs; let lo = 0, hi = s.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (s[m].g0 <= t) lo = m; else hi = m - 1; } return s[lo]; };

// game date → story date (both on the same day grid)
export function storyDate(w, t) {
  if (!w) return t;
  if (t >= w.gEnd) return BACKDROP_END + (t - w.gEnd);
  const first = w.segs[0];
  if (t < first.g0) return first.s0 - (first.g0 - t);
  const x = seg(w, t);
  if (x.gap) return x.s0;
  return Math.min(x.s1, x.s0 + Math.floor((t - x.g0) / x.k / DAY + 1e-9) * DAY);
}
export const inGap = (w, t) => !!w && t >= w.segs[0].g0 && t < w.gEnd && seg(w, t).gap;

// story time (any second) → game time: same time of day on the mapped game date
export function gameTime(w, st) {
  if (!w) return st;
  const d = Math.floor(st / DAY) * DAY, tod = st - d;
  return gameDate(w, d) + tod;
}
export function gameDate(w, s) {
  if (!w) return s;
  if (s > BACKDROP_END) return w.gEnd + (s - BACKDROP_END);
  const first = w.segs[0];
  if (s < first.s0) return first.g0 - (first.s0 - s);
  for (const x of w.segs) if (!x.gap && s >= x.s0 && s < x.s1) return x.g0 + Math.ceil(((s - x.s0) / DAY) * x.k - 1e-9) * DAY;
  return w.gEnd;
}
