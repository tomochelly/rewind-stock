// Stock-forum chatter that reacts to what the market is doing right now — and to what you and your room are doing.
// Tone imitates Korean retail-investor boards (slang, 말머리, anonymous handles) without slurs, insults or self-harm memes.
// Posts are composed from parts: a topic (what happened) × a persona (who is talking) × small variations, so they rarely repeat.
// Not part of the deterministic world: it has its own RNG and is local to each player.
import { mulberry32, pick, hashStr } from './rng.js';
import { BIDX, MARKETS } from './world.js';

const BOARD = { kr: '국장 갤러리', us: '미장 채널' };
const anon = (r) => 'ㅇㅇ(' + (100 + Math.floor(r() * 120)) + '.' + Math.floor(r() * 256) + ')';
const P = (r, a) => pick(r, a);
const maybe = (r, p, s) => (r() < p ? s : '');
const END = ['', '', '', ' ㅋㅋ', ' ㅋㅋㅋ', ' ㄷㄷ', '…', ' ㅎㅎ', '!!', ' ㅠㅠ'];

// Personas: nick pool + phrases that fit a situation group (up / down / idx). Each post gets at most one of pre or post, and only
// when the persona has something for that group — so a macro nerd never comments on someone's lunch.
const PERSONAS = [
  { id: 'newbie', w: 3, nicks: ['주린이', '주식3일차', '첫계좌개설', '개미1호', '용돈투자'], tag: '질문',
    say: { up: { pre: ['주린이 질문인데 ', '초보라 그런데 ', '혹시 '], post: ['. 지금 사도 되나요?', '. 이유가 뭔가요?'] }, down: { pre: ['주린이 질문인데 ', '혹시 '], post: ['. 팔아야 하나요?', '. 이럴 땐 어떻게 해요?'] } } },
  { id: 'scalp', w: 3, nicks: ['단타왕', '5분봉장인', '눌림목헌터', '스캘퍼', '호가창중독'], tag: '잡담',
    say: { up: { pre: ['방금 '], post: ['. 짧게 먹고 나옴', '. 들어갔다 바로 나옴', '. 단타로 1% 먹음'] }, down: { post: ['. 손절 칼같이 함', '. 단타는 손절이 생명'] } } },
  { id: 'bag', w: 3, nicks: ['물타기장인', '평단지킴이', '존버장인', '구조대기다림', '탈출각'], tag: '잡담',
    say: { down: { pre: ['평단 {avg}인데 ', '물린 지 석 달째인데 ', '물타기 세 번 했는데 '], post: ['. 존버합니다', '… 구조대 부탁', '. 원금만 오면 판다'] }, up: { post: ['. 드디어 구조대 오나', '. 평단까지 조금만 더'] } } },
  { id: 'long', w: 2, nicks: ['가치투자자', '배당러', '10년보유', '현금흐름', '적립식'], tag: '잡담',
    say: { down: { post: ['. 어차피 5년 볼 거라 신경 안 씀', '. 분할로 모아갑니다', '. 기업은 그대로임'] }, idx: { post: ['. 적립식은 그냥 산다', '. 장기로 보면 노이즈'] } } },
  { id: 'guru', w: 2, nicks: ['차트쟁이', '고수아님', '십년차', '복기왕', '수급분석'], tag: '정보',
    say: { up: { pre: ['다들 흥분하지 말고. '], post: ['. 고점 신호 조심', '. 판단은 각자'] }, down: { pre: ['경험상 '], post: ['. 여기서 던지면 바닥임', '. 뇌동매매 금지'] } } },
  { id: 'macro', w: 2, nicks: ['매크로덕후', '금리보는개미', '환율지킴이', '연준해석가'], tag: '정보',
    say: { idx: { pre: ['결국 금리임. ', '채권시장 보니 ', '거시로 보면 '], post: ['. 이게 핵심', '. 개별주는 그다음'] } } },
  { id: 'lev', w: 2, nicks: ['레버리지중독', '야수의심장', '풀매수', '인생한방', '3배맨'], tag: '인증',
    say: { up: { post: ['. 3배로 탔다 가즈아', '. 신용 풀로 땡김'] }, down: { post: ['. 레버라 심장 떨린다', '. 반대매매 무섭다'] }, idx: { post: ['. 레버 3배 들어감'] } } },
  { id: 'conspiracy', w: 1, nicks: ['세력추적자', '작전감시단', '찌라시수집가', '뒷이야기'], tag: '루머',
    say: { up: { post: ['. 세력 냄새남', '. 곧 설거지 들어온다'] }, down: { post: ['. 개미털기 들어간다', '. 누가 미리 알았네'] } } },
  { id: 'watch', w: 2, nicks: ['프로관망러', '현금도종목', '구경꾼', '팝콘각'], tag: '잡담',
    say: { idx: { post: ['. 오늘도 관망', '. 안 사길 잘함'] }, up: { post: ['. 구경만 했다'] }, down: { post: ['. 팝콘 각'] } } },
];
const PW = PERSONAS.reduce((s, p) => s + p.w, 0);
const persona = (r) => { let x = r() * PW; for (const p of PERSONAS) { x -= p.w; if (x <= 0) return p; } return PERSONAS[0]; };
const GROUP = { up: 'up', limitUp: 'up', usRun: 'up', ext: 'up', down: 'down', limitDown: 'down', halt: 'down', idxUp: 'idx', idxDown: 'idx', idxFlat: 'idx', macro: 'idx', fx: 'idx' };
// Topic cores: (r, v) => text. v has n (name), p (pct), px, i (index), h (headline), fx, k ...
const T = {
  up: [(r, v) => v.n + ' ' + P(r, ['왜 쏘냐', '+' + v.p + '% 실화냐', '불기둥 뭐냐', '상승 각도 보소', '날아가네', '이유 아는 사람', '지금 들어가면 상투냐', '차트 수직임']),
    (r, v) => P(r, ['어제 판 ', '익절한 ', '관심만 걸어둔 ']) + v.n + ' 오늘 +' + v.p + '%' + P(r, ['… 내 손이 문제', ' 배 아프다', ' 실화냐']),
    (r, v) => v.n + ' ' + P(r, ['거래량 터졌다', '외국인 쓸어담는 중', '호가 비었다', '매도벽 다 뚫림'])],
  down: [(r, v) => v.n + ' ' + P(r, ['왜 빠지냐', '-' + v.p + '% 실화냐', '지하실 밑에 지하 2층', '손절해야 되냐', '개미털기임?', '이 가격이면 줍줍 아님?']),
    (r, v) => v.n + ' ' + P(r, ['물렸다', '비중 줄였어야 했는데', '반등 언제 오냐', '바닥 어디냐']),
    (r, v) => P(r, ['신용 걸린 사람들 ', '어제 산 사람들 ']) + v.n + ' 괜찮냐'],
  limitUp: [(r, v) => v.n + ' ' + P(r, ['상한가 문 닫나', '점상 가냐', '상한가 갔다 ㄷㄷ', '또 상따 각?', '내일 시초가 갭 얼마 뜰까', '상한가 잔량 쌓인다'])],
  limitDown: [(r, v) => v.n + ' ' + P(r, ['하한가 실화냐', '하한가 잔량 봐라', '탈출 못 했다', '내일 반등 오냐'])],
  usRun: [(r, v) => v.n + ' ' + P(r, ['몇 % 간 거임', '+' + v.p + '% 미쳤다', '거래정지 또 걸림', '고점에 물렸다… 음전 실화냐', '숏스퀴즈 가즈아', '잡주는 짧게 먹고 나와야 함', '프리장에서 이미 다 올랐네', '내일 유증 각 아님?']),
    (r, v) => P(r, ['미장 잡주 ', '오늘의 로또 ', '']) + v.n + ' ' + P(r, ['탑승 성공', '못 탔다', '구경만 함'])],
  halt: [(r, v) => v.n + ' ' + P(r, ['거래정지 풀리긴 하냐', '거래정지 걸렸다는데 물린 사람?', '공시 떴다… 상폐 아니겠지', '정지 풀리면 하한가 각'])],
  delist: [(r, v) => v.n + ' ' + P(r, ['정리매매 들어간 사람 있냐', '상폐빔 타는 사람 용자다', '물린 사람들 힘내라', '정리매매는 도박이다 진짜', '상폐빔 떴다 ㄷㄷ'])],
  ipo: [(r, v) => v.n + ' ' + P(r, ['공모주 받은 사람?', '따상 가냐', '상장 첫날 어디까지 가냐', '시초가 보고 판다', '청약 몇 주 받음?', '첫날 사면 물린다던데'])],
  news: [(r, v) => P(r, ['방금 뉴스 봤냐 ', '이거 호재임 악재임? ', '이미 선반영 아님? ', '이거 크다 ', '찌라시인 듯 거르셈 ', '속보 떴다 ']) + '"' + v.h + '"'],
  macro: [(r, v) => '"' + v.h + '" ' + P(r, ['이거 지수 박살 나는 거 아님?', '뜬금없네 ㄷㄷ', '다들 포지션 어떻게 함?', '이건 진짜 큰일 아니냐', '역사적인 날이다', '현금 비중 늘린다'])],
  idxUp: [(r, v) => v.i + ' ' + P(r, ['불장 왔다', '이대로 신고가 가냐', '빨간불 파티', '오늘 같은 날 현금 들고 있던 사람 손']), (r) => P(r, ['다들 수익 인증 ㄱㄱ', '계좌 오랜만에 빨갛다', '오늘은 다 같이 웃자'])],
  idxDown: [(r, v) => '오늘 ' + v.i + ' 왜 이럼', (r) => P(r, ['파란불 보기 싫어서 앱 지움', '이 정도면 바닥 아님?', '공포에 사라 했지 지금이 공포임', '쉬는 것도 투자다', '계좌 녹는 중… 다들 버티냐'])],
  idxFlat: [(r, v) => v.i + ' ' + P(r, ['횡보 언제 끝남', '오늘 장 지루하네', '거래량 없다']), (r) => P(r, ['관망합니다', '다들 눈치보는 중', '심심해서 차트만 봄'])],
  fx: [(r, v) => '환율 ' + v.fx + '원 ' + P(r, ['실화냐 미장 들어가기 무섭네', '이면 달러 사도 되냐', '때문에 수익 다 까먹음', '환차익 개꿀'])],
  lev: [(r) => P(r, ['레버 3배 들어간 사람 손', '인버스 산 사람 지금 웃고 있냐', '레버리지는 장기 보유하면 녹는다', '불 3X 탈출 성공'])],
  ext: [(r, v) => P(r, ['프리장에서 ', '시간외에서 ', '애프터에서 ']) + v.n + ' ' + P(r, ['미쳤네', '다 빠지는 거 뭐임', '거래량 보니 내일 갭 뜰 듯'])],
  open: [(r, v) => v.i + ' ' + P(r, ['장 시작했다 다들 화이팅', '시초가 보고 판단', '동시호가 봤냐']), (r) => P(r, ['장 시작 5분 전 심장 뛴다', '오늘은 매매 안 한다(3분 뒤 매수)', '출근길 시초가 확인'])],
  close: [(r) => P(r, ['오늘 장 마감. 다들 수고', '종가 베팅 들어갔다', '오늘 매매 복기한다', '장 끝나니까 허무하네', '내일은 오르겠지'])],
  night: [(r) => P(r, ['미장 보느라 잠 못 잔다', '새벽 미장 생존 신고', '자고 일어나면 오르겠지', '해외 장 켜놓고 졸고 있음'])],
  weekend: [(r) => P(r, ['주말이라 심심하다 빨리 월요일 와라', '주말에 차트 공부 중', '월요일 갭 무섭다', '주말엔 주식 앱 지운다'])],
  bigTrade: [(r, v) => '누가 ' + v.n + ' ' + v.amt + ' ' + (v.buy ? P(r, ['시장가로 긁었네', '쓸어담았다', '매수 체결 찍힘']) : P(r, ['던졌다', '시장가로 투척', '매도 폭탄'])) + P(r, [' ㄷㄷ 큰손 들어왔냐', '. 세력인가', '. 고래 출몰', ''])],
  room: [(r, v) => '[대결방] ' + v.nick + ' ' + v.n + ' ' + (v.buy ? '매수' : '매도') + P(r, [' 포착 ㅋㅋ', '했다는데 따라가냐', '… 뭘 아는 거지', ' 들어감'])],
  chat: [(r) => P(r, ['점심 뭐 먹지 (주식 얘기 아님)', '현금도 종목이다', '단타 그만해야지 하면서 또 함', '형님들 요즘 뭐 사심?', '장기투자 3일째', '수익률 인증하면 다들 고수더라', '물타기 하다가 바다 됨', '이번 달 월급 전부 넣었다', '오늘의 교훈: 뇌동매매 금지', '주식 하고 나서 뉴스를 다 봄', '계좌 비밀번호 까먹음 (진짜)', '친구가 사라는 거 샀다가 물림'])],
};
const TAG = { up: '잡담', down: '잡담', limitUp: '정보', limitDown: '잡담', usRun: '정보', halt: '정보', delist: '정보', ipo: '공모', news: '뉴스', macro: '속보', idxUp: '잡담', idxDown: '잡담', idxFlat: '잡담', fx: '질문', lev: '인증', ext: '정보', open: '잡담', close: '잡담', night: '잡담', weekend: '잡담', bigTrade: '포착', room: '대결', chat: '잡담' };
const HOT = new Set(['up', 'down', 'limitUp', 'limitDown', 'usRun', 'delist', 'macro', 'bigTrade', 'room', 'halt']);

