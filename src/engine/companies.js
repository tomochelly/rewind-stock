// Fictional companies. Each has its own price level, sensitivity to the sector index (beta),
// to the AI cycle (ai) and the memory cycle (mem), and idiosyncratic volatility (ivol).
// ipo: listing date (null = already listed when the campaign starts). price: price at campaign start, or the IPO offer price.
import { T0, DAY, isTradingDay, nextTradingDay } from './calendar.js';
import { rngFor, pick } from './rng.js';
import { BACKDROP_END } from './backdrop.js';

export const SEMIS = [
  // US — parody names: each hints at a real company by flipping a word (fictional businesses, fictional prices)
  { id: 'ltk', mk: 'us', name: '인비디아', tkr: 'INVD', sector: 'AI 가속기', beta: 1.3, ai: 1.0, mem: 0, ivol: 0.022, price: 42.6, desc: '데이터센터용 AI 가속기 1위. 이름은 라틴어로 "질투". AI 투자 사이클에 가장 민감해요.' },
  { id: 'orb', mk: 'us', name: '매크로디바이스', tkr: 'MCRD', sector: 'CPU·GPU', beta: 1.4, ai: 0.5, mem: 0, ivol: 0.025, price: 29.8, desc: '마이크로가 아니라 매크로. PC·서버용 CPU와 GPU 2위 업체.' },
  { id: 'kpl', mk: 'us', name: '나노크론', tkr: 'NNCR', sector: '메모리', beta: 1.3, ai: 0.2, mem: 0.9, ivol: 0.022, price: 47.9, desc: '마이크로보다 작은 나노. 미국 유일의 대형 메모리 제조사라 메모리 가격에 크게 흔들려요.' },
  { id: 'srd', mk: 'us', name: 'TMI세미', tkr: 'TMIS', sector: '파운드리', beta: 1.0, ai: 0.5, mem: 0.1, ivol: 0.015, price: 51.3, desc: '첨단 공정 위탁생산 1위. 정보가 너무 많은(TMI) 대만 회사. 해외 상장 주식이에요.' },
  { id: 'arg', mk: 'us', name: 'ASMR리소', tkr: 'ASMR', sector: '노광 장비', beta: 1.1, ai: 0.3, mem: 0.1, ivol: 0.018, price: 263.4, desc: '최첨단 노광 장비를 사실상 독점 공급. 장비 돌아가는 소리가 그렇게 좋대요.' },
  { id: 'nvf', mk: 'us', name: '리플라이드 머티리얼즈', tkr: 'RPLD', sector: '증착·식각 장비', beta: 1.2, ai: 0.2, mem: 0.3, ivol: 0.018, price: 58.7, desc: '증착·식각 장비 대형사. 설비투자 사이클을 따라가요.' },
  { id: 'lmp', mk: 'us', name: '램프리서치', tkr: 'LAMP', sector: '식각 장비', beta: 1.25, ai: 0.3, mem: 0.5, ivol: 0.02, price: 39.8, desc: '식각 장비 강자. 메모리 투자에 특히 민감해요.' },
  { id: 'qtl', mk: 'us', name: '와이드컴', tkr: 'WIDE', sector: '네트워크·맞춤형 칩', beta: 1.0, ai: 0.6, mem: 0, ivol: 0.016, price: 281.5, desc: '브로드보다 넓은 와이드. 데이터센터 네트워크 칩과 빅테크 맞춤형 AI 칩을 설계해요.' },
  { id: 'wdr', mk: 'us', name: '원더러스테크', tkr: 'WNDR', sector: '데이터 인프라 칩', beta: 1.3, ai: 0.8, mem: 0, ivol: 0.028, price: 36.2, desc: '마블러스가 아니라 원더러스. 광통신·맞춤형 칩을 만들어요.' },
  { id: 'hlx', mk: 'us', name: '오클라호마 인스트루먼트', tkr: 'OKIN', sector: '아날로그', beta: 0.7, ai: 0, mem: 0, ivol: 0.012, price: 112.2, desc: '텍사스 옆 동네. 산업·자동차용 아날로그 칩이라 변동성이 낮은 편이에요.' },
  { id: 'vlt', mk: 'us', name: '쿨컴', tkr: 'KOOL', sector: '모바일 AP', beta: 1.0, ai: 0.1, mem: 0.1, ivol: 0.017, price: 77.6, desc: '퀄리티보다 쿨함. 스마트폰용 프로세서와 통신 모뎀.' },
  { id: 'crs', mk: 'us', name: '아웃텔', tkr: 'OUTL', sector: '종합 반도체', beta: 0.9, ai: -0.2, mem: 0.1, ivol: 0.018, drift: -0.0005, price: 52.4, desc: '인사이드가 아니라 아웃사이드. 전통 강자였지만 공정 경쟁에서 밀리는 중이에요.' },
  { id: 'off', mk: 'us', name: '오프세미', tkr: 'OFFS', sector: '전력 반도체', beta: 1.2, ai: 0, mem: 0, ivol: 0.024, drift: -0.0002, price: 21.4, desc: '온이 아니라 오프. 전기차·산업용 전력 반도체.' },
  { id: 'hyp', mk: 'us', name: '하이퍼마이크로', tkr: 'HYPM', sector: 'AI 서버', beta: 1.4, ai: 1.3, mem: 0, ivol: 0.045, price: 9.7, desc: '슈퍼를 넘어 하이퍼. AI 서버 조립 업체라 오르내림이 극단적이에요.' },
  { id: 'ast', mk: 'us', name: '레그홀딩스', tkr: 'LEGH', sector: '설계 IP', beta: 1.3, ai: 0.7, mem: 0, ivol: 0.03, price: 51, ipo: '2023-09-14', desc: '팔(Arm) 대신 다리(Leg). 칩 설계 자산을 라이선스해요. 2023년 상장.' },
  { id: 'bch', mk: 'us', name: '비치디스크', tkr: 'BCHD', sector: '낸드 플래시', beta: 1.4, ai: 0.4, mem: 1.3, ivol: 0.04, price: 52, ipo: '2025-02-24', desc: '모래(Sand) 말고 해변(Beach). 낸드 플래시 전문, 2025년 분사 상장.' },
  { id: 'clr', mk: 'us', name: '코어니트', tkr: 'CRNT', sector: 'AI 클라우드', beta: 1.5, ai: 1.4, mem: 0, ivol: 0.04, price: 40, ipo: '2025-03-28', desc: '짜는(Weave) 대신 뜨는(Knit). AI 칩을 대량으로 사서 빌려주는 클라우드. 빚을 많이 써요.' },
  // KR
  { id: 'ddm', mk: 'kr', name: '사성전자', sector: '메모리·파운드리', beta: 0.95, ai: 0.2, mem: 0.8, ivol: 0.013, price: 44150, desc: '별이 하나 더 많은 국내 최대 종합 반도체 기업. 메모리와 위탁생산을 함께 해요.' },
  { id: 'sem', mk: 'kr', name: '로우닉스', sector: '메모리', beta: 1.3, ai: 0.5, mem: 1.1, ivol: 0.02, price: 77800, desc: '하이 말고 로우. 고대역폭 메모리 강자라 메모리 사이클과 AI에 모두 민감해요.' },
  { id: 'hgb', mk: 'kr', name: '사성전기', sector: '패키지 기판·부품', beta: 1.1, ai: 0.3, mem: 0.3, ivol: 0.02, price: 98200, desc: '사성 그룹의 부품 계열사. 칩을 얹는 고급 기판을 만들어요.' },
  { id: 'grm', mk: 'kr', name: '한중반도체', sector: '후공정 장비', beta: 1.6, ai: 0.9, mem: 0.6, ivol: 0.035, price: 9840, desc: '한미 말고 한중. 메모리 적층 본딩 장비라 작은 회사치고 크게 움직여요.' },
  { id: 'nur', mk: 'kr', name: '하트브레인', sector: '반도체 소재', beta: 1.1, ai: 0, mem: 0.3, ivol: 0.028, price: 21350, desc: '영혼(Soul) 대신 심장(Heart). 식각액·특수 소재를 만들어요.' },
  { id: 'dao', mk: 'kr', name: 'SQL하이텍', sector: '8인치 파운드리', beta: 1.1, ai: 0, mem: 0.2, ivol: 0.025, price: 15200, desc: 'DB 말고 SQL. 전력·아날로그 칩 위탁생산.' },
  { id: 'sbt', mk: 'kr', name: '이노공업', sector: '테스트 소켓', beta: 1.2, ai: 0.3, mem: 0.4, ivol: 0.03, price: 23900, desc: '칩 검사용 소켓과 프로브. 이익률이 높기로 유명해요.' },
  { id: 'ilp', mk: 'kr', name: '일성엔지니어링', sector: '증착 장비', beta: 1.4, ai: 0.2, mem: 0.6, ivol: 0.035, price: 7450, desc: '주(週) 말고 일(日). 메모리 증착 장비 업체.' },
  { id: 'tik', mk: 'kr', name: '투익IPS', sector: '증착 장비', beta: 1.3, ai: 0.1, mem: 0.7, ivol: 0.03, price: 28650, desc: '원(One) 말고 투(Two). 메모리·디스플레이 증착 장비.' },
  { id: 'oit', mk: 'kr', name: '오이테크닉스', sector: '레이저 장비', beta: 1.4, ai: 0.3, mem: 0.3, ivol: 0.035, price: 66800, desc: '이오 말고 오이. 반도체 레이저 마킹·가공 장비.' },
  { id: 'tkt', mk: 'kr', name: '테크테일', sector: '테스트 핸들러', beta: 1.5, ai: 0.4, mem: 0.6, ivol: 0.04, price: 12350, desc: '날개(Wing) 대신 꼬리(Tail). 메모리 테스트 장비.' },
  { id: 'dsl', mk: 'kr', name: '두솔케미칼', sector: '반도체 소재', beta: 1.0, ai: 0, mem: 0.4, ivol: 0.022, price: 101500, desc: '한 솔 말고 두 솔. 공정용 과산화수소·전구체.' },
  { id: 'mrn', mk: 'kr', name: '나온칩스', sector: '디자인하우스', beta: 1.4, ai: 0.6, mem: 0, ivol: 0.04, price: 18000, ipo: '2020-10-27', desc: '가운데(가온)에서 밖으로 나온. 팹리스와 위탁생산을 잇는 설계 서비스. 2020년 상장.' },
  { id: 'ara', mk: 'kr', name: '두나마이크론', sector: '첨단 패키징', beta: 1.4, ai: 0.5, mem: 0.3, ivol: 0.035, price: 21000, ipo: '2022-07-14', desc: '하나 말고 두나. 칩을 쌓고 잇는 첨단 패키징. 2022년 상장.' },
  { id: 'rao', mk: 'kr', name: '앵그리오사AI', sector: 'AI 반도체 팹리스', beta: 1.5, ai: 1.2, mem: 0, ivol: 0.05, price: 25000, ipo: '2024-11-20', desc: '분노(Furious)가 아니라 그냥 화남(Angry). AI 추론용 칩을 설계하는 국내 팹리스. 2024년 상장.' },
];

