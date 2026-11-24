/* 지금제철 — KAMIS 시세 (부류별 일일 소매가격)
 *
 * 공식 문서 : https://www.kamis.or.kr/customer/reference/openapi_list.do (일별 부류별 도.소매가격정보)
 *   action=dailyPriceByCategoryList / p_product_cls_code=01(소매) / p_item_category_code / p_regday(전날) / p_returntype=json
 *   응답 data.item[] : item_code, kind_code, rank_code, rank, unit, day1·dpr1(조회일 가격) … day7·dpr7(평년 가격)
 *   가격이 없으면 "-", 오류 코드 : 000 성공 / 001 no data / 200 Wrong Parameters / 900 Unauthenticated
 *
 * 인증키는 소스에 넣지 않는다. config.local.js(깃 제외, build/make-config.mjs 로 환경변수에서 생성)의
 *   window.NOW_JECHEOL_CONFIG = { kamisCertKey, kamisCertId } 를 읽는다. 없으면 시세 기능만 끈다.
 *
 * 가격은 API 응답 값만 쓰고, 매핑되지 않은 품목에는 시세를 붙이지 않는다.
 */
(function () {
  'use strict';

  const ENDPOINT = 'https://www.kamis.or.kr/service/price/xml.do';
  const CACHE_PREFIX = 'now_jecheol.kamis.';      // + regday + '.' + 부류코드
  const CACHE_KEEP_DAYS = 3;

  /*
   * 품목 매핑 : 우리 품목 id → KAMIS 후보 [{ cat: 부류코드, item: 품목코드, kinds: [품종코드 우선순위] }]
   * productInfo(코드표) 응답의 품목명·품종명으로 확인한 것만 넣었다. (2026-11-24 확인)
   * 같은 품목의 다른 상품(수입·냉동수입·염장·굴비·세척수입 등)은 넣지 않았다.
   */
  const MAP = {
    // ---- 과일 ----
    1:  [{ cat: '200', item: '226', kinds: ['00'] }],                         // 딸기(시설) ← 딸기 / 설향
    3:  [{ cat: '400', item: '439', kinds: ['02'] }],                         // 천혜향 ← 만감 / 천혜향
    4:  [{ cat: '400', item: '439', kinds: ['01'] }],                         // 한라봉 ← 만감 / 한라봉
    5:  [{ cat: '400', item: '413', kinds: ['05', '01', '04'] }],             // 복숭아 ← 복숭아 / 유명·백도·창방조생
    6:  [{ cat: '400', item: '429', kinds: ['01'] }],                         // 블루베리 ← 블루베리 / 블루베리 (수입냉동 제외)
    8:  [{ cat: '200', item: '221', kinds: ['00'] }],                         // 수박 ← 수박
    9:  [{ cat: '200', item: '222', kinds: ['00'] }],                         // 참외 ← 참외
    11: [{ cat: '400', item: '411', kinds: ['05', '07', '08', '06', '01'] }], // 사과 ← 사과 / 후지·홍로·시나노골드·쓰가루·홍옥
    14: [{ cat: '400', item: '412', kinds: ['01', '02', '03', '04'] }],       // 배 ← 배 / 신고·만삼길·장십랑·원황
    15: [{ cat: '400', item: '414', kinds: ['01', '12'] }],                   // 포도 ← 포도 / 캠벨얼리·샤인머스켓 (거봉은 16번)
    16: [{ cat: '400', item: '414', kinds: ['02'] }],                         // 거봉 ← 포도 / 거봉
    17: [{ cat: '400', item: '416', kinds: ['00', '01'] }],                   // 단감 ← 단감 / 부유·서촌
    19: [{ cat: '400', item: '415', kinds: ['01'] }],                         // 노지감귤 ← 감귤 / 노지
    // ---- 채소 ----
    24: [{ cat: '200', item: '232', kinds: ['01', '00'] }],                   // 당근 ← 당근 / 무세척(국산)·당근 (세척(수입) 제외)
    25: [{ cat: '200', item: '213', kinds: ['00'] }],                         // 시금치
    26: [{ cat: '200', item: '217', kinds: ['01'] }],                         // 연근
    27: [{ cat: '200', item: '254', kinds: ['00'] }],                         // 부추
    32: [{ cat: '200', item: '245', kinds: ['00', '02'] }],                   // 양파 ← 양파 / 양파·햇양파
    33: [{ cat: '100', item: '152', kinds: ['01', '04', '03', '00'] }],       // 감자 ← 감자 / 수미(노지)·수미(시설)·노지·감자 (식량작물 부류)
    34: [{ cat: '200', item: '258', kinds: ['01', '05', '03', '06', '04'] }], // 마늘 ← 깐마늘(국산) / 깐마늘(국산)·(남도)·(대서)·햇깐마늘
    35: [{ cat: '200', item: '224', kinds: ['01'] }],                         // 애호박 ← 호박 / 애호박
    36: [{ cat: '200', item: '223', kinds: ['02', '01', '03'] }],             // 오이 ← 오이 / 다다기·가시·취청
    38: [{ cat: '200', item: '422', kinds: ['01', '02'] }],                   // 방울토마토 ← 방울토마토 / 방울토마토·대추방울토마토
    39: [{ cat: '200', item: '225', kinds: ['00'] }],                         // 토마토
    41: [{ cat: '200', item: '224', kinds: ['03'] }],                         // 단호박 ← 호박 / 단호박
    42: [{ cat: '100', item: '151', kinds: ['00'] }],                         // 고구마 ← 고구마 / 밤 (식량작물 부류)
    44: [{ cat: '200', item: '246', kinds: ['00'] }],                         // 대파 ← 파 / 대파
    45: [{ cat: '200', item: '280', kinds: ['00'] }, { cat: '200', item: '261', kinds: ['01'] }], // 브로콜리 ← 브로콜리(국산) / 브로콜리
    48: [{ cat: '200', item: '231', kinds: ['03', '06', '01', '02'] }],       // 무 ← 무 / 가을·월동·봄·고랭지
    49: [{ cat: '200', item: '211', kinds: ['03', '06', '01', '02'] }],       // 배추 ← 배추 / 가을·월동·봄·여름(고랭지)
    50: [{ cat: '200', item: '247', kinds: ['00'] }],                         // 생강 ← 생강 / 국산 (수입 제외)
    51: [{ cat: '200', item: '246', kinds: ['02'] }],                         // 쪽파 ← 파 / 쪽파
    // ---- 수산물 ----
    52: [{ cat: '600', item: '644', kinds: ['00'] }],                         // 굴
    53: [{ cat: '600', item: '641', kinds: ['00'] }],                         // 김 ← 김 / 마른김 (구운김 제외)
    54: [{ cat: '600', item: '665', kinds: ['00'] }],                         // 꼬막 ← 꼬막 / 국산(새꼬막)
    58: [{ cat: '600', item: '614', kinds: ['05', '06', '04'] }],             // 참조기 ← 조기 / 참조기(신선 냉장)·참조기(냉동) (굴비 제외)
    60: [{ cat: '600', item: '642', kinds: ['00'] }],                         // 미역 ← 마른미역
    62: [{ cat: '600', item: '661', kinds: ['00'] }],                         // 바지락 ← 바지락 / 냉장
    67: [{ cat: '600', item: '660', kinds: ['01'] }],                         // 다시마 ← 건다시마 / 완도산
    70: [{ cat: '600', item: '653', kinds: ['00'] }],                         // 전복 ← 전복 / 냉장
    71: [{ cat: '600', item: '611', kinds: ['05', '01', '06'] }],             // 고등어 ← 고등어 / 국산(신선 냉장)·생선·국산(냉동) (염장·수입 제외)
    72: [{ cat: '600', item: '656', kinds: ['04', '05', '00'] }],             // 꽃게 ← 꽃게 / 암꽃게(냉장)·수꽃게(냉장)·냉동
    75: [{ cat: '600', item: '663', kinds: ['01'] }],                         // 전어 ← 전어 / 냉장
    77: [{ cat: '600', item: '613', kinds: ['03', '01', '04'] }],             // 갈치 ← 갈치 / 국산(냉장)·생선·국산(냉동) (수입 제외)
  };
  // 매핑하지 않은 품목 (KAMIS 코드표에 없거나, 수입품·다른 상품만 있음)
  //  레드향 살구 천도복숭아 자두 밤 대추 대봉감 키위(참다래 : KAMIS는 골드 키위만) 황금향
  //  냉이 풋마늘 곰취 두릅 아스파라거스 완두콩 풋콩 늙은호박 토란 표고버섯(소매가 조사 없음)
  //  대게 방어 아귀 청어 도다리 꼴뚜기 미더덕 숭어 키조개 병어 농어 대하
  //  낙지(수입 냉동만) 흰다리새우(수입만) 꽁치(냉동 수입만) 도루묵

  // 등급 우선순위 : 상품 → 등급없음(-) → 과일 크기(M·L·S과) → 생선 크기(中·大·小) → 중품
  const RANK_ORDER = ['04', '30', '15', '24', '16', '21', '20', '22', '05'];

  const categories = [...new Set(Object.values(MAP).flat().map((c) => c.cat))];

  // ---------------- 날짜 ----------------
  const pad = (n) => String(n).padStart(2, '0');
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  /** 조회일 : 기기 날짜의 전날 (당일 데이터는 아직 없을 수 있음) */
  function regday(now) { const d = new Date(now || Date.now()); d.setDate(d.getDate() - 1); return ymd(d); }

  // ---------------- 설정 (인증키) ----------------
  function credentials() {
    const c = window.NOW_JECHEOL_CONFIG || {};
    const key = typeof c.kamisCertKey === 'string' ? c.kamisCertKey.trim() : '';
    const id = typeof c.kamisCertId === 'string' ? c.kamisCertId.trim() : '';
    return key && id ? { key, id } : null;
  }

  // ---------------- 캐시 (기기 저장) ----------------
  function cacheGet(day, cat) {
    try { const v = localStorage.getItem(CACHE_PREFIX + day + '.' + cat); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function cacheSet(day, cat, value) {
    try { localStorage.setItem(CACHE_PREFIX + day + '.' + cat, JSON.stringify(value)); } catch (e) { /* 저장 불가 : 이번 실행만 */ }
  }
  /** 며칠 지난 캐시 정리 */
  function cachePrune(today) {
    try {
      const limit = new Date(today + 'T00:00:00'); limit.setDate(limit.getDate() - CACHE_KEEP_DAYS);
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(CACHE_PREFIX)) continue;
        const day = k.slice(CACHE_PREFIX.length, CACHE_PREFIX.length + 10);
        if (new Date(day + 'T00:00:00') < limit) localStorage.removeItem(k);
      }
    } catch (e) { /* 무시 */ }
  }

  // ---------------- 호출 ----------------
  const toPrice = (s) => {
    const n = Number(String(s == null ? '' : s).replace(/,/g, '').trim());
    return String(s).trim() && String(s).trim() !== '-' && Number.isFinite(n) && n > 0 ? n : null;
  };

  /**
   * 한 부류 조회 : 캐시가 있으면 API를 부르지 않는다.
   * 결과 { status: 'ok' | 'nodata' | 'error', rows: [...] }
   *   ok·nodata·error(인증 실패 등 API 응답 오류)는 그날 캐시한다. 네트워크 실패는 캐시하지 않는다(다음 실행 때 다시).
   */
  async function fetchCategory(day, cat, cred) {
    const cached = cacheGet(day, cat);
    if (cached) return cached;
    const params = new URLSearchParams({
      action: 'dailyPriceByCategoryList', p_product_cls_code: '01', p_country_code: '', p_regday: day,
      p_convert_kg_yn: 'N', p_item_category_code: cat, p_cert_key: cred.key, p_cert_id: cred.id, p_returntype: 'json',
    });
    const res = await fetch(ENDPOINT + '?' + params.toString(), { cache: 'no-store' });   // 네트워크 실패면 throw (캐시 안 함)
    let result;
    try {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = JSON.parse(await res.text());
      const data = json && json.data;
      const code = data && (Array.isArray(data.error_code) ? data.error_code[0] : data.error_code);
      const items = data && Array.isArray(data.item) ? data.item : [];
      if (items.length) {
        result = { status: 'ok', rows: items.map((r) => ({
          item: String(r.item_code), kind: String(r.kind_code), rank: String(r.rank_code), rankName: r.rank, kindName: r.kind_name,
          unit: r.unit, dayLabel: r.day1, today: toPrice(r.dpr1), normal: toPrice(r.dpr7),
        })) };
      } else {
        result = { status: String(code) === '001' || String(data) === '001' ? 'nodata' : 'error', code: code || String(data || ''), rows: [] };
      }
    } catch (e) {
      result = { status: 'error', code: e.message, rows: [] };
    }
    cacheSet(day, cat, result);
    return result;
  }

  // ---------------- 품목 시세 고르기 · 판정 ----------------
  /** 매핑 후보 중 당일가가 있는 행 (평년가까지 있는 행 우선, 품종·등급 순서대로) */
  function pickRow(itemId, byCat) {
    const cands = MAP[itemId];
    if (!cands) return null;
    const ordered = [];
    cands.forEach((c) => {
      const rows = (byCat[c.cat] && byCat[c.cat].rows) || [];
      c.kinds.forEach((k) => {
        rows.filter((r) => r.item === c.item && r.kind === k)
          .sort((a, b) => rankIdx(a.rank) - rankIdx(b.rank))
          .forEach((r) => ordered.push(r));
      });
    });
    return ordered.find((r) => r.today && r.normal) || ordered.find((r) => r.today) || null;
  }
  const rankIdx = (r) => { const i = RANK_ORDER.indexOf(r); return i < 0 ? 99 : i; };

  /** 판정 : 당일가 vs 평년가 (평년가 없으면 판정 안 함) */
  function judge(today, normal) {
    if (!today || !normal) return null;
    if (today < normal * 0.9) return 'cheap';
    if (today < normal) return 'bitcheap';
    if (today > normal * 1.1) return 'pricey';
    return null;
  }
  const LABEL = { cheap: '지금 사면 싸요', bitcheap: '평년보다 조금 싸요', pricey: '평년보다 비싸요' };

  /**
   * 전체 시세 불러오기 (부류마다 하루 1번)
   * 결과 Map<품목 id, { price, normal, changePct, verdict, label, unit, regday, kindName, rankName }>
   *   인증키가 없거나 모든 부류가 실패하면 빈 Map
   */
  async function load(now) {
    const cred = credentials();
    const out = { enabled: !!cred, regday: regday(now), prices: new Map(), status: {} };
    if (!cred) return out;
    cachePrune(out.regday);
    const byCat = {};
    await Promise.all(categories.map(async (cat) => {
      try { byCat[cat] = await fetchCategory(out.regday, cat, cred); out.status[cat] = byCat[cat].status; }
      catch (e) { out.status[cat] = 'offline'; }
    }));
    Object.keys(MAP).forEach((id) => {
      const r = pickRow(Number(id), byCat);
      if (!r) return;
      const verdict = judge(r.today, r.normal);
      out.prices.set(Number(id), {
        price: r.today, normal: r.normal,
        changePct: r.normal ? (r.today - r.normal) / r.normal * 100 : null,
        verdict, label: verdict ? LABEL[verdict] : '',
        unit: r.unit, regday: out.regday, kindName: r.kindName, rankName: r.rankName,
      });
    });
    return out;
  }

  window.Kamis = { load, judge, regday, isMapped: (id) => !!MAP[id], mappedIds: () => Object.keys(MAP).map(Number), categories, LABEL };
})();