// Replies under a post, generated on demand from the post's id (same post → same replies).
const R = {
  any: ['ㄹㅇ', '222', '이건 맞말', '뇌피셜 ㄴㄴ', '근거는?', '나도 그 생각함', '글쎄…', '이거 리딩방 냄새남', '형 평단 얼마임', '정보 ㄳ', '판단은 각자', '이 형 또 왔네 ㅋㅋ', '그래서 사라는 거임 팔라는 거임', '저장해둠', '반대로 하면 됨 ㅋㅋ'],
  up: ['축하한다 부럽다', '익절은 언제?', '이제 들어가면 늦음?', '나만 못 탔네', '고점 조심해라', '수익 인증 ㄱ'],
  down: ['힘내라 버티면 온다', '손절도 실력이다', '나도 물림 ㅠ', '지금이 줍줍 타이밍', '반등 나오면 탈출하셈', '비중 조절 실패의 결과'],
  q: ['검색 좀 해라', '그거 공시 보면 나옴', '초보면 ETF부터', '모르면 사지 마라', '나도 궁금'],
};
const kindTone = (k) => (['up', 'limitUp', 'usRun', 'idxUp', 'ipo'].includes(k) ? 'up' : ['down', 'limitDown', 'idxDown', 'halt', 'delist'].includes(k) ? 'down' : null);
export function repliesFor(post) {
  const r = mulberry32(hashStr('reply|' + post.id));
  const n = Math.min(6, 1 + Math.floor(r() * (post.hot ? 6 : 3)));
  const tone = kindTone(post.kind), out = [];
  for (let i = 0; i < n; i++) {
    const pool = post.tag === '질문' && r() < 0.5 ? R.q : tone && r() < 0.55 ? R[tone] : R.any;
    out.push({ nick: r() < 0.6 ? anon(r) : P(r, P(r, PERSONAS).nicks), text: P(r, pool) + P(r, END), up: Math.floor(r() * (post.hot ? 30 : 8)) });
  }
  return out;
}
// Likes/comments keep growing for a while after posting (market time)
export function liveCounts(post, now) {
  const age = Math.max(0, now - post.t), f = 1 - Math.exp(-age / (post.hot ? 1800 : 3600));
  return { up: Math.round(post.up * f), cm: Math.round(post.cm * f), best: post.hot && post.up * f > 40 };
}

