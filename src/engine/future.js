// What happens after the real backdrop ends (2026-11-03): regimes, macro events, rumors.
import { DAY, dateOf, isTradingDay, prevTradingDay, kst, dstr, dow } from './calendar.js';
import { rngFor, gauss, pick } from './rng.js';
import { BACKDROP_END } from './backdrop.js';

// 28-day blocks share a regime: bull / chop / bear, plus a volatility multiplier.
export function regimeFor(seed, t) {
  const b = Math.max(0, Math.floor((t - BACKDROP_END) / (28 * DAY)));
  const r = rngFor(seed, 'regime', b);
  const u = r();
  // The real backdrop ends mid-selloff, so the first two blocks lean bearish/choppy.
  const bear = b < 2 ? 0.45 : 0.3, bull = b < 2 ? 0.25 : 0.4;
  const kind = u < bull ? 'bull' : u < bull + (1 - bull - bear) ? 'chop' : 'bear';
  const drift = kind === 'bull' ? 0.0012 + r() * 0.001 : kind === 'bear' ? -0.0014 - r() * 0.0012 : (r() - 0.5) * 0.0006;
  return { kind, drift, vm: 0.85 + r() * 0.9, ai: (r() - 0.45) * 0.004, mem: (r() - 0.45) * 0.005 };
}

// Macro events for future dates. Each moves the US day (same date) and the next KR day, or both on the same date.
const EVENTS = [
  [1, '연준, 기준금리 0.25%p 인하… 성장주 강세', 0.025], [-1, '연준, 예상 밖 금리 동결·매파적 발언', 0.03],
  [1, '미·중 무역 협상 타결… 반도체 관세 일부 철회', 0.04], [-1, '미·중 무역 협상 결렬, 추가 관세 예고', 0.045],
  [1, '빅테크 4사, 내년 AI 설비투자 대폭 확대 발표', 0.04], [-1, '빅테크 일부, AI 설비투자 축소 검토 보도', 0.05],
  [-1, '미, 반도체 수출 통제 추가 강화', 0.04], [1, '수출 통제 일부 완화 합의', 0.03],
  [-1, '대만 해협 군사 긴장 고조', 0.05], [1, '메모리 고정거래가격 큰 폭 상승', 0.03], [-1, '메모리 고정거래가격 하락 전환', 0.035],
  [1, 'AI 서비스 이용자 폭증… 추론용 칩 품귀', 0.035], [-1, '저비용 고성능 AI 모델 또 공개… 칩 수요 의문', 0.06],
  [-1, '미 소비자물가 예상 상회', 0.03], [1, '미 물가 둔화 확인, 금리 인하 기대 확산', 0.03],
  [-1, 'AI 클라우드 기업 회사채 금리 급등… 자금 조달 우려', 0.045], [1, '주요 AI 기업, 흑자 전환 발표… "투자 회수 시작"', 0.04],
];
// Bigger fictional shocks: [sign, headline, index size, { mk: 'kr'|'us' only, semi: extra weight on the chip index, f: factor/theme moves }]
const BIG = [
  [-1, '중동 전면전 위기… 국제유가 하루 20% 폭등', 0.06, { f: { def: 0.08, nuc: 0.03, power: 0.02 } }],
  [-1, '미 대형 지역은행 파산… 뱅크런 공포 확산', 0.07, { f: { bank: -0.1, coin: 0.05 } }],
  [-1, '신종 호흡기 감염병 확산… WHO 비상사태 검토', 0.08, { f: { bio: 0.12, ent: -0.06, ship: -0.04 } }],
  [-1, '대형 코인 거래소 해킹… 출금 전면 중단', 0.02, { f: { coin: -0.2, meme: -0.05 } }],
  [1, '연준, 긴급 회의 열고 기준금리 0.5%p 전격 인하', 0.05, {}],
  [-1, '연준, 시장 예상 깬 0.75%p 인상… "물가 잡을 때까지"', 0.06, { f: { big: -0.03 } }],
  [-1, '대만 규모 7.5 강진… 파운드리 공장 일제히 가동 중단', 0.05, { semi: 1.8, f: { mem: 0.03 } }],
  [-1, '미 법무부, 빅테크 반독점 기업 분할 명령', 0.05, { f: { big: -0.08, plat: -0.04 } }],
  [-1, '"AI 거품" 경고 보고서 파장… 빅테크 일제히 급락', 0.07, { semi: 1.4, f: { ai: -0.06 } }],
  [-1, '미 국가 신용등급 강등… 국채 금리 급등', 0.045, {}],
  [-1, '대형 헤지펀드 파산… 마진콜 연쇄 청산', 0.06, { f: { meme: -0.06 } }],
  [-1, '글로벌 해운 요충지 봉쇄… 물류 대란', 0.025, { f: { ship: 0.08, auto: -0.03 } }],
  [-1, '북한 ICBM 발사… 한반도 긴장 고조', 0.03, { mk: 'kr', f: { def: 0.1 } }],
  [-1, '정치 불확실성 확대… 외국인 대규모 순매도', 0.04, { mk: 'kr' }],
  [1, '정부, 공매도 전면 금지 발표', 0.05, { mk: 'kr', f: { bat: 0.06, bio: 0.04 } }],
  [1, '중국, 사상 최대 경기 부양책 발표', 0.045, { f: { bat: 0.05, ship: 0.03, auto: 0.03 } }],
  [1, '미·중 정상회담 깜짝 합의… 관세 대폭 인하', 0.05, {}],
  [1, '"꿈의 배터리" 전고체 상용화 발표', 0.02, { f: { bat: 0.12 } }],
  [1, '핵융합 발전 첫 순발전 성공 발표', 0.015, { f: { nuc: 0.1, power: 0.05 } }],
  [1, '"인간 수준" 범용 AI 공개… 전 세계 충격', 0.05, { semi: 1.3, f: { ai: 0.06, robot: 0.08 } }],
  [1, '양자컴퓨터, 실제 암호 해독 시연 성공', 0.01, { f: { quant: 0.25, coin: -0.12 } }],
  [1, '코인 현물 ETF로 사상 최대 자금 유입', 0.01, { f: { coin: 0.12 } }],
  [1, '메모리 3사, 공동 감산 선언', 0.03, { semi: 1.5, f: { mem: 0.06 } }],
  [1, '휴머노이드 로봇 월 1만 대 양산 돌입 발표', 0.02, { f: { robot: 0.15 } }],
  [-1, '유인 우주선 발사 직후 폭발 사고', 0.005, { f: { space: -0.12 } }],
  [1, 'FDA, 신약 심사 기간 절반으로 단축', 0.01, { f: { bio: 0.08 } }],
  [-1, '장중 플래시 크래시… 알고리즘 매도 폭주', 0.04, {}],
  [1, '미 물가 2% 안착 확인… "인플레 전쟁 끝났다"', 0.04, {}],
  [-1, '글로벌 클라우드 대규모 장애… 하루 넘게 먹통', 0.02, { f: { big: -0.04, ai: -0.02 } }],
  [1, '각국 정부, 원전 신규 건설 공동 선언', 0.015, { f: { nuc: 0.12, power: 0.04 } }],
];
const evCache = new Map();
// Macro events on a game date d. history mode: only after the real backdrop ends (as before, plus the bigger shocks).
// unknown mode: from day one, more often, bigger and more varied; 3% are black swans (x2.5).
export function macroEvent(seed, d, mode) {
  if (mode !== 'unknown' && d <= BACKDROP_END) return null;
  const key = seed + ':' + mode + ':' + d;
  if (evCache.has(key)) return evCache.get(key);
  let ev = null;
  const w = dow(d);
  if (w !== 0 && w !== 6) {
    const r = rngFor(seed, mode === 'unknown' ? 'uev' : 'fev', d);
    if (r() < (mode === 'unknown' ? 0.085 : 0.06)) {
      const big = r() < (mode === 'unknown' ? 0.4 : 0.15);
      const [sign, text, size, opt] = big ? pick(r, BIG) : [...pick(r, EVENTS), {}];
      const morning = r() < 0.35; // 08:20 KST: hits KR the same day; 21:10 KST: hits US the same day, KR the next day
      const swan = mode === 'unknown' && big && r() < 0.03 * 10 / 4; // ~3% of all events
      const mag = size * (0.6 + r() * 0.8) * sign * (swan ? 2.5 : 1);
      ev = { t: d + (morning ? 8 * 3600 + 20 * 60 : 21 * 3600 + 10 * 60), morning, text: swan ? '[블랙스완] ' + text : text, major: Math.abs(mag) > 0.03, mag, mk: opt.mk || 'all',
        semi: opt.semi || 1, f: opt.f || null, follow: big ? (r() - 0.45) * 0.9 : 0, swan };
    }
  }
  evCache.set(key, ev);
  return ev;
}
export const futureEvent = (seed, d) => macroEvent(seed, d, 'history');