// Everything else, by theme. th = theme loadings, base = 'broad' (moves with the broad index) unless 'semi'. small = prone to spikes.
const X = (id, mk, name, tkr, theme, beta, th, ivol, price, desc, extra = {}) => ({ id, mk, name, tkr, sector: extra.sector || null, theme, beta, th, ivol, price, desc, base: 'broad', ...extra });
export const MORE = [
  // KR — 2차전지
  X('ecp', 'kr', '에고프로', null, 'bat', 1.3, { bat: 1.5 }, 0.035, 21800, '에코 말고 에고(Ego). 양극재 소재 지주사라 2차전지 테마의 대장 노릇을 해요.', { small: true }),
  X('ecb', 'kr', '에고프로비엠', null, 'bat', 1.3, { bat: 1.3 }, 0.03, 64500, '에고프로의 양극재 자회사.'),
  X('mnf', 'kr', '엠앤에프', null, 'bat', 1.3, { bat: 1.3 }, 0.03, 31200, 'L 다음은 M. 양극재 업체.'),
  X('sdi', 'kr', '사성SDI', null, 'bat', 1.0, { bat: 0.9 }, 0.018, 238000, '사성 그룹의 배터리 회사.'),
  X('pfm', 'kr', '포스트퓨처엠', null, 'bat', 1.1, { bat: 1.1 }, 0.022, 17150, '포스코 말고 포스트(Post). 양·음극재를 함께 만들어요.'),
  X('lje', 'kr', 'LJ에너지솔루션', null, 'bat', 1.0, { bat: 0.9 }, 0.02, 300000, 'G 다음은 J. 국내 최대 배터리 셀 업체, 2022년 상장.', { ipo: '2022-01-27' }),
  // KR — 바이오
  X('cel', 'kr', '셀트리오', null, 'bio', 0.9, { bio: 1.0 }, 0.02, 178000, '넷이 아니라 셋(Trio). 바이오시밀러 대표 기업.'),
  X('sbl', 'kr', '사성바이오로직스', null, 'bio', 0.7, { bio: 0.6 }, 0.016, 305000, '사성 그룹의 바이오 위탁생산.'),
  X('alg', 'kr', '올테오젠', null, 'bio', 1.2, { bio: 1.5 }, 0.04, 31200, 'Al 말고 All. 플랫폼 기술 수출로 유명한 바이오텍.', { small: true }),
  X('xgn', 'kr', '엑스젠', null, 'bio', 1.1, { bio: 1.5 }, 0.04, 17600, 'C 대신 X. 분자진단 키트 업체라 감염병 뉴스에 민감해요.', { small: true }),
  X('hlc', 'kr', 'HLC', null, 'bio', 1.3, { bio: 1.6 }, 0.045, 23400, 'B 다음은 C. 신약 허가 하나에 회사 운명이 걸린 바이오.', { small: true }),
  // KR — 방산·조선·원전·전력
  X('hpa', 'kr', '한파에어로스페이스', null, 'def', 1.0, { def: 1.3 }, 0.022, 34500, '한화 말고 한파(寒波). 자주포와 항공 엔진을 만드는 방산 대장주.'),
  X('lig', 'kr', 'LIG넥스투', null, 'def', 0.9, { def: 1.2 }, 0.022, 33800, '원 다음은 투. 유도무기 전문.'),
  X('hrt', 'kr', '현재로템', null, 'def', 1.0, { def: 1.0, auto: 0.2 }, 0.025, 19650, '현대 말고 현재. 전차와 철도 차량.'),
  X('kae', 'kr', '한국항공지구', null, 'def', 1.0, { def: 0.9, space: 0.4 }, 0.02, 33200, '우주 말고 지구. 국산 전투기와 헬기를 만들어요.'),
  X('hdh', 'kr', 'HD현재중공업', null, 'ship', 1.0, { ship: 1.2 }, 0.022, 112000, '세계 1위 조선사(가상).'),
  X('hpo', 'kr', '한파오션', null, 'ship', 1.1, { ship: 1.3, def: 0.3 }, 0.028, 26500, '한파 그룹의 조선소. 군함도 만들어요.'),
  X('ssh', 'kr', '사성중공업', null, 'ship', 1.1, { ship: 1.3 }, 0.026, 7720, '사성 그룹의 조선소.'),
  X('dse', 'kr', '세산에너빌리티', null, 'nuc', 1.2, { nuc: 1.3, power: 0.3 }, 0.028, 11950, '두 산 말고 세 산. 원전 주기기와 가스터빈.'),
  X('ksg', 'kr', '한선기술', null, 'nuc', 1.0, { nuc: 1.2 }, 0.025, 21800, '원전 설계 전문.'),
  X('hde', 'kr', 'HD현재일렉트릭', null, 'power', 1.2, { power: 1.6 }, 0.03, 24300, '변압기 수출이 터지면서 전력기기 대장주가 됐어요.'),
  X('lte', 'kr', 'LT일렉트릭', null, 'power', 1.1, { power: 1.3 }, 0.026, 51200, 'S 다음은 T. 전력 인프라 장비.'),
  // KR — 로봇·엔터·게임·플랫폼·자동차·금융·코인·테마
  X('rbw', 'kr', '무지개로보틱스', null, 'robot', 1.4, { robot: 1.6 }, 0.045, 18900, '레인보우를 우리말로. 협동로봇과 휴머노이드.', { small: true }),
  X('dsr', 'kr', '세산로보틱스', null, 'robot', 1.3, { robot: 1.3 }, 0.04, 26000, '세산 그룹 협동로봇 자회사. 2023년 상장.', { ipo: '2023-10-05' }),
  X('hyp2', 'kr', '하이프', null, 'ent', 1.0, { ent: 1.2 }, 0.028, 135000, '벌집(Hive) 말고 과대광고(Hype). 아이돌 기획사, 2020년 상장.', { ipo: '2020-10-15' }),
  X('jyb', 'kr', 'JYB엔터', null, 'ent', 1.0, { ent: 1.0 }, 0.026, 25300, 'P 다음은 B. 아이돌 기획사.'),
  X('snt', 'kr', 'SN엔터', null, 'ent', 1.0, { ent: 1.0 }, 0.026, 41200, 'M 다음은 N. 1세대 기획사.'),
  X('nch', 'kr', '엔씨하드', null, 'game', 1.0, { game: 1.1 }, 0.022, 455000, '소프트 말고 하드. 한때 황제주였던 게임사.', { drift: -0.0004 }),
  X('drf', 'kr', '드래프톤', null, 'game', 1.0, { game: 1.0 }, 0.025, 498000, '크래프트 말고 드래프트. 배틀로얄 게임 하나로 큰 회사, 2021년 상장.', { ipo: '2021-08-10' }),
  X('jsy', 'kr', '진주심연', null, 'game', 1.2, { game: 1.3 }, 0.035, 172000, '펄(Pearl) 어비스(Abyss)를 우리말로. 신작 출시일만 기다리는 게임사.', { small: true }),
  X('nvr', 'kr', '네버', null, 'plat', 0.9, { plat: 1.0, ai: 0.2 }, 0.018, 128000, '네이버 말고 네버(Never). 국내 1위 포털.'),
  X('cco', 'kr', '코코아', null, 'plat', 1.1, { plat: 1.3 }, 0.024, 26700, '카카오 말고 코코아. 국민 메신저 회사.'),
  X('ccb', 'kr', '코코아뱅크', null, 'plat', 1.1, { plat: 1.0, bank: 0.5 }, 0.03, 39000, '코코아의 인터넷은행, 2021년 상장.', { ipo: '2021-08-06' }),
  X('hmc', 'kr', '현재차', null, 'auto', 0.9, { auto: 1.0 }, 0.018, 128500, '현대 말고 현재. 국내 1위 완성차.'),
  X('gea', 'kr', '기어', null, 'auto', 0.9, { auto: 1.0 }, 0.018, 38900, '기아 말고 기어(Gear).'),
  X('kcf', 'kr', 'KC금융', null, 'bank', 0.8, { bank: 1.0 }, 0.014, 45100, 'B 다음은 C. 대형 금융지주.'),
  X('ghj', 'kr', '구한지주', null, 'bank', 0.8, { bank: 1.0 }, 0.014, 42800, '신(新) 말고 구(舊). 대형 금융지주.'),
  X('ntt', 'kr', '너희기술투자', null, 'coin', 1.3, { coin: 1.3 }, 0.05, 2150, '우리 말고 너희. 코인 거래소 지분 때문에 코인 시세를 따라가요.', { small: true }),
  X('gsd', 'kr', '구성델타테크', null, 'meme', 1.2, { meme: 0.2 }, 0.05, 2890, '신성 말고 구성. 엉뚱한 테마에 자주 엮이는 소형주.', { small: true }),
  // US — 빅테크·플랫폼
  X('pear', 'us', '페어', 'PEAR', 'big', 1.0, { big: 1.0 }, 0.014, 44.3, '사과 말고 배. 스마트폰과 PC, 서비스.'),
  X('mch', 'us', '매크로하드', 'MCHD', 'big', 0.95, { big: 1.0, ai: 0.3 }, 0.013, 125.4, '마이크로→매크로, 소프트→하드. 클라우드와 오피스 소프트웨어.'),
  X('nile', 'us', '나일', 'NILE', 'big', 1.1, { big: 1.0, plat: 0.3 }, 0.017, 89.2, '아마존 말고 나일강. 전자상거래와 클라우드.'),
  X('omg', 'us', '오메가벳', 'OMGA', 'big', 1.0, { big: 1.0, ai: 0.3 }, 0.015, 54.6, '알파 말고 오메가. 검색 광고와 클라우드.'),
  X('bta', 'us', '베타플랫폼', 'BETA', 'big', 1.2, { big: 1.0, plat: 0.6 }, 0.022, 175.1, '메타 말고 베타. 소셜 미디어 공룡.'),
  X('nfp', 'us', '넷플립', 'NFLP', 'big', 1.0, { big: 0.6, ent: 0.5 }, 0.022, 34.6, '플릭스 말고 플립. 동영상 스트리밍.'),
  X('eds', 'us', '에디슨모터스', 'EDSN', 'auto', 1.6, { auto: 1.8, ai: 0.3 }, 0.04, 14.8, '테슬라의 라이벌 에디슨. 전기차, 그리고 CEO의 말 한마디.'),
  // US — 바이오·방산·원전·전력·우주·양자
  X('cls', 'us', '클래식나', 'CLSC', 'bio', 1.2, { bio: 1.6 }, 0.04, 16.5, '모던 말고 클래식. mRNA 백신 회사.', { small: true }),
  X('ros', 'us', '일라이 로즈', 'ROSE', 'bio', 0.6, { bio: 0.5 }, 0.014, 121.0, '백합 말고 장미. 비만 치료제 강자.', { drift: 0.0009 }),
  X('wyz', 'us', '와이자', 'WYZR', 'bio', 0.6, { bio: 0.6 }, 0.013, 41.0, 'F 대신 W. 거대 제약사.'),
  X('rkm', 'us', '록키드 마틴', 'RKMT', 'def', 0.7, { def: 1.0 }, 0.012, 300.2, '히드 대신 키드. 전투기를 만드는 방산 거인.'),
  X('pln', 'us', '팔란티리', 'PLNR', 'ai', 1.4, { ai: 0.9, def: 0.5 }, 0.04, 10, '팔란티어 말고 팔란티리. 정부·국방 데이터 분석, 2020년 상장.', { ipo: '2020-09-30', small: true }),
  X('ods', 'us', '올드스케일', 'OLDS', 'nuc', 1.5, { nuc: 2.0 }, 0.06, 10, '뉴(New) 말고 올드(Old). 소형 원자로 개발사, 2022년 상장.', { ipo: '2022-05-03', small: true }),
  X('okr', 'us', '오클로로', 'OKLR', 'nuc', 1.6, { nuc: 2.2, ai: 0.4 }, 0.065, 10, '데이터센터용 소형 원전 스타트업, 2024년 상장.', { ipo: '2024-05-10', small: true }),
  X('hrz', 'us', '호리즌티브', 'HRZT', 'power', 1.3, { power: 1.3, ai: 0.6 }, 0.03, 10.6, '세로(Vertical) 말고 가로(Horizontal). 데이터센터 전력·냉각 장비.'),
  X('rkk', 'us', '로켓키친', 'RKTK', 'space', 1.7, { space: 1.8 }, 0.05, 10, '랩(Lab) 말고 키친. 소형 발사체, 2021년 상장.', { ipo: '2021-08-25', small: true }),
  X('asd', 'us', 'ASD스페이스', 'ASDS', 'space', 1.8, { space: 2.0 }, 0.06, 10, '위성으로 휴대폰 통신을 하겠다는 회사, 2021년 상장.', { ipo: '2021-04-07', small: true }),
  X('ionp', 'us', '아이온P', 'IONP', 'quant', 1.6, { quant: 1.8 }, 0.06, 10, 'Q 다음은 P. 이온 트랩 양자컴퓨터, 2021년 상장.', { ipo: '2021-10-01', small: true }),
  X('spg', 'us', '스파게티 컴퓨팅', 'SPGT', 'quant', 1.8, { quant: 2.2 }, 0.07, 10, '리게티 말고 스파게티. 초전도 양자컴퓨터, 2022년 상장.', { ipo: '2022-03-02', small: true }),
  // US — 코인·밈·AI 소프트웨어·금융
  X('cir', 'us', '코인루프', 'COIR', 'coin', 1.3, { coin: 1.2 }, 0.04, 381, '바닥(Base) 말고 지붕(Roof). 코인 거래소, 2021년 직상장.', { ipo: '2021-04-14' }),
  X('nns', 'us', '나노스트래티지', 'NANS', 'coin', 1.5, { coin: 1.8 }, 0.045, 12.4, '마이크로 말고 나노. 회사 돈으로 코인을 사 모아요.'),
  X('hfm', 'us', '하프마라톤', 'HFMR', 'coin', 1.7, { coin: 2.0 }, 0.06, 0.9, '풀 말고 하프. 코인 채굴 업체.', { small: true }),
  X('ggo', 'us', '게임고', 'GMGO', 'meme', 1.2, { meme: 1.5, game: 0.3 }, 0.05, 5.6, '스톱(Stop) 말고 고(Go). 게임 소매점이자 개미들의 성지.', { small: true }),
  X('bmc', 'us', 'BMC 시네마', 'BMCE', 'meme', 1.2, { meme: 1.6, ent: 0.3 }, 0.05, 7.8, 'A 다음은 B. 극장 체인이자 밈 주식.', { small: true }),
  X('c4', 'us', 'C4.ai', 'CFAI', 'ai', 1.4, { ai: 1.0 }, 0.05, 42, '3.ai보다 하나 더. 기업용 AI 소프트웨어, 2020년 상장.', { ipo: '2020-12-09', small: true }),
  X('rnf', 'us', '레인플레이크', 'RNFK', 'big', 1.3, { big: 0.6, ai: 0.4 }, 0.03, 120, '눈송이 말고 빗방울. 클라우드 데이터 플랫폼, 2020년 상장.', { ipo: '2020-09-16' }),
  X('jpm', 'us', 'JP모닝', 'JPMN', 'bank', 0.8, { bank: 1.0 }, 0.013, 105.2, '모건(Morgan) 말고 모닝(Morning). 미국 최대 은행.'),
];

