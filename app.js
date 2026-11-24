/* 지금제철 — 앱 로직
 * 데이터 : assets/jecheol.json (앱 내장, 서비스 워커가 오프라인용으로 저장)
 * 규칙   : 제철 여부는 반드시 item.months 배열로 판정한다. season 문자열은 화면 표시용으로만 쓴다.
 */
(function () {
  'use strict';

  const DATA_URL = 'assets/jecheol.json';
  const IMG_DIR = 'assets/images/';
  const FAV_KEY = 'now_jecheol.favorites';
  const CATS = ['전체', '과일', '채소', '수산물'];
  const CAT_CLASS = { 과일: 'fruit', 채소: 'veg', 수산물: 'sea' };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------------- 상태 ----------------
  let items = [];
  let byId = new Map();
  let recipes = {};                               // 요리 이름 → 레시피 (JSON v4 recipes)
  let thisMonth = new Date().getMonth() + 1;      // 기기 날짜 기준 이번 달
  const state = {
    month: thisMonth,                             // 월별 화면에서 고른 달
    cat: { home: '전체', month: '전체', search: '전체' },
    query: '',
  };
  let favorites = loadFavorites();
  let lastListHash = '#home';                     // 상세에서 돌아갈 화면
  let prices = new Map();                         // KAMIS 시세 (품목 id → 시세). 키 없음·오프라인·실패면 빈 Map
  let currentView = 'home';
  let recipeItemId = 0;                           // 레시피 화면일 때 그 요리의 품목 id (뒤로 가기용)
  const won = (n) => n.toLocaleString('ko-KR') + '원';

  // ---------------- 데이터 ----------------
  /** 제철 판정 : months 배열만 사용 */
  function isInSeason(item, month) {
    return item.months.includes(month);
  }
  /** 월 + 분류로 거르기 */
  function itemsOfMonth(month, cat) {
    return items.filter((it) => isInSeason(it, month) && (cat === '전체' || it.category === cat));
  }
  /** 검색어 + 분류로 거르기 (전체 품목 대상, 공백·대소문자 무시) */
  function searchItems(query, cat) {
    const q = query.replace(/\s+/g, '').toLowerCase();
    return items.filter((it) => (cat === '전체' || it.category === cat) && (!q || it.name.replace(/\s+/g, '').toLowerCase().includes(q)));
  }

  /** JSON 구조 확인 (값은 바꾸지 않음) */
  function validate(data) {
    if (!data || !Array.isArray(data.items)) throw new Error('items 배열이 없습니다.');
    data.items.forEach((it, i) => {
      const where = '항목 ' + (i + 1) + (it && it.name ? ' (' + it.name + ')' : '');
      if (!it || typeof it.id !== 'number' || typeof it.name !== 'string' || !it.name) throw new Error(where + ' : id 또는 name이 올바르지 않습니다.');
      if (!CAT_CLASS[it.category]) throw new Error(where + ' : category가 과일·채소·수산물이 아닙니다.');
      if (!Array.isArray(it.months) || !it.months.every((m) => Number.isInteger(m) && m >= 1 && m <= 12)) throw new Error(where + ' : months가 1~12 숫자 배열이 아닙니다.');
    });
    // 레시피 (v4) : 요리 이름 → 레시피. 없거나 형식이 틀리면 레시피만 없는 것으로 보고 앱은 그대로 동작
    recipes = data.recipes && typeof data.recipes === 'object' && !Array.isArray(data.recipes) ? data.recipes : {};
    return data.items;
  }

  async function loadData() {
    const res = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error('데이터 파일 응답 ' + res.status);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('JSON 형식 오류 : ' + e.message); }
    return validate(data);
  }

  // ---------------- 즐겨찾기 (기기 저장) ----------------
  function loadFavorites() {
    try {
      const v = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
      return Array.isArray(v) ? v.filter((x) => typeof x === 'number') : [];
    } catch (e) { return []; }
  }
  function saveFavorites() {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(favorites)); } catch (e) { /* 저장 불가(사생활 보호 모드 등) : 이번 실행 동안만 유지 */ }
  }
  const isFav = (id) => favorites.includes(id);
  function toggleFav(id) {
    favorites = isFav(id) ? favorites.filter((x) => x !== id) : favorites.concat(id);
    saveFavorites();
  }

  // ---------------- 그리기 ----------------
  /** 시세 판정 뱃지 (판정이 있을 때만) */
  function priceBadgeHtml(id) {
    const p = prices.get(id);
    return p && p.verdict ? '<span class="pbadge ' + p.verdict + '">' + esc(p.label) + '</span>' : '';
  }

  // ---------------- 이미지 (assets/images 내장, 목록은 thumb/ 축소본) ----------------
  /** JSON image 필드 → 주소용 파일명 (없거나 형식이 틀리면 '') */
  function imageFile(it) {
    return typeof it.image === 'string' && it.image.trim() ? encodeURIComponent(it.image.trim()) : '';
  }
  /** 카드 썸네일 : 축소본 → 실패하면 원본 → 그래도 실패하면 기본 아이콘 (onImageError) */
  function thumbHtml(it) {
    const f = imageFile(it);
    if (!f) return '<span class="thumb noimg" aria-hidden="true"></span>';
    return '<span class="thumb" aria-hidden="true"><img src="' + IMG_DIR + 'thumb/' + f + '" data-full="' + IMG_DIR + f + '" alt="" width="64" height="64" decoding="async"></span>';
  }
  /** 이미지 로딩 실패 : 이미지 자리만 기본 아이콘으로 바꾸고 나머지 내용은 그대로 */
  function onImageError(e) {
    const img = e.target;
    if (!img || img.tagName !== 'IMG' || !img.parentElement) return;
    const box = img.parentElement;
    if (box.classList.contains('thumb')) {
      if (img.dataset.full) { const full = img.dataset.full; delete img.dataset.full; img.src = full; return; }
      box.classList.add('noimg');
      img.remove();
    } else if (box.id === 'd-hero') {
      box.classList.add('noimg');
    }
  }

  function cardHtml(it) {
    return '<li><button type="button" class="card" data-id="' + it.id + '">' + thumbHtml(it) + '<span class="card-body">' +
      '<div class="card-top"><span class="card-name">' + esc(it.name) + '</span>' +
      '<span class="badge ' + CAT_CLASS[it.category] + '">' + esc(it.category) + '</span>' +
      (isFav(it.id) ? '<span class="card-star" aria-label="즐겨찾기">★</span>' : '') + '</div>' +
      '<div class="card-season">제철 <b>' + esc(it.season) + '</b>' + priceBadgeHtml(it.id) + '</div>' +
      '<div class="card-note">' + esc(it.note) + '</div>' +
      '</span></button></li>';
  }
  function renderList(el, list, emptyHtml) {
    el.innerHTML = list.length ? list.map(cardHtml).join('') : '<li class="empty">' + emptyHtml + '</li>';
  }
  /** 분류 탭 (각 분류의 개수 표시) */
  function renderCats(scope, baseList) {
    const box = document.querySelector('.cat-tabs[data-scope="' + scope + '"]');
    box.innerHTML = CATS.map((c) => {
      const n = c === '전체' ? baseList.length : baseList.filter((it) => it.category === c).length;
      return '<button type="button" class="cat" role="tab" data-cat="' + c + '" aria-selected="' + (state.cat[scope] === c) + '">' +
        esc(c) + '<span class="n">' + n + '</span></button>';
    }).join('');
  }

  function renderHome() {
    $('home-title').textContent = thisMonth + '월의 제철 식재료';
    const all = itemsOfMonth(thisMonth, '전체');
    $('home-sub').textContent = '오늘 ' + todayText() + ' · 제철 ' + all.length + '종';
    renderCats('home', all);
    renderList($('home-list'), itemsOfMonth(thisMonth, state.cat.home), '<b>이 분류는 이번 달 제철 품목이 없어요</b>');
    // 지금 사면 싸요 : 이번 달 제철 중 '평년보다 10% 이상 저렴' 판정만 (없으면 섹션 숨김)
    const cheap = all.filter((it) => { const p = prices.get(it.id); return p && p.verdict === 'cheap'; })
      .sort((a, b) => prices.get(a.id).changePct - prices.get(b.id).changePct);
    $('cheap').hidden = !cheap.length;
    if (cheap.length) {
      $('cheap-sub').textContent = '평년보다 10% 이상 저렴한 이번 달 제철 품목 ' + cheap.length + '종 · 소매가 기준 · 출처: KAMIS';
      renderList($('cheap-list'), cheap, '');
    } else {
      $('cheap-list').innerHTML = '';
    }
  }

  function renderMonth() {
    const bar = $('month-bar');
    if (!bar.childElementCount) {
      let html = '';
      for (let m = 1; m <= 12; m++) {
        html += '<button type="button" class="mon" role="tab" data-month="' + m + '">' + m + '월<small></small></button>';
      }
      bar.innerHTML = html;
    }
    bar.querySelectorAll('.mon').forEach((b) => {
      const m = Number(b.dataset.month);
      b.setAttribute('aria-selected', String(m === state.month));
      b.classList.toggle('today', m === thisMonth);
      b.querySelector('small').textContent = itemsOfMonth(m, '전체').length + '종';
    });
    $('month-title').textContent = state.month + '월의 제철 식재료';
    const all = itemsOfMonth(state.month, '전체');
    renderCats('month', all);
    renderList($('month-list'), itemsOfMonth(state.month, state.cat.month), '<b>이 분류는 ' + state.month + '월 제철 품목이 없어요</b>');
    // 고른 달 버튼을 가운데로 (월 버튼 줄만 가로로 이동, 페이지는 그대로)
    const sel = bar.querySelector('.mon[aria-selected="true"]');
    if (sel) bar.scrollLeft = sel.offsetLeft - bar.offsetLeft - (bar.clientWidth - sel.offsetWidth) / 2;
  }

  function renderSearch() {
    const base = searchItems(state.query, '전체');
    renderCats('search', base);
    const list = searchItems(state.query, state.cat.search);
    $('search-count').textContent = state.query.trim() ? '‘' + state.query.trim() + '’ 검색 결과 ' + list.length + '종' : '전체 ' + list.length + '종';
    $('search-clear').hidden = !state.query;
    renderList($('search-list'), list, '<b>검색 결과가 없어요</b>다른 이름으로 찾아보세요.');
  }

  function renderFav() {
    const list = favorites.map((id) => byId.get(id)).filter(Boolean);
    $('fav-sub').textContent = list.length ? '저장한 품목 ' + list.length + '종 · 이번 달 제철 ' + list.filter((it) => isInSeason(it, thisMonth)).length + '종' : '';
    renderList($('fav-list'), list, '<b>저장한 품목이 없어요</b>품목을 눌러 상세 화면에서 ☆ 즐겨찾기를 누르면 여기에 모여요.');
  }

  function renderDetail(it) {
    $('top-title').textContent = it.name;
    // 상단 큰 이미지 (원본). 파일이 없거나 실패하면 기본 아이콘
    const f = imageFile(it);
    const hero = $('d-hero'), img = $('d-img');
    hero.classList.toggle('noimg', !f);
    if (!f) img.removeAttribute('src');
    else if (img.getAttribute('src') !== IMG_DIR + f) img.src = IMG_DIR + f;
    else if (img.complete && !img.naturalWidth) hero.classList.add('noimg');   // 같은 품목을 다시 열었고 이미 실패한 경우
    $('d-badge').className = 'badge ' + CAT_CLASS[it.category];
    $('d-badge').textContent = it.category;
    $('d-name').textContent = it.name;
    $('d-season').textContent = it.season;
    const inNow = isInSeason(it, thisMonth);
    $('d-now').textContent = inNow ? '이번 달(' + thisMonth + '월) 제철이에요' : '이번 달(' + thisMonth + '월)은 제철이 아니에요';
    $('d-now').className = inNow ? 'in' : 'out';
    $('d-note').textContent = it.note;
    // 고르는 법 · 보관법 · 어울리는 요리 (데이터 그대로). 레시피가 있는 요리만 눌러서 레시피 화면으로, 없으면 일반 글자
    setTextSection('d-pick', it.pick);
    setTextSection('d-store', it.store);
    const dishes = Array.isArray(it.dishes) ? it.dishes.map((d, i) => [d, i]).filter(([d]) => typeof d === 'string' && d.trim()) : [];
    $('d-dishes').innerHTML = dishes.map(([d, i]) => recipeOf(d)
      ? '<li><a class="chip chip-link" href="#recipe-' + it.id + '-' + i + '">' + esc(d) + '<span class="chip-arrow" aria-hidden="true">›</span></a></li>'
      : '<li class="chip">' + esc(d) + '</li>').join('');
    $('d-dishes').hidden = $('d-dishes-label').hidden = !dishes.length;
    renderPriceCard(it.id);
    let html = '';
    for (let m = 1; m <= 12; m++) {
      const on = isInSeason(it, m);
      html += '<li class="' + (on ? 'on' : '') + (m === thisMonth ? ' now' : '') + '" aria-label="' + m + '월 ' + (on ? '제철' : '제철 아님') + (m === thisMonth ? ', 이번 달' : '') + '">' + m + '월</li>';
    }
    $('d-months').innerHTML = html;
    updateFavBtn(it.id);
  }
  // ---------------- 요리 레시피 (JSON v4 recipes, 내장 데이터만) ----------------
  /** 요리 이름 → 레시피 (없거나 재료·순서가 없으면 null : 그 요리는 누를 수 없음) */
  function recipeOf(name) {
    if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(recipes, name)) return null;
    const r = recipes[name];
    if (!r || typeof r !== 'object') return null;
    const ok = (a) => Array.isArray(a) && a.some((x) => typeof x === 'string' && x.trim());
    return ok(r.ingredients) && ok(r.steps) ? r : null;
  }
  /** 레시피 화면 : 이름 · 인분 · 소요 시간(데이터 그대로) · 재료(체크) · 만드는 순서(번호) */
  function renderRecipe(it, dish, r) {
    const str = (v) => (typeof v === 'string' ? v.trim() : '');
    const list = (a) => a.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());
    $('top-title').textContent = dish;
    $('r-from').textContent = it.name + ' · 어울리는 요리';
    $('r-name').textContent = dish;
    const servings = str(r.servings), time = str(r.time);
    $('r-servings').textContent = servings;
    $('r-servings').hidden = !servings;
    $('r-time').textContent = time;          // "약 3일"·"약 1주일"도 그대로 (분으로 바꾸지 않음)
    $('r-time').hidden = !time;
    $('r-meta').hidden = !servings && !time;
    const ings = list(r.ingredients), steps = list(r.steps);
    $('r-ing-count').textContent = ings.length + '가지';
    $('r-ingredients').innerHTML = ings.map((x) => '<li><label class="ing"><input type="checkbox"><span>' + esc(x) + '</span></label></li>').join('');
    $('r-steps').innerHTML = steps.map((x) => '<li>' + esc(x) + '</li>').join('');
  }

  function setTextSection(id, text) {
    const t = typeof text === 'string' ? text.trim() : '';
    $(id).textContent = t;
    $(id).hidden = $(id + '-label').hidden = !t;
  }
  /** 상세 시세 카드 : 시세가 있을 때만 (매핑 안 됨·가격 없음이면 숨김) */
  function renderPriceCard(id) {
    const p = prices.get(id);
    $('d-price').hidden = !p;
    if (!p) return;
    $('d-price-val').textContent = won(p.price);
    $('d-price-unit').textContent = '/ ' + p.unit;
    const v = $('d-price-verdict');
    v.hidden = !p.verdict;
    v.className = 'price-verdict pbadge ' + (p.verdict || '');
    v.textContent = p.label;
    const kind = [p.kindName, p.rankName && p.rankName !== '-' ? p.rankName : ''].filter(Boolean).join(' · ');
    const pct = p.changePct == null ? '평년 가격 없음'
      : '평년(' + won(p.normal) + ') 대비 ' + (p.changePct > 0 ? '+' : '') + p.changePct.toFixed(1) + '%';
    $('d-price-meta').textContent = pct + ' · 기준일 ' + p.regday + (kind ? ' · ' + kind : '');
  }

  function updateFavBtn(id) {
    const on = isFav(id);
    const b = $('d-fav');
    b.setAttribute('aria-pressed', String(on));
    b.textContent = on ? '★ 즐겨찾기됨' : '☆ 즐겨찾기';
  }

  function todayText() {
    const d = new Date();
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
  }

  // ---------------- 화면 이동 (주소 해시) ----------------
  // #home · #month · #month-3 · #search · #fav · #item-12 · #recipe-12-0 (품목 id - 어울리는 요리 순번)
  /** 시세가 늦게 도착하면 지금 화면만 다시 그림 (스크롤 유지) */
  function renderCurrent() {
    if (currentView === 'home') renderHome();
    else if (currentView === 'month') renderMonth();
    else if (currentView === 'search') renderSearch();
    else if (currentView === 'fav') renderFav();
    else if (currentView === 'detail') {
      const id = Number((location.hash.match(/^#item-(\d+)$/) || [])[1]);
      if (byId.has(id)) renderPriceCard(id);
    }
  }

  function route() {
    const h = location.hash || '#home';
    let view = 'home', item = null, dish = '', recipe = null;
    let m;
    if ((m = h.match(/^#item-(\d+)$/))) { item = byId.get(Number(m[1])); view = item ? 'detail' : 'home'; }
    else if ((m = h.match(/^#recipe-(\d+)-(\d+)$/))) {
      // 레시피 : 품목 id + 어울리는 요리 순번. 레시피가 없으면 그 품목 상세(품목도 없으면 홈)로
      item = byId.get(Number(m[1]));
      dish = item && Array.isArray(item.dishes) ? item.dishes[Number(m[2])] : '';
      recipe = item ? recipeOf(dish) : null;
      if (recipe) view = 'recipe';
      else if (item) { history.replaceState(null, '', '#item-' + item.id); view = 'detail'; }
    }
    else if ((m = h.match(/^#month-(\d{1,2})$/)) && +m[1] >= 1 && +m[1] <= 12) { view = 'month'; state.month = +m[1]; }
    else if (['#home', '#month', '#search', '#fav'].includes(h)) view = h.slice(1);

    document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== 'view-' + view; });
    const sub = view === 'detail' || view === 'recipe';   // 목록에서 들어간 화면 (뒤로 버튼)
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === view || (sub && lastListHash.startsWith('#' + t.dataset.tab))));
    $('btn-back').hidden = !sub;
    recipeItemId = view === 'recipe' ? item.id : 0;
    if (!sub) { $('top-title').textContent = '지금제철'; lastListHash = h === '#month' ? '#month-' + state.month : h; }

    if (view === 'home') renderHome();
    else if (view === 'month') renderMonth();
    else if (view === 'search') renderSearch();
    else if (view === 'fav') renderFav();
    else if (view === 'detail') renderDetail(item);
    else if (view === 'recipe') renderRecipe(item, dish, recipe);
    currentView = view;
    if (view !== 'month') window.scrollTo(0, 0);
  }

  // ---------------- 이벤트 ----------------
  function bind() {
    window.addEventListener('hashchange', route);
    document.addEventListener('error', onImageError, true);   // img 오류는 버블링되지 않아 캡처 단계에서 받음

    document.addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (card) { location.hash = '#item-' + card.dataset.id; return; }
      const cat = e.target.closest('.cat');
      if (cat) {
        const scope = cat.parentElement.dataset.scope;
        state.cat[scope] = cat.dataset.cat;
        ({ home: renderHome, month: renderMonth, search: renderSearch })[scope]();
        return;
      }
      const mon = e.target.closest('.mon');
      if (mon) { history.replaceState(null, '', '#month-' + mon.dataset.month); route(); }
    });

    $('btn-back').addEventListener('click', () => {
      // 앱 안에서 들어왔으면 뒤로, 상세 주소로 바로 열었으면 직전 목록(없으면 홈)으로
      // 레시피 주소로 바로 열었으면 그 품목 상세로
      if (navigatedInApp) history.back();
      else location.hash = recipeItemId ? '#item-' + recipeItemId : lastListHash;
    });

    $('d-fav').addEventListener('click', () => {
      const id = Number((location.hash.match(/^#item-(\d+)$/) || [])[1]);
      if (!byId.has(id)) return;
      toggleFav(id);
      updateFavBtn(id);
    });

    const input = $('search-input');
    input.addEventListener('input', () => { state.query = input.value; renderSearch(); });
    $('search-clear').addEventListener('click', () => { input.value = ''; state.query = ''; renderSearch(); input.focus(); });

    // 앱을 켜 둔 채 달이 바뀌면 이번 달 다시 계산
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      const m = new Date().getMonth() + 1;
      if (m !== thisMonth) { thisMonth = m; route(); }
    });
  }
  // 이 세션에서 앱 안 이동이 있었는지 (상세 → 뒤로 처리용)
  let navigatedInApp = false;
  window.addEventListener('hashchange', () => { navigatedInApp = true; });

  // ---------------- 시작 ----------------
  async function start() {
    try {
      items = await loadData();
    } catch (e) {
      $('error').hidden = false;
      $('error-desc').textContent = e && e.message ? e.message : String(e);
      document.querySelector('.tabbar').hidden = true;
      return;
    }
    byId = new Map(items.map((it) => [it.id, it]));
    favorites = favorites.filter((id) => byId.has(id));
    bind();
    route();
    loadPrices();
  }

  /** KAMIS 시세 : 목록은 먼저 보여 주고 뒤에서 불러옴. 키 없음·오프라인·실패면 시세 영역만 숨김 */
  async function loadPrices() {
    if (!window.Kamis) return;
    const hasKey = !!(window.NOW_JECHEOL_CONFIG && window.NOW_JECHEOL_CONFIG.kamisCertKey && window.NOW_JECHEOL_CONFIG.kamisCertId);
    $('price-loading').hidden = !hasKey;
    let state = 'off';
    try {
      const r = await window.Kamis.load();
      prices = r.prices;
      state = !r.enabled ? 'nokey' : (prices.size ? 'ready' : 'empty');
    } catch (e) {
      prices = new Map();
      state = 'error';
    }
    $('price-loading').hidden = true;
    document.body.dataset.prices = state;   // 시세 처리 끝 (nokey · ready · empty · error)
    renderCurrent();
  }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
      // 상세용 원본 이미지를 뒤에서 기기에 저장 (오프라인 상세에서도 보이도록). 실패해도 화면에는 영향 없음
      navigator.serviceWorker.ready.then((reg) => { if (reg.active) reg.active.postMessage('cache-images'); }).catch(() => {});
    });
  }
  start();
})();