// Total macro-event effect on a market's trading day t: {g, r}. Big shocks echo the next day (follow-through or rebound).
export function macroEffect(seed, mk, t, mode, kind = 'semi') {
  let g = 0, r = 0;
  const apply = (ev, f) => { if (ev && (ev.mk === 'all' || ev.mk === mk)) { const m = ev.mag * f * (kind === 'semi' ? ev.semi : 1); g += m * 0.8; r += m; } };
  const prev = prevTradingDay(mk, t);
  if (mk === 'us') apply(macroEvent(seed, t, mode), 1);
  else for (let d = prev; d <= t; d += DAY) {
    const ev = macroEvent(seed, d, mode); if (!ev) continue;
    if (d === t && ev.morning) apply(ev, 0.9);
    else if (d < t && (!ev.morning || d > prev)) apply(ev, 0.75);
  }
  // echo: the session after the shock
  for (let d = prevTradingDay(mk, prev) + DAY; d <= prev; d += DAY) { const ev = macroEvent(seed, d, mode); if (ev && ev.follow) { const m = ev.mag * ev.follow * (kind === 'semi' ? ev.semi : 1); if (ev.mk === 'all' || ev.mk === mk) { g += m * 0.6; r += m; } } }
  return { g, r };
}
export const futureEffect = (seed, mk, t) => (t <= BACKDROP_END ? { g: 0, r: 0 } : macroEffect(seed, mk, t, 'history'));

