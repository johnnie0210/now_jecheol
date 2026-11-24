// 목록용 썸네일 생성 : assets/images/<파일명>.webp → assets/images/thumb/<같은 파일명>.webp
//
// 원본(1600px)은 상세 화면에서 그대로 쓰고, 목록 카드에는 작게 줄인 사본을 쓴다.
// (원본 79장을 목록에서 디코딩하면 휴대폰에서 스크롤이 끊길 수 있음)
// 크기만 줄이고 내용·파일명은 바꾸지 않는다.
//
// 설치할 패키지 없음 : PC의 Edge(또는 Chrome)를 헤드리스로 띄워 canvas로 줄인다. (Node 22 이상)
//   node build/make-thumbs.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets/images');
const OUT = path.join(SRC, 'thumb');
const SIZE = 256;      // 카드 썸네일 64px × 화면 배율 3 이상
const QUALITY = 0.85;
const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
const exe = BROWSERS.find((p) => fs.existsSync(p));
if (!exe) { console.error('Edge 또는 Chrome을 찾지 못했습니다.'); process.exit(1); }

const port = 9341;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'thumb-prof-'));
const proc = spawn(exe, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let targets = [];
  for (let i = 0; i < 60 && !targets.some((t) => t.type === 'page'); i++) {
    try { targets = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); } catch { /* 아직 안 뜸 */ }
    await sleep(250);
  }
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('브라우저 연결 실패');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params) => new Promise((r) => { const i = ++seq; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

  fs.mkdirSync(OUT, { recursive: true });
  const files = fs.readdirSync(SRC).filter((f) => f.toLowerCase().endsWith('.webp'));
  let total = 0;
  for (const f of files) {
    const b64 = fs.readFileSync(path.join(SRC, f)).toString('base64');
    const expr = `(async () => {
      const img = new Image();
      img.src = 'data:image/webp;base64,${b64}';
      await img.decode();
      const k = Math.min(1, ${SIZE} / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/webp', ${QUALITY});
    })()`;
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    const url = r.result && r.result.result && r.result.result.value;
    if (typeof url !== 'string' || !url.startsWith('data:image/webp;base64,')) throw new Error(f + ' 변환 실패');
    const buf = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    fs.writeFileSync(path.join(OUT, f), buf);
    total += buf.length;
  }
  console.log('썸네일 ' + files.length + '장 생성 (' + SIZE + 'px, 합계 ' + Math.round(total / 1024) + 'KB)');
  ws.close();
} finally {
  proc.kill();
}