export const ETFS = [
  { id: 'us3x', mk: 'us', name: '반도체 불 3X', sector: '레버리지 ETF', k: 3, price: 24.6, etf: true, desc: '반도체 지수 하루 수익률의 3배를 따라가요. 매일 배율을 다시 맞춰서, 오르내림이 반복되면 값이 깎여요.' },
  { id: 'usm3x', mk: 'us', name: '반도체 베어 3X', sector: '인버스 ETF', k: -3, price: 31.2, etf: true, desc: '반도체 지수 하루 수익률의 -3배. 지수가 빠지는 날 크게 올라요.' },
  { id: 'kr2x', mk: 'kr', name: '반도체 레버리지 2X', sector: '레버리지 ETF', k: 2, price: 8635, etf: true, desc: '국내 반도체 지수 하루 수익률의 2배.' },
  { id: 'krm2x', mk: 'kr', name: '반도체 인버스 2X', sector: '인버스 ETF', k: -2, price: 4870, etf: true, desc: '국내 반도체 지수 하루 수익률의 -2배.' },
  { id: 'kbx2', mk: 'kr', name: '코스비 레버리지 2X', sector: '레버리지 ETF', k: 2, price: 14250, etf: true, base: 'broad', desc: '코스비 지수 하루 수익률의 2배.' },
  { id: 'kbi', mk: 'kr', name: '코스비 인버스', sector: '인버스 ETF', k: -1, price: 4920, etf: true, base: 'broad', desc: '코스비 지수 하루 수익률의 -1배.' },
  { id: 'nd3x', mk: 'us', name: '나스닭 불 3X', sector: '레버리지 ETF', k: 3, price: 18.9, etf: true, base: 'broad', desc: '나스닭 지수 하루 수익률의 3배. 개미들의 최애 레버리지.' },
  { id: 'ndm3x', mk: 'us', name: '나스닭 베어 3X', sector: '인버스 ETF', k: -3, price: 41.5, etf: true, base: 'broad', desc: '나스닭 지수 하루 수익률의 -3배.' },
];