// Theme/factor moves from macro events on date t (the event day, or the day after an evening headline)
export function macroFactor(seed, name, t, mode) {
  let x = 0;
  for (const d of [t, t - DAY]) { const ev = macroEvent(seed, d, mode); if (ev && ev.f && ev.f[name] && (d === t ? ev.morning : !ev.morning)) x += ev.f[name] * (ev.swan ? 2 : 1); }
  return x;
}
// Lasting part of past shocks (log), fading with a ~90-day time constant: the story path is pulled toward this offset, not back to the raw anchor
export function shockOffset(seed, mk, t, mode, kind = 'semi') {
  if (mode !== 'unknown') return 0;
  let off = 0;
  for (let d = t - 240 * DAY; d < t; d += DAY) {
    const ev = macroEvent(seed, d, mode);
    if (ev && (ev.mk === 'all' || ev.mk === mk)) off += Math.log1p(ev.mag * (1 + (ev.follow || 0)) * (kind === 'semi' ? ev.semi : 1) * 1.2) * Math.exp(-(t - d) / (90 * DAY));
  }
  return off;
}

// Rumors & briefs: [tag, text, tone(+1/-1/0), target('stk'|'idx'|null)]
export const RUMORS = [
  ['커뮤니티', '{co} 대형 고객사 추가 수주설… 회사 측 "확인해 줄 수 없다"', 1, 'stk'],
  ['찌라시', '증권가 메신저에 "{co} 유상증자 검토" 찌라시 확산', -1, 'stk'],
  ['찌라시', '"{co} 핵심 라인 수율 문제" 소문… 회사 "사실무근"', -1, 'stk'],
  ['단독', '{co}, 해외 신규 공장 부지 물색 중인 것으로 알려져', 1, 'stk'],
  ['증권가', '{broker} "{co} 목표주가 상향, 업황 바닥 통과"', 1, 'stk'],
  ['증권가', '{broker}, {co} 투자의견 "중립"으로 하향', -1, 'stk'],
  ['커뮤니티', '"{co} 임원 자사주 매도" 공시 캡처 커뮤니티 확산', -1, 'stk'],
  ['커뮤니티', '종목 토론방 "{co} 오늘 간다" 글 폭증', 1, 'stk'],
  ['해외', '외국계 리포트 "{co} 신제품 고객사 테스트 통과 임박"', 1, 'stk'],
  ['루머', '{peer}와 {co} 기술 제휴설 돌아', 1, 'stk'],
  ['루머', '"{co} 대주주 블록딜 추진" 루머', -1, 'stk'],
  ['찌라시', '"{co} 대형 고객사 주문 일부 취소" 찌라시', -1, 'stk'],
  ['공시', '{co}, 자사주 매입 결정', 1, 'stk'],
  ['거시', '미 국채 10년물 금리 급등, 기술주 부담', -1, 'idx'],
  ['거시', '미 국채 금리 하락에 성장주 숨통', 1, 'idx'],
  ['거시', '달러 강세 지속… 신흥국 자금 이탈 우려', -1, 'idx'],
  ['공급망', '메모리 현물 가격 3주 연속 상승', 1, 'idx'],
  ['공급망', '메모리 현물 가격 하락 전환', -1, 'idx'],
  ['공급망', '대만 파운드리 월매출 예상 상회', 1, 'idx'],
  ['공급망', '"주요 고객사 재고 조정 길어진다" 관측', -1, 'idx'],
  ['정책', '"추가 반도체 수출 규제 검토 중" 외신 보도', -1, 'idx'],
  ['정책', '정부, 반도체 설비투자 세액공제 확대 검토', 1, 'idx'],
  ['해외', '중국 경기 지표 예상 하회', -1, 'idx'],
  ['해외', '일본 반도체 장비 수주 회복 조짐', 1, 'idx'],
  ['루머', '"대형 헤지펀드, 반도체 공매도 확대" 소문', -1, 'idx'],
  ['루머', '"빅테크 AI 투자 축소 검토" 소문… 해당 기업 부인', -1, 'idx'],
  ['루머', '"빅테크, 내년 AI 데이터센터 투자 대폭 확대" 관측', 1, 'idx'],
  ['해외', '{peer} 분기 실적 앞두고 옵션 거래 급증', 0, 'idx'],
  ['산업', '반도체 업계, 인재 채용 박람회 개최', 0, null],
  ['산업', '{co}, 지역 대학과 산학협력 협약 체결', 0, null],
  ['산업', '글로벌 반도체 컨퍼런스 다음 달 개막', 0, null],
  ['산업', '{peer} CEO, 해외 포럼서 "AI는 이제 시작"', 0, null],
  ['커뮤니티', '"반도체 차트 쌍바닥?" 유튜브 영상 화제', 0, null],
  ['거시', '주간 신규 실업수당 청구 건수 예상 부합', 0, null],
];
export const BROKERS = ['한결증권', '새벽증권', '온새미증권', '다솜투자증권'];

export { gauss, dateOf, isTradingDay, kst, dstr };
