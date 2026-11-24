// KAMIS 인증키 설정 파일 생성 : 환경변수 → config.local.js (깃에 올리지 않음, .gitignore 등록)
//
//   PowerShell : $env:KAMIS_CERT_KEY='발급키'; $env:KAMIS_CERT_ID='요청자ID'; node build/make-config.mjs
//   개발용     : $env:KAMIS_CERT_KEY='TEST';   $env:KAMIS_CERT_ID='TEST';     node build/make-config.mjs
//   키 지우기  : node build/make-config.mjs --clear   (시세 기능 끔)
//
// 환경변수가 없으면 아무것도 만들지 않는다. 키는 화면·로그에 출력하지 않는다.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../config.local.js');

if (process.argv.includes('--clear')) {
  if (fs.existsSync(OUT)) fs.unlinkSync(OUT);
  console.log('config.local.js 삭제 (시세 기능 꺼짐)');
  process.exit(0);
}

const key = (process.env.KAMIS_CERT_KEY || '').trim();
const id = (process.env.KAMIS_CERT_ID || '').trim();
if (!key || !id) {
  console.error('KAMIS_CERT_KEY, KAMIS_CERT_ID 환경변수가 필요합니다. (config.local.js를 만들지 않음)');
  process.exit(1);
}

fs.writeFileSync(OUT,
  '// 자동 생성 (build/make-config.mjs) — 깃에 올리지 말 것\n' +
  'window.NOW_JECHEOL_CONFIG = ' + JSON.stringify({ kamisCertKey: key, kamisCertId: id }) + ';\n', 'utf8');
console.log('config.local.js 생성 (키 길이 ' + key.length + ', ID 길이 ' + id.length + ')');
