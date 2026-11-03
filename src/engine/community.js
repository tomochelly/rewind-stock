// Stock-forum chatter that reacts to what the market is doing right now.
// Tone imitates Korean retail-investor boards (slang, 말머리, anonymous handles) without slurs or self-harm memes.
import { mulberry32, pick } from './rng.js';
import { BIDX, MARKETS } from './world.js';

const BOARD = { kr: '국장 갤러리', us: '미장 채널' };
const NICKS = ['존버장인', '익절요정', '손절의신', '물타기장인', '차트쟁이', '단타왕', '가치투자자', '개미1호', '배당러', '레버리지중독', '현금도종목', '줍줍러', '떡상기원', '프로관망러', '분할매수봇', '눌림목헌터', '공시덕후', '야수의심장', '평단지킴이', '주린이'];
const anon = (r) => 'ㅇㅇ(' + (100 + Math.floor(r() * 120)) + '.' + Math.floor(r() * 256) + ')';

const T = {
  upBig: ['{n} 이거 뭐냐 갑자기 왜 쏘냐', '{n} +{p}% 실화냐 ㄷㄷ', '{n} 가즈아ㅏㅏㅏ', '{n} 물려있던 거 드디어 탈출각', '어제 판 {n} 오늘 +{p}%... 내 손이 문제임', '{n} 차트 보소 수직상승', '{n} 이유 아는 사람? 뉴스 없는데 쏘네', '{n} 지금 들어가면 상투냐'],
  upMid: ['{n} 슬금슬금 오르네', '{n} 오늘 좀 하네', '{n} 평단 회복 직전', '{n} 이 정도면 추세 전환 아님?', '{n} 존버는 승리한다'],
  downBig: ['{n} 왜 빠지냐 설명좀', '{n} 물렸다... 손절해야 되나', '{n} 지하실 밑에 지하 2층 있음', '{n} -{p}% 실화냐', '{n} 이 가격이면 줍줍 아님?', '{n} 개미털기 ㅋㅋ 안 털림', '{n} 비중 줄였어야 했는데', '{n} 신용 걸린 사람들 괜찮냐'],
  downMid: ['{n} 조정 오는 듯', '{n} 파란불 보기 싫다', '{n} 분할매수 들어갑니다', '{n} 이 정도는 건강한 조정임'],
  idxUp: ['{i} 불장 왔다', '오늘 같은 날 현금 들고 있던 사람 손', '빨간불 파티 ㅋㅋ', '다들 수익 인증 ㄱㄱ', '{i} 이대로 신고가 가냐'],
  idxDown: ['오늘 {i} 왜 이럼', '파란불 보기 싫어서 앱 지움', '이 정도면 바닥 아님?', '공포에 사라 했지 지금이 공포임', '{i} 또 빠지네 그냥 쉬는 것도 투자', '계좌 녹는 중... 다들 버티냐'],
  idxFlat: ['오늘 장 지루하네', '{i} 횡보 언제 끝남', '관망합니다', '거래량 없는 거 보니 다들 눈치보는 중'],
  news: ['방금 뉴스 봤냐 "{h}"', '이거 호재임 악재임? "{h}"', '"{h}" 이거 이미 선반영 아님?', '뉴스 나오기 전에 누가 미리 샀네 ㅋㅋ', '"{h}" 이거 크다', '"{h}" 찌라시인 듯 거르셈'],
  spike: ['{n} 상한가 문 닫나요?', '{n} 또 상따 각?', '{n} VI 걸렸네 ㄷㄷ', '{n} 작전 아님? 조심해라', '{n} 테마 붙은 듯'],
  fx: ['환율 {fx}원 실화냐 미장 들어가기 무섭네', '환차익 개꿀ㅋㅋ', '달러 지금 사두는 게 맞냐', '환율 때문에 수익 다 까먹음'],
  lev: ['레버 3배 들어간 사람 손', '인버스 산 사람 지금 웃고 있냐', '레버리지는 장기 보유하면 녹는다고 몇 번 말함', '불 3X 탈출 성공했다 ㅋㅋ'],
  chat: ['점심 뭐 먹지 (주식 얘기 아님)', '오늘도 관망', '현금도 종목이다', '단타 그만해야지 하면서 또 함', '형님들 요즘 뭐 사심?', '신용 쓰는 사람들 조심해라', '장기투자 3일째', '수익률 인증하면 다들 고수더라', '물타기 하다가 바다 됨', '이번 달 월급 전부 넣었다'],
  ext: ['프리장에서 {n} 미쳤네', '애프터에서 다 빠지는 거 뭐임', '시간외 거래량 보니 내일 갭 뜰 듯'],
};
const TAG = { upBig: '잡담', upMid: '잡담', downBig: '잡담', downMid: '잡담', idxUp: '잡담', idxDown: '잡담', idxFlat: '잡담', news: '뉴스', spike: '정보', fx: '질문', lev: '인증', chat: '잡담', ext: '정보' };

