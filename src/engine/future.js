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
const evCache = new Map();
export function futureEvent(seed, d) { // d: date (00:00 KST)
  if (d <= BACKDROP_END) return null;
  const key = seed + ':' + d;
  if (evCache.has(key)) return evCache.get(key);
  let ev = null;
  const w = dow(d);
  if (w !== 0 && w !== 6) {
    const r = rngFor(seed, 'fev', d);
    if (r() < 0.06) {
      const [sign, text, size] = pick(r, EVENTS);
      const morning = r() < 0.35; // 08:20 KST: hits KR the same day; 21:10 KST: hits US the same day, KR the next day
      const mag = size * (0.6 + r() * 0.8) * sign;
      ev = { t: d + (morning ? 8 * 3600 + 20 * 60 : 21 * 3600 + 10 * 60), morning, text, major: Math.abs(mag) > 0.03, mag, mk: 'all' };
    }
  }
  evCache.set(key, ev);
  return ev;
}

// Total future-event effect on a market's trading day t: {g, r}
export function futureEffect(seed, mk, t) {
  let g = 0, r = 0;
  if (t <= BACKDROP_END) return { g, r };
  const apply = (ev, f) => { if (ev) { g += ev.mag * f * 0.8; r += ev.mag * f; } };
  if (mk === 'us') {
    const ev = futureEvent(seed, t);
    if (ev) apply(ev, 1);
  } else {
    const prev = prevTradingDay('kr', t);
    for (let d = prev; d <= t; d += DAY) {
      const ev = futureEvent(seed, d);
      if (!ev) continue;
      if (d === t && ev.morning) apply(ev, 0.9);
      else if (d < t && (!ev.morning || d > prev)) apply(ev, 0.75);
    }
  }
  return { g, r };
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
