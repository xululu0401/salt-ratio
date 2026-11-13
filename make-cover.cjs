/* 生成封面 cover.png（1200×1200）。
 * 纪律：封面上的每个数字都来自 core.js 对默认场景的真实计算，不写死。
 * 依赖：node + 本机 Canvas（用 core 算数，用 build 出来的 index.html 做视觉参照）。
 */
const fs = require('node:fs');
const path = require('node:path');
const A = require('./core.js');
const out = A.compute(A.defaultState());
if (!out.ok) throw new Error('默认场景算不出来，封面不生成：' + JSON.stringify(out.errors));

/* 没有第三方图片库，用最小 PNG 编码器自己画（纯色块 + 手写点阵数字不现实），
 * 所以封面走「矢量 SVG → 用浏览器截图」的路线：这里只把数字算好写进 SVG。 */
const W = 1200, H = 1200;
const F = '-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
const M = 'ui-monospace,Menlo,Consolas,monospace';
const v = out.values;
const lines = [
  ['目标盐度 ' + A.fmtPct(v.w, 2), '罐子 ' + A.fmt(v.vol, 3) + ' L'],
  ['菜占容积 ' + A.fmtPct(v.vegShare, 1), '菜净重 ' + A.fmtV(v.vegMass, 0) + ' g'],
  ['每升含盐 ' + A.fmtV(out.saltPerL, 2) + ' g', '密度 ' + A.fmt(out.rho, 4) + ' g/mL']
];
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#f2f5f8"/>
  <rect x="48" y="48" width="${W - 96}" height="${H - 96}" fill="#ffffff" stroke="#d5dee7"/>
  <rect x="48" y="48" width="${W - 96}" height="16" fill="#4a6fa5"/>
  <text x="104" y="180" font-family="${F}" font-size="58" font-weight="700" fill="#1b2430">那袋盐怎么配</text>
  <text x="104" y="240" font-family="${F}" font-size="30" fill="#7d8b9c">腌菜、卤味：罐子里到底要下多少盐、兑多少水</text>
  <line x1="104" y1="288" x2="${W - 104}" y2="288" stroke="#d5dee7" stroke-dasharray="8 8"/>
  <text x="104" y="380" font-family="${F}" font-size="30" fill="#4c5a6b">这一罐还要下</text>
  <text x="104" y="510" font-family="${M}" font-size="128" font-weight="700" fill="#a8551c">${A.fmtV(out.mSalt, 1)} g</text>
  <text x="104" y="600" font-family="${F}" font-size="30" fill="#4c5a6b">兑水</text>
  <text x="104" y="730" font-family="${M}" font-size="128" font-weight="700" fill="#2f8f8a">${A.fmtV(out.waterMl, 0)} mL</text>
  <text x="104" y="812" font-family="${F}" font-size="28" fill="#4c5a6b">菜预计出水 ${A.fmtV(out.vegWaterG, 0)} g → 盐度约落到 ${A.fmtPct(out.wAfter, 2)}</text>
  <text x="104" y="856" font-family="${F}" font-size="28" fill="#4c5a6b">一次到位请称 ${A.fmtV(out.saltTotal, 1)} g 盐（含补上菜出的水）· 每 100 mL 液体：盐 ${A.fmtV(out.per100Salt, 2)} g、水 ${A.fmtV(out.per100Water, 0)} g</text>
  <line x1="104" y1="900" x2="${W - 104}" y2="900" stroke="#eaeff4"/>
  ${lines.map((r, i) => `<text x="104" y="${960 + i * 46}" font-family="${F}" font-size="27" fill="#7d8b9c">${r[0]}</text>
  <text x="${W - 104}" y="${960 + i * 46}" text-anchor="end" font-family="${F}" font-size="27" fill="#7d8b9c">${r[1]}</text>`).join('\n  ')}
  <text x="104" y="${H - 96}" font-family="${F}" font-size="23" fill="#7d8b9c">只算盐和水的比例与体积，不做安全判定 · 默认场景为虚构示例</text>
</svg>`;
fs.writeFileSync(path.join(__dirname, 'cover.svg'), svg);
console.log('cover.svg', fs.statSync(path.join(__dirname, 'cover.svg')).size, 'bytes');
console.log('封面数字（全部来自这次 compute）: 盐', A.fmtV(out.mSalt, 1), 'g / 水', A.fmtV(out.waterMl, 0), 'mL / 每升含盐', A.fmtV(out.saltPerL, 2), 'g');
