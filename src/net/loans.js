// Loans between players in a room. There is no server and no direct messages: each player only publishes a small
// presence blob, so every step is something one side publishes and the other side reacts to:
//   lender: offer (o)  →  borrower: accept (a)  →  lender: funds, cash leaves, publishes funded (f)  →  borrower: cash arrives
//   borrower: repays, publishes the cumulative amount paid (p)  →  lender: credits the difference
// Cumulative totals and ids make every step idempotent, so repeated or late presence updates never move money twice.
// Money is KRW only and everything is in game time. It is a friends' game: a peer could lie, and that is fine.
import { DAY } from '../engine/calendar.js';
import { availKrw } from '../engine/account.js';

export const RATES = [0, 3, 5, 10, 20];    // total interest, % of principal
export const TERMS = [7, 14, 30, 60, 90];   // game days
export const PLANS = { bullet: '만기 일시 상환', weekly: '매주 나눠 갚기' };
const MAX_OFFERS = 5, KEEP = 12;

export function normalizeLoans(a) {
  for (const [k, v] of [['loans', []], ['loanOffers', []], ['loanAccepts', []], ['loanFunded', []], ['loanDeclined', []], ['loanSeq', 0], ['loanReq', null], ['loanAuto', true]]) if (a[k] === undefined) a[k] = v;
  return a;
}

// Installments: weekly → equal parts every 7 days (the last one on the due day absorbs rounding); bullet → everything on the due day.
export function schedule(l) {
  const end = l.startT + l.days * DAY;
  if (l.plan !== 'weekly') return [{ t: end, amt: l.totalDue }];
  const n = Math.max(1, Math.ceil(l.days / 7)), each = Math.floor(l.totalDue / n), out = [];
  for (let i = 1; i <= n; i++) out.push({ t: i === n ? end : l.startT + i * 7 * DAY, amt: i === n ? l.totalDue - each * (n - 1) : each });
  return out;
}
export const dueBy = (l, t) => schedule(l).reduce((s, x) => s + (x.t <= t ? x.amt : 0), 0);
export const paidOf = (l) => (l.role === 'borrow' ? l.paid : l.received) || 0;
export const remaining = (l) => Math.max(0, l.totalDue - paidOf(l));
// late = what should have been paid by a day ago but wasn't
export const overdue = (l, t) => (remaining(l) > 0 ? Math.max(0, dueBy(l, t - DAY) - paidOf(l)) : 0);
export function nextDue(l, t) {
  let acc = 0; const paid = paidOf(l);
  for (const x of schedule(l)) { acc += x.amt; if (acc > paid) return { t: x.t, amt: Math.min(x.amt, acc - paid), late: x.t < t - DAY }; }
  return null;
}
export const active = (a) => a.loans.filter((l) => remaining(l) > 0);

/* ---------- local actions ---------- */
export function makeOffer(a, me, to, amt, rate, days, plan) {
  normalizeLoans(a);
  if (!(amt >= 10000)) return { err: '1만 원 이상 빌려줄 수 있어요.' };
  if (availKrw(a) < amt) return { err: '원화 예수금이 부족해요.' };
  if (a.loanOffers.length >= MAX_OFFERS) return { err: '보낸 제안이 너무 많아요. 먼저 정리해 주세요.' };
  const id = me.pid.slice(0, 6) + '-' + (++a.loanSeq).toString(36);
  a.loanOffers.push({ id, to: to.pid, toNick: to.nick, amt: Math.round(amt), totalDue: Math.round(amt * (1 + rate / 100)), rate, days, plan });
  return { ok: true };
}
export const cancelOffer = (a, id) => { a.loanOffers = a.loanOffers.filter((o) => o.id !== id); };
export function acceptOffer(a, offer) { // offer as seen in the lender's presence
  if (a.loanAccepts.some((x) => x.id === offer.id) || a.loans.some((l) => l.id === offer.id)) return;
  a.loanAccepts.push({ ...offer });
}
export const declineOffer = (a, id) => { a.loanDeclined.push(id); if (a.loanDeclined.length > 40) a.loanDeclined.shift(); };
export function repay(a, id, amt) {
  const l = a.loans.find((x) => x.id === id && x.role === 'borrow'); if (!l) return 0;
  const pay = Math.floor(Math.min(amt, remaining(l), availKrw(a)));
  if (pay <= 0) return 0;
  a.krw -= pay; l.paid += pay;
  return pay;
}
export const nudge = (a, id, t) => { const l = a.loans.find((x) => x.id === id && x.role === 'lend'); if (l) l.nudgeT = t; };
export const setRequest = (a, amt) => { a.loanReq = amt > 0 ? Math.round(amt) : null; };

