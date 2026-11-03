// Calendar, holidays and trading sessions.
// All timestamps are "KST wall-clock seconds": Date.UTC(...) of the Korean local time.
// That keeps formatting trivial (read with getUTC*) and makes session math pure arithmetic.

export const DAY = 86400;
export const T0 = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / 1000; };
export const kst = (s) => { const [a, b] = s.split(' '); const [h, mi] = b.split(':').map(Number); return T0(a) + h * 3600 + mi * 60; };
export const dow = (t) => new Date(t * 1000).getUTCDay();
export const dstr = (t) => new Date(t * 1000).toISOString().slice(0, 10);
export const yearOf = (t) => new Date(t * 1000).getUTCFullYear();
export const dateOf = (t) => Math.floor(t / DAY) * DAY;

function nthWd(y, mo, wd, n) { let t = Date.UTC(y, mo, 1) / 1000; while (dow(t) !== wd) t += DAY; return t + (n - 1) * 7 * DAY; }
function lastWd(y, mo, wd) { let t = Date.UTC(y, mo + 1, 1) / 1000 - DAY; while (dow(t) !== wd) t -= DAY; return t; }
function easter(y) { // anonymous Gregorian algorithm
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(y, month - 1, day) / 1000;
}

export function usDST(t) { const y = yearOf(t); return t >= nthWd(y, 2, 0, 2) && t < nthWd(y, 10, 0, 1); }

const usCache = new Map();
function usHolidays(y) {
  if (usCache.has(y)) return usCache.get(y);
  const obs = (t) => (dow(t) === 6 ? t - DAY : dow(t) === 0 ? t + DAY : t);
  const s = new Set();
  const ny = Date.UTC(y, 0, 1) / 1000; if (dow(ny) !== 6) s.add(obs(ny));
  [nthWd(y, 0, 1, 3), nthWd(y, 1, 1, 3), easter(y) - 2 * DAY, lastWd(y, 4, 1), obs(Date.UTC(y, 6, 4) / 1000),
    nthWd(y, 8, 1, 1), nthWd(y, 10, 4, 4), obs(Date.UTC(y, 11, 25) / 1000)].forEach((t) => s.add(t));
  if (y >= 2022) s.add(obs(Date.UTC(y, 5, 19) / 1000));
  if (y === 2025) s.add(T0('2025-01-09'));
  usCache.set(y, s);
  return s;
}

// KRX closures that move with the lunar calendar, elections and one-off days (2019–2030, approximate beyond 2026).
const KR_EXTRA = {
  2019: ['02-04', '02-05', '02-06', '09-12', '09-13'],
  2020: ['01-24', '01-27', '04-15', '04-30', '08-17', '09-30', '10-01', '10-02'],
  2021: ['02-11', '02-12', '05-19', '08-16', '09-20', '09-21', '09-22', '10-04', '10-11'],
  2022: ['01-31', '02-01', '02-02', '03-09', '06-01', '09-09', '09-12', '10-10'],
  2023: ['01-23', '01-24', '05-29', '09-28', '09-29', '10-02'],
  2024: ['02-09', '02-12', '04-10', '05-06', '05-15', '09-16', '09-17', '09-18', '10-01'],
  2025: ['01-27', '01-28', '01-29', '01-30', '03-03', '05-06', '06-03', '10-06', '10-07', '10-08'],
  2026: ['02-16', '02-17', '02-18', '03-02', '05-25', '06-03', '08-17', '09-24', '09-25', '10-05'],
  2027: ['02-08', '02-09', '05-13', '09-14', '09-15', '09-16'],
  2028: ['01-26', '01-27', '01-28', '05-02', '10-02', '10-04'],
  2029: ['02-12', '02-13', '02-14', '05-21', '09-21', '09-24'],
  2030: ['02-04', '02-05', '05-09', '09-11', '09-12', '09-13'],
};
const KR_FIXED = ['01-01', '03-01', '05-01', '05-05', '06-06', '08-15', '10-03', '10-09', '12-25', '12-31'];
const krCache = new Map();
function krHolidays(y) {
  if (krCache.has(y)) return krCache.get(y);
  const s = new Set();
  KR_FIXED.forEach((md) => s.add(T0(y + '-' + md)));
  (KR_EXTRA[y] || []).forEach((md) => s.add(T0(y + '-' + md)));
  krCache.set(y, s);
  return s;
}

export function isTradingDay(mk, t) {
  const w = dow(t);
  if (w === 0 || w === 6) return false;
  return !(mk === 'kr' ? krHolidays(yearOf(t)) : usHolidays(yearOf(t))).has(t);
}
export function nextTradingDay(mk, t) { let d = t + DAY; while (!isTradingDay(mk, d)) d += DAY; return d; }
export function prevTradingDay(mk, t) { let d = t - DAY; while (!isTradingDay(mk, d)) d -= DAY; return d; }

export const NXT_FROM = T0('2025-03-04');
// Korean brokers' US "day market" (via an overseas ATS): from Feb 2022, halted after the 2024-08-05 mass cancellation, back from 2025-11-04.
export const hasDayMarket = (t) => t >= T0('2022-02-07') && !(t > T0('2024-08-05') && t < T0('2025-11-04'));

export const SESSION_LABEL = {
  pre: { label: '프리', long: '프리마켓' }, reg: { label: '정규', long: '정규장' },
  after: { label: '애프터', long: '애프터마켓' }, day: { label: '데이', long: '데이마켓' },
};

// Sessions of one trading day, in minutes from 00:00 KST of that date (US sessions run past midnight).
export function sessionsFor(mk, t, ext) {
  const S = [];
  const add = (id, a, b, x) => S.push({ id, start: a, end: b, ext: x, ...SESSION_LABEL[id] });
  if (mk === 'kr') {
    const nxt = t >= NXT_FROM;
    if (nxt && ext) add('pre', 480, 530, true);
    add('reg', 540, 930, false);
    if (nxt && ext) add('after', 940, 1200, true);
  } else {
    const sh = usDST(t) ? -60 : 0;
    if (ext && hasDayMarket(t)) add('day', 600 + sh, 1035 + sh, true);
    if (ext) add('pre', 1080 + sh, 1410 + sh, true);
    add('reg', 1410 + sh, 1800 + sh, false);
    if (ext) add('after', 1800 + sh, 2040 + sh, true);
  }
  return S;
}

// KR securities transaction tax on sells (incl. special tax), approximate by year.
export function krSellTax(t) {
  const y = yearOf(t);
  return y <= 2020 ? 0.0025 : y <= 2022 ? 0.0023 : y === 2023 ? 0.002 : y === 2024 ? 0.0018 : y === 2025 ? 0.0015 : 0.002;
}

export const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
