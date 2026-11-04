import { useEffect, useMemo, useRef, useState } from 'react';
import Chart from './Chart.jsx';
import { IDX, BIDX, MARKETS } from '../engine/world.js';
import { THEMES, THEME_ORDER } from '../engine/themes.js';
import { repliesFor, liveCounts } from '../engine/community.js';
import { MAX_LV, TIERS, valueAt, costAt, odds } from '../minigame/forge.js';
import { sound } from './sound.js';
import { incomingOffers, schedule, remaining, overdue, nextDue, paidOf, RATES, TERMS, PLANS } from '../net/loans.js';
import { quoteOrder, quoteLimit, valuation, FX_SPREAD, availKrw, availUsd, tickOf, limitBand } from '../engine/account.js';
import { priceText, diffText, pct, tone, won, usd, moneyK, moneyU, compact, hhmm, mmdd, dateText, shortDate, num2 } from './format.js';

export function Spark({ data, w = 64, h = 26 }) {
  if (!data || data.length < 2) return <svg width={w} height={h} aria-hidden="true" />;
  const lo = Math.min(...data), hi = Math.max(...data), span = hi - lo || 1;
  const pts = data.map((v, i) => (i / (data.length - 1)) * w + ',' + (h - 2 - ((v - lo) / span) * (h - 4))).join(' ');
  const cls = data[data.length - 1] >= data[0] ? 'spark up' : 'spark down';
  return <svg width={w} height={h} className={cls} aria-hidden="true"><polyline points={pts} fill="none" strokeWidth="1.5" /></svg>;
}

const Icon = {
  back: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>,
  gear: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>,
  pause: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M8 5v14" /><path d="M16 5v14" /></svg>,
  play: <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5l12 7-12 7z" /></svg>,
};
export { Icon };

/* ---------------- Clock bar ---------------- */
export const SPEEDS = [60, 600, 3600, 14400];
export function ClockBar({ world, settings, speed, setSpeed, onSkip, onSettings, desk, cur, setCur, locked , onForge}) {
  const fx = world.fx();
  const st = (mk) => {
    const m = world.marketState(mk);
    if (m.open) return { on: true, text: MARKETS[mk].name + ' ' + m.sess.long };
    return { on: false, text: MARKETS[mk].name + ' ' + (m.next ? '닫힘 · ' + m.next.label + ' ' + hhmm(m.next.t0) : '닫힘') };
  };
  const kr = st('kr'), us = st('us');
  const ny = world.clock - (world.isUsDst() ? 13 : 14) * 3600;
  // publish the bar's real height so sticky things below it (left column, toasts) sit right under it
  const bar = useRef(null);
  useEffect(() => {
    const el = bar.current; if (!el || typeof ResizeObserver === 'undefined') return;
    const set = () => document.documentElement.style.setProperty('--cb-h', el.offsetHeight + 'px');
    const ro = new ResizeObserver(set); ro.observe(el); set();
    return () => ro.disconnect();
  }, []);
  return (
    <header ref={bar} className={'clockbar' + (desk ? ' desk' : '')}>
      <div className="cb-row">
        <div className="cb-time">
          <span className="cb-date">{dateText(world.clock, world.startT, settings.hideYear)}</span>
          <span className="cb-hm num">{hhmm(world.clock)}</span>
          <span className="cb-ny num">뉴욕 {hhmm(ny)}</span>
        </div>
        <span className="cb-btns">
          {onForge && <button className="pill forge-btn" type="button" onClick={onForge}>강화소</button>}
          <button className="iconbtn" type="button" onClick={onSettings} aria-label="설정">{Icon.gear}</button>
        </span>
      </div>
      <div className="cb-row wrap">
        <span className={'pill' + (kr.on ? ' on' : '')}>{kr.text}</span>
        <span className={'pill' + (us.on ? ' on' : '')}>{us.text}</span>
        <button type="button" className="pill fx" onClick={() => setCur(cur === 'USD' ? 'KRW' : 'USD')} aria-label="해외 가격 표시 통화 전환">
          <span className="num">USD/KRW {num2(fx)}</span><b>{cur === 'USD' ? '$ 표시' : '₩ 표시'}</b>
        </button>
      </div>
      <div className="cb-row">
        <div className="seg speed" role="group" aria-label={locked ? '재생 속도 (방장이 정해요)' : '재생 속도'}>
          <button type="button" aria-pressed={speed === 0} aria-label="일시정지" disabled={locked} onClick={() => setSpeed(0)}>{Icon.pause}</button>
          {SPEEDS.map((s) => <button key={s} type="button" aria-pressed={speed === s} disabled={locked} onClick={() => setSpeed(s)}>×{s >= 3600 ? s / 3600 + 'h' : s}</button>)}
        </div>
        {locked ? <span className="pill">방장이 시간을 정해요</span> : (
          <>
            <button type="button" className="skip" onClick={() => onSkip('session')}>다음 세션 ▸</button>
            <button type="button" className="skip" onClick={() => onSkip('day')}>다음 날 ▸▸</button>
          </>
        )}
      </div>
    </header>
  );
}