export function newCommunity(seed) { return { r: mulberry32((Number.parseInt(String(seed), 36) || 7) ^ 0x5bd1e995), last: null, posts: [], seq: 0, seenTrades: 0, seenPeer: {}, lastSess: {} }; }

// Generates posts for the market time that passed between t0 and t1 (at most a few per call).
// ctx (optional): { acct, peers } — your trades and your room's latest trades also get noticed.
export function communityTick(world, cs, t0, t1, ctx = {}) {
  const r = cs.r, out = [];
  if (t1 <= t0) return out;
  const span = Math.min(t1 - t0, 4 * 3600);
  const add = (post) => { if (post) { post.t = post.t || t1 - Math.floor(r() * Math.min(span, 600)); post.id = world.seed + ':' + (cs.seq++); out.push(post); } };
  for (const mk of ['kr', 'us']) {
    const st = world.marketState(mk), open = st.open;
    const recent = world.newsLog.slice(-12).filter((e) => e.t > t1 - 3 * 3600 && (e.mk === mk || e.mk === 'all'));
    const heat = 1 + recent.filter((e) => e.major).length * 2 + recent.filter((e) => ['급등', '상한가', '상폐빔', '거래정지', '상장폐지'].includes(e.tag)).length;
    // session edges: a burst of "장 시작" / "장 마감" posts
    const sid = open ? st.sess.id : null;
    if (sid !== (cs.lastSess[mk] ?? null)) {
      if (sid === 'reg') add(makePost(world, mk, r, recent, 'open'));
      else if (cs.lastSess[mk] === 'reg') add(makePost(world, mk, r, recent, 'close'));
      cs.lastSess[mk] = sid;
    }
    const rate = (open ? 1 / 380 : 1 / 2600) * heat; // posts per market-second
    let n = Math.min(3, Math.floor(span * rate + r()));
    while (n-- > 0) add(makePost(world, mk, r, recent, null, open && st.sess.ext));
  }
  // your own big trades
  const a = ctx.acct;
  if (a && a.trades.length) {
    if (cs.seenTrades > a.trades.length) cs.seenTrades = 0;
    for (const tr of a.trades.slice(cs.seenTrades)) {
      const inst = world.instrument(tr.id); if (!inst || inst.etf) continue;
      const q = world.quote(tr.id), krw = tr.total * (inst.mk === 'us' ? world.fx() : 1), turn = q.turnover * (inst.mk === 'us' ? world.fx() : 1);
      if (krw >= 3e7 && (turn <= 0 || krw / turn > 0.004) && r() < 0.8) add(post(world, inst.mk, r, 'bigTrade', { n: inst.name, amt: amtText(krw), buy: tr.side === 'buy' }, inst.id, tr.t + 30 + Math.floor(r() * 300)));
    }
    cs.seenTrades = a.trades.length;
  }
  // friends in the room
  for (const p of ctx.peers || []) {
    const pr = p.presence; if (p.isMe || !pr || !Array.isArray(pr.trades)) continue;
    const last = pr.trades[pr.trades.length - 1]; if (!last) continue;
    const key = last.join('|'); if (cs.seenPeer[p.id] === key) continue;
    const first = cs.seenPeer[p.id] === undefined; cs.seenPeer[p.id] = key;
    if (first || r() > 0.6) continue; // don't dump history on join; and not every trade
    const inst = [...world.listed('kr'), ...world.listed('us')].find((c) => c.name.slice(0, 16) === last[2]);
    add(post(world, inst ? inst.mk : 'kr', r, 'room', { nick: String(pr.nick || '누군가').slice(0, 12), n: last[2], buy: last[1] === 'b' }, inst ? inst.id : null));
  }
  out.sort((x, y) => x.t - y.t);
  cs.posts.push(...out);
  if (cs.posts.length > 300) cs.posts.splice(0, cs.posts.length - 300);
  return out;
}
const amtText = (krw) => (krw >= 1e8 ? (Math.round(krw / 1e7) / 10).toLocaleString('ko-KR') + '억' : Math.round(krw / 1e4).toLocaleString('ko-KR') + '만 원어치');

