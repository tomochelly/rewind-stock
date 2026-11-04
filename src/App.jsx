import { useCallback, useEffect, useRef, useState } from 'react';
import { World, randomStart, IDX, BIDX } from './engine/world.js';
import { dateOf, DAY } from './engine/calendar.js';
import { newAccount, normalizeAccount, execute, exchange, valuation, placeLimit, cancelOrder, processOrders, toggleWatch, sweepDelisted, availKrw } from './engine/account.js';
import { newForge, buyItem, enhance, sellItem, costAt } from './minigame/forge.js';
import { sound } from './ui/sound.js';
import { newCommunity, communityTick } from './engine/community.js';
import { openRoom, newRoomCode } from './net/room.js';
import { hostOf, myPresence, targetClock } from './net/match.js';
import { lobbyLink, lobbyRooms, lobbyAd } from './net/lobby.js';
import { ClockBar, MarketList, StockDetail, OrderPanel, AccountView, NewsFeed, Sheet, ExchangePanel, SettingsPanel, StartScreen, CommunityFeed, RoomPanel, SyncScreen, ForgePanel } from './ui/views.jsx';
import { dateText, won, priceText } from './ui/format.js';

const SAVE_KEY = 'rewind.campaign.v1';
const SET_KEY = 'rewind.settings.v1';
const roomKey = (code) => 'rewind.room.' + code;
const store = {
  get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } },
};

function useMedia(q) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q).matches : false);
  useEffect(() => { const mq = window.matchMedia(q); const f = () => setM(mq.matches); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); }, [q]);
  return m;
}

const DEFAULT_SETTINGS = { theme: 'dark', cur: 'USD', hideYear: true, pause: true, sound: true, vol: 0.5 };
const NO_ROOM_MSG = '실시간 서버에 연결할 수 없어요. `npm run dev`나 `npm start`로 띄운 주소에서 열어 주세요.';

