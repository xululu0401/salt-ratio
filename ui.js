/* 那袋盐怎么配 · 界面层（ui.js）
 * 只负责把 AppCore.compute 的结果画出来、把用户的点击改回输入。
 * 纪律：页面上出现的每个数字都来自同一次 compute 的输出（或用户自己填的原文），
 *       不在这里另算一遍，也不写死任何数值。
 */
(function () {
  'use strict';
  var C = window.AppCore;
  var $ = function (id) { return document.getElementById(id); };
  var state = C.defaultState();
  var out = null;
  var saveTimer = null;

  /* ── 输入分组（顺序就是页面顺序） ── */
  var GROUPS = [
    { host: 'g-w', keys: ['w'] },
    { host: 'g-vessel', keys: ['vol', 'vegShare'] },
    { host: 'g-veg', keys: ['vegMass', 'vegWater', 'headroom'] },
    { host: 'g-have', keys: ['haveVol', 'haveW'] },
    { host: 'g-measure', keys: ['bulk', 'spoon', 'bagG', 'bagPrice'] }
  ];

  var HINTS = {
    w: '盐的质量 ÷ 盐水总质量。0.1–30，超过 24 会提示这是密度模型的外推区。',
    vol: '你手上那个罐子的容积，0.1–200 L。',
    vegShare: '你估计的：菜在罐子里占掉多少比例的体积（含菜里原有的水）。',
    vegMass: '要腌的菜的净重。它只用来算「菜会渗出多少水」。',
    vegWater: '你估计的：菜每 100 g 会渗出多少克水。拿不准就填小一点，页面会把影响算给你看。',
    headroom: '液面到罐口留多少余量，防止发酵顶出来。',
    haveVol: '上一次剩下的、或者已经泡着的盐水有多少毫升。没有就填 0。',
    haveW: '那部分盐水自己的盐度。填 0 就是清水。',
    bulk: '盐堆在勺里的松紧程度，只影响「合几勺」和盐占多少体积，不影响要下多少克盐。',
    spoon: '你那一平勺大约多少克。量勺只是估数，能用秤就用秤。',
    bagG: '一袋盐多少克，用来算要买几袋。',
    bagPrice: '你自己买的价，本页不查真实价格。'
  };

  /* ── 建表单 ── */
  function buildInputs() {
    GROUPS.forEach(function (g) {
      var host = $(g.host);
      host.innerHTML = '';
      g.keys.forEach(function (k) {
        var f = C.FIELDS[k];
        var d = document.createElement('div');
        d.className = 'f';
        d.id = 'f_' + k;
        var lab = document.createElement('label');
        lab.setAttribute('for', 'i_' + k);
        lab.innerHTML = f.label + '<i>' + (f.unit || '') + '</i>';
        var inp = document.createElement('input');
        inp.id = 'i_' + k;
        inp.type = 'text';
        inp.inputMode = 'decimal';
        inp.autocomplete = 'off';
        inp.setAttribute('aria-label', f.label + (f.unit ? '（' + f.unit + '）' : ''));
        inp.title = HINTS[k] || '';
        inp.addEventListener('input', function () {
          state[k] = inp.value;
          render(false);
          queueSave();
        });
        var msg = document.createElement('div');
        msg.className = 'msg';
        msg.id = 'm_' + k;
        d.appendChild(lab); d.appendChild(inp); d.appendChild(msg);
        host.appendChild(d);
      });
    });
  }

  function buildPresets() {
    var bar = $('presetBar');
    bar.innerHTML = '<span class="lb">试一个：</span>';
    C.PRESETS.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = p.name;
      b.title = p.note;
      b.addEventListener('click', function () {
        state = C.stateFromPreset(p.key);
        render(true);
        queueSave();
      });
      bar.appendChild(b);
    });
  }

  /* ── 渲染 ── */
  function render(full) {
    if (full) syncInputs();
    out = C.compute(state);
    markInputs();
    renderErrors();
    renderWarnings();
    if (out.ok) {
      renderSlip();
    } else {
      blankSlip();
    }
    renderSteps();
    renderSuggestions();
    renderSchemes();
    renderAlt();
    renderChecks();
    highlightPreset();
  }

  function syncInputs() {
    C.ORDER.forEach(function (k) {
      var el = $('i_' + k);
      if (el) el.value = state[k];
    });
  }

  function markInputs() {
    C.ORDER.forEach(function (k) {
      var box = $('f_' + k);
      if (!box) return;
      var bad = out.errors.some(function (e) { return e.field === k; });
      var warned = !bad && out.warnings.some(function (w) { return w.field === k; });
      box.classList.toggle('bad', bad);
      var msg = $('m_' + k);
      if (msg) {
        var e = out.errors.filter(function (x) { return x.field === k; })[0];
        var w = out.warnings.filter(function (x) { return x.field === k; })[0];
        msg.textContent = e ? e.message : (warned && w ? w.message : '');
        msg.style.display = e ? 'block' : 'none';
      }
    });
  }

  function renderErrors() {
    var bar = $('errBar'), list = $('errList');
    if (out.ok) { bar.classList.add('hide'); list.innerHTML = ''; return; }
    bar.classList.remove('hide');
    list.innerHTML = '';
    /* 跨字段的无解原因（field 指向某个输入框）与字段本身的错都要列出来，去重 */
    var seen = {};
    out.errors.forEach(function (e) {
      var key = e.code + '|' + e.message;
      if (seen[key]) return;
      seen[key] = 1;
      var li = document.createElement('li');
      li.textContent = e.message;
      list.appendChild(li);
    });
  }

  function renderWarnings() {
    var bar = $('warnBar'), list = $('warnList');
    if (!out.warnings.length) { bar.classList.add('hide'); list.innerHTML = ''; return; }
    bar.classList.remove('hide');
    list.innerHTML = '';
    out.warnings.forEach(function (w) {
      var li = document.createElement('li');
      li.textContent = w.message;
      list.appendChild(li);
    });
  }

  function blankSlip() {
    $('lead').textContent = '先把标红的数改对，这张单子才算得出来。';
    $('leadSub').textContent = '';
    $('vSalt').innerHTML = '—<span class="u">g</span>';
    $('vWater').innerHTML = '—<span class="u">mL</span>';
    $('dSalt').textContent = ''; $('dWater').textContent = '';
    $('facts').innerHTML = '';
    $('slipMeta').textContent = '';
  }

  function renderSlip() {
    var v = out.values;
    $('slipMeta').textContent = '这个罐子 · 目标 ' + C.fmtPct(v.w, 2) + ' · ' + C.fmt(v.vol, 3) + ' L';
    if (out.enoughSalt) {
      $('lead').innerHTML = '这一罐<b>不用再下盐</b>：已有的盐水里的盐就够了。';
    } else {
      $('lead').innerHTML = '这一罐还要下 <em>' + C.fmtV(out.mSalt, 1) + '</em> g 盐、兑 <em>' + C.fmtV(out.waterMl, 0) + '</em> mL 水。';
    }
    $('leadSub').textContent = out.carryMl > 0
      ? '已经算上你填的那 ' + C.fmtV(out.carryMl, 0) + ' mL 原有盐水（' + C.fmtPct(out.carryW, 2) + '）。'
      : '';

    $('vSalt').innerHTML = (out.enoughSalt ? '0' : C.fmtV(out.mSalt, 1)) + '<span class="u">g</span>';
    $('vWater').innerHTML = C.fmtV(out.waterMl, 0) + '<span class="u">mL</span>';
    $('dSalt').textContent = out.enoughSalt
      ? '已有的盐 ' + C.fmtV(out.haveSalt, 1) + ' g 已经超过整罐该有的 ' + C.fmtV(out.totalSaltM, 1) + ' g'
      : '整罐该含盐 ' + C.fmtV(out.totalSaltM, 2) + ' g' + (out.carryMl > 0 ? '，其中 ' + C.fmtV(out.haveSalt, 2) + ' g 来自原有盐水' : '');
    $('dWater').textContent = '约 ' + C.fmtV(out.mWater, 0) + ' g（1 g 水按 1 mL 算）';

    var rows = [
      ['液体总量', C.fmtV(out.availMl, 0) + ' mL（' + C.fmtV(out.totalSolM, 1) + ' g，密度 ' + C.fmt(out.rho, 4) + ' g/mL）'],
      ['每升含盐', C.fmtV(out.saltPerL, 2) + ' g/L　→　每 100 mL 液体：盐 ' + C.fmtV(out.per100Salt, 2) + ' g、水 ' + C.fmtV(out.per100Water, 0) + ' g'],
      ['体积账', '菜以外 ' + C.fmtV(out.bracket, 0) + ' mL　−　菜渗出的水 ' + C.fmtV(out.vegWaterG, 0) + ' mL　−　预留 ' + C.fmtPct(out.values.headroom, 1) + ' = 液体 ' + C.fmtV(out.availMl, 0) + ' mL'],
      ['盐占的体积', C.fmtV(out.saltMl, 0) + ' mL（堆积密度 ' + C.fmtV(out.values.bulk, 0) + ' g/L）≈ ' + C.fmtV(out.spoons, 1) + ' 平勺（一平勺 ' + C.fmtV(out.values.spoon, 1) + ' g）'],
      ['要买的盐', out.bags + ' 袋 × ' + C.fmtV(out.values.bagG, 0) + ' g = ' + C.fmtV(out.bags * out.values.bagG, 0) + ' g，约 ' + C.fmtV(out.bagCost, 2) + ' 元（单价是你填的）']
    ];
    if (out.vegWaterG > 0) {
      rows.splice(1, 0, ['菜会出水', C.fmtV(out.vegWaterG, 0) + ' g（菜净重 ' + C.fmtV(out.values.vegMass, 0) + ' g × ' + C.fmtPct(out.values.vegWater, 1) + '）→ 盐度会从 ' + C.fmtPct(out.values.w, 2) + ' 落到 ' + C.fmtPct(out.wAfter, 2) + '；一次到位就把盐改称 ' + C.fmtV(out.saltTotal, 1) + ' g']);
    }
    var f = $('facts');
    f.innerHTML = '';
    rows.forEach(function (r) {
      var d = document.createElement('div');
      d.innerHTML = r[0] + '：<b>' + esc(r[1]) + '</b>';
      f.appendChild(d);
    });
  }

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function renderSteps() {
    var ol = $('steps');
    ol.innerHTML = '';
    if (!out.ok) {
      $('planTail').textContent = '等算得出来再给步骤';
      var li0 = document.createElement('li');
      li0.innerHTML = '<span class="dot">–</span><h4>先解决上面标红的问题</h4><p>无解的时候硬给一张单子只会误导人。</p>';
      ol.appendChild(li0);
      return;
    }
    $('planTail').textContent = '共 ' + out.plan.steps.length + ' 步';
    out.plan.steps.forEach(function (s) {
      var li = document.createElement('li');
      var h = document.createElement('h4'); h.textContent = s.title;
      var p = document.createElement('p'); p.textContent = s.text;
      var dot = document.createElement('span'); dot.className = 'dot'; dot.textContent = s.no;
      li.appendChild(dot); li.appendChild(h); li.appendChild(p);
      ol.appendChild(li);
    });
  }

  function renderSuggestions() {
    var host = $('sugList');
    host.innerHTML = '';
    var list = C.suggestions(state, out);
    if (!list.length) {
      host.innerHTML = '<p class="note">这个条件下没有可给的建议（该改的都改过了，或者当前是无解/极简状态）。</p>';
      return;
    }
    list.forEach(function (s) {
      var d = document.createElement('div');
      d.className = 'sug';
      var t = document.createElement('p'); t.className = 't'; t.textContent = s.label;
      var e = document.createElement('p'); e.className = 'e'; e.textContent = s.effect;
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = '按这个改';
      b.setAttribute('data-sug', s.id);
      b.addEventListener('click', function () {
        state = C.applySuggestion(state, s);
        render(true); queueSave();
        $('autoTag').textContent = '已按建议改：' + s.label;
      });
      d.appendChild(t); d.appendChild(e); d.appendChild(b);
      host.appendChild(d);
    });
  }

  function renderSchemes() {
    var host = $('schemeCards');
    host.innerHTML = '';
    if (!out.ok || !out.schemes) return;
    out.schemes.forEach(function (sc) {
      var d = document.createElement('div');
      d.className = 'cmp' + (Math.abs(sc.w - out.values.w) < 1e-9 ? ' pick' : '');
      d.setAttribute('data-scheme', sc.w);
      var h = document.createElement('h4');
      h.textContent = '目标 ' + C.fmtPct(sc.w, 2) + (Math.abs(sc.w - out.values.w) < 1e-9 ? '（当前）' : '');
      var dl = document.createElement('dl');
      [['每升含盐', C.fmtV(sc.saltPerL, 1) + ' g/L'],
       ['本轮下盐', C.fmtV(sc.mSalt, 1) + ' g'],
       ['兑水', C.fmtV(sc.waterMl, 0) + ' mL'],
       ['渗出后', C.fmtPct(sc.wAfter, 2)],
       ['整袋', sc.bags + ' 袋 / ' + C.fmtV(sc.bagCost, 2) + ' 元']].forEach(function (r) {
        var row = document.createElement('div');
        row.innerHTML = '<span>' + r[0] + '</span><b>' + esc(r[1]) + '</b>';
        dl.appendChild(row);
      });
      d.appendChild(h); d.appendChild(dl);
      host.appendChild(d);
    });
  }

  function renderAlt() {
    var tb = $('altTable').querySelector('tbody');
    tb.innerHTML = '';
    (out.alt || []).forEach(function (r) {
      var tr = document.createElement('tr');
      if (r.isCurrent) tr.className = 'cur';
      if (!r.ok) {
        tr.innerHTML = '<td>' + C.fmtV(r.vol, 3) + ' L' + (r.isCurrent ? '（当前）' : '') + '</td><td colspan="5">' + esc(r.reason) + '</td>';
      } else {
        tr.innerHTML = '<td>' + C.fmtV(r.vol, 3) + ' L' + (r.isCurrent ? '（当前）' : '') + '</td>' +
          '<td><b>' + C.fmtV(r.availMl, 0) + '</b> mL</td>' +
          '<td><b>' + C.fmtV(r.saltTotal, 1) + '</b> g</td>' +
          '<td>' + C.fmtV(r.waterMl, 0) + ' mL</td>' +
          '<td>' + r.bags + ' 袋</td>' +
          '<td>' + C.fmtPct(r.wAfter, 2) + '</td>';
      }
      tb.appendChild(tr);
    });
  }

  function renderChecks() {
    var ul = $('chkList');
    ul.innerHTML = '';
    if (!out.ok) {
      $('chkTail').textContent = '无解，没有可自检的结果';
      var li = document.createElement('li');
      li.className = 'n';
      li.textContent = '算不出来，所以没有任何一项通过';
      ul.appendChild(li);
      return;
    }
    var pass = out.checks.filter(function (c) { return c.pass; }).length;
    $('chkTail').textContent = pass + ' / ' + out.checks.length + ' 项通过';
    out.checks.forEach(function (c) {
      var li = document.createElement('li');
      li.className = c.pass ? 'y' : 'n';
      li.setAttribute('data-check', c.name);
      var b = document.createElement('b'); b.textContent = c.name;
      var sp = document.createElement('span'); sp.textContent = c.detail;
      li.appendChild(b); li.appendChild(sp);
      ul.appendChild(li);
    });
  }

  function highlightPreset() {
    var bar = $('presetBar');
    Array.prototype.forEach.call(bar.querySelectorAll('.chip'), function (b, i) {
      b.classList.toggle('on', C.PRESETS[i].key === state.key);
    });
  }

  /* ── 本机保存 ── */
  function queueSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveLocal(true); }, 400);
  }
  function saveLocal(quiet) {
    try {
      localStorage.setItem(C.STORE_KEY, JSON.stringify({ saved_at: new Date().toISOString(), state: state }));
      if (!quiet) $('saveTag').textContent = '已保存到本机（' + new Date().toLocaleTimeString('zh-CN') + '）';
      return true;
    } catch (e) {
      if (!quiet) $('saveTag').textContent = '本机保存失败：' + (e && e.message ? e.message : e);
      return false;
    }
  }
  function loadLocal() {
    try {
      var raw = localStorage.getItem(C.STORE_KEY);
      if (!raw) return null;
      var j = JSON.parse(raw);
      return j && j.state ? { state: C.stateFromJSON(j.state), saved_at: j.saved_at } : null;
    } catch (e) { return null; }
  }

  /* ── 下载 ── */
  /* 页面上的每个数字都来自 render() 里那一次 compute 的结果（out）。
   * 导出必须用同一个 out，不能在这里再 compute 一次 —— 否则「导出与页面同源」只是碰巧成立。
   * （本轮实测抓到过：导出按钮拿到的是别处的默认态结果，CSV 直接退化成只有一行错误。） */
  function shown() { return out || C.compute(state); }
  function stamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }
  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  /* 结果卡：1080×1350，内容全部取自这一次 compute 的输出 */
  function drawCard() {
    var W = 1080, H = 1350;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var g = cv.getContext('2d');
    if (!g) return null;
    g.fillStyle = '#f2f5f8'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffffff'; g.fillRect(48, 48, W - 96, H - 96);
    g.fillStyle = '#4a6fa5'; g.fillRect(48, 48, W - 96, 12);
    var pad = 96, y = 140;
    g.textBaseline = 'top';
    g.fillStyle = '#1b2430';
    g.font = '600 54px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    g.fillText('那袋盐怎么配', pad, y); y += 76;
    g.font = '28px -apple-system,"PingFang SC",sans-serif';
    g.fillStyle = '#7d8b9c';
    g.fillText('配盐单 · ' + new Date().toLocaleString('zh-CN'), pad, y); y += 62;

    if (!out.ok) {
      g.fillStyle = '#b91c1c';
      g.font = '600 38px -apple-system,"PingFang SC",sans-serif';
      g.fillText('这次算不出来：', pad, y); y += 54;
      g.font = '26px -apple-system,"PingFang SC",sans-serif';
      wrapText(g, out.errors[0].message, pad, y, W - pad * 2, 40);
      g.fillStyle = '#7d8b9c';
      g.font = '22px -apple-system,"PingFang SC",sans-serif';
      g.fillText('本页只算盐和水的比例，不做安全判定。', pad, H - 150);
      return cv;
    }

    var v = out.values;
    g.fillStyle = '#4a6fa5';
    g.font = '600 30px -apple-system,"PingFang SC",sans-serif';
    g.fillText('这一罐还要下', pad, y); y += 46;
    g.fillStyle = '#a8551c';
    g.font = '700 118px ui-monospace,Menlo,monospace';
    var saltTxt = C.fmtV(out.mSalt, 1) + ' g';
    g.fillText(saltTxt, pad, y);
    var wSalt = g.measureText(saltTxt).width;
    g.font = '600 30px -apple-system,"PingFang SC",sans-serif';
    g.fillStyle = '#2f8f8a';
    g.fillText('　＋ 水', pad + wSalt, y + 76);
    g.font = '700 118px ui-monospace,Menlo,monospace';
    var waterTxt = C.fmtV(out.waterMl, 0) + ' mL';
    g.fillText(waterTxt, pad + wSalt + 150, y);
    y += 168;

    g.fillStyle = '#4c5a6b';
    g.font = '27px -apple-system,"PingFang SC",sans-serif';
    var lines = [
      '目标盐度 ' + C.fmtPct(v.w, 2) + '　·　罐子 ' + C.fmt(v.vol, 3) + ' L　·　菜占容积 ' + C.fmtPct(v.vegShare, 1) + '　·　菜净重 ' + C.fmtV(v.vegMass, 0) + ' g',
      '菜预计出水 ' + C.fmtV(out.vegWaterG, 0) + ' g　→　盐度约落到 ' + C.fmtPct(out.wAfter, 2) + '　（一次到位请称 ' + C.fmtV(out.saltTotal, 1) + ' g 盐）',
      '液体 ' + C.fmtV(out.availMl, 0) + ' mL　·　每升含盐 ' + C.fmtV(out.saltPerL, 2) + ' g　·　密度 ' + C.fmt(out.rho, 4) + ' g/mL',
      '盐占体积 ' + C.fmtV(out.saltMl, 0) + ' mL ≈ ' + C.fmtV(out.spoons, 1) + ' 平勺　·　要买 ' + out.bags + ' 袋（' + C.fmtV(out.values.bagG, 0) + ' g/袋），约 ' + C.fmtV(out.bagCost, 2) + ' 元',
      '换罐子直接乘：每 100 mL 液体 盐 ' + C.fmtV(out.per100Salt, 2) + ' g、水 ' + C.fmtV(out.per100Water, 0) + ' g',
      '菜以外空间 ' + C.fmtV(out.bracket, 0) + ' mL　−　菜渗水 ' + C.fmtV(out.vegWaterG, 0) + ' mL　−　预留 ' + C.fmtPct(v.headroom, 1) + ' = 液体 ' + C.fmtV(out.availMl, 0) + ' mL'
    ];
    if (out.carryMl > 0) {
      lines.splice(2, 0, '已算上原有盐水 ' + C.fmtV(out.carryMl, 0) + ' mL（' + C.fmtPct(out.carryW, 2) + '，含盐 ' + C.fmtV(out.haveSalt, 2) + ' g）');
    }
    lines.forEach(function (t) { y = wrapText(g, t, pad, y, W - pad * 2, 42) + 12; });

    y += 8;
    g.strokeStyle = '#eaeff4'; g.beginPath(); g.moveTo(pad, y); g.lineTo(W - pad, y); g.stroke();
    y += 26;
    g.fillStyle = '#4c5a6b';
    g.font = '600 28px -apple-system,"PingFang SC",sans-serif';
    g.fillText('照这个顺序做', pad, y); y += 44;
    g.font = '25px -apple-system,"PingFang SC",sans-serif';
    out.plan.steps.forEach(function (s) {
      y = wrapText(g, s.no + '. ' + s.title + '：' + s.text, pad, y, W - pad * 2, 36) + 8;
    });

    g.fillStyle = '#7d8b9c';
    g.font = '22px -apple-system,"PingFang SC",sans-serif';
    var foot = '本页只算盐和水的比例与体积：不判断能不能吃、能放多久，不内置任何菜品配方；密度按线性内插、体积按加和近似。默认与内置场景全部是虚构示例。';
    var fy = H - 210;
    wrapText(g, foot, pad, fy, W - pad * 2, 32);
    g.fillText('AI 自行复核，未做人工校核。', pad, H - 118);
    return cv;
  }

  function wrapText(g, text, x, y, maxW, lh) {
    var line = '';
    for (var i = 0; i < text.length; i++) {
      var test = line + text[i];
      if (g.measureText(test).width > maxW && line) {
        g.fillText(line, x, y); y += lh; line = text[i];
      } else { line = test; }
    }
    if (line) { g.fillText(line, x, y); y += lh; }
    return y;
  }

  function downloadCard() {
    var cv = drawCard();
    if (!cv) { $('dlTag').textContent = '这台设备没有可用的 canvas，结果卡没画出来。'; return; }
    cv.toBlob(function (blob) {
      if (!blob) { $('dlTag').textContent = '结果卡导出失败（toBlob 返回空）。'; return; }
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '那袋盐怎么配-结果卡-1080x1350-' + stamp() + '.png';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      $('dlTag').textContent = '结果卡已导出：1080×1350 PNG，' + Math.round(blob.size / 1024) + ' KB。';
    }, 'image/png');
  }

  /* ── 事件 ── */
  function wire() {
    $('btnReset').addEventListener('click', function () {
      state = C.defaultState(); render(true); queueSave();
      $('autoTag').textContent = '已恢复默认示例（虚构）';
    });
    $('btnSave').addEventListener('click', function () {
      var okSave = saveLocal(false);
      if (okSave) $('saveTag').textContent = '已保存到本机 ' + new Date().toLocaleTimeString('zh-CN');
    });
    $('btnLoad').addEventListener('click', function () {
      var l = loadLocal();
      if (!l) { $('saveTag').textContent = '本机上还没有保存过'; return; }
      state = l.state; render(true);
      $('saveTag').textContent = '已读取本机保存（' + new Date(l.saved_at).toLocaleString('zh-CN') + '）';
    });
    $('fileImport').addEventListener('change', function (ev) {
      var f = ev.target.files && ev.target.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var j = JSON.parse(String(fr.result));
          var st = j && j.state ? j.state : j;
          if (!st || typeof st !== 'object') throw new Error('文件里没有状态');
          state = C.stateFromJSON(st);
          render(true); queueSave();
          $('saveTag').textContent = '已导入备份：' + f.name;
        } catch (e) {
          $('saveTag').textContent = '导入失败：' + (e && e.message ? e.message : e);
        }
      };
      fr.readAsText(f);
      ev.target.value = '';
    });
    $('dlCsv').addEventListener('click', function () {
      download('那袋盐怎么配-' + stamp() + '.csv', C.toCSV(state, shown()), 'text/csv;charset=utf-8');
      $('dlTag').textContent = 'CSV 已导出（带 BOM，Excel 可直接打开）。';
    });
    $('dlMd').addEventListener('click', function () {
      download('那袋盐怎么配-' + stamp() + '.md', C.toMarkdown(state, shown()), 'text/markdown;charset=utf-8');
      $('dlTag').textContent = '说明（.md）已导出。';
    });
    $('dlPng').addEventListener('click', downloadCard);
    $('dlJson').addEventListener('click', function () {
      download('那袋盐怎么配-备份-' + stamp() + '.json', C.toJSON(state, shown()), 'application/json;charset=utf-8');
      $('dlTag').textContent = '备份（JSON）已导出，含输入与这次的结果。';
    });
  }

  /* ── 启动：有本机保存就用它 ── */
  buildInputs();
  buildPresets();
  wire();
  var l = loadLocal();
  if (l) {
    state = l.state;
    $('saveTag').textContent = '已恢复上次保存（' + new Date(l.saved_at).toLocaleString('zh-CN') + '）';
  }
  render(true);

  /* 给验收脚本一个只读入口，便于核对页面读数与引擎输出 */
  window.__saltUi = {  /* 只读入口，给验收脚本核对页面读数与引擎输出 */
    getState: function () { return C.cloneState(state); },
    getOut: function () { return out; },
    getChecks: function () { return out && out.ok ? out.checks.map(function (c) { return { name: c.name, pass: c.pass }; }) : []; }
  };
})();
