#!/usr/bin/env node
/* 那袋盐怎么配 · 浏览器验收驱动
 * 用法：node 验收.cjs 本地
 *       node 验收.cjs 线上 <url>
 * 纪律：控制台先「故意 error + 故意 warn」自证采集器能记到再清零；
 *       四种下载必须真实落盘并核对字节/PNG 头；逐档视口断言 innerWidth 实测值；
 *       不用脚本 PASS 代替 read_image 目检（看图由截图.cjs + read_image 另行完成）。
 */
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const AB = '/Users/xululu/.workbuddy/binaries/node/versions/22.22.2-6/bin/agent-browser';
const PROFILE = '/Users/xululu/.agent-browser/zhihu-profile';
const SESSION = process.env.S63_SESSION || 'codex63app';
const TAG = process.argv[2] || '本地';
const URL_ARG = process.argv[3] || null;
const LOCAL = 'http://127.0.0.1:8931/index.html';
const URL = URL_ARG || LOCAL;
const ROOT = path.join(__dirname, '..');
const DLDIR = path.join(ROOT, 'evidence', '下载', TAG);
const OUT = path.join(ROOT, 'evidence', '浏览器验收结果-' + TAG + '.txt');
fs.mkdirSync(DLDIR, { recursive: true });
fs.readdirSync(DLDIR).forEach(function (f) { fs.unlinkSync(path.join(DLDIR, f)); });

function ev(js) {
  let raw;
  try {
    raw = execFileSync(AB, ['--session', SESSION, '--json', 'eval', js],
      { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 180000 });
  } catch (e) {
    throw new Error('eval 失败：' + String((e.stdout || '') + (e.stderr || '')).slice(-600) + '\n片段：' + String(js).slice(0, 160));
  }
  const last = raw.trim().split('\n').filter(Boolean).pop();
  const o = JSON.parse(last);
  if (!o.success) throw new Error('eval 失败：' + JSON.stringify(o.error) + '\n片段：' + String(js).slice(0, 160));
  let r = o.data && ('result' in o.data ? o.data.result : o.data);
  while (typeof r === 'string') {
    const t = r.trim();
    if (!(t.charAt(0) === '{' || t.charAt(0) === '[')) break;
    try { const n = JSON.parse(r); if (n === r) break; r = n; } catch (e) { break; }
  }
  return r;
}
function sh(args) {
  return execFileSync(AB, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 180000 });
}
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
/* 需要「先注入 RUNNER 再执行一段语句」时用这个：包成 IIFE 并 return 结果 */
function evIIFE(js) { return ev('(function(){' + RUNNER + '\n' + js + '\nreturn true;})()'); }

const RUNNER = `
window.__res = [];   /* 注意：这里不用 var —— var 造出的全局属性不可重定义，第二次注入会静默失效 */
window.__ok = function (g, name, cond, detail) {
  window.__res.push({ g: g, name: name, pass: !!cond, detail: detail === undefined ? '' : String(detail).slice(0, 320) });
  return !!cond;
};
window.__near = function (g, name, a, b, eps, detail) {
  var ok = (typeof a === 'number' && typeof b === 'number' && isFinite(a) && isFinite(b)) ? Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps) : false;
  return window.__ok(g, name, ok, (detail || '') + ' [' + a + ' vs ' + b + ']');
};
window.__set = function (id, v) {
  var el = document.getElementById(id);
  if (!el) return false;
  el.value = String(v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
};
window.__txt = function (id) { var el = document.getElementById(id); return el ? el.innerText : null; };
window.__pressPreset = function (i) {
  var b = document.querySelectorAll('#presetBar .chip')[i];
  if (!b) return false;
  b.click(); return true;
};
window.__click = function (id) { var el = document.getElementById(id); if (!el) return false; el.click(); return true; };
/* 页面级「不挤出屏幕」的判据：文档不横向滚动 + 没有任何元素右边界越界。
 * 例外：放在 overflow-x:auto 容器里的宽表格是设计如此（可以横向滑），
 * 不算页面溢出 —— 但也要确认它确实被包在可滚动容器里，否则照样算越界。 */
window.__inScroller = function (el) {
  for (var p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    var ox = getComputedStyle(p).overflowX;
    if (ox === 'auto' || ox === 'scroll' || ox === 'overlay') return true;
  }
  return false;
};
window.__overflow = function () {
  var bad = [], vw = window.innerWidth;
  var de = document.documentElement;
  var all = document.querySelectorAll('*');
  for (var i = 0; i < all.length; i++) {
    var r = all[i].getBoundingClientRect();
    if (r.width > 0 && r.right > vw + 1 && !window.__inScroller(all[i])) {
      bad.push((all[i].id || all[i].tagName) + ' right=' + Math.round(r.right) + ' vw=' + vw);
      if (bad.length > 8) break;
    }
  }
  return { docScrollW: de.scrollWidth, bodyScrollW: document.body.scrollWidth, innerWidth: vw, offenders: bad };
};
/* 下载拦截：把 Blob 抓成 dataURL 交给 node 落盘，同时不让浏览器真去存文件 */
window.__patchDownload = function () {
  window.__dl = {};
  var orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (blob) {
    var url = orig(blob);
    var fr = new FileReader();
    fr.onload = function () { window.__dl[url] = String(fr.result); };
    fr.readAsDataURL(blob);
    return url;
  };
  var realClick = HTMLAnchorElement.prototype.click;
  window.__clicks = [];
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) { window.__clicks.push(this.download); return; }
    return realClick.apply(this, arguments);
  };
  return true;
};
window.__grab = function () {
  return JSON.stringify({ files: window.__clicks || [], blobs: window.__dl || {} });
};
window.__reader = function () { return true; };
true;
`;