export default function App() {
  const [settings, setSettingsState] = useState(() => ({ ...DEFAULT_SETTINGS, ...(store.get(SET_KEY) || {}) }));
  const setSettings = (s) => { setSettingsState(s); store.set(SET_KEY, s); };
  const setCur = (cur) => setSettings({ ...settings, cur });
  const worldRef = useRef(null), acctRef = useRef(null), commRef = useRef(null), roomRef = useRef(null);
  const [phase, setPhase] = useState('start'); // start | sync | play
  const [saveInfo, setSaveInfo] = useState(null);
  const [tick, setTick] = useState(0);
  const [speed, setSpeedState] = useState(600);
  const lastSpeed = useRef(600);
  const [tab, setTab] = useState('home');
  const [rightTab, setRightTab] = useState('news');
  const [mk, setMk] = useState('kr');
  const [sel, setSel] = useState(null);
  const [side, setSide] = useState('buy');
  const [sheet, setSheet] = useState(null); // 'order' | 'exchange' | 'settings'
  const [toast, setToast] = useState(null);
  const [saveWarn, setSaveWarn] = useState(false);
  const [fillNote, setFillNote] = useState(null);
  const [roomMsg, setRoomMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sync, setSync] = useState(null); // { code, msg, progress }
  const [lobby, setLobby] = useState({ status: 'loading', rooms: [] }); // status: loading | ok | none
  const desk = useMedia('(min-width: 1080px)');
  const isGuest = () => roomRef.current && roomRef.current.role === 'guest';
  const setSpeed = (s) => { if (isGuest()) return; if (s > 0) lastSpeed.current = s; setSpeedState(s); if (s > 0) setToast(null); };

  useEffect(() => { document.documentElement.setAttribute('data-theme', settings.theme); }, [settings.theme]);

  useEffect(() => {
    const s = store.get(SAVE_KEY);
    if (s && s.world) {
      try { const w = World.fromSave(s.world); setSaveInfo({ mode: w.mode, date: dateText(w.clock, w.startT, settings.hideYear || w.mode === 'unknown'), total: won(valuation(normalizeAccount(s.acct), w).totalKrw), raw: s }); }
      catch (e) { setSaveInfo(null); }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(() => {
    const w = worldRef.current, a = acctRef.current, rm = roomRef.current;
    if (!w) return;
    const ok = rm
      ? store.set(roomKey(rm.code), { seed: w.seed, acct: a, nick: rm.nick })
      : store.set(SAVE_KEY, { world: w.toSave(), acct: a });
    setSaveWarn(!ok);
  }, []);

  const notifyFills = (ev) => {
    if (!ev || !ev.length) return;
    const w = worldRef.current, e = ev[ev.length - 1], inst = w.instrument(e.o.id);
    const text = e.kind === 'fill'
      ? '지정가 ' + (e.o.side === 'buy' ? '매수' : '매도') + ' 체결 · ' + inst.name + ' ' + e.o.qty + '주 ' + priceText(inst, e.trade.px, 'USD', w.fx())
      : '지정가 주문이 장 마감으로 취소됐어요 · ' + inst.name + ' ' + e.o.qty + '주';
    setFillNote({ text, until: performance.now() + 5000 });
    if (e.kind === 'fill') sound.play('fill');
    save();
  };

  // held stocks: 상장폐지 wipes the position; halts and delisting news on something I own get a notice
  const notifyDelist = (gone) => {
    if (!gone || !gone.length) return;
    const w = worldRef.current;
    sound.play('warn');
    setFillNote({ text: '상장폐지 · ' + gone.map((g) => (w.instrument(g.id)?.name || g.id) + ' ' + g.q + '주').join(', ') + '가 사라졌어요', until: performance.now() + 8000 });
    save();
  };
  const notifyHeld = (fired) => {
    const a = acctRef.current; if (!fired || !a) return;
    const e = fired.filter((x) => x.comp && a.pos[x.comp] && ['거래정지', '상장폐지', '거래재개', '상폐빔'].includes(x.tag)).pop();
    if (e) { setFillNote({ text: '보유 종목 · ' + e.text, until: performance.now() + 8000 }); sound.play('warn'); }
    else if (fired.some((x) => x.comp && (a.pos[x.comp] || a.watch.includes(x.comp)) && ['상한가', '급등', '상장'].includes(x.tag))) sound.play('alert');
  };

  const begin = (w, a) => {
    worldRef.current = w; acctRef.current = a; commRef.current = newCommunity(w.seed);
    setPhase('play'); setSel(null); setTab('home'); setSpeedState(600); lastSpeed.current = 600; setToast(null); setTick((x) => x + 1);
  };
  const newWorld = (opt) => {
    const seed = opt.code || Math.random().toString(36).slice(2, 8).toUpperCase();
    setSettings({ ...settings, hideYear: opt.hideYear, pause: opt.pause });
    return new World({ seed, startT: randomStart(seed), ext: opt.ext, mode: opt.mode });
  };
  const onStart = (opt) => { leaveRoom(); begin(newWorld(opt), newAccount(opt.cash || 10_000_000)); setTimeout(save, 0); };
  const onContinue = () => { leaveRoom(); const s = saveInfo.raw; begin(World.fromSave(s.world), normalizeAccount(s.acct)); };
  const onNew = () => { leaveRoom(); store.del(SAVE_KEY); worldRef.current = null; setSaveInfo(null); setSheet(null); setPhase('start'); };

  /* ---------- rooms ---------- */
  const attachRoom = (t, code, role, nick, pub = true) => {
    const rm = { t, code, role, nick, pub, joinedAt: Date.now(), peers: [], hostId: null, connected: true, noHostSince: null };
    rm.unsub = t.onPeers((peers) => { rm.peers = peers; });
    roomRef.current = rm;
    return rm;
  };
  function leaveRoom() {
    const rm = roomRef.current; if (!rm) return;
    try { rm.unsub && rm.unsub(); rm.t.leave(); } catch (e) { /* already gone */ }
    roomRef.current = null;
  }
  const onCreateRoom = async (opt, nick) => {
    setBusy(true); setRoomMsg(null);
    const code = newRoomCode();
    const t = await openRoom(code);
    setBusy(false);
    if (!t) { setRoomMsg(NO_ROOM_MSG); return; }
    leaveRoom();
    attachRoom(t, code, 'host', nick, opt.pub !== false);
    begin(newWorld(opt), newAccount(opt.cash || 10_000_000));
    setTab('room'); setRightTab('room');
  };
  const onJoinRoom = async (code, nick) => {
    setBusy(true); setRoomMsg(null);
    const t = await openRoom(code);
    setBusy(false);
    if (!t) { setRoomMsg(NO_ROOM_MSG); return; }
    leaveRoom();
    worldRef.current = null;
    attachRoom(t, code, 'guest', nick);
    setSync({ code, msg: '방장을 찾는 중이에요…', progress: null, since: Date.now() });
    setPhase('sync');
  };
  const cancelSync = () => { leaveRoom(); worldRef.current = null; setSync(null); setPhase('start'); };

  // guests: build the host's world and fast-forward to the host's clock, a few days per frame
  useEffect(() => {
    if (phase !== 'sync') return;
    let raf;
    const step = () => {
      const rm = roomRef.current; if (!rm) return;
      const host = hostOf(rm.peers.filter((p) => !p.isMe));
      if (!host) {
        if (Date.now() - sync.since > 15000) setSync((s) => ({ ...s, msg: '방에 아무도 없어요. 코드를 확인하거나 방장에게 다시 물어봐 주세요.' }));
        raf = requestAnimationFrame(step); return;
      }
      const hp = host.presence;
      if (!worldRef.current) {
        const w = new World({ seed: hp.seed, startT: hp.startT, ext: hp.ext, mode: hp.mode });
        const saved = store.get(roomKey(rm.code));
        acctRef.current = saved && saved.seed === hp.seed ? normalizeAccount(saved.acct) : newAccount(hp.cash);
        worldRef.current = w; rm.syncFrom = w.clock;
      }
      const w = worldRef.current, target = targetClock(host);
      w.skipTo(Math.min(target, w.clock + 3 * DAY), false);
      const prog = target > rm.syncFrom ? (w.clock - rm.syncFrom) / (target - rm.syncFrom) : 1;
      if (target - w.clock < 120) {
        const a = acctRef.current; worldRef.current = null;
        begin(w, a); setSpeedState(hp.speed || 0); setTab('room'); setRightTab('room'); setSync(null);
        return;
      }
      setSync((s) => ({ ...s, msg: '방장이 있는 시점까지 따라가는 중이에요… (' + dateText(w.clock, w.startT, true) + ')', progress: Math.max(0, Math.min(1, prog)) }));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // share my state with the room
  useEffect(() => {
    if (phase !== 'play') return;
    const id = setInterval(() => {
      const rm = roomRef.current, w = worldRef.current, a = acctRef.current;
      if (!rm || !w) return;
      rm.connected = rm.t.connected();
      rm.t.setPresence(myPresence(w, a, rm, rm.role === 'host' ? speedRef.current : 0));
    }, 300);
    return () => clearInterval(id);
  }, [phase]);
  const speedRef = useRef(speed); speedRef.current = speed;

  // public lobby: watch the list on the start screen
  useEffect(() => {
    if (phase !== 'start') return;
    const link = lobbyLink((ok) => { if (!ok) setLobby({ status: 'none', rooms: [] }); });
    link.watch((peers) => setLobby({ status: 'ok', rooms: lobbyRooms(peers) }));
    return () => link.close();
  }, [phase]);
  // ...and while playing, the current host of a public room keeps it listed (successors take over automatically)
  useEffect(() => {
    if (phase !== 'play') return;
    const link = lobbyLink();
    const tick = () => {
      const rm = roomRef.current, w = worldRef.current, a = acctRef.current;
      if (rm && w && rm.role === 'host' && rm.pub) { rm.speed = speedRef.current; link.advertise(lobbyAd(w, a, rm)); }
      else link.withdraw();
    };
    const first = setTimeout(tick, 300), id = setInterval(tick, 2000);
    return () => { clearTimeout(first); clearInterval(id); link.close(); };
  }, [phase]);

  /* ---------- game loop ---------- */
  const modalOpen = sheet === 'order' || sheet === 'exchange' || sheet === 'forge';
  const bellRef = useRef({ kr: null, us: null });
  useEffect(() => { sound.set({ on: settings.sound !== false, vol: settings.vol ?? 0.5 }); }, [settings.sound, settings.vol]);
  useEffect(() => {
    if (phase !== 'play') return;
    let raf, last = performance.now(), lastUi = 0, lastSave = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.25, (now - last) / 1000); last = now;
      const w = worldRef.current, a = acctRef.current, rm = roomRef.current;
      if (w) {
        const before = dateOf(w.clock), t0 = w.clock;
        let res = null;
        if (rm) {
          const host = hostOf(rm.peers);
          rm.hostId = host ? host.id : null;
          if (rm.role === 'guest') {
            if (host && !host.isMe) {
              rm.noHostSince = null;
              if (host.presence.pub != null) rm.pub = host.presence.pub !== false; // so whoever takes over keeps the room listed (or not)
              // Guests can't rewind, so never run ahead of the host: stop at the same major news the host stops at
              // (same seed -> same moment) and wait there until the host's real clock moves past it.
              let target = targetClock(host);
              if (rm.holdAt != null) {
                if (host.presence.clock > rm.holdAt || now > rm.holdUntil) rm.holdAt = null;
                else target = Math.min(target, rm.holdAt);
              }
              if (target > w.clock + 1) {
                res = w.skipTo(Math.min(target, w.clock + 2 * DAY), true);
                if (res.paused) { rm.holdAt = w.clock; rm.holdUntil = now + 2000; }
              }
              if ((host.presence.speed || 0) !== speedRef.current) setSpeedState(host.presence.speed || 0);
            } else {
              rm.noHostSince = rm.noHostSince || now;
              if (now - rm.noHostSince > 3000) { rm.role = 'host'; setToast({ text: '방장이 나가서 내가 방장이 됐어요. 시간은 이제 내가 정해요.' }); }
            }
          } else if (host && !host.isMe && (host.presence.joinedAt || 0) < rm.joinedAt) {
            rm.role = 'guest'; // someone who joined earlier is hosting
          }
        }
        if ((!rm || rm.role === 'host') && speed > 0 && !(modalOpen && !rm)) {
          res = w.advance(dt * speed, settings.pause);
          if (res.paused) { const m = res.fired.filter((e) => e.major).pop(); setToast(m || null); setSpeedState(0); }
        } else if (res && res.fired.some((e) => e.major)) setToast(res.fired.filter((e) => e.major).pop());
        if (res && res.fired.some((e) => e.major)) sound.play('major');
        for (const mk of ['kr', 'us']) { const reg = w.marketState(mk).sess?.id === 'reg'; if (reg && bellRef.current[mk] === false) sound.play('bell'); bellRef.current[mk] = reg; }
        if (w.clock !== t0) {
          notifyFills(processOrders(a, w, t0, w.clock));
          if (res) notifyHeld(res.fired);
          notifyDelist(sweepDelisted(a, w));
          const cs = commRef.current;
          if (cs.t0 == null) cs.t0 = t0;
          if (now - (cs.lastReal || 0) > 1500) { communityTick(w, cs, cs.t0, w.clock, { acct: a, peers: rm ? rm.peers : [] }); cs.t0 = w.clock; cs.lastReal = now; }
          if (dateOf(w.clock) !== before) { a.eq.push({ t: before, v: valuation(a, w).totalKrw }); if (a.eq.length > 4000) a.eq.shift(); }
        }
      }
      if (now - lastUi > 120) { lastUi = now; setTick((x) => x + 1); }
      if (now - lastSave > 15000) { lastSave = now; save(); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onHide = () => save();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('pagehide', onHide); document.removeEventListener('visibilitychange', onHide); };
  }, [phase, speed, modalOpen, settings.pause, save]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSkip = (kind) => {
    if (isGuest()) return;
    const w = worldRef.current;
    const target = kind === 'day' ? w.nextKrDayStart() : w.nextSessionStart();
    const t0 = w.clock;
    const res = w.skipTo(target, settings.pause);
    notifyFills(processOrders(acctRef.current, w, t0, w.clock));
    notifyHeld(res.fired); notifyDelist(sweepDelisted(acctRef.current, w));
    communityTick(w, commRef.current, t0, w.clock, { acct: acctRef.current, peers: roomRef.current ? roomRef.current.peers : [] }); commRef.current.t0 = w.clock;
    if (res.paused) { setToast(res.fired.filter((e) => e.major).pop() || null); setSpeedState(0); }
    else if (speed === 0) setSpeed(lastSpeed.current);
    setTick((x) => x + 1);
  };
  const onOrderDone = (id, s, v, byPct) => { const r = execute(acctRef.current, worldRef.current, id, s, v, byPct); if (r.ok) sound.play(s === 'buy' ? 'buy' : 'sell'); setTick((x) => x + 1); save(); return r; };
  // 강화소: money moves between KRW cash and the item; results are revealed by the panel after a short suspense
  const onForge = (act, base) => {
    const a = acctRef.current; if (!a) return null;
    if (!a.forge) a.forge = newForge();
    const f = a.forge; let out = null;
    if (act === 'buy') { if (availKrw(a) < base) return { err: '원화 예수금이 부족해요.' }; a.krw -= base; buyItem(f, base); sound.play('coin'); out = { res: 'buy' }; }
    else if (act === 'try') {
      if (!f.item) return null;
      const c = costAt(f.item.base, f.item.lv); if (availKrw(a) < c) return { err: '강화 비용이 부족해요. 원화 예수금을 확인해 주세요.' };
      a.krw -= c; out = enhance(f); a.krw += out.cost - c; // enhance() reports the same cost; keep cash exact
      sound.play('forgeTry');
    } else if (act === 'sell') { const v = sellItem(f); a.krw += v; sound.play('coin'); out = { res: 'sell', value: v }; }
    setTick((x) => x + 1); save();
    return out;
  };
  const onLimit = (id, s, px, v, byPct) => { const r = placeLimit(acctRef.current, worldRef.current, id, s, px, v, byPct); setTick((x) => x + 1); save(); return r; };
  const onCancel = (oid) => { cancelOrder(acctRef.current, worldRef.current, oid); setTick((x) => x + 1); save(); };
  const onWatch = (id) => { toggleWatch(acctRef.current, id); setTick((x) => x + 1); save(); };
  const onExchange = (dir, amt) => { exchange(acctRef.current, worldRef.current, dir, amt); setTick((x) => x + 1); save(); };
  const onLeaveRoom = () => { save(); leaveRoom(); setTab('home'); setRightTab('news'); setToast({ text: '방에서 나왔어요. 같은 세계를 혼자 이어서 해요.' }); };
  const select = (id) => { setSel(id); if (!desk) setTab('stock'); const inst = worldRef.current.instrument(id); if (inst && !inst.index && mk !== 'watch') setMk(inst.mk); };

  if (phase === 'start') return <StartScreen saveInfo={saveInfo} onContinue={onContinue} onStart={onStart} onCreateRoom={onCreateRoom} onJoinRoom={onJoinRoom} roomMsg={roomMsg} busy={busy} lobby={lobby} />;
  if (phase === 'sync') return <SyncScreen code={sync?.code} msg={sync?.msg} progress={sync?.progress} onCancel={cancelSync} />;
  const w = worldRef.current, a = acctRef.current, rm = roomRef.current;
  const news = w.newsLog, posts = commRef.current.posts;
  const cur = settings.cur;
  const roomView = rm && { code: rm.code, role: rm.role, peers: rm.peers, hostId: rm.hostId, connected: rm.connected !== false };
  const toastEl = toast && (
    <div className="toast" role="status">
      <span><b>{toast.major ? (isGuest() ? '주요 뉴스' : '주요 뉴스로 멈췄어요') : '알림'}</b>{toast.text}</span>
      {isGuest() || !toast.major ? <button type="button" onClick={() => setToast(null)}>닫기</button> : <button type="button" onClick={() => setSpeed(lastSpeed.current)}>계속</button>}
    </div>
  );
  // 미지의 국면: the year is always hidden (knowing it would give the chapter away)
  const viewSettings = w && w.mode === 'unknown' ? { ...settings, hideYear: true, lockYear: true } : settings;
  const clock = <ClockBar world={w} settings={viewSettings} speed={speed} setSpeed={setSpeed} onSkip={onSkip} onSettings={() => setSheet('settings')} onForge={() => setSheet('forge')} desk={desk} cur={cur} setCur={setCur} locked={isGuest()} />;
  const sheets = (
    <>
      {sheet === 'order' && sel && <Sheet title="주문" onClose={() => setSheet(null)}><OrderPanel world={w} acct={a} id={sel} side={side} setSide={setSide} cur={cur} onDone={onOrderDone} onLimit={onLimit} tick={tick} /></Sheet>}
      {sheet === 'exchange' && <Sheet title="환전" onClose={() => setSheet(null)}><ExchangePanel world={w} acct={a} onExchange={onExchange} /></Sheet>}
      {sheet === 'forge' && <Sheet title="강화소" onClose={() => setSheet(null)}><ForgePanel acct={a} onForge={onForge} /></Sheet>}
      {sheet === 'settings' && <Sheet title="설정" onClose={() => setSheet(null)}><SettingsPanel settings={viewSettings} setSettings={(x) => { const { lockYear, ...rest } = x; setSettings(lockYear ? { ...rest, hideYear: settings.hideYear } : rest); }} world={w} onNew={onNew} /></Sheet>}
    </>
  );
  const fillEl = fillNote && performance.now() < fillNote.until && <div className="fillnote" role="status">{fillNote.text}</div>;
  const warn = saveWarn && <p className="note warn">브라우저 저장 공간이 부족해서 자동 저장을 못 했어요.</p>;

  if (desk) {
    const detailId = sel || BIDX[mk === 'watch' ? 'kr' : mk];
    const tabs = [...(rm ? [['room', '대결']] : []), ['news', '뉴스'], ['community', '커뮤니티']];
    return (
      <div className="desk-app">
        {clock}
        {toastEl}
        {fillEl}
        <div className="desk-grid">
          <aside className="col-left"><MarketList world={w} mk={mk} setMk={setMk} cur={cur} onSelect={select} selected={sel} tick={tick} watch={a.watch} /></aside>
          <main className="col-mid">
            <StockDetail world={w} acct={a} id={detailId} cur={cur} theme={settings.theme} tick={tick} desk news={news} onWatch={onWatch} onCancel={onCancel} />
          </main>
          <aside className="col-right">
            <OrderPanel key={detailId} world={w} acct={a} id={detailId} side={side} setSide={setSide} cur={cur} onDone={onOrderDone} onLimit={onLimit} tick={tick} inline />
            <div className="panel">
              <div className="seg big" role="tablist" aria-label="정보">
                {tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={rightTab === k} onClick={() => setRightTab(k)}>{l}</button>)}
              </div>
              {rightTab === 'room' && rm && <RoomPanel room={roomView} world={w} onLeave={onLeaveRoom} />}
              {rightTab === 'news' && <NewsFeed world={w} news={news} settings={viewSettings} compact />}
              {rightTab === 'community' && <CommunityFeed posts={posts} world={w} settings={viewSettings} onSelect={select} small />}
            </div>
            <AccountView world={w} acct={a} cur={cur} setCur={setCur} onSelect={select} onExchange={() => setSheet('exchange')} onCancel={onCancel} tick={tick} theme={settings.theme} />
          </aside>
        </div>
        {warn}
        {sheets}
      </div>
    );
  }

  const navItems = [['home', '시장'], ['account', '내 계좌'], ['community', '커뮤니티'], ['news', '뉴스'], ...(rm ? [['room', '대결']] : [])];
  return (
    <div className="mob-app">
      {clock}
      {toastEl}
      {fillEl}
      <main className="mob-main">
        {tab === 'home' && <MarketList world={w} mk={mk} setMk={setMk} cur={cur} onSelect={select} selected={sel} tick={tick} watch={a.watch} />}
        {tab === 'stock' && sel && <StockDetail world={w} acct={a} id={sel} cur={cur} theme={settings.theme} tick={tick} news={news} onWatch={onWatch} onCancel={onCancel} onBack={() => setTab('home')} onOrder={(s) => { setSide(s); setSheet('order'); }} />}
        {tab === 'account' && <AccountView world={w} acct={a} cur={cur} setCur={setCur} onSelect={select} onExchange={() => setSheet('exchange')} onCancel={onCancel} tick={tick} theme={settings.theme} />}
        {tab === 'news' && <NewsFeed world={w} news={news} settings={viewSettings} />}
        {tab === 'community' && <CommunityFeed posts={posts} world={w} settings={viewSettings} onSelect={select} />}
        {tab === 'room' && rm && <RoomPanel room={roomView} world={w} onLeave={onLeaveRoom} />}
        {warn}
      </main>
      {tab !== 'stock' && (
        <nav className="bottomnav" aria-label="메뉴" style={{ gridTemplateColumns: 'repeat(' + navItems.length + ', 1fr)' }}>
          {navItems.map(([k, l]) => <button key={k} type="button" aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}>{l}</button>)}
        </nav>
      )}
      {sheets}
    </div>
  );
}