/* ---------- presence ---------- */
export function presenceLoans(a, t) {
  normalizeLoans(a);
  const borrow = a.loans.filter((l) => l.role === 'borrow'), lend = a.loans.filter((l) => l.role === 'lend');
  return {
    o: a.loanOffers.map((o) => [o.id, o.to, o.amt, o.totalDue, o.days, o.plan]),
    a: a.loanAccepts.map((x) => [x.id, x.from]),
    f: a.loanFunded.slice(-KEEP),
    p: borrow.slice(-KEEP).map((l) => [l.id, l.peerPid, l.paid]),
    n: lend.filter((l) => l.nudgeT && remaining(l) > 0).map((l) => [l.id, l.nudgeT]),
    q: a.loanReq,
    d: borrow.reduce((s, l) => s + remaining(l), 0), // public: how much this player still owes
    od: borrow.filter((l) => overdue(l, t) > 0).length,
  };
}

// Offers addressed to me that I haven't answered yet
export function incomingOffers(a, me, peers) {
  normalizeLoans(a);
  const out = [];
  for (const p of peers) {
    const pr = p.presence, ln = pr && pr.ln; if (p.isMe || !ln || !Array.isArray(ln.o)) continue;
    for (const o of ln.o) {
      if (!Array.isArray(o) || o[1] !== me.pid) continue;
      const [id, , amt, totalDue, days, plan] = o;
      if (a.loanDeclined.includes(id) || a.loanAccepts.some((x) => x.id === id) || a.loans.some((l) => l.id === id)) continue;
      out.push({ id, from: pr.pid, fromNick: pr.nick || '익명', amt: +amt || 0, totalDue: +totalDue || 0, days: +days || 7, plan: plan === 'weekly' ? 'weekly' : 'bullet' });
    }
  }
  return out;
}

