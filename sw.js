/* 지금제철 — 서비스 워커 (오프라인)
 * 앱 파일·데이터를 설치 때 저장해 두고, 네트워크가 없으면 저장본으로 동작한다.
 * 앱 파일은 네트워크 우선(새 버전을 바로 받음), 아이콘·품목 이미지는 캐시 우선.
 * 품목 이미지 : 목록용 축소본(thumb/)은 설치 때, 상세용 원본은 앱이 보낸 'cache-images' 메시지로 뒤에서 저장한다.
 *              이미지 목록은 jecheol.json의 image 필드에서 만든다. (하나가 실패해도 설치·앱 동작에는 영향 없음)
 * 앱 파일이나 데이터를 바꾸면 CACHE 버전을 올린다.
 */
const CACHE = 'now-jecheol-v4';
const IMG_DIR = './assets/images/';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './kamis.js',
  './app.js',
  './assets/jecheol.json',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => imageUrls(IMG_DIR + 'thumb/').then(cacheMissing).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

/** jecheol.json(저장본)의 image 필드 → 이미지 주소 목록 (앱과 같은 방식으로 인코딩) */
async function imageUrls(dir) {
  const res = await caches.match('./assets/jecheol.json');
  if (!res) return [];
  const data = await res.json();
  return (Array.isArray(data.items) ? data.items : [])
    .filter((it) => it && typeof it.image === 'string' && it.image.trim())
    .map((it) => dir + encodeURIComponent(it.image.trim()));
}
/** 아직 저장 안 된 이미지만 하나씩 받아 저장 (실패는 건너뜀) */
async function cacheMissing(urls) {
  const c = await caches.open(CACHE);
  for (const u of urls) {
    if (await c.match(u)) continue;
    try { const r = await fetch(u); if (r.ok) await c.put(u, r); } catch (err) { /* 다음에 다시 시도 */ }
  }
}

self.addEventListener('message', (e) => {
  if (e.data === 'cache-images') e.waitUntil(imageUrls(IMG_DIR).then(cacheMissing).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // KAMIS 시세는 서비스 워커를 거치지 않음 (앱이 기기에 캐시)
  if (url.pathname.endsWith('/config.local.js')) return;  // 인증키 설정 파일은 저장하지 않음

  if (url.pathname.includes('/icons/') || url.pathname.includes('/assets/images/')) {
    // cache-first (없으면 받아서 저장)
    e.respondWith(caches.match(req, { ignoreSearch: true }).then((c) => c || fetch(req).then((res) => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((cc) => cc.put(req, copy)); }
      return res;
    })));
    return;
  }
  // network-first (앱 파일·데이터), 실패하면 저장본
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((c) => c || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