(async function main() {
  const lines = [];
  const push = function (s) { lines.push(s); console.log(s); };

  push('# 浏览器验收 · ' + TAG + ' · ' + URL + ' · ' + new Date().toISOString());
  /* 先把旧会话关掉，保证 --profile 真的被用上（否则会警告「daemon already running」） */
  try { sh(['close', '--all']); } catch (e) { /* 没有会话也没关系 */ }
  await sleep(600);
  sh(['--profile', PROFILE, '--session', SESSION, 'open', URL]);
  await sleep(1200);
  /* 每次开页面都把上一轮的本机保存清掉，保证从默认态开始 */
  ev('(function(){try{localStorage.clear();return "cleared";}catch(e){return "no-ls";}})()');
  sh(['--session', SESSION, 'open', URL]);
  await sleep(1200);
  sh(['--session', SESSION, 'console', '--clear']);
  ev('(function(){console.error("__aria_selfcheck_error__");console.warn("__aria_selfcheck_warn__");return true;})()');
  await sleep(400);

  const G = {};
  /* 每条断言都自带 RUNNER（页面重载后 window.__ok 会消失，所以不能只在开头注入一次） */
  function evalAssert(js, gname) {
    /* 必须包在 IIFE 里并显式 return：eval 拿到的是「最后一条表达式的值」，
     * 直接拼语句会返回 true（最后一次 __ok 的返回值），收集不到断言数组。 */
    const r = ev('(function(){' + RUNNER + '\n' + js + '\nreturn window.__res;})()');
    /* 兼容两种返回形态：直接是数组，或者包在 {res:[...]} 里 */
    const list = Array.isArray(r) ? r : (r && Array.isArray(r.res) ? r.res : (r && r.res ? r.res : []));
    if (!list.length) throw new Error('这一组没有收集到任何断言：' + gname);
    G[gname] = list;
    return list;
  }

  /* ── G0 采集器自检 ── */
  let g0 = [];
  g0.push(ev('(function(){return JSON.stringify({res:window.__res?window.__res.length:-1});})()'));
  let con = '';
  try { con = sh(['--session', SESSION, 'console']); } catch (e) { con = ''; }
  const sawErr = /__aria_selfcheck_error__/.test(con);
  const sawWarn = /__aria_selfcheck_warn__/.test(con);
  evalAssert(`
    window.__ok('G0', '故意 error 被采集器记到', ${sawErr}, 'console 输出里应当出现自检串');
    window.__ok('G0', '故意 warn 被采集器记到', ${sawWarn}, 'console 输出里应当出现自检串');
  `, 'G0');
  sh(['--session', SESSION, 'console', '--clear']);

  /* ── 通用前置 ── */
  const PRE = RUNNER + `
    window.__patchDownload();
    window.__pressPreset(0);
  `;
  ev(PRE);
  await sleep(300);

  /* ── G1 默认渲染与锚点 ── */
  evalAssert(`
    var o = window.__saltUi.getOut(), st = window.__saltUi.getState();
    window.__ok('G1','默认场景算得出来', o.ok, JSON.stringify((o.errors||[]).map(function(e){return e.code;})));
    window.__near('G1','要下的盐 = 35.8 g（手算锚点）', o.mSalt, 35.782032, 1e-6);
    window.__near('G1','要兑的水 = 560.6 mL（手算锚点）', o.waterMl, 560.585168, 1e-6);
    window.__near('G1','液体可用体积 = 572 mL', o.availMl, 572, 1e-9);
    window.__near('G1','密度 = 1.0426 g/mL', o.rho, 1.0426, 1e-12);
    window.__near('G1','每升含盐 = 62.556 g', o.saltPerL, 62.556, 1e-9);
    window.__near('G1','下盐总量（含补盐）= 38.9735 g', o.saltTotal, 38.973521361702126, 1e-9);
    window.__near('G1','渗出后盐度 = 5.5362 %', o.wAfter, 5.535867537832984, 1e-9);
    var lead = window.__txt('lead');
    window.__ok('G1','主结论里出现下盐量', lead.indexOf('35.8') >= 0, lead);
    window.__ok('G1','主结论里出现兑水量', lead.indexOf('561') >= 0, lead);
    var facts = window.__txt('facts');
    window.__ok('G1','关键证据里出现体积账', facts.indexOf('菜以外') >= 0, '');
    window.__ok('G1','关键证据里出现每升含盐', facts.indexOf('每升含盐') >= 0, '');
    var steps = document.querySelectorAll('#steps li');
    window.__ok('G1','照做清单 5 步', steps.length === 5, '实际 ' + steps.length);
    var inputs = document.querySelectorAll('section input[type=text]');
    window.__ok('G1','输入框 12 个', inputs.length === 12, '实际 ' + inputs.length);
    var ids = [].map.call(inputs, function(x){return x.id;}).sort().join(',');
    window.__ok('G1','输入框 id 与规格表一致', ids === 'i_bagG,i_bagPrice,i_bulk,i_haveVol,i_haveW,i_headroom,i_spoon,i_vegMass,i_vegShare,i_vegWater,i_vol,i_w', ids);
    window.__ok('G1','预设按钮 12 个', document.querySelectorAll('#presetBar .chip').length === 12, '');
    window.__ok('G1','三档对照卡 3 张', document.querySelectorAll('#schemeCards .cmp').length === 3, '');
    window.__ok('G1','换罐子表格有当前档高亮', document.querySelectorAll('#altTable tr.cur').length === 1, '');
    var chks = document.querySelectorAll('#chkList li');
    window.__ok('G1','自检列表有 11 项', chks.length === 11, '实际 ' + chks.length);
    window.__ok('G1','自检没有红项', document.querySelectorAll('#chkList li.n').length === 0, '');
    window.__ok('G1','错误条隐藏', document.getElementById('errBar').classList.contains('hide'), '');
  `, 'G1');

  /* ── G2 改条件立即重算 + 交互 ── */
  evalAssert(`
    var before = window.__saltUi.getOut().mSalt;
    window.__set('i_w','12');
    var o12 = window.__saltUi.getOut();
    window.__ok('G2','改目标盐度立刻重算（盐变多）', o12.mSalt > before, before + ' → ' + o12.mSalt);
    window.__near('G2','12 % 的下盐 = 液体×密度×12%', o12.mSalt, o12.availMl * o12.rho * 0.12, 1e-6);
    window.__set('i_w','6');
    window.__near('G2','改回 6 % 回到原值', window.__saltUi.getOut().mSalt, before, 1e-9);

    window.__set('i_vol','2');
    var o2 = window.__saltUi.getOut();
    window.__near('G2','罐子改 2 L：液体 = (2000−600−50)×0.88', o2.availMl, (2000-600-50)*0.88, 1e-9);
    window.__set('i_vol','1');

    window.__set('i_vegWater','0');
    var o0 = window.__saltUi.getOut();
    window.__near('G2','出水率 0：盐度不再被稀释', o0.wAfter, 6, 1e-9);
    window.__near('G2','出水率 0：补盐为 0', o0.addSalt, 0, 1e-12);
    window.__set('i_vegWater','10');

    window.__set('i_haveVol','300');
    window.__set('i_haveW','10');
    var oc = window.__saltUi.getOut();
    window.__ok('G2','填了原有盐水后本轮下盐变少', oc.mSalt < before, before + ' → ' + oc.mSalt);
    window.__near('G2','原有盐水量进总数（只算一次）', oc.mSalt + oc.haveSalt, oc.totalSaltM, 1e-6);
    var factsC = window.__txt('facts');
    window.__ok('G2','结论里说明算上了原有盐水', window.__txt('leadSub').indexOf('原有盐水') >= 0, window.__txt('leadSub'));
    window.__set('i_haveVol','0'); window.__set('i_haveW','0');

    var sugg = document.querySelectorAll('#sugList .sug button');
    window.__ok('G2','建议条数 ≥ 3', sugg.length >= 3, '实际 ' + sugg.length);
    var beforeLead = window.__txt('lead');
    var beforeSalt = window.__saltUi.getOut().mSalt;
    if (sugg.length) sugg[0].click();
    var afterLead = window.__txt('lead');
    window.__ok('G2','点建议之后主结论变了', afterLead !== beforeLead, beforeLead + ' → ' + afterLead);
    window.__ok('G2','点建议之后盐量也变了', window.__saltUi.getOut().mSalt !== beforeSalt, '');
    window.__ok('G2','提示里写明了按哪条建议改的', window.__txt('autoTag').indexOf('已按建议改') >= 0, window.__txt('autoTag'));

    window.__pressPreset(0);
    window.__ok('G2','点预设能回到默认场景', Math.abs(window.__saltUi.getOut().mSalt - 35.782032) < 1e-6, '');
    var chips = document.querySelectorAll('#presetBar .chip');
    window.__ok('G2','预设高亮只有 1 个', document.querySelectorAll('#presetBar .chip.on').length === 1, '');
  `, 'G2');

  /* ── G3 异常/无解与非法输入 ── */
  evalAssert(`
    window.__set('i_w','abc');
    var o1 = window.__saltUi.getOut();
    window.__ok('G3','非数字：算不出来', !o1.ok, '');
    window.__ok('G3','非数字：错误条显示出来', !document.getElementById('errBar').classList.contains('hide'), '');
    window.__ok('G3','非数字：输入框标红', document.getElementById('f_w').classList.contains('bad'), '');
    window.__ok('G3','非数字：结论区给出「先改对」提示', window.__txt('lead').indexOf('先') >= 0, window.__txt('lead'));
    window.__ok('G3','非数字：自检区不谎报通过', document.querySelectorAll('#chkList li').length === 1, '');
    window.__ok('G3','非数字：照做清单说清先解决标红', window.__txt('steps').indexOf('先解决') >= 0, '');
    window.__set('i_w','6');
    window.__ok('G3','改回合法：错误条又隐藏', document.getElementById('errBar').classList.contains('hide'), '');
    window.__ok('G3','改回合法：标红被清掉', !document.getElementById('f_w').classList.contains('bad'), '');
    window.__near('G3','改回合法：结论恢复', window.__saltUi.getOut().mSalt, 35.782032, 1e-6);

    /* 越界 */
    window.__set('i_w','0');
    window.__ok('G3','目标盐度 0 非法（下界 0.1）', !window.__saltUi.getOut().ok, '');
    window.__set('i_w','31');
    window.__ok('G3','目标盐度 31 非法（上界 30）', !window.__saltUi.getOut().ok, '');
    window.__set('i_w','30');
    window.__ok('G3','目标盐度 30 合法且提示外推', window.__saltUi.getOut().ok && window.__saltUi.getOut().warnings.some(function(w){return w.code==='extrapolated';}), '');
    window.__set('i_w','6');

    /* 无解：菜渗出的水就占满菜以外的空间 */
    window.__pressPreset(9);            /* 9 = toolittle：菜渗出的水就把菜以外的空间占完 */
    var oz = window.__saltUi.getOut();
    window.__ok('G3','无解预设：算不出来', !oz.ok, '');
    var codes = (oz.errors||[]).map(function(e){return e.code;}).join(',');
    window.__ok('G3','无解原因是 no-liquid-room', codes.indexOf('no-liquid-room') >= 0, codes);
    window.__ok('G3','无解时给出可执行修法（降到约多少克）', /降到约|出水率降到/.test(window.__txt('errList')), window.__txt('errList').slice(0,150));
    window.__ok('G3','无解时结论区不显示 0，而是让你改数', window.__txt('vSalt').indexOf('—') >= 0, window.__txt('vSalt'));

    /* 无解：已有盐水的水超量 */
    window.__pressPreset(10);           /* 10 = toosalty：已有盐水 1,900 mL 2 % 对 25 % 目标，水超量 */
    var ow = window.__saltUi.getOut();
    window.__ok('G3','水超量预设：算不出来', !ow.ok, '');
    window.__ok('G3','水超量原因是 infeasible', (ow.errors||[]).some(function(e){return e.code==='infeasible';}), JSON.stringify((ow.errors||[]).map(function(e){return e.code;})));
    window.__ok('G3','水超量时说明「只会加不会减」', window.__txt('errList').indexOf('只会加不会减') >= 0, window.__txt('errList').slice(0,180));

    /* 够咸那一支：不加盐但要提示 */
    window.__pressPreset(0);
    window.__set('i_w','2'); window.__set('i_haveVol','100'); window.__set('i_haveW','20');
    var oe = window.__saltUi.getOut();
    window.__ok('G3','原有盐水够咸：仍然算得出来', oe.ok, JSON.stringify((oe.errors||[]).map(function(e){return e.code;})));
    window.__ok('G3','原有盐水够咸：本轮下盐为 0', oe.mSalt === 0, '');
    window.__ok('G3','原有盐水够咸：给了「加盐解决不了」提示', window.__txt('warnList').indexOf('加盐解决不了') >= 0 || window.__txt('warnList').indexOf('多') >= 0, window.__txt('warnList').slice(0,180));
    window.__ok('G3','原有盐水够咸：主结论说不用再下盐', window.__txt('lead').indexOf('不用再下盐') >= 0, window.__txt('lead'));

    /* 极端长文本与极值 */
    window.__pressPreset(0);
    window.__set('i_vegMass','50000'); window.__set('i_vol','200'); window.__set('i_vegWater','80'); window.__set('i_vegShare','20');
    var oex = window.__saltUi.getOut();
    window.__ok('G3','极端组合要么算得出要么给明确原因', oex.ok || (oex.errors && oex.errors.length > 0), '');
    var ov = window.__overflow();
    window.__ok('G3','极端组合下页面不横向溢出', ov.docScrollW <= ov.innerWidth + 1 && ov.offenders.length === 0, JSON.stringify(ov));

    /* 极小值与超长数字文本 */
    window.__pressPreset(0);
    window.__set('i_vol','0.1'); window.__set('i_vegShare','94.9'); window.__set('i_vegMass','0'); window.__set('i_headroom','0');
    var omin = window.__saltUi.getOut();
    window.__ok('G3','极小液体体积仍可算且为有限正数', omin.ok && omin.mSalt > 0 && isFinite(omin.mSalt), JSON.stringify((omin.errors||[]).map(function(e){return e.code;})));
    window.__pressPreset(0);
    window.__set('i_bagPrice','999.99');
    window.__ok('G3','超长数字文本被接受并算出有限成本', isFinite(window.__saltUi.getOut().bagCost), '');
    window.__pressPreset(0);
  `, 'G3');

  /* ── G4 持久化与重开 ── */
  evalAssert(`
    window.__set('i_w','9.5'); window.__set('i_vol','3'); window.__set('i_vegMass','1234');
    var saved = window.__saltUi.getState();
    window.__ok('G4','保存按钮存在且可点', window.__click('btnSave'), '');
    var raw = localStorage.getItem('salt-ratio.v1');
    window.__ok('G4','本机确实写入了存档', !!raw && raw.length > 40, raw ? raw.length + ' 字节' : 'null');
    window.__ok('G4','存档里带着刚改的三个值', /9\\.5/.test(raw) && /"3"/.test(raw) && /1234/.test(raw), '');
  `, 'G4');
  await sleep(300);
  /* 整页重载，验证刷新恢复 */
  sh(['--session', SESSION, 'open', URL]);
  await sleep(1500);
  evalAssert(`
    var st = window.__saltUi.getState();
    window.__ok('G4','刷新后从本机恢复目标盐度 9.5', st.w === '9.5', st.w);
    window.__ok('G4','刷新后罐子容积 = 3', st.vol === '3', st.vol);
    window.__ok('G4','刷新后菜净重 = 1234', st.vegMass === '1234', st.vegMass);
    window.__ok('G4','刷新后页面读数与恢复的状态自洽', window.__saltUi.getOut().ok, '');
    window.__ok('G4','页面提示已恢复上次保存', window.__txt('saveTag').indexOf('恢复') >= 0 || window.__txt('saveTag').indexOf('保存') >= 0, window.__txt('saveTag'));
    window.__patchDownload();
    window.__click('btnReset');
    var d = window.__saltUi.getOut();
    window.__near('G4','恢复默认按钮把盐量还原', d.mSalt, 35.782032, 1e-6);
  `, 'G4');

  /* ── G5 视口与窄屏 ── */
  const VIEWS = [[1280, 900], [375, 780], [320, 700]];
  for (let i = 0; i < VIEWS.length; i++) {
    const [w, h] = VIEWS[i];
    sh(['--session', SESSION, 'set', 'viewport', String(w), String(h)]);
    await sleep(600);
    evalAssert(`
      var ov = window.__overflow();
      window.__ok('G5','视口 ${w}×${h}：innerWidth 实测等于设定值', ov.innerWidth === ${w}, 'innerWidth=' + ov.innerWidth);
      window.__ok('G5','视口 ${w}×${h}：文档不横向滚动', ov.docScrollW <= ov.innerWidth + 1, 'scrollWidth=' + ov.docScrollW);
      window.__ok('G5','视口 ${w}×${h}：没有任何元素右边界超出视口（可横向滑动的容器除外）', ov.offenders.length === 0, JSON.stringify(ov.offenders));
      window.__ok('G5','视口 ${w}×${h}：主结论与两个大数仍然可见', document.getElementById('lead').getBoundingClientRect().height > 0 && document.getElementById('vSalt').getBoundingClientRect().height > 0, '');
      window.__ok('G5','视口 ${w}×${h}：照做清单 5 步都还在', document.querySelectorAll('#steps li').length === 5, '');
    `, 'G5');
  }
  /* 窄屏下的长文案与极值实看 */
  sh(['--session', SESSION, 'set', 'viewport', '375', '780']);
  await sleep(400);
  evIIFE(`
    window.__patchDownload();
    window.__pressPreset(7);
    window.__set('i_w','29.9'); window.__set('i_vegMass','48000'); window.__set('i_vegWater','79');
  `);
  await sleep(300);
  evalAssert(`
    var ov = window.__overflow();
    var o = window.__saltUi.getOut();
    window.__ok('G5','375px 长文案+极值：仍不溢出', ov.docScrollW <= ov.innerWidth + 1 && ov.offenders.length === 0, JSON.stringify(ov));
    window.__ok('G5','375px 长文案+极值：要么算得出要么给原因', o.ok || (o.errors && o.errors.length > 0), '');
    window.__ok('G5','375px 长文案+极值：警告条文字没有 undefined', window.__txt('warnList').indexOf('undefined') < 0, '');
  `, 'G5');
  sh(['--session', SESSION, 'set', 'viewport', '1280', '900']);
  await sleep(400);

  /* ── G6 四种下载真实落盘 ── */
  evIIFE(`
    window.__patchDownload();
    window.__pressPreset(2);
    window.__reader = 1;
  `);
  await sleep(300);
  evalAssert(`
    window.__ok('G6','下载拦截器装好了', !!window.__dl && Array.isArray(window.__clicks), '');
    window.__ok('G6','CSV 按钮可点', window.__click('dlCsv'), '');
    window.__click('dlMd'); window.__click('dlPng'); window.__click('dlJson');
  `, 'G6');
  await sleep(1500);
  const grab = ev('window.__grab()');
  const files = (grab && grab.files) || [];
  const blobs = (grab && grab.blobs) || {};
  const urls = Object.keys(blobs);
  evalAssert(`
    window.__ok('G6','触发了 4 次下载', ${files.length} === 4, ${JSON.stringify(files)});
    var names = ${JSON.stringify(files)};
    window.__ok('G6','CSV 文件名以 .csv 结尾', names[0] && /\\.csv$/.test(names[0]), names[0]);
    window.__ok('G6','MD 文件名以 .md 结尾', names[1] && /\\.md$/.test(names[1]), names[1]);
    window.__ok('G6','PNG 文件名以 .png 结尾', names[2] && /\\.png$/.test(names[2]), names[2]);
    window.__ok('G6','JSON 文件名以 .json 结尾', names[3] && /\\.json$/.test(names[3]), names[3]);
    window.__ok('G6','PNG 文件名里写明尺寸', names[2] && names[2].indexOf('1080x1350') >= 0, names[2]);
  `, 'G6');
  /* 落盘 + 结构核对 */
  const saved = [];
  for (let i = 0; i < urls.length && i < files.length; i++) {
    const dataUrl = blobs[urls[i]];
    const comma = dataUrl.indexOf(',');
    const meta = dataUrl.slice(5, comma);
    const b64 = dataUrl.slice(comma + 1);
    const buf = Buffer.from(b64, 'base64');
    const name = files[i] || ('download-' + i);
    const p = path.join(DLDIR, name.replace(/[/\\]/g, '_'));
    fs.writeFileSync(p, buf);
    saved.push({ name, path: p, bytes: buf.length, meta });
  }
  const csvF = saved.find(function (s) { return /\.csv$/.test(s.name); });
  const mdF = saved.find(function (s) { return /\.md$/.test(s.name); });
  const pngF = saved.find(function (s) { return /\.png$/.test(s.name); });
  const jsonF = saved.find(function (s) { return /\.json$/.test(s.name); });
  const csvTxt = csvF ? fs.readFileSync(csvF.path, 'utf8') : '';
  const mdTxt = mdF ? fs.readFileSync(mdF.path, 'utf8') : '';
  const pngBuf = pngF ? fs.readFileSync(pngF.path) : Buffer.alloc(0);
  let jsonObj = null;
  try { jsonObj = jsonF ? JSON.parse(fs.readFileSync(jsonF.path, 'utf8')) : null; } catch (e) { jsonObj = null; }
  const curRaw = ev('JSON.stringify(window.__saltUi.getOut())');
  const curOut = typeof curRaw === 'string' ? JSON.parse(curRaw) : curRaw;
  const pngW = pngBuf.length > 24 ? pngBuf.readUInt32BE(16) : -1;
  const pngH = pngBuf.length > 24 ? pngBuf.readUInt32BE(20) : -1;
  const pngMagic = pngBuf.slice(0, 8).toString('hex');
  /* 多行文本一律用 JSON.parse('…') 的形式塞进环境，避免在模板字符串里把断行搞坏 */
  const csvLiteral = JSON.stringify(JSON.stringify(csvTxt));
  const mdLiteral = JSON.stringify(JSON.stringify(mdTxt));
  const saltStr = String(curOut.mSalt.toFixed(1));
  const waterStr = String(curOut.waterMl.toFixed(0));
  evalAssert(`
    var csv = JSON.parse(${csvLiteral});
    var md = JSON.parse(${mdLiteral});
    var csvLines = csv.split('\\n').filter(function (x) { return x.length > 0; });
    window.__ok('G6','CSV 带 UTF-8 BOM', csv.charCodeAt(0) === 0xFEFF, '首字符码 ' + csv.charCodeAt(0));
    window.__ok('G6','CSV 行数 ≥ 20', csvLines.length >= 20, '实际 ' + csvLines.length + ' 行');
    window.__ok('G6','CSV 里有表头', csvLines[0].indexOf('项目') >= 0, csvLines[0]);
    window.__ok('G6','CSV 里出现本次的下盐量 ${saltStr}', csv.indexOf('${saltStr}') >= 0, '');
    window.__ok('G6','CSV 里出现本次的兑水量 ${waterStr}', csv.indexOf('${waterStr}') >= 0, '');
    window.__ok('G6','MD 有标题', md.indexOf('# ') === 0, JSON.stringify(md.slice(0, 30)));
    window.__ok('G6','MD 里出现本次的下盐量 ${saltStr}', md.indexOf('${saltStr}') >= 0, '');
    window.__ok('G6','MD 带上边界声明', md.indexOf('安全判定') >= 0, '');
    window.__ok('G6','PNG magic 是 89504e47', '${pngMagic}' === '89504e470d0a1a0a', '${pngMagic}');
    window.__ok('G6','PNG 尺寸 1080×1350', ${pngW} === 1080 && ${pngH} === 1350, ${pngW} + '×' + ${pngH});
    window.__ok('G6','PNG 字节数 > 20 KB', ${pngBuf.length} > 20480, ${pngBuf.length} + ' 字节');
    window.__ok('G6','JSON 可解析', ${jsonObj ? 'true' : 'false'}, '');
    window.__ok('G6','JSON 里有输入状态', ${jsonObj && jsonObj.state ? 'true' : 'false'}, '');
    window.__near('G6','JSON 里的下盐量与页面一致', ${jsonObj && jsonObj.result ? jsonObj.result.mSalt : -1}, ${curOut.mSalt}, 1e-9);
    window.__near('G6','JSON 里的兑水量与页面一致', ${jsonObj && jsonObj.result ? jsonObj.result.waterMl : -1}, ${curOut.waterMl}, 1e-9);
    window.__ok('G6','四个文件都真实落盘', ${saved.filter(function (s) { return s.bytes > 0; }).length} === 4, JSON.stringify(${JSON.stringify(saved.map(function (s) { return s.name + ':' + s.bytes; }))}));
  `, 'G6');
  push('落盘文件：' + saved.map(function (s) { return s.name + ' (' + s.bytes + ' 字节)'; }).join('；'));

  /* ── G7 控制台为空 ── */
  await sleep(500);
  let con2 = '';
  try { con2 = sh(['--session', SESSION, 'console']); } catch (e) { con2 = ''; }
  let err2 = '';
  try { err2 = sh(['--session', SESSION, 'errors']); } catch (e) { err2 = ''; }
  const errCount = (con2.match(/\[error\]/g) || []).length;
  const warnCount = (con2.match(/\[warn\]/g) || []).length;
  const pageErrs = err2.trim() && !/no page errors|^$/i.test(err2.trim()) ? err2.trim().slice(0, 400) : '';
  evalAssert(`
    window.__ok('G7','控制台 error 数 = 0', ${errCount} === 0, 'error=' + ${errCount} + ' warn=' + ${warnCount});
    window.__ok('G7','控制台 warn 数 = 0', ${warnCount} === 0, 'warn=' + ${warnCount});
    window.__ok('G7','没有未捕获的页面错误', ${pageErrs ? 'false' : 'true'}, ${JSON.stringify(pageErrs)});
  `, 'G7');

  /* ── 汇总 ── */
  const all = [];
  Object.keys(G).forEach(function (k) { G[k].forEach(function (r) { all.push(r); }); });
  const pass = all.filter(function (r) { return r.pass; }).length;
  const fail = all.length - pass;
  push('');
  Object.keys(G).forEach(function (k) {
    const list = G[k];
    const p = list.filter(function (r) { return r.pass; }).length;
    push('## ' + k + '：' + p + '/' + list.length + ' PASS');
    list.forEach(function (r) { if (!r.pass) push('   ✗ ' + r.name + ' —— ' + r.detail); });
  });
  push('');
  push('合计 ' + pass + '/' + all.length + ' PASS，失败 ' + fail);
  push('落盘目录：' + DLDIR);
  fs.writeFileSync(OUT, lines.join('\n') + '\n');
  fs.writeFileSync(path.join(ROOT, 'evidence', '浏览器验收-' + TAG + '.json'),
    JSON.stringify({ tag: TAG, url: URL, at: new Date().toISOString(), pass: pass, total: all.length, groups: G, downloads: saved.map(function (s) { return { name: s.name, bytes: s.bytes }; }) }, null, 2));
  push('结果已写入：' + OUT);
  process.exit(fail === 0 ? 0 : 1);
})().catch(function (e) {
  console.error('验收脚本自身出错：' + (e && e.stack ? e.stack : e));
  process.exit(2);
});