// React to what peers published. Returns events for toasts: { kind, text }
export function syncLoans(a, world, me, peers) {
  normalizeLoans(a);
  const ev = [], byPid = new Map();
  for (const p of peers) if (!p.isMe && p.presence && p.presence.pid && p.presence.ln) byPid.set(p.presence.pid, p.presence);
  const won = (x) => Math.round(x).toLocaleString('ko-KR') + '원';
  // lender: a borrower accepted one of my offers → fund it (or report failure)
  for (const o of [...a.loanOffers]) {
    const b = byPid.get(o.to); if (!b || !Array.isArray(b.ln.a)) continue;
    if (!b.ln.a.some((x) => Array.isArray(x) && x[0] === o.id && x[1] === me.pid)) continue;
    a.loanOffers = a.loanOffers.filter((x) => x.id !== o.id);
    if (availKrw(a) < o.amt) { a.loanFunded.push([o.id, o.to, 0, 0]); ev.push({ kind: 'warn', text: (b.nick || '상대') + '님이 대출을 수락했지만 예수금이 부족해서 보내지 못했어요.' }); continue; }
    a.krw -= o.amt;
    a.loans.push({ id: o.id, role: 'lend', peerPid: o.to, peerNick: b.nick || o.toNick, amt: o.amt, totalDue: o.totalDue, rate: o.rate, days: o.days, plan: o.plan, startT: world.clock, received: 0 });
    a.loanFunded.push([o.id, o.to, 1, world.clock]);
    ev.push({ kind: 'lent', text: (b.nick || '상대') + '님에게 ' + won(o.amt) + '을 빌려줬어요.' });
  }
  // borrower: the lender funded (or failed) what I accepted
  for (const x of [...a.loanAccepts]) {
    const l = byPid.get(x.from); if (!l) continue;
    const f = (l.ln.f || []).find((e) => Array.isArray(e) && e[0] === x.id && e[1] === me.pid);
    if (f) {
      a.loanAccepts = a.loanAccepts.filter((y) => y.id !== x.id);
      if (f[2] === 1 && !a.loans.some((y) => y.id === x.id)) {
        a.krw += x.amt;
        a.loans.push({ id: x.id, role: 'borrow', peerPid: x.from, peerNick: l.nick || x.fromNick, amt: x.amt, totalDue: x.totalDue, rate: Math.round((x.totalDue / x.amt - 1) * 100), days: x.days, plan: x.plan, startT: +f[3] || world.clock, paid: 0, nudgeSeen: 0 });
        ev.push({ kind: 'borrowed', text: (l.nick || '상대') + '님에게 ' + won(x.amt) + '을 빌렸어요. 갚을 돈은 ' + won(x.totalDue) + '이에요.' });
      } else if (f[2] !== 1) ev.push({ kind: 'warn', text: (l.nick || '상대') + '님의 예수금이 부족해서 대출이 취소됐어요.' });
    } else if (!(l.ln.o || []).some((o) => Array.isArray(o) && o[0] === x.id)) { a.loanAccepts = a.loanAccepts.filter((y) => y.id !== x.id); } // offer withdrawn
  }
  for (const l of a.loans) {
    const peer = byPid.get(l.peerPid); if (!peer) continue;
    if (l.role === 'lend') { // repayments come in as a cumulative total
      const p = (peer.ln.p || []).find((e) => Array.isArray(e) && e[0] === l.id && e[1] === me.pid);
      const paid = p ? Math.min(l.totalDue, Math.max(0, +p[2] || 0)) : 0;
      if (paid > l.received) {
        const d = paid - l.received; a.krw += d; l.received = paid;
        ev.push({ kind: 'repaid', text: (peer.nick || l.peerNick) + '님이 ' + won(d) + ' 갚았어요' + (remaining(l) > 0 ? ' · 남은 돈 ' + won(remaining(l)) : ' · 다 받았어요') });
      }
    } else { // nudges from my lender
      const n = (peer.ln.n || []).find((e) => Array.isArray(e) && e[0] === l.id);
      if (n && +n[1] > (l.nudgeSeen || 0)) { l.nudgeSeen = +n[1]; if (remaining(l) > 0) ev.push({ kind: 'warn', text: (peer.nick || l.peerNick) + '님이 상환을 독촉했어요 · 남은 돈 ' + won(remaining(l)) }); }
    }
  }
  if (a.loanFunded.length > 40) a.loanFunded.splice(0, a.loanFunded.length - 40);
  return ev;
}

// Borrower side: pay whatever is due from KRW cash when it's due (on by default)
export function autoRepay(a, world) {
  normalizeLoans(a);
  if (!a.loanAuto) return [];
  const ev = [];
  for (const l of a.loans) {
    if (l.role !== 'borrow' || remaining(l) <= 0) continue;
    const owe = dueBy(l, world.clock) - l.paid; if (owe <= 0) continue;
    const pay = repay(a, l.id, owe);
    if (pay > 0) ev.push({ kind: 'autopay', text: '자동 상환 · ' + l.peerNick + '님에게 ' + Math.round(pay).toLocaleString('ko-KR') + '원' + (pay < owe ? ' (예수금 부족, 일부만)' : '') });
  }
  return ev;
}