/* ---------------- Market list ---------------- */
// Rows never move by themselves: "내 순서" is a saved order you rearrange by dragging the ⋮⋮ handle (or arrow keys on it).
// The other sorts are snapshots taken when you tap them; tap the active one again to re-sort with the latest numbers.
const SORTS = [['mine', '내 순서'], ['turnover', '거래대금'], ['up', '상승'], ['down', '하락'], ['name', '이름']];
const ORDER_KEY = 'rw-order';
const loadOrder = () => { try { const v = JSON.parse(localStorage.getItem(ORDER_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
const saveOrder = (o) => { try { localStorage.setItem(ORDER_KEY, JSON.stringify(o)); } catch (e) { /* storage unavailable */ } };
const byOrder = (rows, ids) => { const pos = new Map(ids.map((id, i) => [id, i])); return rows.map((r, i) => [r, pos.has(r.c.id) ? pos.get(r.c.id) : 1e6 + i]).sort((a, b) => a[1] - b[1]).map((x) => x[0]); };
const scrollParent = (el) => { for (let e = el && el.parentElement; e; e = e.parentElement) { const o = getComputedStyle(e).overflowY; if ((o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight) return e; } return null; };

function DragList({ rows, row, sortable, onMove }) {
  const ul = useRef(null), st = useRef(null);
  const [live, setLive] = useState(null); // ids in their dragged order while a drag is running
  const ids = rows.map((r) => r.c.id);
  const shown = live ? byOrder(rows, live) : rows;
  const end = () => { const d = st.current; st.current = null; cancelAnimationFrame(d?.raf || 0); if (d && d.ids.join() !== ids.join()) onMove(d.ids); setLive(null); };
  const down = (e, id) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const sp = scrollParent(ul.current);
    st.current = { id, ids: ids.slice(), y: e.clientY, x: e.clientX, sp, raf: 0 };
    const tickScroll = () => { // keep scrolling while the finger rests near an edge
      const d = st.current; if (!d) return;
      const top = d.sp ? d.sp.getBoundingClientRect().top : 0, bot = d.sp ? d.sp.getBoundingClientRect().bottom : window.innerHeight;
      const v = d.y < top + 56 ? -8 : d.y > bot - 56 ? 8 : 0;
      if (v) { if (d.sp) d.sp.scrollTop += v; else window.scrollBy(0, v); retarget(); }
      d.raf = requestAnimationFrame(tickScroll);
    };
    st.current.raf = requestAnimationFrame(tickScroll);
    setLive(ids.slice());
  };
  const retarget = () => {
    const d = st.current; if (!d) return;
    const el = document.elementFromPoint(d.x, d.y), li = el && el.closest('li[data-id]');
    if (!li || !ul.current.contains(li) || li.dataset.id === d.id) return;
    const to = d.ids.indexOf(li.dataset.id), from = d.ids.indexOf(d.id);
    if (to < 0) return;
    d.ids.splice(from, 1); d.ids.splice(to, 0, d.id); setLive(d.ids.slice());
  };
  const move = (e) => { const d = st.current; if (!d) return; d.x = e.clientX; d.y = e.clientY; retarget(); };
  const key = (e, id) => {
    const i = ids.indexOf(id), j = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : -1;
    if (j < 0 || j >= ids.length || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault(); const n = ids.slice(); n.splice(i, 1); n.splice(j, 0, id); onMove(n);
    requestAnimationFrame(() => ul.current?.querySelector('li[data-id="' + id + '"] .grip')?.focus());
  };
  return (
    <ul className={'list' + (sortable ? ' sortable' : '')} ref={ul}>
      {shown.map((r) => (
        <li key={r.c.id} data-id={r.c.id} className={live && st.current?.id === r.c.id ? 'dragging' : ''}>
          {sortable && <button type="button" className="grip" aria-label={r.c.name + ' 순서 옮기기 (위아래 화살표)'} onPointerDown={(e) => down(e, r.c.id)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onKeyDown={(e) => key(e, r.c.id)}>⋮⋮</button>}
          {row(r)}
        </li>
      ))}
    </ul>
  );
}

export function MarketList({ world, mk, setMk, cur, onSelect, selected, tick, watch = [] }) {
  const [sort, setSort] = useState('mine');
  const [snap, setSnap] = useState(null); // { key, ids } — frozen order for the snapshot sorts
  const [order, setOrder] = useState(loadOrder);
  const [theme, setTheme] = useState('all');
  const fx = world.fx();
  const isW = mk === 'watch';
  const src = isW ? watch.map((id) => world.instrument(id)).filter((c) => c && !c.index && world.priceOf(c.id) != null) : world.listed(mk);
  const themes = isW ? [] : THEME_ORDER.filter((k) => src.some((c) => !c.etf && c.theme === k));
  const rows = src.filter((c) => isW || theme === 'all' || (theme === 'etf' ? c.etf : !c.etf && c.theme === theme)).map((c) => ({ c, q: world.quote(c.id), sp: world.spark(c.id) }));
  const sorter = { turnover: (a, b) => b.q.turnover * (b.c.mk === 'us' ? fx : 1) - a.q.turnover * (a.c.mk === 'us' ? fx : 1), up: (a, b) => b.q.chg - a.q.chg, down: (a, b) => a.q.chg - b.q.chg, name: (a, b) => a.c.name.localeCompare(b.c.name, 'ko') };
  const pickSort = (k) => {
    setSort(k);
    if (k === 'mine') { setSnap(null); return; }
    const all = (isW ? src : world.listed(mk)).map((c) => ({ c, q: world.quote(c.id) })).sort(sorter[k]);
    setSnap({ key: k, ids: all.map((r) => r.c.id) });
  };
  const arrange = (list) => (sort === 'mine' || !snap ? byOrder(list, order) : byOrder(list, snap.ids));
  const stocks = arrange(rows.filter((r) => !r.c.etf)), etfs = arrange(rows.filter((r) => r.c.etf));
  // a drag reorders only the visible subset; slot it back into the full saved order
  const onMove = (subset) => {
    const base = [...order]; for (const c of world.listed('kr').concat(world.listed('us'))) if (!base.includes(c.id)) base.push(c.id);
    for (const id of subset) if (!base.includes(id)) base.push(id);
    const set = new Set(subset), slots = base.map((id, i) => (set.has(id) ? i : -1)).filter((i) => i >= 0);
    slots.forEach((i, j) => { base[i] = subset[j]; });
    setOrder(base); saveOrder(base);
  };
  const upcoming = isW ? [] : world.upcoming(mk);
  const badge = (r) => {
    const s = world.statusOf ? world.statusOf(r.c.id) : null;
    if (s === 'halt') return <span className="badge muted">거래정지</span>;
    if (s === 'clr') return <span className="badge warn">정리매매</span>;
    if (s === 'luld') return <span className="badge warn">일시정지</span>;
    if (r.c.mk === 'kr' && !r.c.etf && r.q.prev && r.q.price >= Math.floor(r.q.prev * 1.3 / 10) * 10 * 0.995 && r.q.chg > 0.29) return <span className="badge hot">상한가</span>;
    if (r.c.mk === 'kr' && !r.c.etf && r.q.chg < -0.29) return <span className="badge cold">하한가</span>;
    if (r.q.chg > 0.15) return <span className="badge hot">급등</span>;
    if (r.q.chg < -0.15) return <span className="badge cold">급락</span>;
    if (r.c.ipoT && Math.abs(world.clock - r.c.ipoT) < 86400 * 1.2) return <span className="badge new">신규</span>;
    return null;
  };
  const row = (r) => (
    <button type="button" className={'row' + (selected === r.c.id ? ' sel' : '')} onClick={() => onSelect(r.c.id)}>
      <span className="r-name"><b>{r.c.name}{badge(r)}</b><small>{isW ? (r.c.mk === 'kr' ? '국내 · ' : '해외 · ') : ''}{r.c.tkr ? r.c.tkr + ' · ' : ''}{r.c.sector}</small></span>
      <Spark data={r.sp} />
      <span className="r-px"><b className="num">{priceText(r.c, r.q.price, cur, fx)}</b><small className={'num ' + tone(r.q.chg)}>{pct(r.q.chg)}</small></span>
    </button>
  );
  const idxCard = (id) => {
    const inst = world.instrument(id), q = world.quote(id);
    return (
      <button key={id} type="button" className={'idxcard' + (selected === id ? ' sel' : '')} onClick={() => onSelect(id)}>
        <small>{inst.name}</small>
        <b className="num">{priceText(inst, q.price, cur, fx).replace('pt', '')}</b>
        <span className={'num ' + tone(q.chg)}>{pct(q.chg)}</span>
        <Spark data={world.spark(id)} w={120} h={28} />
      </button>
    );
  };
  return (
    <section className="market" aria-label="시장">
      <div className="seg big" role="tablist" aria-label="시장 선택">
        <button type="button" role="tab" aria-selected={mk === 'kr'} onClick={() => setMk('kr')}>국내</button>
        <button type="button" role="tab" aria-selected={mk === 'us'} onClick={() => setMk('us')}>해외</button>
        <button type="button" role="tab" aria-selected={isW} onClick={() => setMk('watch')}>관심 {watch.length ? watch.length : ''}</button>
      </div>
      {!isW && <div className="idxrow">{idxCard(BIDX[mk])}{idxCard(IDX[mk])}</div>}
      {isW && rows.length === 0 && <p className="note">아직 관심 종목이 없어요. 종목 화면의 ☆ 버튼을 누르면 여기에 모여요.</p>}
      {upcoming.length > 0 && (
        <div className="ipo-note">{upcoming.map((c) => <span key={c.id}>상장 예정 · <b>{c.name}</b> ({c.sector}) {mmdd(c.ipoT)}</span>)}</div>
      )}
      {!isW && (
        <div className="sorts themes" role="group" aria-label="테마">
          <button type="button" aria-pressed={theme === 'all'} onClick={() => setTheme('all')}>전체</button>
          {themes.map((k) => <button key={k} type="button" aria-pressed={theme === k} onClick={() => setTheme(k)}>{THEMES[k].name}</button>)}
          <button type="button" aria-pressed={theme === 'etf'} onClick={() => setTheme('etf')}>ETF</button>
        </div>
      )}
      <div className="sorts" role="group" aria-label="정렬">
        {SORTS.map(([k, l]) => <button key={k} type="button" aria-pressed={sort === k} onClick={() => pickSort(k)} title={k !== 'mine' && sort === k ? '다시 누르면 지금 기준으로 다시 정렬해요' : undefined}>{l}{k !== 'mine' && sort === k ? ' ↻' : ''}</button>)}
      </div>
      {sort === 'mine' && <p className="note sort-hint">⋮⋮를 끌어서 순서를 바꿀 수 있어요. 순서는 가만히 있어요.</p>}
      <DragList rows={stocks} row={row} sortable={sort === 'mine'} onMove={onMove} />
      {etfs.length > 0 && <h3 className="list-h">ETF</h3>}
      <DragList rows={etfs} row={row} sortable={sort === 'mine'} onMove={onMove} />
    </section>
  );
}

/* ---------------- Community ---------------- */
export function CommunityFeed({ posts, world, settings, onSelect, small }) {
  const [f, setF] = useState('all');
  const [open, setOpen] = useState(null);
  const items = posts.filter((p) => f === 'all' || p.mk === f).slice(-(small ? 25 : 120)).reverse();
  return (
    <section className="feed community" aria-label="커뮤니티">
      <div className="sorts" role="group" aria-label="게시판">
        {[['all', '전체'], ['kr', '국장 갤러리'], ['us', '미장 채널']].map(([k, l]) => <button key={k} type="button" aria-pressed={f === k} onClick={() => setF(k)}>{l}</button>)}
      </div>
      {items.length === 0 ? <p className="note">아직 글이 없어요. 장이 열리면 글이 올라와요.</p> : (
        <ul className="posts">
          {items.map((p, i) => {
            const id = p.id || p.t + ':' + i, live = liveCounts(p, world.clock), isOpen = open === id;
            return (
              <li key={id} className={isOpen ? 'open' : ''}>
                <button type="button" className="post" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : id)}>
                  <span className="p-title"><span className={'tag' + (p.tag === '대결' || p.tag === '포착' ? ' hot' : '')}>{p.tag}</span>{p.text}{live.best && <span className="badge hot">개념글</span>}</span>
                  <span className="p-meta"><span>{p.nick}</span><span>{p.board}</span><span className="num">{hhmm(p.t)}</span><span>추천 <b className="num">{live.up}</b></span><span>댓글 <b className="num">{live.cm}</b></span></span>
                </button>
                {isOpen && (
                  <div className="replies">
                    {repliesFor(p).slice(0, Math.max(1, Math.min(6, live.cm))).map((c, j) => <p key={j}><b>{c.nick}</b> {c.text} <small className="num">추천 {Math.round(c.up * (live.cm ? 1 : 0))}</small></p>)}
                    {p.comp && onSelect && <button type="button" className="pill" onClick={() => onSelect(p.comp)}>{(world.instrument(p.comp)?.name || '종목')} 보기 →</button>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="note">가상의 개미들이 남기는 글이에요. 정보가 아니라 분위기예요.</p>
    </section>
  );
}

/* ---------------- Room ---------------- */
const dLeft = (t, now) => Math.ceil((t - now) / 86400);
function LoanForm({ to, onLoan, onDone }) {
  const [amt, setAmt] = useState(''), [rate, setRate] = useState(5), [days, setDays] = useState(30), [plan, setPlan] = useState('weekly'), [err, setErr] = useState(null);
  const n = Number(String(amt).replace(/[^0-9]/g, '')) || 0;
  const total = Math.round(n * (1 + rate / 100)), parts = plan === 'weekly' ? Math.max(1, Math.ceil(days / 7)) : 1;
  return (
    <div className="loan-form">
      <label className="qty"><span>빌려줄 돈</span><input inputMode="numeric" value={n ? n.toLocaleString('ko-KR') : ''} onChange={(e) => setAmt(e.target.value)} placeholder="0" aria-label="빌려줄 금액" /></label>
      <div className="pcts">{[1e6, 1e7, 5e7, 1e8].map((v) => <button key={v} type="button" onClick={() => setAmt(String(v))}>{compact(v)}</button>)}</div>
      <div className="lf-row"><span>이자 (총)</span><div className="seg">{RATES.map((r) => <button key={r} type="button" aria-pressed={rate === r} onClick={() => setRate(r)}>{r}%</button>)}</div></div>
      <div className="lf-row"><span>기간</span><div className="seg">{TERMS.map((d) => <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>{d}일</button>)}</div></div>
      <div className="lf-row"><span>갚는 방식</span><div className="seg">{Object.entries(PLANS).map(([k, l]) => <button key={k} type="button" aria-pressed={plan === k} onClick={() => setPlan(k)}>{l}</button>)}</div></div>
      <p className="note">{n > 0 ? to.nick + '님은 ' + days + '일 동안 ' + won(total) + '을 ' + (parts > 1 ? parts + '번에 나눠 (회당 약 ' + won(Math.floor(total / parts)) + ')' : '만기에 한 번에') + ' 갚아요. 게임 속 날짜 기준이에요.' : '금액을 넣으면 상환 조건이 보여요.'}</p>
      {err && <p className="note cold">{err}</p>}
      <div className="row2">
        <button type="button" className="ghost" onClick={onDone}>취소</button>
        <button type="button" className="cta" disabled={!n} onClick={() => { const r = onLoan('offer', { to, amt: n, rate, days, plan }); if (r && r.err) setErr(r.err); else onDone(); }}>제안 보내기</button>
      </div>
    </div>
  );
}
function LoanCard({ l, world, onLoan }) {
  const [open, setOpen] = useState(false), [amt, setAmt] = useState('');
  const now = world.clock, left = remaining(l), paid = paidOf(l), od = overdue(l, now), nd = nextDue(l, now), sch = schedule(l);
  const borrow = l.role === 'borrow', done = left <= 0;
  const n = Number(String(amt).replace(/[^0-9]/g, '')) || 0;
  let acc = 0;
  return (
    <li className={'loan' + (od > 0 ? ' late' : '') + (done ? ' done' : '')}>
      <div className="ln-h">
        <span><small>{borrow ? l.peerNick + '님에게 빌린 돈' : l.peerNick + '님에게 빌려준 돈'}</small>
          <b className="num">{done ? '다 갚았어요' : (borrow ? '남은 빚 ' : '받을 돈 ') + won(left)}</b></span>
        {od > 0 ? <span className="badge cold">연체 {won(od)}</span> : !done && <span className="badge muted">D-{Math.max(0, dLeft(l.startT + l.days * 86400, now))}</span>}
      </div>
      <div className="ln-bar" aria-label={'상환 ' + Math.round((paid / l.totalDue) * 100) + '%'}><i style={{ width: Math.min(100, (paid / l.totalDue) * 100) + '%' }} /></div>
      <p className="ln-sub">원금 {won(l.amt)} · 이자 {l.rate}% · 총 {won(l.totalDue)} · {PLANS[l.plan]} · {borrow ? '갚은 돈 ' : '받은 돈 '}{won(paid)}</p>
      {!done && nd && <p className={'ln-next' + (nd.late ? ' cold' : '')}>{nd.late ? '밀린 상환' : '다음 상환'} · {shortDate(nd.t, world.startT, true)} ({nd.late ? '지남' : 'D-' + Math.max(0, dLeft(nd.t, now))}) · <b className="num">{won(nd.amt)}</b></p>}
      <button type="button" className="linkish" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? '상환 일정 접기' : '상환 일정 보기 (' + sch.length + '회)'}</button>
      {open && (
        <table className="ln-sch"><thead><tr><th>회차</th><th>날짜</th><th>금액</th><th>상태</th></tr></thead><tbody>
          {sch.map((x, i) => { acc += x.amt; const st = paid >= acc ? '완료' : x.t < now - 86400 ? '연체' : x.t <= now ? '오늘' : '예정'; return <tr key={i} className={st === '연체' ? 'cold' : st === '완료' ? 'muted' : ''}><td className="num">{i + 1}</td><td>{shortDate(x.t, world.startT, true)}</td><td className="num">{won(x.amt)}</td><td>{st}</td></tr>; })}
        </tbody></table>
      )}
      {!done && (borrow ? (
        <div className="ln-act">
          <input inputMode="numeric" value={n ? n.toLocaleString('ko-KR') : ''} onChange={(e) => setAmt(e.target.value)} placeholder="갚을 금액" aria-label="갚을 금액" />
          {nd && <button type="button" className="ghost" onClick={() => onLoan('repay', { id: l.id, amt: nd.amt })}>이번 회차</button>}
          <button type="button" className="ghost" onClick={() => onLoan('repay', { id: l.id, amt: left })}>전액</button>
          <button type="button" className="cta" disabled={!n} onClick={() => { onLoan('repay', { id: l.id, amt: n }); setAmt(''); }}>갚기</button>
        </div>
      ) : od > 0 && <button type="button" className="ghost" onClick={() => onLoan('nudge', { id: l.id })}>독촉하기</button>)}
    </li>
  );
}

export function RoomPanel({ room, world, acct, onLoan, onLeave }) {
  const [copied, setCopied] = useState(false);
  const [lendTo, setLendTo] = useState(null), [req, setReq] = useState('');
  if (!room) return null;
  const list = room.peers.filter((p) => p.presence && p.presence.v === 2).sort((a, b) => (b.presence.ret || 0) - (a.presence.ret || 0));
  const hostId = room.hostId;
  const me = { pid: room.pid, nick: room.nick };
  const inbox = acct && onLoan ? incomingOffers(acct, me, room.peers) : [];
  const loans = acct && acct.loans ? [...acct.loans].sort((a, b) => (remaining(a) > 0 ? 0 : 1) - (remaining(b) > 0 ? 0 : 1) || b.startT - a.startT) : [];
  const owe = loans.filter((l) => l.role === 'borrow').reduce((s, l) => s + remaining(l), 0), due = loans.filter((l) => l.role === 'lend').reduce((s, l) => s + remaining(l), 0);
  const reqN = Number(String(req).replace(/[^0-9]/g, '')) || 0;
  return (
    <section className="room" aria-label="대결 방">
      <div className="room-h">
        <span><small>대결 방</small><b className="num">{room.code}</b></span>
        <button type="button" onClick={() => { try { navigator.clipboard.writeText(room.code).then(() => setCopied(true), () => setCopied(false)); } catch (e) { setCopied(false); } }}>{copied ? '복사됨' : '코드 복사'}</button>
      </div>
      <p className="note">{room.connected ? (room.role === 'host' ? '내가 방장이에요. 시간과 속도는 방장이 정해요.' : '방장의 시계에 맞춰 같이 흘러가요.') : '연결이 잠깐 끊겼어요. 다시 연결하는 중이에요.'}</p>
      <ol className="ranks">
        {list.map((p, i) => {
          const pr = p.presence, trs = pr.trades || [], last = trs[trs.length - 1], ln = pr.ln || {};
          const canLend = !p.isMe && pr.pid && onLoan;
          return (
            <li key={p.id} className={p.isMe ? 'me' : ''}>
              <div className="rk-row">
                <span className="rk num">{i + 1}</span>
                <span className="rn"><b>{pr.nick || '익명'}{p.isMe ? ' (나)' : ''}{p.id === hostId ? ' · 방장' : ''}{ln.od > 0 && <span className="badge cold">연체</span>}</b>
                  <small>{last ? (last[1] === 'b' ? '매수 ' : '매도 ') + last[2] + ' ' + last[3] + '주' : (pr.top || []).map((t) => t[0]).join(', ') || '현금 보유 중'}{ln.d > 0 ? ' · 빚 ' + compact(ln.d) + '원' : ''}{ln.q ? ' · 대출 요청 ' + compact(ln.q) + '원' : ''}</small></span>
                <span className="rr"><b className={'num ' + tone(pr.ret || 0)}>{pct(pr.ret || 0)}</b><small className="num">{compact(pr.total || 0)}원</small></span>
              </div>
              {canLend && lendTo !== pr.pid && <button type="button" className="pill lend-btn" onClick={() => setLendTo(pr.pid)}>돈 빌려주기</button>}
              {canLend && lendTo === pr.pid && <LoanForm to={{ pid: pr.pid, nick: pr.nick || '익명' }} onLoan={onLoan} onDone={() => setLendTo(null)} />}
            </li>
          );
        })}
      </ol>
      {onLoan && acct && (
        <div className="loans">
          <h3>대출</h3>
          {inbox.map((o) => (
            <div key={o.id} className="loan offer">
              <p><b>{o.fromNick}</b>님이 <b className="num">{won(o.amt)}</b>을 빌려주겠대요.</p>
              <p className="ln-sub">{o.days}일 안에 총 {won(o.totalDue)} (이자 {Math.round((o.totalDue / o.amt - 1) * 100)}%) · {PLANS[o.plan]}{o.plan === 'weekly' ? ' · ' + Math.max(1, Math.ceil(o.days / 7)) + '회' : ''}</p>
              <div className="row2"><button type="button" className="ghost" onClick={() => onLoan('decline', o)}>거절</button><button type="button" className="cta" onClick={() => onLoan('accept', o)}>빌리기</button></div>
            </div>
          ))}
          {(acct.loanAccepts || []).map((x) => <p key={x.id} className="note">{x.fromNick}님이 {won(x.amt)}을 보내는 중이에요… (상대가 접속해 있어야 해요)</p>)}
          {(acct.loanOffers || []).map((o) => <p key={o.id} className="note">{o.toNick}님에게 {won(o.amt)} 제안함 · 수락 기다리는 중 <button type="button" className="linkish" onClick={() => onLoan('cancel', o)}>취소</button></p>)}
          {(owe > 0 || due > 0) && <p className="ln-sum">남은 빚 <b className="num cold">{won(owe)}</b> · 받을 돈 <b className="num up">{won(due)}</b></p>}
          {loans.length > 0 && <ul className="loan-list">{loans.slice(0, 12).map((l) => <LoanCard key={l.id} l={l} world={world} onLoan={onLoan} />)}</ul>}
          {loans.some((l) => l.role === 'borrow') && (
            <button type="button" className="setting" aria-pressed={acct.loanAuto !== false} onClick={() => onLoan('auto')}>
              <span className="t"><b>자동 상환</b><small>상환일이 되면 원화 예수금에서 알아서 갚아요</small></span><span className="switch" aria-hidden="true" />
            </button>
          )}
          <div className="ln-req">
            {acct.loanReq ? <p className="note">방에 대출 요청 중 · {won(acct.loanReq)} <button type="button" className="linkish" onClick={() => onLoan('request', { amt: 0 })}>요청 내리기</button></p> : (
              <><input inputMode="numeric" value={reqN ? reqN.toLocaleString('ko-KR') : ''} onChange={(e) => setReq(e.target.value)} placeholder="필요한 돈" aria-label="대출 요청 금액" />
                <button type="button" className="ghost" disabled={!reqN} onClick={() => { onLoan('request', { amt: reqN }); setReq(''); }}>대출 요청 올리기</button></>
            )}
          </div>
          <p className="note">빌려준 돈과 빌린 돈은 이자까지 포함해서 총자산·수익률에 반영돼요. 돈은 원화 예수금으로 오가고, 상대가 방에 접속해 있을 때 주고받아져요.</p>
        </div>
      )}
      <button type="button" className="ghost" onClick={onLeave}>방 나가기 (혼자 계속하기)</button>
    </section>
  );
}

/* ---------------- Stock detail ---------------- */
export function StockDetail({ world, acct, id, cur, theme, tick, onBack, onOrder, desk, news, onWatch, onCancel }) {
  const [tf, setTf] = useState(5);
  const inst = world.instrument(id), q = world.quote(id), fx = world.fx();
  const pos = acct.pos[id];
  const prevTxt = priceText(inst, q.prev, cur, fx);
  const compNews = news.filter((e) => e.comp === id || (e.major && (e.mk === 'all' || e.mk === inst.mk))).slice(-12).reverse();
  const native = inst.mk === 'us' && !inst.index && cur === 'KRW' ? usd(q.price ?? 0) : inst.mk === 'us' && !inst.index ? won((q.price ?? 0) * fx) : null;
  return (
    <section className="detail" aria-label={inst.name}>
      <div className="d-top">
        {!desk && <button type="button" className="iconbtn ghostbtn" onClick={onBack} aria-label="목록으로">{Icon.back}</button>}
        <div className="d-title"><h2>{inst.name}</h2><small>{inst.tkr ? inst.tkr + ' · ' : ''}{inst.sector}{q.sess ? ' · ' + q.sess.long : ' · 장 마감'}</small></div>
        {!inst.index && onWatch && <button type="button" className={'iconbtn star' + (acct.watch.includes(id) ? ' on' : '')} aria-pressed={acct.watch.includes(id)} aria-label="관심 종목" onClick={() => onWatch(id)}>{acct.watch.includes(id) ? '★' : '☆'}</button>}
      </div>
      <div className="d-px">
        <span className="big num">{priceText(inst, q.price, cur, fx)}</span>
        <span className={'num ' + tone(q.chg)}>{diffText(inst, q.price != null && q.prev ? q.price - q.prev : null, cur, fx)} ({pct(q.chg)})</span>
        <small className="muted">전일 종가 {prevTxt} 대비{native ? ' · ' + native : ''}</small>
      </div>
      <div className="chartbox">
        <div className="tools">
          <div className="seg" role="group" aria-label="봉 단위">
            {[[1, '1분'], [5, '5분'], ['D', '일']].map(([k, l]) => <button key={k} type="button" aria-pressed={tf === k} onClick={() => setTf(k)}>{l}</button>)}
          </div>
          <span className="legend-dot"><i />시간외</span>
        </div>
        <Chart world={world} id={id} tf={tf} tick={tick} theme={theme} height={desk ? 380 : 280} mk={inst.mk} />
        {inst.mk === 'us' && !inst.index && <p className="note">차트는 달러 기준이에요.</p>}
      </div>
      <dl className="facts">
        <div><dt>고가</dt><dd className="num">{priceText(inst, q.hi, cur, fx)}</dd></div>
        <div><dt>저가</dt><dd className="num">{priceText(inst, q.lo, cur, fx)}</dd></div>
        <div><dt>거래량</dt><dd className="num">{compact(q.vol)}{inst.index ? '' : '주'}</dd></div>
        <div><dt>전일 종가</dt><dd className="num">{prevTxt}</dd></div>
      </dl>
      {pos && (
        <div className="holding">
          <h3>내 보유</h3>
          <div className="kv"><span>수량</span><b className="num">{pos.q}주</b></div>
          <div className="kv"><span>평균 단가</span><b className="num">{priceText(inst, pos.cost / pos.q, cur, fx)}</b></div>
          <div className="kv"><span>평가금액</span><b className="num">{priceText(inst, (q.price ?? 0) * pos.q, cur, fx)}</b></div>
          <div className="kv"><span>손익</span><b className={'num ' + tone((q.price ?? 0) * pos.q - pos.cost)}>{diffText(inst, (q.price ?? 0) * pos.q - pos.cost, cur, fx)} ({pct(((q.price ?? 0) * pos.q) / pos.cost - 1)})</b></div>
        </div>
      )}
      <PendingOrders world={world} acct={acct} cur={cur} onCancel={onCancel} only={id} />
      {inst.desc && <p className="desc">{inst.desc}</p>}
      <div className="cnews">
        <h3>관련 뉴스</h3>
        {compNews.length === 0 ? <p className="note">아직 관련 뉴스가 없어요.</p> : <NewsItems items={compNews} world={world} hideYear />}
      </div>
      {!desk && !inst.index && (
        <div className="tradebar">
          <button type="button" className="trade sell" disabled={!pos} onClick={() => onOrder('sell')}>매도</button>
          <button type="button" className="trade buy" onClick={() => onOrder('buy')}>매수</button>
        </div>
      )}
    </section>
  );
}

/* ---------------- Order ---------------- */
export function OrderPanel({ world, acct, id, side, setSide, cur, onDone, onLimit, tick, inline }) {
  const [type, setType] = useState('market'); // 'market' | 'limit'
  const [mode, setMode] = useState('pct'); // 'pct' | 'qty'
  const [pctV, setPctV] = useState(0.5);
  const [qty, setQty] = useState('');
  const [lp, setLp] = useState('');
  const [msg, setMsg] = useState(null);
  const inst = world.instrument(id), fx = world.fx();
  if (!inst || inst.index) return <div className="order empty"><p className="note">종목을 고르면 여기서 주문할 수 있어요.</p></div>;
  const cur0 = world.priceOf(id);
  const limitPx = lp === '' ? cur0 : Number(lp);
  const amount = mode === 'pct' ? pctV : Number(qty) || 0;
  const est = type === 'market' ? quoteOrder(acct, world, id, side, amount, mode === 'pct') : quoteLimit(acct, world, id, side, limitPx, amount, mode === 'pct');
  const unit = (v) => (inst.mk === 'kr' ? won(v) : moneyU(v, cur, fx));
  const free = (acct.pos[id]?.q || 0) - (acct.pos[id]?.locked || 0);
  const band = limitBand(world, id);
  const step = (dir) => { const base = lp === '' ? cur0 : Number(lp) || cur0; const t = tickOf(world, id, base); setLp(String(inst.mk === 'kr' ? Math.round(base / t) * t + dir * t : Math.round((base + dir * t) * 100) / 100)); setMsg(null); };
  const submit = () => {
    const r = type === 'market' ? onDone(id, side, amount, mode === 'pct') : onLimit(id, side, limitPx, amount, mode === 'pct');
    if (!r.ok) setMsg(r.reason);
    else if (type === 'market') setMsg((side === 'buy' ? '매수 ' : '매도 ') + r.qty + '주 체결됐어요.');
    else setMsg('지정가 ' + (side === 'buy' ? '매수 ' : '매도 ') + r.qty + '주 주문을 넣었어요. 가격에 닿으면 체결돼요.');
  };
  const label = !est.ok ? (est.reason || '주문할 수 없어요') : (type === 'limit' ? '지정가 ' : '') + est.qty + '주 ' + (side === 'buy' ? '매수' : '매도');
  return (
    <div className={'order' + (inline ? ' inline' : '')}>
      <div className="seg big" role="tablist" aria-label="매수 또는 매도">
        <button type="button" role="tab" aria-selected={side === 'buy'} className="t-buy" onClick={() => { setSide('buy'); setMsg(null); }}>매수</button>
        <button type="button" role="tab" aria-selected={side === 'sell'} className="t-sell" onClick={() => { setSide('sell'); setMsg(null); }}>매도</button>
      </div>
      <div className="seg" role="group" aria-label="주문 방식">
        <button type="button" aria-pressed={type === 'market'} onClick={() => { setType('market'); setMsg(null); }}>시장가</button>
        <button type="button" aria-pressed={type === 'limit'} onClick={() => { setType('limit'); setLp(''); setMsg(null); }}>지정가</button>
      </div>
      <div className="kv"><span>{inst.name}</span><b className="num">{type === 'market' ? (est.px != null ? '예상 ' + priceText(inst, est.px, cur, fx) : '-') : '현재 ' + priceText(inst, cur0, cur, fx)}</b></div>
      {type === 'limit' && (
        <>
          <div className="qty price">
            <button type="button" className="tick" onClick={() => step(-1)} aria-label="한 호가 내리기">−</button>
            <input id="order-price" inputMode="decimal" value={lp === '' ? String(cur0 ?? '') : lp} onChange={(e) => { setLp(e.target.value.replace(/[^0-9.]/g, '')); setMsg(null); }} aria-label={'주문 가격 (' + (inst.mk === 'kr' ? '원' : '달러') + ')'} />
            <span>{inst.mk === 'kr' ? '원' : '$'}</span>
            <button type="button" className="tick" onClick={() => step(1)} aria-label="한 호가 올리기">+</button>
          </div>
          <p className="note">{band ? '주문 가능 범위 ' + won(band.lo) + ' ~ ' + won(band.hi) + ' · ' : ''}당일 장이 끝날 때까지 유효해요. 가격이 닿으면 그 가격(또는 더 유리한 가격)에 체결돼요.</p>
        </>
      )}
      <p className="note">{side === 'buy' ? '주문 가능 ' + (inst.mk === 'kr' ? won(availKrw(acct)) : usd(availUsd(acct)) + ' + 원화 ' + won(availKrw(acct))) : '팔 수 있는 수량 ' + free + '주'}</p>
      <div className="pcts" role="group" aria-label="주문 비율">
        {[0.1, 0.25, 0.5, 1].map((p) => <button key={p} type="button" aria-pressed={mode === 'pct' && pctV === p} onClick={() => { setMode('pct'); setPctV(p); setMsg(null); }}>{p === 1 ? '전부' : p * 100 + '%'}</button>)}
      </div>
      <label className="qty"><span>수량</span>
        <input id="order-qty" inputMode="numeric" value={mode === 'qty' ? qty : est.qty || ''} onChange={(e) => { setMode('qty'); setQty(e.target.value.replace(/[^0-9]/g, '')); setMsg(null); }} placeholder="0" />
        <span>주</span>
      </label>
      <div className="kv"><span>{side === 'buy' ? '예상 결제 금액' : '예상 받을 금액'}</span><b className="num">{est.total != null ? unit(est.total) : '-'}</b></div>
      <div className="kv sub"><span>수수료{est.tax ? ' · 거래세' : ''}</span><b className="num">{est.fees != null ? unit((est.fees || 0) + (est.tax || 0)) : '-'}</b></div>
      {est.convertKrw > 0 && <div className="kv sub"><span>자동 환전 (원화 → 달러)</span><b className="num">{won(est.convertKrw)}</b></div>}
      <button type="button" className={'trade wide ' + side} disabled={!est.ok} onClick={submit}>{label}</button>
      {msg && <p className="note" role="status">{msg}</p>}
      <p className="note">{type === 'market' ? '시간외 세션은 호가 간격이 넓어 더 불리하게 체결돼요. ' : ''}수수료·세금은 근사치예요.</p>
    </div>
  );
}

export function PendingOrders({ world, acct, cur, onCancel, only }) {
  const list = acct.orders.filter((o) => !only || o.id === only);
  if (!list.length) return null;
  const fx = world.fx();
  return (
    <div className="pending">
      <h3>미체결 주문</h3>
      <ul>
        {list.map((o) => {
          const inst = world.instrument(o.id);
          return (
            <li key={o.oid}>
              <span className={o.side === 'buy' ? 'up' : 'down'}>{o.side === 'buy' ? '매수' : '매도'}</span>
              <span className="p-name">{only ? '' : inst.name + ' '}{o.qty}주 · {priceText(inst, o.px, cur, fx)}</span>
              {onCancel && <button type="button" onClick={() => onCancel(o.oid)}>취소</button>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------------- Account ---------------- */
export function AccountView({ world, acct, cur, setCur, onSelect, onExchange, onCancel, tick, theme }) {
  const v = valuation(acct, world), fx = v.fx;
  const m = (x) => moneyK(x, cur, fx);
  return (
    <section className="account" aria-label="내 계좌">
      <div className="acct-top">
        <small>총자산</small>
        <span className="big num">{m(v.totalKrw)}</span>
        <span className={'num ' + tone(v.ret)}>{diffText({ mk: 'kr' }, v.totalKrw - acct.startKrw, 'KRW', fx)} ({pct(v.ret)})</span>
        <div className="seg" role="group" aria-label="표시 통화"><button type="button" aria-pressed={cur === 'KRW'} onClick={() => setCur('KRW')}>원화</button><button type="button" aria-pressed={cur === 'USD'} onClick={() => setCur('USD')}>달러</button></div>
      </div>
      <dl className="facts">
        <div><dt>원화 예수금</dt><dd className="num">{won(acct.krw)}</dd>{acct.holdKrw > 0 && <small className="note">주문 가능 {won(availKrw(acct))}</small>}</div>
        <div><dt>달러 예수금</dt><dd className="num">{usd(acct.usd)}</dd>{acct.holdUsd > 0 && <small className="note">주문 가능 {usd(availUsd(acct))}</small>}</div>
        <div><dt>국내 주식</dt><dd className="num">{won(v.krStock)}</dd></div>
        <div><dt>해외 주식</dt><dd className="num">{moneyU(v.usStock, cur, fx)}</dd></div>
      </dl>
      <button type="button" className="ghost" onClick={onExchange}>환전하기 · 1달러 {num2(fx)}원</button>
      {acct.eq.length > 1 && <EquityLine acct={acct} theme={theme} />}
      <PendingOrders world={world} acct={acct} cur={cur} onCancel={onCancel} />
      <h3>보유 종목</h3>
      {v.rows.length === 0 ? <p className="note">아직 보유한 종목이 없어요. 시장 탭에서 종목을 눌러 사 보세요.</p> : (
        <ul className="list">
          {v.rows.map((r) => (
            <li key={r.id}><button type="button" className="row" onClick={() => onSelect(r.id)}>
              <span className="r-name"><b>{r.inst.name}</b><small>{r.q}주 · 평균 {priceText(r.inst, r.avg, cur, fx)}</small></span>
              <span className="r-px"><b className="num">{priceText(r.inst, r.value, cur, fx)}</b><small className={'num ' + tone(r.pnl)}>{diffText(r.inst, r.pnl, cur, fx)} ({pct(r.ret)})</small></span>
            </button></li>
          ))}
        </ul>
      )}
      <h3>최근 거래</h3>
      {acct.trades.length === 0 ? <p className="note">거래 내역이 없어요.</p> : (
        <ul className="trades">
          {acct.trades.slice(-20).reverse().map((t, i) => {
            const inst = world.instrument(t.id);
            return <li key={i}><time className="num">{shortDate(t.t, world.startT, true)} {hhmm(t.t)}</time><span className={t.side === 'buy' ? 'up' : 'down'}>{t.side === 'buy' ? '매수' : '매도'}</span><span>{inst?.name} {t.qty}주</span><b className="num">{inst ? priceText(inst, t.px, cur, fx) : ''}</b></li>;
          })}
        </ul>
      )}
    </section>
  );
}

function EquityLine({ acct }) {
  const data = acct.eq.slice(-240).map((e) => e.v);
  return <div className="eqline"><small>일별 총자산 추이</small><Spark data={data} w={320} h={70} /></div>;
}

/* ---------------- News ---------------- */
export function NewsItems({ items, world, hideYear }) {
  return (
    <ul className="news">
      {items.map((e, i) => (
        <li key={e.t + ':' + i} className={e.major ? 'major' : ''}>
          <time className="num">{shortDate(e.t, world.startT, hideYear)} {hhmm(e.t)}{e.mk !== 'all' ? ' · ' + (e.mk === 'kr' ? '국내' : '해외') : ''}</time>
          <p><span className={'tag' + (e.major ? ' major' : '')}>{e.tag}</span>{e.text}</p>
        </li>
      ))}
    </ul>
  );
}
export function NewsFeed({ world, news, settings, compact: small }) {
  const [f, setF] = useState('all');
  const items = news.filter((e) => f === 'all' || (f === 'major' ? e.major : e.mk === f || e.mk === 'all')).slice(-(small ? 30 : 150)).reverse();
  return (
    <section className="feed" aria-label="뉴스">
      <div className="sorts" role="group" aria-label="뉴스 필터">
        {[['all', '전체'], ['major', '주요'], ['kr', '국내'], ['us', '해외']].map(([k, l]) => <button key={k} type="button" aria-pressed={f === k} onClick={() => setF(k)}>{l}</button>)}
      </div>
      {items.length === 0 ? <p className="note">아직 뉴스가 없어요. 시간이 흐르면 속보와 찌라시가 쌓여요.</p> : <NewsItems items={items} world={world} hideYear={settings.hideYear} />}
    </section>
  );
}

/* ---------------- Sheets ---------------- */
export function Sheet({ title, onClose, children }) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-h"><h2>{title}</h2><button type="button" className="iconbtn" onClick={onClose} aria-label="닫기">✕</button></div>
        {children}
      </div>
    </>
  );
}

export function ExchangePanel({ world, acct, onExchange }) {
  const [dir, setDir] = useState('toUsd');
  const [amt, setAmt] = useState('');
  const [msg, setMsg] = useState(null);
  const fx = world.fx(), a = Number(amt) || 0;
  const out = dir === 'toUsd' ? a / (fx * (1 + FX_SPREAD)) : a * fx * (1 - FX_SPREAD);
  return (
    <div className="order">
      <div className="seg big" role="tablist" aria-label="환전 방향">
        <button type="button" role="tab" aria-selected={dir === 'toUsd'} onClick={() => setDir('toUsd')}>원화 → 달러</button>
        <button type="button" role="tab" aria-selected={dir === 'toKrw'} onClick={() => setDir('toKrw')}>달러 → 원화</button>
      </div>
      <p className="note">기준 환율 {num2(fx)}원 · 환전 수수료 {FX_SPREAD * 100}% (근사치)</p>
      <label className="qty"><span>{dir === 'toUsd' ? '바꿀 원화' : '바꿀 달러'}</span>
        <input id="fx-amt" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0" />
        <span>{dir === 'toUsd' ? '원' : '$'}</span>
      </label>
      <div className="pcts">{[0.25, 0.5, 1].map((p) => <button key={p} type="button" onClick={() => setAmt(String(dir === 'toUsd' ? Math.floor(acct.krw * p) : Math.floor(acct.usd * p * 100) / 100))}>{p === 1 ? '전부' : p * 100 + '%'}</button>)}</div>
      <div className="kv"><span>받을 금액</span><b className="num">{dir === 'toUsd' ? usd(out) : won(out)}</b></div>
      <button type="button" className="cta" disabled={a <= 0} onClick={() => { onExchange(dir, a); setAmt(''); setMsg('환전했어요.'); }}>환전하기</button>
      {msg && <p className="note" role="status">{msg}</p>}
    </div>
  );
}

export function SettingsPanel({ settings, setSettings, world, onNew }) {
  const [confirm, setConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const toggle = (k, title, sub) => (
    <button type="button" className="setting" aria-pressed={!!settings[k]} onClick={() => setSettings({ ...settings, [k]: !settings[k] })}>
      <span className="t"><b>{title}</b><small>{sub}</small></span><span className="switch" aria-hidden="true" />
    </button>
  );
  return (
    <div className="settings-p">
      <div className="settings">
        <button type="button" className="setting" aria-pressed={settings.theme === 'light'} onClick={() => setSettings({ ...settings, theme: settings.theme === 'light' ? 'dark' : 'light' })}>
          <span className="t"><b>라이트 모드</b><small>끄면 다크 모드예요</small></span><span className="switch" aria-hidden="true" />
        </button>
        {settings.lockYear ? <p className="note">미지의 국면 모드라 연도는 항상 숨겨져요.</p> : toggle('hideYear', '연도 숨기기', "몇 년도인지 모르게 '1년차'로 표시해요")}
        {toggle('pause', '주요 뉴스에 일시정지', '찌라시·단신은 멈추지 않아요')}
        {toggle('sound', '효과음', '체결·속보·장 시작 종·강화 소리')}
        {settings.sound !== false && (
          <label className="setting vol"><span className="t"><b>효과음 크기</b></span>
            <input type="range" min="0" max="1" step="0.05" value={settings.vol ?? 0.5} onChange={(e) => setSettings({ ...settings, vol: Number(e.target.value) })} onPointerUp={() => sound.play('fill')} aria-label="효과음 크기" />
          </label>
        )}
      </div>
      <div className="codebox"><span><small>세계 코드</small><b className="num">{world.seed}</b></span>
        <button type="button" onClick={() => { try { navigator.clipboard.writeText(world.seed).then(() => setCopied(true), () => setCopied(false)); } catch (e) { setCopied(false); } }}>{copied ? '복사됨' : '복사'}</button></div>
      <p className="note">친구가 새 캠페인을 시작할 때 이 코드를 넣으면 같은 세계(같은 시작일, 같은 주가와 뉴스)에서 시작해요. 시간외 설정도 같아야 해요.</p>
      {!confirm ? <button type="button" className="ghost danger" onClick={() => setConfirm(true)}>새 캠페인 시작</button> : (
        <div className="confirm"><p>지금 캠페인은 지워져요. 새로 시작할까요?</p><div className="row2"><button type="button" className="ghost" onClick={() => setConfirm(false)}>취소</button><button type="button" className="ghost danger" onClick={onNew}>지우고 새로 시작</button></div></div>
      )}
    </div>
  );
}

/* ---------------- Start ---------------- */
export function StartScreen({ saveInfo, onContinue, onStart, onCreateRoom, onJoinRoom, roomMsg, busy, lobby = { status: 'none', rooms: [] } }) {
  const [opt, setOpt] = useState({ mode: 'history', hideYear: true, ext: true, pause: true, code: '', cash: 10000000, pub: true });
  const [nick, setNick] = useState(() => { try { return localStorage.getItem('rewind.nick') || ''; } catch (e) { return ''; } });
  const [joinCode, setJoinCode] = useState('');
  const nickOk = nick.trim().length > 0;
  const saveNick = () => { try { localStorage.setItem('rewind.nick', nick.trim()); } catch (e) { /* storage unavailable */ } };
  const cashOk = opt.cash >= 100000 && opt.cash <= 100000000000;
  const tg = (k, title, sub) => (
    <button type="button" className="setting" aria-pressed={opt[k]} onClick={() => setOpt({ ...opt, [k]: !opt[k] })}>
      <span className="t"><b>{title}</b><small>{sub}</small></span><span className="switch" aria-hidden="true" />
    </button>
  );
  return (
    <main className="start">
      <div className="brand"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 19l-7-7 7-7" /><path d="M20 19l-7-7 7-7" /></svg>되감기<span className="chip">반도체</span></div>
      <h1>2019년 어느 날,<br />반도체 시장으로 돌아갑니다.</h1>
      <p className="lede">언제 무슨 일이 터질지는 몰라요. 실제로 있었던 국면 위에서 가상의 반도체 회사 20여 곳과 레버리지 ETF를 국내·해외 장 구분 없이 사고팔아요. 지금 이후의 미래도 계속 이어져요.</p>
      {saveInfo && (
        <button type="button" className="continue" onClick={onContinue}>
          <span><small>이어하기{saveInfo.mode === 'unknown' ? ' · 미지의 국면' : ''}</small><b>{saveInfo.date}</b></span><span className="num">{saveInfo.total}</span>
        </button>
      )}
      <div className="seg big mode-pick" role="radiogroup" aria-label="모드">
        <button type="button" role="radio" aria-checked={opt.mode === 'history'} aria-pressed={opt.mode === 'history'} onClick={() => setOpt({ ...opt, mode: 'history' })}>역사 그대로</button>
        <button type="button" role="radio" aria-checked={opt.mode === 'unknown'} aria-pressed={opt.mode === 'unknown'} onClick={() => setOpt({ ...opt, mode: 'unknown' })}>미지의 국면</button>
      </div>
      <p className="note mode-note">{opt.mode === 'history'
        ? '실제 날짜와 순서 그대로 흘러가요. 2026년 11월 이후는 가상의 미래예요.'
        : '실제 국면이 같은 순서로 오지만 언제, 얼마나 빨리 올지는 매번 달라요. 대체로 더 빠르게 지나가고, 가상의 대형 사건이 수시로 끼어들어요. 연도는 항상 숨겨져요.'}</p>
      <div className="settings">
        {opt.mode === 'history' && tg('hideYear', '연도 숨기기', "몇 년도인지 모르게 '1년차'로 표시해요")}
        {tg('ext', '시간외 세션 포함', '그 시기에 열렸던 프리·애프터·데이마켓까지 흘러가요')}
        {tg('pause', '주요 뉴스에 일시정지', '속보가 나오면 멈춰요')}
      </div>
      <div className="cashbox">
        <label className="qty"><span>시작 자금</span>
          <input id="start-cash" inputMode="numeric" value={opt.cash ? opt.cash.toLocaleString('ko-KR') : ''} onChange={(e) => setOpt({ ...opt, cash: Number(e.target.value.replace(/[^0-9]/g, '')) || 0 })} />
          <span>원</span>
        </label>
        <div className="pcts" role="group" aria-label="시작 자금 빠른 선택">
          {[[1000000, '100만'], [10000000, '1천만'], [50000000, '5천만'], [100000000, '1억'], [1000000000, '10억']].map(([v, l]) => <button key={v} type="button" aria-pressed={opt.cash === v} onClick={() => setOpt({ ...opt, cash: v })}>{l}</button>)}
        </div>
        {!cashOk && <p className="note warn">시작 자금은 10만 원에서 1,000억 원 사이로 정해 주세요.</p>}
      </div>
      <label className="qty code"><span>세계 코드 (선택)</span><input id="world-code" value={opt.code} onChange={(e) => setOpt({ ...opt, code: e.target.value.trim() })} placeholder="비우면 새 세계" autoComplete="off" /></label>
      <button type="button" className="cta" disabled={!cashOk} onClick={() => onStart(opt)}>{(saveInfo ? '새 캠페인 시작 · ' : '시작하기 · ') + won(opt.cash)}</button>
      {saveInfo && <p className="note">새로 시작하면 이어하던 캠페인은 지워져요.</p>}
      <section className="roombox" aria-labelledby="room-h">
        <h2 id="room-h">친구와 실시간 대결</h2>
        <p className="note">같은 방에 들어온 사람들은 같은 시계, 같은 주가, 같은 뉴스를 함께 봐요. 방장이 시간을 흘려보내고, 서로의 수익률과 매매가 실시간으로 보여요. 끝은 없어요. 그만두고 싶을 때 나가면 돼요.</p>
        <label className="qty"><span>닉네임</span><input id="nick" value={nick} maxLength={16} onChange={(e) => setNick(e.target.value)} placeholder="방에서 보일 이름" autoComplete="off" /></label>
        <div className="lobby" aria-live="polite">
          <h3>지금 열린 방{lobby.status === 'ok' && lobby.rooms.length > 0 ? ' ' + lobby.rooms.length : ''}</h3>
          {lobby.status === 'loading' && <p className="note">방 목록을 불러오는 중이에요…</p>}
          {lobby.status === 'none' && <p className="note">이 주소에서는 실시간 서버에 연결할 수 없어요.</p>}
          {lobby.status === 'ok' && lobby.rooms.length === 0 && <p className="note">아직 열린 방이 없어요. 방을 만들면 여기 들어온 누구나 바로 참가할 수 있어요.</p>}
          {lobby.rooms.length > 0 && (
            <ul className="lobby-list">
              {lobby.rooms.map((r) => (
                <li key={r.code}>
                  <span className="lb-info"><b>{r.nick}의 방 <small className="num">{r.n}명</small></b>
                    <small>{r.mode === 'unknown' ? '미지의 국면 · ' : ''}{r.startT ? dateText(r.clock, r.startT, true) : ''} · 시작 자금 {compact(r.cash)}원 · {r.speed ? '진행 중' : '일시정지'}{r.ext ? '' : ' · 정규장만'}</small></span>
                  <button type="button" className="ghost" disabled={!nickOk || busy} onClick={() => { saveNick(); onJoinRoom(r.code, nick.trim()); }}>참가</button>
                </li>
              ))}
            </ul>
          )}
          {lobby.rooms.length > 0 && !nickOk && <p className="note">닉네임을 적으면 참가할 수 있어요.</p>}
        </div>
        {tg('pub', '열린 방 목록에 공개', '끄면 방 코드를 아는 사람만 들어올 수 있어요')}
        <button type="button" className="ghost" disabled={!nickOk || !cashOk || busy} onClick={() => { saveNick(); onCreateRoom(opt, nick.trim()); }}>방 만들기 (위 설정·시작 자금으로)</button>
        <div className="code-join">
          <label className="qty"><span>방 코드로 참가</span><input id="join-code" value={joinCode} maxLength={6} onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="6자리" autoComplete="off" /></label>
          <button type="button" className="ghost" disabled={!nickOk || joinCode.length !== 6 || busy} onClick={() => { saveNick(); onJoinRoom(joinCode, nick.trim()); }}>참가</button>
        </div>
        {roomMsg && <p className="note warn" role="status">{roomMsg}</p>}
      </section>
      <p className="note">회사·상품·주가는 모두 가상이에요. 날짜와 배경 사건은 실제 반도체 국면(2019~2026년 11월 3일)을 따르고, 변동폭은 실제보다 크게 잡았어요. 그 이후는 매번 다르게 만들어지는 가상의 미래예요. 진행 상황은 이 브라우저에 자동 저장돼요.</p>
    </main>
  );
}

export function SyncScreen({ code, msg, progress, onCancel }) {
  return (
    <main className="start sync">
      <h1>방 {code}</h1>
      <p className="lede">{msg}</p>
      {progress != null && <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><i style={{ width: Math.round(progress * 100) + '%' }} /></div>}
      <button type="button" className="ghost" onClick={onCancel}>취소</button>
    </main>
  );
}

/* ---------------- 강화소 (mini-game) ---------------- */
const FORGE_TEXT = { success: '강화 성공!', stay: '강화 실패 · 단계 유지', drop: '강화 실패 · 단계 하락', break: '주권이 파괴됐어요…', buy: '새 황금 주권을 샀어요', sell: '판매 완료' };
export function ForgePanel({ acct, onForge }) {
  const f = acct.forge || { item: null, stats: { spent: 0, earned: 0, best: 0, broke: 0, tries: 0 } };
  const [shown, setShown] = useState(f.item ? { ...f.item } : null); // what the card shows (lags behind during the suspense)
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(null), [fx, setFx] = useState('');
  const [statSnap, setStatSnap] = useState(null); // frozen during the suspense so the result isn't spoiled
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { if (!busy) setShown(f.item ? { ...f.item } : null); }, [busy, f.item, f.item && f.item.lv]); // eslint-disable-line react-hooks/exhaustive-deps
  const it = shown, cash = Math.max(0, acct.krw - (acct.holdKrw || 0));
  const act = (kind, base) => {
    if (busy) return;
    const before = { ...f.stats };
    const r = onForge(kind, base);
    if (!r) return;
    if (r.err) { setMsg({ text: r.err, tone: 'cold' }); return; }
    if (kind !== 'try') { setMsg({ text: FORGE_TEXT[r.res] + (r.value ? ' · ' + won(r.value) : ''), tone: '' }); setShown(acct.forge.item ? { ...acct.forge.item } : null); return; }
    setStatSnap(before);
    setBusy(true); setFx('charging'); setMsg({ text: '강화 중…', tone: '' });
    timer.current = setTimeout(() => {
      const after = acct.forge.item;
      setBusy(false); setStatSnap(null); setFx(r.res); setShown(after ? { ...after } : null);
      setMsg({ text: FORGE_TEXT[r.res] + (r.res === 'success' ? ' +' + after.lv : ''), tone: r.res === 'success' ? 'up' : r.res === 'stay' ? '' : 'cold' });
      sound.play(r.res === 'success' ? (after.lv >= 10 ? 'forgeBig' : 'forgeOk') : r.res === 'break' ? 'forgeBreak' : r.res === 'drop' ? 'forgeDrop' : 'forgeFail');
      timer.current = setTimeout(() => setFx(''), 900);
    }, 650);
  };
  const o = it ? odds(it.lv) : null, cost = it ? costAt(it.base, it.lv) : 0, value = it ? valueAt(it.base, it.lv) : 0;
  const pctx = (x) => (x * 100).toFixed(x < 0.1 && x > 0 ? 1 : 0) + '%';
  const S = busy && statSnap ? statSnap : f.stats;
  const net = S.earned + (it ? value : 0) - S.spent; // includes what the certificate in hand is worth
  return (
    <div className="forge">
      <p className="note">황금 주권을 사서 한 단계씩 강화해요. 단계가 오를수록 비싸게 팔 수 있지만, 실패하면 그대로이거나 10단계부터는 떨어지고, 12단계부터는 부서질 수 있어요. 비용과 판매 대금은 원화 예수금으로 오가요.</p>
      {it ? (
        <>
          <div className={'f-card ' + fx} aria-live="polite">
            <span className="f-name">황금 주권</span>
            <b className="f-lv num">+{it.lv}</b>
            <span className="f-pips" aria-hidden="true">{Array.from({ length: MAX_LV }, (_, i) => <i key={i} className={i < it.lv ? 'on' : ''} />)}</span>
            <span className="f-val">판매가 <b className="num">{won(value)}</b></span>
          </div>
          {it.lv < MAX_LV ? (
            <div className="f-odds">
              <span>성공 <b className="num up">{pctx(o.success)}</b></span>
              <span>유지 <b className="num">{pctx(o.stay)}</b></span>
              {o.drop > 0 && <span>하락 <b className="num cold">{pctx(o.drop)}</b></span>}
              {o.break > 0 && <span>파괴 <b className="num cold">{pctx(o.break)}</b></span>}
            </div>
          ) : <p className="note">최고 단계예요. 이제 팔기만 하면 돼요.</p>}
          {msg && <p className={'f-msg ' + (msg.tone || '')}>{msg.text}</p>}
          <div className="row2">
            <button type="button" className="ghost" disabled={busy} onClick={() => act('sell')}>판매 · {won(value)}</button>
            <button type="button" className="cta" disabled={busy || it.lv >= MAX_LV || cash < cost} onClick={() => act('try')}>{busy ? '강화 중…' : '강화 · ' + won(cost)}</button>
          </div>
        </>
      ) : (
        <>
          {msg && <p className={'f-msg ' + (msg.tone || '')}>{msg.text}</p>}
          <h3>황금 주권 사기</h3>
          <div className="f-tiers">
            {TIERS.map((b) => <button key={b} type="button" className="ghost" disabled={cash < b} onClick={() => act('buy', b)}>{won(b)}<small>+10이면 {compact(valueAt(b, 10))}원</small></button>)}
          </div>
        </>
      )}
      <div className="f-stats">
        <span>원화 예수금 <b className="num">{won(cash)}</b></span>
        <span>누적 손익 (들고 있는 주권 가치 포함) <b className={'num ' + tone(net)}>{(net >= 0 ? '+' : '') + won(net)}</b></span>
        <span>최고 <b className="num">+{S.best}</b> · 시도 <b className="num">{S.tries}</b> · 파괴 <b className="num">{S.broke}</b></span>
      </div>
    </div>
  );
}
