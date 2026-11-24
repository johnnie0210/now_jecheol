// 앱 아이콘 생성 (외부 패키지 없음) : node build/make-icons.mjs
// 초록 바탕 + 흰 원 + 잎 달린 주황 열매. 192·512px, 마스커블(가장자리까지 바탕) 512px
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../icons');
const GREEN = [47, 143, 78], WHITE = [255, 255, 255], ORANGE = [242, 112, 36], LEAF = [56, 158, 74], STEM = [110, 76, 40];

// CRC32 (PNG 청크용)
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// 좌표는 0~1 단위. 위에서부터 겹쳐 칠할 도형 (마지막이 맨 위)
function shapes(maskable) {
  const s = maskable ? 0.78 : 1;                         // 마스커블은 안전영역 안으로 축소
  const c = (x, y) => [0.5 + (x - 0.5) * s, 0.5 + (y - 0.5) * s];
  const r = (v) => v * s;
  const list = [];
  // 바탕 : 일반은 둥근 사각형, 마스커블은 가장자리까지
  list.push(maskable ? { t: 'all', col: GREEN } : { t: 'rrect', x0: 0.02, y0: 0.02, x1: 0.98, y1: 0.98, rad: 0.22, col: GREEN });
  list.push({ t: 'circle', c: c(0.5, 0.5), r: r(0.34), col: WHITE });
  list.push({ t: 'circle', c: c(0.5, 0.56), r: r(0.2), col: ORANGE });          // 열매
  list.push({ t: 'rect', x0: c(0.485, 0)[0], x1: c(0.515, 0)[0], y0: c(0, 0.3)[1], y1: c(0, 0.38)[1], col: STEM });
  list.push({ t: 'ellipse', c: c(0.585, 0.32), rx: r(0.085), ry: r(0.042), rot: -0.55, col: LEAF });  // 잎
  return list;
}
function inside(sh, x, y) {
  switch (sh.t) {
    case 'all': return true;
    case 'rect': return x >= sh.x0 && x <= sh.x1 && y >= sh.y0 && y <= sh.y1;
    case 'circle': return (x - sh.c[0]) ** 2 + (y - sh.c[1]) ** 2 <= sh.r ** 2;
    case 'ellipse': {
      const dx = x - sh.c[0], dy = y - sh.c[1], co = Math.cos(sh.rot), si = Math.sin(sh.rot);
      const u = dx * co + dy * si, v = -dx * si + dy * co;
      return (u / sh.rx) ** 2 + (v / sh.ry) ** 2 <= 1;
    }
    case 'rrect': {
      if (x < sh.x0 || x > sh.x1 || y < sh.y0 || y > sh.y1) return false;
      const cx = Math.min(Math.max(x, sh.x0 + sh.rad), sh.x1 - sh.rad), cy = Math.min(Math.max(y, sh.y0 + sh.rad), sh.y1 - sh.rad);
      return (x - cx) ** 2 + (y - cy) ** 2 <= sh.rad ** 2;
    }
  }
  return false;
}
function draw(size, maskable) {
  const list = shapes(maskable), SS = 4, buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {   // 4x4 슈퍼샘플링으로 가장자리 부드럽게
      const x = (px + (sx + 0.5) / SS) / size, y = (py + (sy + 0.5) / SS) / size;
      let col = null;
      for (const sh of list) if (inside(sh, x, y)) col = sh.col;
      if (col) { r += col[0]; g += col[1]; b += col[2]; a += 255; }
    }
    const n = SS * SS, i = (py * size + px) * 4, cov = a / 255;
    buf[i] = cov ? Math.round(r / cov) : 0; buf[i + 1] = cov ? Math.round(g / cov) : 0; buf[i + 2] = cov ? Math.round(b / cov) : 0; buf[i + 3] = Math.round(a / n);
  }
  return png(size, buf);
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'icon-192.png'), draw(192, false));
fs.writeFileSync(path.join(OUT, 'icon-512.png'), draw(512, false));
fs.writeFileSync(path.join(OUT, 'icon-maskable-512.png'), draw(512, true));
console.log('icons written to', OUT);
