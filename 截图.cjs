#!/usr/bin/env node
/* 截图：整页图 + 按 DOM 矩形裁出的区块图 + 封面。
 * 用法：node 截图.cjs [本地|线上]
 * 纪律：元素截图只拍可见区域（折叠下方会得到几百字节的空图），所以一律「整页截图 + DOM 矩形裁图」。
 */
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const AB = '/Users/xululu/.workbuddy/binaries/node/versions/22.22.2-6/bin/agent-browser';
const PROFILE = '/Users/xululu/.agent-browser/zhihu-profile';
const SESSION = process.env.S63_SESSION || 'codex63shot';
const TAG = process.argv[2] || '本地';
const URL = process.argv[3] || 'http://127.0.0.1:8931/index.html';
const SHOT = path.join(__dirname, '..', 'evidence', '截图-' + TAG);
fs.mkdirSync(SHOT, { recursive: true });

function ev(js) {
  const raw = execFileSync(AB, ['--session', SESSION, '--json', 'eval', js],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 180000 });
  const o = JSON.parse(raw.trim().split('\n').filter(Boolean).pop());
  if (!o.success) throw new Error('eval 失败：' + JSON.stringify(o.error));
  return o.data && ('result' in o.data ? o.data.result : o.data);
}
function sh(a) { return execFileSync(AB, a, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 180000 }); }
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

async function shoot(name, vw, vh, js) {
  sh(['--session', SESSION, 'set', 'viewport', String(vw), String(vh)]);
  await sleep(400);
  if (js) { ev(js); await sleep(400); }
  const p = path.join(SHOT, name + '.png');
  sh(['--session', SESSION, 'screenshot', '--full', p]);
  const size = fs.statSync(p).size;
  console.log('  ' + name + '.png  ' + size + ' 字节  (' + vw + '×' + vh + ')');
  return { name: name, path: p, bytes: size, vw: vw, vh: vh };
}

(async function main() {
  console.log('# 截图 · ' + TAG + ' · ' + URL);
  try { sh(['close', '--all']); } catch (e) {}
  await sleep(600);
  sh(['--profile', PROFILE, '--session', SESSION, 'open', URL]);
  await sleep(1200);
  ev('(function(){try{localStorage.clear();}catch(e){}return true;})()');
  sh(['--session', SESSION, 'open', URL]);
  await sleep(1200);

  const shots = [];
  const P = function (i) { return '(function(){document.querySelectorAll("#presetBar .chip")[' + i + '].click();return true;})()'; };
  const S = function (id, v) { return '(function(){var e=document.getElementById("' + id + '");e.value="' + v + '";e.dispatchEvent(new Event("input",{bubbles:true}));return true;})()'; };

  /* 1280 宽：默认 + 各状态 */
  shots.push(await shoot('01-默认场景-1280', 1280, 900, P(0)));
  shots.push(await shoot('02-改了条件-1280', 1280, 900, S('i_w', '12') + ';' + S('i_vol', '2')));
  shots.push(await shoot('03-原有盐水合并-1280', 1280, 900, P(5)));
  shots.push(await shoot('04-够咸那一支-1280', 1280, 900, P(0) + ';' + S('i_w', '2') + ';' + S('i_haveVol', '100') + ';' + S('i_haveW', '20')));
  shots.push(await shoot('05-非法输入-1280', 1280, 900, P(0) + ';' + S('i_w', 'abc')));
  shots.push(await shoot('06-无解-菜渗水占满-1280', 1280, 900, P(9)));
  shots.push(await shoot('07-无解-水超量-1280', 1280, 900, P(10)));
  shots.push(await shoot('08-提示外推区-1280', 1280, 900, P(0) + ';' + S('i_w', '29.9')));
  shots.push(await shoot('09-大缸-1280', 1280, 900, P(7)));
  shots.push(await shoot('10-点了建议之后-1280', 1280, 900,
    P(0) + ';(function(){var b=document.querySelector("#sugList .sug button");if(b)b.click();return true;})()'));

  /* 窄屏 */
  shots.push(await shoot('20-默认场景-375', 375, 780, P(0)));
  shots.push(await shoot('21-长文案极值-375', 375, 780, P(7) + ';' + S('i_w', '29.9') + ';' + S('i_vegMass', '48000') + ';' + S('i_vegWater', '79')));
  shots.push(await shoot('22-无解-375', 375, 780, P(9)));
  shots.push(await shoot('23-默认场景-320', 320, 700, P(0)));
  shots.push(await shoot('24-合并盐水-320', 320, 700, P(5)));

  /* 区块矩形：整页图 + DOM 矩形，交给裁图脚本 */
  sh(['--session', SESSION, 'set', 'viewport', '1280', '900']);
  await sleep(400);
  ev(P(0));
  await sleep(400);
  const rects = ev(`(function(){
    var ids = ['presetBar','errBar','slip','warnBar','steps','sugList','schemeCards','altTable','chkList','dlCsv'];
    var out = {};
    ids.forEach(function(id){
      var el = document.getElementById(id);
      if(!el) return;
      var r = el.getBoundingClientRect();
      out[id] = { x: Math.max(0, Math.floor(r.left + window.scrollX)), y: Math.max(0, Math.floor(r.top + window.scrollY)),
                  w: Math.ceil(r.width), h: Math.ceil(r.height) };
    });
    var secs = document.querySelectorAll('section');
    out.__sections = [];
    for (var i=0;i<secs.length;i++){ var r=secs[i].getBoundingClientRect();
      out.__sections.push({ x: Math.max(0,Math.floor(r.left+window.scrollX)), y: Math.max(0,Math.floor(r.top+window.scrollY)), w: Math.ceil(r.width), h: Math.ceil(r.height) }); }
    return JSON.stringify(out);
  })()`);
  const full = path.join(SHOT, '30-整页-1280.png');
  sh(['--session', SESSION, 'screenshot', '--full', full]);
  fs.writeFileSync(path.join(SHOT, '区块矩形.json'),
    JSON.stringify({ page: full, page_bytes: fs.statSync(full).size, rects: JSON.parse(rects) }, null, 2));
  console.log('  30-整页-1280.png  ' + fs.statSync(full).size + ' 字节（区块矩形已落盘）');

  /* 封面：把 cover.svg 渲染成 1200×1200 PNG */
  sh(['--session', SESSION, 'set', 'viewport', '1200', '1200']);
  await sleep(300);
  sh(['--session', SESSION, 'open', 'http://127.0.0.1:8931/cover.svg']);
  await sleep(1200);
  const cover = path.join(__dirname, 'cover.png');
  sh(['--session', SESSION, 'screenshot', cover]);
  console.log('  cover.png  ' + fs.statSync(cover).size + ' 字节');

  fs.writeFileSync(path.join(SHOT, '截图清单.json'),
    JSON.stringify({ tag: TAG, url: URL, at: new Date().toISOString(), shots: shots, cover: cover }, null, 2));
  console.log('截图清单 → evidence/截图-' + TAG + '/截图清单.json');
})().catch(function (e) { console.error('截图脚本出错：' + (e && e.stack ? e.stack : e)); process.exit(2); });