// Procedural IPOs after the real backdrop ends: deterministic per 28-day block.
const SYL1 = ['하늘', '바다', '푸른', '은하', '새벽', '라온', '다올', '이음', '모아', '한울', '누리', '아름'];
const SYL2 = ['칩스', '세미', '실리콘', '테크', '반도체', '로직', '포토닉스', '시스템즈'];
const EN1 = ['Nova', 'Vela', 'Quanta', 'Lumen', 'Orion', 'Zeno', 'Atlas', 'Helio', 'Kairo', 'Myri'];
const EN2 = ['Logic', 'Photon', 'Wafer', 'Neural', 'Silica', 'Volt', 'Grid'];
const EN_KO = { Nova: '노바', Vela: '벨라', Quanta: '콴타', Lumen: '루멘', Orion: '오리온', Zeno: '제노', Atlas: '아틀라스', Helio: '헬리오', Kairo: '카이로', Myri: '미리',
  Logic: '로직', Photon: '포톤', Wafer: '웨이퍼', Neural: '뉴럴', Silica: '실리카', Volt: '볼트', Grid: '그리드' };
const IPO_SECTORS = [['광 반도체', 'semi', { ai: 0.6 }], ['AI 추론 칩', 'semi', { ai: 1.3 }], ['차세대 메모리', 'semi', { mem: 1.0, ai: 0.4 }], ['휴머노이드 로봇', 'robot', { robot: 1.6, ai: 0.4 }], ['소형 원자로', 'nuc', { nuc: 2.0 }], ['우주 인터넷', 'space', { space: 2.0 }], ['비만 치료제', 'bio', { bio: 1.5 }], ['양자 보안', 'quant', { quant: 2.0 }], ['드론 방산', 'def', { def: 1.5 }], ['전고체 배터리', 'bat', { bat: 1.6 }], ['AI 에이전트 SW', 'ai', { ai: 1.4 }]];

