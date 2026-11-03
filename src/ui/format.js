import { WEEKDAY } from '../engine/calendar.js';

const nf0 = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const won = (v) => (v < 0 ? '-' : '') + nf0.format(Math.round(Math.abs(v))) + '원';
export const usd = (v) => (v < 0 ? '-' : '') + '$' + nf2.format(Math.abs(v));
export const num2 = (v) => nf2.format(v);

// A price with its currency unit. US prices follow the chosen display currency.
export function priceText(inst, p, cur, fx) {
  if (p == null) return '-';
  if (inst.index) return nf2.format(p) + 'pt';
  if (inst.mk === 'kr') return won(p);
  return cur === 'KRW' ? won(p * fx) : usd(p);
}
export function diffText(inst, d, cur, fx) {
  if (d == null) return '';
  const s = d > 0 ? '+' : d < 0 ? '−' : '';
  if (inst.index) return s + nf2.format(Math.abs(d));
  if (inst.mk === 'kr') return s + nf0.format(Math.round(Math.abs(d))) + '원';
  return cur === 'KRW' ? s + nf0.format(Math.round(Math.abs(d * fx))) + '원' : s + '$' + nf2.format(Math.abs(d));
}
// Amounts held in KRW, shown in the display currency.
export const moneyK = (v, cur, fx) => (cur === 'USD' ? usd(v / fx) : won(v));
// Amounts held in USD.
export const moneyU = (v, cur, fx) => (cur === 'KRW' ? won(v * fx) : usd(v));

export const pct = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v * 100).toFixed(2) + '%';
export const tone = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');

const pad = (n) => String(n).padStart(2, '0');
export const hhmm = (t) => { const d = new Date(t * 1000); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); };
export const mmdd = (t) => { const d = new Date(t * 1000); return pad(d.getUTCMonth() + 1) + '.' + pad(d.getUTCDate()); };
export function dateText(t, startT, hideYear) {
  const d = new Date(t * 1000), y = d.getUTCFullYear();
  const pre = hideYear ? (y - new Date(startT * 1000).getUTCFullYear() + 1) + '년차 ' : y + '.';
  return pre + mmdd(t) + ' (' + WEEKDAY[d.getUTCDay()] + ')';
}
export const shortDate = (t, startT, hideYear) => (hideYear ? (new Date(t * 1000).getUTCFullYear() - new Date(startT * 1000).getUTCFullYear() + 1) + '년차 ' : new Date(t * 1000).getUTCFullYear() + '.') + mmdd(t);

export function compact(v) {
  if (v >= 1e12) return (v / 1e12).toFixed(1) + '조';
  if (v >= 1e8) return (v / 1e8).toFixed(1) + '억';
  if (v >= 1e4) return (v / 1e4).toFixed(0) + '만';
  return nf0.format(Math.round(v));
}