export function newCommunity(seed) { return { r: mulberry32((Number.parseInt(String(seed), 36) || 7) ^ 0x5bd1e995), last: null, posts: [] }; }

// Generates posts for the market time that passed between t0 and t1 (at most a few per call).
export function communityTick(world, cs, t0, t1) {
  const r = cs.r, out = [];
  if (t1 <= t0) return out;
  const span = Math.min(t1 - t0, 4 * 3600);
  for (const mk of ['kr', 'us']) {
    const st = world.marketState(mk), open = st.open;
    const recent = world.newsLog.slice(-8).filter((e) => e.t > t1 - 3 * 3600 && (e.mk === mk || e.mk === 'all'));
    const heat = 1 + recent.filter((e) => e.major).length * 2 + recent.filter((e) => e.tag === '급등' || e.tag === '상한가').length;
    const rate = (open ? 1 / 420 : 1 / 2400) * heat; // posts per market-second
    let n = Math.min(2, Math.floor(span * rate + r()));
    while (n-- > 0) {
      const post = makePost(world, mk, r, recent, open && st.sess.ext);
      if (post) { post.t = t1 - Math.floor(r() * span); out.push(post); }
    }
  }
  out.sort((a, b) => a.t - b.t);
  cs.posts.push(...out);
  if (cs.posts.length > 300) cs.posts.splice(0, cs.posts.length - 300);
  return out;
}

function makePost(world, mk, r, recent, ext) {
  const fx = world.fx();
  const list = world.listed(mk).filter((c) => !c.etf);
  if (!list.length) return null;
  const quotes = list.map((c) => ({ c, q: world.quote(c.id) })).filter((x) => x.q.price != null);
  quotes.sort((a, b) => Math.abs(b.q.chg) - Math.abs(a.q.chg));
  const bq = world.quote(BIDX[mk]);
  const u = r();
  let kind, name = '', p = 0, comp = null;
  const movers = quotes.slice(0, 8);
  if (u < 0.38 && movers.length) {
    const m = pick(r, movers); name = m.c.name; comp = m.c.id; p = Math.abs(m.q.chg * 100);
    kind = m.q.chg > 0.06 ? 'upBig' : m.q.chg > 0.01 ? 'upMid' : m.q.chg < -0.06 ? 'downBig' : m.q.chg < -0.01 ? 'downMid' : 'chat';
  } else if (u < 0.55) kind = bq.chg > 0.012 ? 'idxUp' : bq.chg < -0.012 ? 'idxDown' : 'idxFlat';
  else if (u < 0.7 && recent.length) kind = 'news';
  else if (u < 0.78) { const sp = recent.find((e) => e.tag === '급등' || e.tag === '상한가'); if (sp) { kind = 'spike'; comp = sp.comp; name = world.instrument(sp.comp)?.name || ''; } else kind = 'chat'; }
  else if (u < 0.84) kind = mk === 'us' ? 'fx' : 'lev';
  else if (u < 0.88 && ext && movers.length) { kind = 'ext'; name = movers[0].c.name; comp = movers[0].c.id; }
  else kind = 'chat';
  let text = pick(r, T[kind]);
  if (kind === 'news') { const e = pick(r, recent); text = text.replace('{h}', e.text.length > 28 ? e.text.slice(0, 28) + '…' : e.text); }
  text = text.replace('{n}', name).replace('{p}', p.toFixed(1)).replace('{i}', MARKETS[mk].bidxName).replace('{fx}', Math.round(fx).toLocaleString('ko-KR'));
  const hot = kind === 'upBig' || kind === 'downBig' || kind === 'spike';
  return {
    mk, board: BOARD[mk], tag: TAG[kind], text, comp,
    nick: r() < 0.55 ? anon(r) : pick(r, NICKS),
    up: Math.floor(r() * (hot ? 60 : 12)), cm: Math.floor(r() * (hot ? 40 : 8)),
  };
}