export function futureIpos(seed, uptoT) {
  const out = [];
  const startBlock = BACKDROP_END;
  for (let b = 0, bt = startBlock; bt <= uptoT; b++, bt = startBlock + b * 28 * DAY) {
    for (const mk of ['kr', 'us']) {
      const r = rngFor(seed, 'ipo', mk, b);
      if (r() > 0.2) continue;
      let t = bt + Math.floor(r() * 20) * DAY;
      while (!isTradingDay(mk, t)) t = nextTradingDay(mk, t);
      if (t > uptoT + 30 * DAY) continue;
      const [sector, theme, th] = pick(r, IPO_SECTORS);
      let name, tkr;
      if (mk === 'kr') name = pick(r, SYL1) + pick(r, SYL2);
      else { const a = pick(r, EN1), c = pick(r, EN2); name = EN_KO[a] + EN_KO[c]; tkr = (a.slice(0, 2) + c.slice(0, 2)).toUpperCase(); }
      const price = mk === 'kr' ? Math.round((8000 + r() * 40000) / 100) * 100 : Math.round(15 + r() * 45);
      out.push({ id: 'f' + mk + b, mk, name, tkr, sector, theme, th, base: theme === 'semi' ? 'semi' : 'broad', beta: 1.2 + r() * 0.5, ai: th.ai || 0, mem: th.mem || 0, ivol: 0.03 + r() * 0.03, price,
        ipoT: t, desc: '새로 상장한 ' + sector + ' 기업 (가상).', future: true, small: true });
    }
  }
  return out;
}

export const ROSTER = [...SEMIS.map((c) => ({ ...c, base: 'semi', theme: 'semi', th: { ai: c.ai, mem: c.mem }, small: c.ivol >= 0.035 })), ...MORE];
ROSTER.forEach((c) => { if (!c.sector) c.sector = { bat: '2차전지', bio: '바이오', def: '방산', ship: '조선', nuc: '원전', power: '전력기기', robot: '로봇', ent: '엔터', game: '게임', plat: '플랫폼', auto: '자동차', bank: '금융', coin: '코인', meme: '밈', big: '빅테크', space: '우주항공', quant: '양자컴퓨터', ai: 'AI 소프트웨어' }[c.theme]; });