function post(world, mk, r, kind, v, comp, t) {
  const who = persona(r);
  return finish(world, mk, r, kind, v, comp, who, t, true);
}
function finish(world, mk, r, kind, v, comp, who, t, plain) {
  const core = P(r, T[kind])(r, v).replace(/\s+/g, ' ').trim();
  const fit = !plain && who.say[GROUP[kind]];
  let text = core, voiced = false;
  if (fit && r() < 0.6) {
    const pre = fit.pre && fit.pre.length && (!fit.post || r() < 0.5);
    text = pre ? P(r, fit.pre).replace('{avg}', v.avg || '높은 가격') + core : core.replace(/[.…!?ㅋㄷ ]+$/, '') + P(r, fit.post);
    voiced = true;
  } else if (!/[?"]$/.test(core)) text = core + P(r, END);
  const hot = HOT.has(kind);
  const up = Math.floor(r() * (hot ? 90 : 14)) + (hot && r() < 0.15 ? 60 : 0);
  return {
    mk, board: BOARD[mk], tag: voiced && (kind === 'up' || kind === 'down') ? who.tag : TAG[kind], text, comp, kind, hot, t,
    nick: r() < 0.5 ? anon(r) : P(r, who.nicks), up, cm: Math.floor(up * (0.3 + r() * 0.8)),
  };
}

function makePost(world, mk, r, recent, force, ext) {
  const fx = world.fx();
  const list = world.listed(mk).filter((c) => !c.etf);
  if (!list.length) return null;
  const quotes = list.map((c) => ({ c, q: world.quote(c.id) })).filter((x) => x.q.price != null);
  quotes.sort((a, b) => Math.abs(b.q.chg) - Math.abs(a.q.chg));
  const bq = world.quote(BIDX[mk]);
  const v = { i: MARKETS[mk].bidxName, fx: Math.round(fx).toLocaleString('ko-KR') };
  const who = persona(r);
  const fill = (m) => { v.n = m.c.name; v.p = Math.abs(m.q.chg * 100).toFixed(1); v.avg = priceStr(m.c, m.q.price * (1 + 0.1 + r() * 0.5)); return m.c.id; };
  if (force) return finish(world, mk, r, force, v, null, who);
  const d = new Date(world.clock * 1000), wd = d.getUTCDay(), hr = d.getUTCHours();
  const u = r();
  let kind = 'chat', comp = null;
  const movers = quotes.slice(0, 8);
  const ev = (tags) => recent.filter((e) => tags.includes(e.tag) && e.comp).pop();
  const macro = recent.filter((e) => e.mk === 'all' && e.major).pop();
  if (u < 0.34 && movers.length) {
    const m = pick(r, movers); comp = fill(m);
    const lim = mk === 'kr' && Math.abs(m.q.chg) > 0.29;
    kind = lim ? (m.q.chg > 0 ? 'limitUp' : 'limitDown') : mk === 'us' && m.c.small && m.q.chg > 0.3 ? 'usRun' : m.q.chg > 0.01 ? 'up' : m.q.chg < -0.01 ? 'down' : 'chat';
  } else if (u < 0.46) kind = bq.chg > 0.012 ? 'idxUp' : bq.chg < -0.012 ? 'idxDown' : 'idxFlat';
  else if (u < 0.58 && recent.length) { const e = macro && r() < 0.6 ? macro : pick(r, recent); kind = e === macro ? 'macro' : 'news'; const h = e.text.replace(/["'“”]/g, ''); v.h = h.length > 30 ? h.slice(0, 30) + '…' : h; comp = e.comp || null; }
  else if (u < 0.68) {
    const e = ev(['상장폐지', '상폐빔']) || ev(['거래정지']) || ev(['상장']) || ev(['급등', '상한가']);
    if (e) { const c = world.instrument(e.comp); v.n = c ? c.name : ''; comp = e.comp; kind = ['상장폐지', '상폐빔'].includes(e.tag) ? 'delist' : e.tag === '거래정지' ? 'halt' : e.tag === '상장' ? 'ipo' : mk === 'us' ? 'usRun' : 'limitUp'; }
  } else if (u < 0.74) kind = mk === 'us' ? 'fx' : 'lev';
  else if (u < 0.8 && ext && movers.length) { kind = 'ext'; comp = fill(movers[0]); }
  else if (u < 0.86 && (wd === 0 || wd === 6)) kind = 'weekend';
  else if (u < 0.9 && mk === 'us' && (hr >= 23 || hr < 6)) kind = 'night';
  if (kind === 'chat' && r() < 0.3 && movers.length) { const m = pick(r, movers); comp = fill(m); kind = m.q.chg >= 0 ? 'up' : 'down'; }
  if (!v.n && ['up', 'down', 'limitUp', 'limitDown', 'usRun', 'ext', 'halt', 'delist', 'ipo'].includes(kind)) kind = 'chat';
  return finish(world, mk, r, kind, v, comp, who);
}
const priceStr = (c, px) => (c.mk === 'kr' ? Math.round(px / 10) * 10 + '원' : '$' + px.toFixed(2));
