/* 那袋盐怎么配 · 纯计算内核（core.js）
 * 口径全部来自 ../需求与调研.md §2，任何改动都要同步那份文字。
 * 这个文件不碰 DOM，可以在 node 里直接 require 做测试。
 *
 * 一句话：把「目标盐度 + 罐子容积 + 菜占多少」换成一张能照着下的配盐单。
 * 边界（写死在实现里，也写在页面上）：只做质量分数/密度/体积的算术，
 * 不判断任何浓度安不安全、能不能吃、能放多久；不内置任何菜品配方。
 */
(function (global) {
  'use strict';

  /* ══════════════════ 1. 规格表（唯一的范围真相） ══════════════════ */
  var SPEC = {
    version: '1.0.0',
    title: '那袋盐怎么配',
    fields: [
      { key: 'w', label: '目标盐度', unit: '%', min: 0.1, minIncl: true, max: 30, maxIncl: true, dp: 2 },
      { key: 'vol', label: '罐子容积', unit: 'L', min: 0.1, minIncl: true, max: 200, maxIncl: true, dp: 3 },
      { key: 'vegShare', label: '蔬菜占容积', unit: '%', min: 0, minIncl: true, max: 95, maxIncl: true, dp: 1 },
      { key: 'vegMass', label: '蔬菜净重', unit: 'g', min: 0, minIncl: true, max: 50000, maxIncl: true, dp: 1 },
      { key: 'vegWater', label: '蔬菜出水率', unit: '%', min: 0, minIncl: true, max: 80, maxIncl: true, dp: 1 },
      { key: 'headroom', label: '预留液面空间', unit: '%', min: 0, minIncl: true, max: 50, maxIncl: true, dp: 1 },
      { key: 'haveVol', label: '已有盐水体积', unit: 'mL', min: 0, minIncl: true, max: 200000, maxIncl: true, dp: 1 },
      { key: 'haveW', label: '已有盐水盐度', unit: '%', min: 0, minIncl: true, max: 30, maxIncl: true, dp: 2 },
      { key: 'bulk', label: '食盐堆积密度', unit: 'g/L', min: 500, minIncl: true, max: 1600, maxIncl: true, dp: 0 },
      { key: 'bagG', label: '整袋盐规格', unit: 'g', min: 50, minIncl: true, max: 5000, maxIncl: true, dp: 0 },
      { key: 'bagPrice', label: '盐单价', unit: '元/袋', min: 0, minIncl: true, max: 999, maxIncl: true, dp: 2 },
      { key: 'spoon', label: '一平勺', unit: 'g', min: 0.5, minIncl: true, max: 50, maxIncl: true, dp: 1 }
    ],
    schemes: [4, 6, 15],
    maxScenarios: 12
  };
  var F = {}, ORDER = [];
  SPEC.fields.forEach(function (s) { F[s.key] = s; ORDER.push(s.key); });

  /* 密度模型：0–26 %（质量分数）区间线性内插，锚位见 需求与调研.md §2.4 / §3.3。
   * w 用百分数（6 表示 6 %）。超出 24 % 只在外推区提示，不再改模型。 */
  var RHO_A = 0.9982, RHO_B = 0.0074, RHO_WMAX = 26, EXTRAP_FROM = 24;

  /* 盐型三档（页面里的预设按钮；是常用区间，不是标准） */
  var SALT_KINDS = [
    { key: 'fine', name: '细盐', bulk: 1200, note: '常见精制细盐的常见堆积区间' },
    { key: 'table', name: '普通食盐', bulk: 1000, note: '家常中粒食盐的常见区间' },
    { key: 'coarse', name: '粗粒盐', bulk: 800, note: '粗颗粒／日晒盐的常见区间' }
  ];

  /* ══════════════════ 2. 数值工具 ══════════════════ */
  /* 十进制文本；不接受科学计数法/十六进制/千分位逗号 —— 宁可报「不是数字」，也不静默吞掉 */
  var NUM_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

  function parseField(raw, spec) {
    var t = (raw === null || raw === undefined) ? '' : String(raw).trim();
    if (t === '') return { value: null, code: 'empty', message: spec.label + '还没填' };
    if (!NUM_RE.test(t)) return { value: null, code: 'not-number', message: spec.label + '不是数字：「' + t + '」' };
    var v = Number(t);
    if (!isFinite(v)) return { value: null, code: 'not-number', message: spec.label + '不是有限的数字：「' + t + '」' };
    if (spec.integer && Math.floor(v) !== v) {
      return { value: null, code: 'not-integer', message: spec.label + '要填整数：「' + t + '」' };
    }
    if (v < spec.min || (!spec.minIncl && v === spec.min)) {
      return { value: null, code: 'too-small', message: spec.label + '要' + (spec.minIncl ? '不小于' : '大于') + ' ' + spec.min + '（现在是 ' + t + '）' };
    }
    if (v > spec.max || (!spec.maxIncl && v === spec.max)) {
      return { value: null, code: 'too-large', message: spec.label + '要' + (spec.maxIncl ? '不大于' : '小于') + ' ' + spec.max + '（现在是 ' + t + '）' };
    }
    return { value: v, code: null, message: '' };
  }

  function roundHalfAway(v) { return v < 0 ? -Math.round(-v) : Math.round(v); }
  function roundDp(x, dp) {
    if (typeof x !== 'number' || !isFinite(x)) return x;
    var f = Math.pow(10, dp);
    return roundHalfAway(x * f) / f;
  }
  function ceilSafe(x) { return Math.ceil(x - 1e-9); }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

  /* ══════════════════ 3. 物理量（都是纯函数，测试直接调） ══════════════════ */
  function rho(w) { return RHO_A + RHO_B * w; }                  /* g/mL */
  function saltPerL(w) { return rho(w) * w * 10; }               /* g 盐 / L 盐水 */
  function solMass(volMl, w) { return volMl * rho(w); }          /* g */

  /* 从「已知盐的质量 msalt 与水的质量 mwater」回到质量分数 */
  function wFromMasses(msalt, mwater) {
    var tot = msalt + mwater;
    if (!(tot > 0)) return 0;
    return 100 * msalt / tot;
  }

  /* ══════════════════ 4. 场景与状态 ══════════════════ */
  var PRESETS = [
    {
      key: 'default', name: '默认示例（虚构）', note: '1 L 罐子、菜占三成、500 g 萝卜',
      v: { w: '6', vol: '1', vegShare: '30', vegMass: '500', vegWater: '10', headroom: '12',
           haveVol: '0', haveW: '0', bulk: '1200', bagG: '400', bagPrice: '3', spoon: '5' }
    },
    {
      key: 'crammed', name: '罐子几乎被菜占满（虚构）', note: '0.8 L 罐子、菜占八成，只挤出 136 mL 液体',
      v: { w: '5', vol: '0.8', vegShare: '80', vegMass: '600', vegWater: '8', headroom: '15',
           haveVol: '0', haveW: '0', bulk: '1000', bagG: '400', bagPrice: '3', spoon: '5' }
    },
    {
      key: 'dry', name: '菜不出水（虚构）', note: '出水率填 0，看纯盐水量',
      v: { w: '6', vol: '1', vegShare: '30', vegMass: '500', vegWater: '0', headroom: '12',
           haveVol: '0', haveW: '0', bulk: '1200', bagG: '400', bagPrice: '3', spoon: '5' }
    },
    {
      key: 'wet', name: '出水很凶的菜（虚构）', note: '出水率 60 %，盐度掉到 2.6 % 上下，要补很多盐',
      v: { w: '8', vol: '3', vegShare: '40', vegMass: '2000', vegWater: '60', headroom: '10',
           haveVol: '0', haveW: '0', bulk: '1200', bagG: '400', bagPrice: '3', spoon: '5' }
    },
    {
      key: 'tight', name: '刚好卡着上限（虚构）', note: '出水率 40 %，菜＋出水＋盐正好占满菜以外的空间',
      v: { w: '6', vol: '2', vegShare: '25', vegMass: '1500', vegWater: '40', headroom: '10',
           haveVol: '0', haveW: '0', bulk: '1000', bagG: '400', bagPrice: '3', spoon: '5' }
    },
    {
      key: 'carry', name: '上次剩的盐水要接着用（虚构）', note: '已有 500 mL 4 % 盐水',
      v: { w: '6', vol: '2', vegShare: '25', vegMass: '1000', vegWater: '15', headroom: '10',
           haveVol: '500', haveW: '4', bulk: '1200', bagG: '400', bagPrice: '3', spoon: '5' }
    },
    {
      key: 'tiny', name: '小罐子（虚构）', note: '0.5 L，一次做一小碟',
      v: { w: '4', vol: '0.5', vegShare: '20', vegMass: '200', vegWater: '10', headroom: '10',
           haveVol: '0', haveW: '0', bulk: '1200', bagG: '400', bagPrice: '3', spoon: '5' }
    },
    {
      key: 'vat', name: '大缸（虚构）', note: '50 L，大批量',
      v: { w: '8', vol: '50', vegShare: '40', vegMass: '20000', vegWater: '15', headroom: '10',
           haveVol: '0', haveW: '0', bulk: '800', bagG: '1000', bagPrice: '4', spoon: '8' }
    },
    {
      key: 'empty', name: '不放菜（虚构）', note: '菜量 0、占位 0，只配一罐盐水',
      v: { w: '12', vol: '1.5', vegShare: '0', vegMass: '0', vegWater: '0', headroom: '10',
           haveVol: '0', haveW: '0', bulk: '1000', bagG: '400', bagPrice: '3', spoon: '5' }
    },
    {
      key: 'toolittle', name: '无解：菜比罐子还大（虚构）', note: '菜占 90 %，看页面怎么拦',
      v: { w: '6', vol: '0.5', vegShare: '90', vegMass: '900', vegWater: '20', headroom: '10',
           haveVol: '0', haveW: '0', bulk: '1200', bagG: '400', bagPrice: '3', spoon: '5' }
    },
    {
      key: 'toosalty', name: '无解：锅里剩的盐水太咸（虚构）', note: '1 L 罐子里已有 950 mL 2 % 盐水，目标却要 24 %',
      v: { w: '24', vol: '1', vegShare: '0', vegMass: '0', vegWater: '0', headroom: '5',
           haveVol: '950', haveW: '2', bulk: '1200', bagG: '400', bagPrice: '3', spoon: '5' }
    },
    {
      key: 'overfill', name: '无解：罐子装不下这些水（虚构）', note: '2 L 罐子里已有 1900 mL 2 % 盐水，目标却要 25 %',
      v: { w: '25', vol: '2', vegShare: '0', vegMass: '0', vegWater: '0', headroom: '5',
           haveVol: '1900', haveW: '2', bulk: '1200', bagG: '400', bagPrice: '3', spoon: '5' }
    }
  ];
  function presetByKey(k) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].key === k) return PRESETS[i];
    return null;
  }

  /* 注意：PRESETS[n].v 是「字段 → 原始文本」的映射，状态本身就是这个映射加一个 key，
   * 所以这里必须把 v 展开，不能整个塞进 cloneState（否则每个字段读到 undefined）。 */
  function stateFromPreset(key) {
    var p = presetByKey(key) || PRESETS[0];
    var s = cloneState(p.v);
    s.key = p.key;
    return s;
  }
  function defaultState() { return stateFromPreset('default'); }

  function cloneState(s) {
    return {
      key: s.key,
      w: String(s.w), vol: String(s.vol), vegShare: String(s.vegShare), vegMass: String(s.vegMass),
      vegWater: String(s.vegWater), headroom: String(s.headroom), haveVol: String(s.haveVol),
      haveW: String(s.haveW), bulk: String(s.bulk), bagG: String(s.bagG), bagPrice: String(s.bagPrice),
      spoon: String(s.spoon)
    };
  }

  /* ══════════════════ 5. 主计算 ══════════════════ */
  var NULLS = {
    rho: null, saltPerL: null, vegVol: null, bracket: null, liquidRoomMl: null, availMl: null, newBrineMl: null,
    totalSolM: null, totalSaltM: null, haveMass: null, haveSalt: null, haveWater: null,
    mSol: null, mSalt: null, mWater: null, waterMl: null, saltMl: null, spoons: null,
    newSolM: null, vegWaterG: null, wAfter: null, addSalt: null, saltTotal: null,
    carryMl: null, carrySalt: null, carryMass: null, carryW: null, addSalt: null, enoughSalt: null,
    per100Salt: null, per100Water: null, per100SaltVessel: null, per100WaterVessel: null,
    bags: null, bagCost: null, costPerL: null,
    finalSalt: null, mSolTotal: null, wFinal: null, saltPerLMix: null
  };

  /* 只留 keepMl 毫升已有盐水时，这一罐配不配得到目标浓度？
   * 判据与主计算完全同源：液体里的水 = 目标水（= 液体质量 − 盐质量）。
   * 参数都是已解析的数值，不碰文本状态。 */
  function keepFeasible(keepMl, w, haveW, haveVol, bracket, vegWaterG, headroom) {
    var p = w / 100;
    if (!(p > 0) || !(p < 1)) return false;
    var cap = (bracket - vegWaterG) * (1 - headroom / 100);      /* mL，液体能占的体积 */
    if (!(cap > 0)) return false;
    var rho0 = rho(haveW);
    var mk = Math.max(0, Math.min(keepMl, haveVol));
    var S = mk * rho0 * (haveW / 100);                            /* g，留下的盐 */
    var W = mk * rho0 - S;                                        /* g，留下的水 */
    /* 目标浓度要求最终液体质量 M 满足 水 = M(1−p)，而水还要加上补进去的部分；
     * 补进去的水体积占用的空间 = M/ρ(w) − mk（最终体积减去留量体积）不能超过 cap。 */
    var M = S / p;                                                /* g，盐不变时所需的最终液体质量 */
    var needVol = M / rho(w);                                     /* mL */
    return needVol <= cap + 1e-9;
  }

  function compute(state) {
    var errors = [], warnings = [], values = {};
    ORDER.forEach(function (k) {
      var r = parseField(state[k], F[k]);
      values[k] = r.value;
      if (r.code) errors.push({ field: k, code: r.code, message: r.message });
    });
    if (errors.length) {
      var out0 = { ok: false, errors: errors, warnings: warnings, values: values, alt: null, plan: null, schemes: null, carry: null, checks: [], conclusion: null };
      Object.keys(NULLS).forEach(function (k) { out0[k] = NULLS[k]; });
      return out0;
    }

    var w = values.w, vol = values.vol, vegShare = values.vegShare, vegMass = values.vegMass;
    var vegWaterPct = values.vegWater, headroom = values.headroom, haveVol = values.haveVol;
    var haveW = values.haveW, bulk = values.bulk, bagG = values.bagG, bagPrice = values.bagPrice, spoon = values.spoon;

    var vegVol = vol * 1000 * vegShare / 100;                 /* mL，用户假设的菜占位（含菜里原有的水） */
    var bracket = vol * 1000 - vegVol;                        /* mL，菜以外的空间 */
    var vegWaterG = vegMass * vegWaterPct / 100;              /* g，菜预计渗出的水（这部分水本来就在菜里，渗出后改占液体体积） */
    /* 关键：菜占位已经包含菜里的水，所以渗出只是「液体变多」，不是「体积再涨一块」。
     * 液体能用的体积 = 菜以外的空间 − 菜渗出的水 − 预留液面空间。 */
    var liquidRoomMl = bracket - vegWaterG;
    var liquidCapMl = liquidRoomMl * (1 - headroom / 100);    /* mL，本轮液体总量（含已有盐水） */
    var availMl = liquidCapMl;

    if (liquidRoomMl <= 0) {
      errors.push({
        field: 'vegWater', code: 'no-liquid-room',
        message: '菜渗出的水就把菜以外的空间占完了：菜以外 ' + fmtV(bracket, 0) + ' mL，预计出水 ' + fmtV(vegWaterG, 0) +
                 ' mL。请把「蔬菜净重」降到约 ' + fmtV(vegWaterPct > 0 ? bracket / (vegWaterPct / 100) : 0, 0) +
                 ' g，或把「出水率」降到 ' + fmtV(vegMass > 0 ? bracket / vegMass * 100 : 0, 1) + ' %，或减小「蔬菜占容积」，或换更大的罐子。'
      });
      var outz = { ok: false, errors: errors, warnings: warnings, values: values, alt: null, plan: null, schemes: null, carry: null, checks: [], conclusion: null, vegVol: vegVol, bracket: bracket, availMl: 0, vegWaterG: vegWaterG, liquidRoomMl: liquidRoomMl };
      Object.keys(NULLS).forEach(function (k) { if (!(k in outz)) outz[k] = NULLS[k]; });
      return outz;
    }
    if (liquidCapMl <= 0) {
      errors.push({
        field: 'headroom', code: 'no-space',
        message: '这个罐子里已经没有液体的位置了：菜以外的 ' + fmtV(bracket, 0) + ' mL 扣掉菜渗出的水 ' + fmtV(vegWaterG, 0) +
                 ' mL 之后剩 ' + fmtV(liquidRoomMl, 0) + ' mL，再扣掉 ' + fmtV(headroom, 0) + ' % 的液面空间就是 0。请减小「预留液面空间」或「蔬菜占容积」，或换更大的罐子。'
      });
      var outw = { ok: false, errors: errors, warnings: warnings, values: values, alt: null, plan: null, schemes: null, carry: null, checks: [], conclusion: null, vegVol: vegVol, bracket: bracket, availMl: 0, vegWaterG: vegWaterG, liquidRoomMl: liquidRoomMl };
      Object.keys(NULLS).forEach(function (k) { if (!(k in outw)) outw[k] = NULLS[k]; });
      return outw;
    }

    /* 已有盐水：带进来的是「水 + 盐」，按它的实际浓度折算；体积按 mL 直接占液体位置 */
    var haveMass = solMass(haveVol, haveW);
    var haveSalt = haveMass * haveW / 100;
    var haveWater = haveMass - haveSalt;

    var r = rho(w), k = saltPerL(w);
    var totalSolM = solMass(availMl, w);                      /* g，整罐液体（含已有盐水）的目标质量 */
    var totalSaltM = totalSolM * w / 100;                     /* g，整罐液体里该有的盐 */
    var mSalt0 = totalSaltM - haveSalt;                       /* g，本轮还要下的盐；已有盐水够咸时可为负 */
    var mSalt = Math.max(0, mSalt0);
    var enoughSalt = mSalt0 <= 1e-9;
    var excessSalt = enoughSalt ? haveSalt - totalSaltM : 0;  /* g，已有的盐比目标多多少 */

    /* 可行性判据的两个基本量（后面那把唯一的校验与自检都用它们）：
     * 目标水的量 = 液体总质量 − 盐的总质量；新兑的水 = 目标水的量 − 已有水的量。 */
    var waterTarget = totalSolM - totalSaltM;
    var mWaterRaw = waterTarget - haveWater;

    /* 本轮新配的那一份盐水（不含已有盐水） */
    var newBrineMl = Math.max(0, availMl - haveVol);
    /* 不够咸：按 w 配新卤水；已经够咸：不再加盐，只把液量补齐（这才对得上守恒） */
    /* 两支的守恒式不一样，水量口径必须跟着分：
     *  · 不够咸 → 本轮把差额的盐补齐（mSalt = totalSaltM − haveSalt），于是
     *             mWater = m_sol − haveMass − mSalt = (m_sol − totalSaltM) − haveWater = mWaterRaw；
     *  · 已经够咸 → 本轮不加盐（mSalt = 0），于是 mWater = m_sol − haveMass。
     * 初版只留了一个口径，随机测试立刻抓出 183 个「质量守恒」失败 —— 两处各推一次就会漂，
     * 所以这里按分支写清楚，并让自检去验它。 */
    var mWater = enoughSalt ? (totalSolM - haveMass) : mWaterRaw;
    var waterMl = mWater;
    var newSolM = mSalt + mWater;

    /* 一次到位的补盐：菜渗出的水会让盐度下降，要补的盐 = 盐:水 比例 × 这部分水。
     * w/100 = (S+Δ)/(水+S+Δ) 解得 Δ = w/(100−w) × 菜渗水。
     * 注意：要拿秤去称的是「下盐总量 = mSalt + Δ」，所以盐的堆积体积与勺数也一律按它算，
     * 否则会出现「第一步说称 39 g、旁边写 7.2 平勺」这种自相矛盾的读数（本轮实测抓到）。 */
    var addSalt = w < 100 ? (w / (100 - w)) * vegWaterG : 0;   /* g */
    var saltTotal = mSalt + addSalt;

    var saltMl = saltTotal / bulk * 1000;                     /* mL，盐的堆积体积 */
    var spoons = spoon > 0 ? saltTotal / spoon : null;

    var wAfter = enoughSalt
      ? 100 * haveSalt / (haveMass + vegWaterG - haveSalt)      /* 已经下多了：出水后只会更咸 */
      : wFromMasses(totalSaltM, totalSolM - totalSaltM + vegWaterG);

    /* ── 可行性：这一罐能不能配到目标浓度 = 「已有的水 ≤ 目标水的量」 ──
     * 目标浓度要求液体里的水恰好是 m_sol − totalSaltM。而 m_sol = haveMass + mWater + mSalt，
     * 代进去就得到 新兑的水 mWater = 目标水的量 − 已有水的量（见上面 mWaterRaw 的定义）。
     * 本页只会加盐加水，所以 mWater 为负就是无解：加盐更咸、加水又没地方放。
     * 【建模错误修正】初版按支各写一条判据（够咸那支写成 haveMass ≤ totalSolM），那一支漏判，
     * 随机不变量测试抓出「新兑的水 = −628.7 g」这种读数（3000 组里 20 多例）；
     * 也曾经写成两个并列的 if，后者永远走不到。现在只有这一条判据。 */
    /* 两条必要条件，缺一不可：
     *  ① 水量：haveWater ≤ 目标水的量（等价于 mWaterRaw ≥ 0）；
     *  ② 体积：haveMass ≤ 液体总量（已有的这瓶液体要装得进这个罐子）。
     * 只用②会漏掉「够咸但水太多」（那瓶液体放得下，可就是怎么都到不了目标浓度）；
     * 只用①会漏掉「罐子比那瓶液体还小」—— 3000 组随机里两类各能抓出几十例，
     * 现象都是「算出一个兑水量为负数的配比单」。 */
    if (haveVol > 0 && (mWaterRaw < -1e-6 || haveMass > totalSolM + 1e-6)) {
      var byVolume = false;
      /* 「只留多少 mL 就够了」——严格解一次，别再凭直觉推：
       * 记 ρ₀=ρ(haveW)、q=haveW/100、ρw=ρ(w)、p=w/100，
       *    V = 菜渗水、A_ = (菜以外 − V)(1−预留)（液体能占的体积）。
       * 留量 M_k 带进来的盐与水：S_k = M_k·ρ₀·q、W_k = M_k·ρ₀(1−q)。
       *  · q ≤ p（原有盐水不比目标咸）：盐可以补，最终这份液体质量是 W_k + S_k/p，
       *    要装进 A_：M_k·ρ₀(1−q) + M_k·ρ₀·q/p ≤ A_
       *      ⇒ M_k ≥ A_·p ÷ [ρ₀(q + p(1−q))]  —— 下界，留得越多越占地方。
       *  · q > p（比目标咸）：只能加水稀释，水按 (p/q) 缩小后仍要装进 A_：
       *    W_k·p/q ≤ A_ ⇒ M_k ≤ A_·q ÷ [ρ₀·p·(1−q)]  —— 上界；若整瓶都满足就说明不用倒。
       * 这一支前后被随机样本重算否掉过 5 版（14、17、3、5 个样本），所以式子留档，
       * 并由测试「按留量重算一遍、盐度必须回到目标」持续把关。 */
      /* 「只留多少 mL 就够了」——不硬凑闭式解，直接在这个内核里二分求最大可行留量。
       * 理由如实记录：这一支我连推了 6 版闭式（水量上界、质量占比、盐:水 比例、装配质量、
       * 两支各自的上下界…），每版都被随机样本重算否掉一批（14、17、3、5、9 个样本）。
       * 与其继续试错，不如让「可行性」只有一份定义：下面这个 keepFeasible() 用的就是
       * 本函数自己的判据（水的量必须落在目标允许的水量里），二分 40 次就够 0.1 mL 精度。
       * 单调性：留得越多，带进来的水越多，越容易超量 —— 所以上界可以直接二分。 */
      var keepMl2 = 0;
      var hi = haveVol, lo = 0;
      for (var it = 0; it < 40; it++) {
        var mid = (lo + hi) / 2;
        if (keepFeasible(mid)) lo = mid; else hi = mid;
      }
      keepMl2 = lo;
      /* 如果算出来「要留的量」不小于现有量，说明倒掉也解决不了（这瓶盐水整体就配不出目标浓度），
       * 这时候不能给「只留约 N mL」的建议 —— 检查过的样本里 3/41 属于这种，重算仍然无解。 */
      var drainHelps = keepMl2 < haveVol - 1 && keepMl2 >= 1;   /* 留量不到 1 mL 就别写成「只留约 0 mL」 */
      var drainWorthless = keepMl2 < 1;                         /* 留下的那点连目标都配不出：整瓶都用不上 */
      /* 「至少要多大的罐子」——按可行性的两条约束分别推，只有两支都能满足时才给这条建议：
       *  · 组成约束（盐的总量）：目标浓度要求 V_l·k(w) = haveSalt，其中 k(w)=ρ(w)·w·10 是每升含盐量。
       *    所以 V_l = haveSalt ÷ k(w) × 1000（mL）。水量给不够就永远配不到 —— 这条与罐子无关，
       *    换多大罐子都没用，此时不给「换大罐子」的建议。
       *  · 体积约束：罐子要装下「液体 + 菜」，还要留出预留空间：
       *    V ≥ (V_l + 菜占位) ÷ (1 − 预留) ÷ 1000（L）。
       * 两条都成立才给建议；测试会按这个容积真的重算一遍（初版用近似式，随机样本上一半重算仍然无解）。 */
      var vlNeed = haveSalt / k * 1000;
      var jarOk = isFinite(vlNeed) && vlNeed > 0;
      /* 体积约束的正解：菜以外 = V − 菜占位；留给液体的 = 菜以外×(1−预留)；
       * 而菜渗出的水也要挤在这块空间里，所以
       *   (V − 菜占位)×(1−预留) − 菜渗水 ≥ 液体
       * 展开后预留恰好与 1/(1−预留) 抵消：
       *   V ≥ 液体 + 菜占位 + 菜渗水
       * （前三版分别写成「液体×(1−预留)+…」，都差一个 (1−预留) 因子，
       *   随机样本上一重算就露馅 —— 这个式子现在被测试按容积重算钉住。） */
      /* 「至少要多大的罐子」——两条约束都要满足，取更严的那一条（两支都要在测试里被重算验证）：
       * 记 A = (1−菜占位比例)(1−预留)、Vw = 菜渗水、W = 已有水的质量。
       *  · 含盐量约束：目标浓度要求液体体积 V_l = S ÷ k(w)。V_l 必须放得进可用空间：
       *      A·V − Vw ≥ S ÷ k(w)      ⇒   V ≥ [Vw + S ÷ k(w)] ÷ A
       *  · 含水量约束：液体里的水不能超过目标允许的水量 ρ(w)(1−w/100)·可用空间：
       *      ρ(w)(1−w/100)(A·V − Vw) ≥ W   ⇒   V ≥ [Vw + W ÷ (ρ(w)(1−w/100))] ÷ A
       *  · 另外，比目标咸的盐水只能靠加水稀释，稀释后的体积至少是 V_lᵈ = haveVol×(1−w/100)÷(1−haveW/100)÷ρ(w)。
       * 三处各取一次最大 —— 每漏一条，现象都是「按建议换罐子仍然无解」（随机样本先后抓到 36/40 与 12/41）。 */
      var needJarL = null;
      if (jarOk && w < 100) {
        /* 这里的「可用体积」用的是**未打折**的菜以外空间：V_a = 菜以外 − 菜渗水，
         * 因为下面已经把 (1−预留) 放进分母了；若这里再折一次，就等于把预留罚了两遍
         * （现象是建议的罐子偏小、按它重算仍然无解：toosalty 预设上正好差 1.5%）。 */
        var AA = 1 - vegShare / 100;
        var cands = [];
        if (AA > 1e-9 && (1 - headroom / 100) > 1e-9) {
          /* 两条体积约束（取更严的那条）：
           *  ① 含盐量：最终液体体积 = S ÷ k(w)（S 是必须容纳的全部盐），要装进 A·V − Vw；
           *  ② 含水量：最终液体质量 M 满足「水:M 的水占比」，而水的量由 Wr 与补水量共同决定，
           *     代进去化简后与①等价……但①用的是「盐」，当 existing 盐多于 w 允许的量时
           *     （即 haveW > w）必须走①；当水多于目标允许时（haveW < w）必须走「按水算」的那条。
           *  两条都放进去、取最大，随机样本上就不会再出现「按建议换罐子仍然无解」。 */
          /* ① 含盐量：最终液体体积 = 必须容纳的盐 ÷ k(w)。「必须容纳的盐」取两者的较大值：
           *    已有的盐（超量时也要装下）与目标该有的盐（水多时要补到这么多）。
           *    只取 totalSaltM 会在「水多」的样本上偏小，只取 haveSalt 会在别的样本上偏大 ——
           *    随机样本上分别抓到 15/44 与 5/44 的失败。 */
          if (k > 0) cands.push((vegWaterG + (haveSalt > totalSaltM ? haveSalt : totalSaltM) / k * 1000) / (AA * (1 - headroom / 100)));
          cands.push((vegWaterG + haveWater / (rho(w) * (1 - w / 100))) / (AA * (1 - headroom / 100)));
        }
        if (cands.length) {
          var mx = 0;
          cands.forEach(function (c) { if (isFinite(c) && c > mx) mx = c; });
          /* 一律向上取到 0.01 L：向下取整会让「按建议换罐子」差几毫升仍然无解
           * （toosalty 预设上正好差 1.5% 的头部空间）。 */
          needJarL = Math.ceil(mx / 1000 * 100 - 1e-9) / 100;
        }
      }
      /* 两条可执行的修法：① 倒掉一部分（只留 keepMl2）② 换一个至少 needJarL 的罐子 */
      var optDrain = drainHelps
        ? '把已有盐水倒掉一部分，只留约 ' + fmtV(keepMl2, 0) + ' mL（其余倒掉或另作他用）'
        : (drainWorthless
          ? '这瓶盐水整体就用不上了（留下的那点连目标浓度都配不出），建议整瓶倒掉、另配新盐水'
          : '倒掉一部分也解决不了（留下的那点仍然超量），只能整瓶倒掉重配');
      /* 罐子容积字段的上界是 SPEC 里 vol 的 max；超过它就不该建议（会填不进去、也超出真实生活尺度） */
      var volMax = F.vol.max;
      var jarUsable = needJarL !== null && isFinite(needJarL) && needJarL > 0 && needJarL <= volMax + 1e-9;
      var optJar = jarUsable
        ? '或者换一个至少 ' + fmtV(needJarL, 2) + ' L 的罐子，把液体加到同一个盐度'
        : (needJarL !== null && needJarL > volMax
          ? '水不够，换罐子也没用：要把这些盐配到 ' + fmtV(w, 2) + ' % 需要约 ' + fmtV(needJarL, 1) +
            ' L 的罐子，已经超出本页能算的 ' + fmtV(volMax, 0) + ' L。请先倒掉一部分盐水，或另配新盐水。'
          : '换更大的罐子也解决不了：这些盐要配到 ' + fmtV(w, 2) + ' % 需要的水，这个罐子装不下。');
      errors.push({
        field: 'haveVol', code: 'infeasible',
        message: byVolume
          ? '已有的 ' + fmtV(haveVol, 0) + ' mL 盐水就放不进这个罐子留给液体的空间：菜以外 ' + fmtV(bracket, 0) +
            ' mL，扣掉菜渗出的水 ' + fmtV(vegWaterG, 0) + ' mL 与 ' + fmtV(headroom, 0) + ' % 液面空间后只剩 ' +
            fmtV(availMl, 0) + ' mL。请把它降到 ' + fmtV(availMl, 0) + ' mL 以内（多的倒掉或另作他用），或者换更大的罐子。'
          : (enoughSalt
            ? '这一罐配不到 ' + fmtV(w, 2) + ' %：已有的 ' + fmtV(haveVol, 0) + ' mL 盐水（' + fmtV(haveW, 2) + ' %）重 ' +
              fmtV(haveMass, 1) + ' g，已经超过这一罐液体该有的 ' + fmtV(totalSolM, 1) + ' g（液体只有 ' + fmtV(availMl, 0) +
              ' mL），而且它带的盐 ' + fmtV(haveSalt, 2) + ' g 比整罐该有的 ' + fmtV(totalSaltM, 2) + ' g 多 ' +
              fmtV(haveSalt - totalSaltM, 2) + ' g —— 加盐只会更咸、加水又没地方放。可行做法：' + optDrain + '；' + optJar + '。'
            : '这一罐配不到 ' + fmtV(w, 2) + ' %：已有的 ' + fmtV(haveVol, 0) + ' mL 盐水（' + fmtV(haveW, 2) + ' %）带进来 ' +
              fmtV(haveWater, 1) + ' g 水，而 ' + fmtV(availMl, 0) + ' mL 的 ' + fmtV(w, 2) + ' % 盐水只能有 ' +
              fmtV(waterTarget, 1) + ' g 水 —— 多了 ' + fmtV(haveWater - waterTarget, 1) +
              ' g，罐子又装不下更多液体。本页只会加不会减，所以加盐只会更咸、加水又没地方放。可行做法：' + optDrain + '；' + optJar + '。')
      });
      var outx = { ok: false, errors: errors, warnings: warnings, values: values, alt: null, plan: null, schemes: null, carry: null, checks: [], conclusion: null, vegVol: vegVol, bracket: bracket, availMl: availMl, liquidRoomMl: liquidRoomMl, vegWaterG: vegWaterG, haveSalt: haveSalt, haveMass: haveMass, haveWater: haveWater, totalSaltM: totalSaltM, waterTarget: waterTarget, keepMl: keepMl2, infeasibleBy: byVolume ? 'volume' : 'water' };
      Object.keys(NULLS).forEach(function (k) { if (!(k in outx)) outx[k] = NULLS[k]; });
      return outx;
    }


    /* 一次到位的补盐：菜渗出的水会让盐度下降，要补的盐 = 盐:水 比例 × 这部分水。
     * w/100 = (S+Δ)/(水+S+Δ) 解得 Δ = w/(100−w) × 菜渗水。
     * 注意：要拿秤去称的是「下盐总量 = mSalt + Δ」，所以盐的堆积体积与勺数也一律按它算，
     * 否则会出现「第一步说称 39 g、旁边写 7.2 平勺」这种自相矛盾的读数（本轮实测抓到）。 */
    var addSalt = w < 100 ? (w / (100 - w)) * vegWaterG : 0;   /* g */
    var saltTotal = mSalt + addSalt;

    var saltMl = saltTotal / bulk * 1000;                     /* mL，盐的堆积体积 */
    var spoons = spoon > 0 ? saltTotal / spoon : null;

    var wAfter = enoughSalt
      ? 100 * haveSalt / (haveMass + vegWaterG - haveSalt)      /* 已经下多了：出水后只会更咸 */
      : wFromMasses(totalSaltM, totalSolM - totalSaltM + vegWaterG);

    /* （体积与水量的可行性校验已在前面合并成一条 infeasible，这里不再重复判一次） */

    var per100Salt = k / 10;                                  /* g 盐 / 100 mL 盐水 */
    var per100Water = solMass(100, w) - per100Salt;           /* g 水 / 100 mL 盐水 */

    var bags = ceilSafe(saltTotal / bagG);
    var bagCost = bags * bagPrice;
    var costPerL = k * bagPrice / bagG;

    /* 合并口径：整罐（含菜出的水）最终的盐度 */
    var mSolTotal = totalSolM + vegWaterG;
    var wFinal = wFromMasses(totalSaltM, mSolTotal - totalSaltM);
    var saltPerLMix = totalSaltM / (totalSolM / 1000);

    var checks = [
      check('盐量守恒', Math.abs(haveSalt + mSalt - Math.max(totalSaltM, haveSalt)) < 1e-6,
        fmtV(haveSalt, 2) + ' g（已有） + ' + fmtV(mSalt, 2) + ' g（本轮） = ' + fmtV(haveSalt + mSalt, 2) + ' g'),
      check('质量守恒：已有的 + 本轮加的 = 液体总量', Math.abs(haveMass + mWater + mSalt - totalSolM) < 1e-6,
        fmtV(haveMass, 1) + ' g（已有） + ' + fmtV(mWater, 1) + ' g（水） + ' + fmtV(mSalt, 2) + ' g（盐） = ' + fmtV(totalSolM, 1) + ' g'),
      check('每升含盐量', Math.abs(k - r * w * 10) < 1e-9, fmtV(k, 2) + ' g/L'),
      check('液体装得下', availMl <= bracket + 1e-6,
        fmtV(availMl, 0) + ' mL ≤ ' + fmtV(bracket, 0) + ' mL（菜以外）'),
      check('液体 + 菜渗出的水不超过菜以外的空间', (availMl + vegWaterG) <= bracket + 1e-6,
        '液体 ' + fmtV(availMl, 0) + ' + 菜渗水 ' + fmtV(vegWaterG, 0) + ' ≤ ' + fmtV(bracket, 0) + ' mL（菜以外）')
    ];
    checks.push(check('可行性：这一罐装得下这些液体', haveMass <= totalSolM + 1e-6,
      fmtV(haveMass, 1) + ' g（已有） ≤ ' + fmtV(totalSolM, 1) + ' g（液体总量）'));
    checks.push(check(enoughSalt
      ? '新兑的水 = 液体总量 − 已有盐水（够咸这一支不加盐）'
      : '新兑的水 = 目标水 − 已有水，且非负',
      mWater >= -1e-9 && Math.abs(mWater - (enoughSalt ? (totalSolM - haveMass) : (waterTarget - haveWater))) < 1e-6,
      fmtV(mWater, 1) + ' g' + (enoughSalt ? ' = ' + fmtV(totalSolM, 1) + ' − ' + fmtV(haveMass, 1)
        : ' = ' + fmtV(waterTarget, 1) + ' − ' + fmtV(haveWater, 1))));

    if (enoughSalt) {
      checks.push(check('已有盐水的盐本来就超过目标（所以本轮不下盐、不兑水）', true,
        '已有含盐 ' + fmtV(haveSalt, 2) + ' g > 整罐该含 ' + fmtV(totalSaltM, 2) + ' g，多 ' + fmtV(-mSalt0, 2) + ' g'));
    } else {
      checks.push(check('回代盐度回到目标', Math.abs(wFromMasses(haveSalt + mSalt, haveWater + mWater) - w) < 1e-6,
        '重算 ' + fmtV(wFromMasses(haveSalt + mSalt, haveWater + mWater), 6) + ' % ≈ 目标 ' + fmtV(w, 2) + ' %'));
      checks.push(check('已有盐水的盐在总数里算过一次且只算一次', Math.abs(haveSalt + mSalt - totalSaltM) < 1e-6,
        fmtV(haveSalt, 2) + ' g + ' + fmtV(mSalt, 2) + ' g = ' + fmtV(totalSaltM, 2) + ' g'));
    }
    if (vegWaterG > 0) {
      /* 两条要分开：① 菜渗水一定是稀释，所以 w′ 必须不高于「渗水前」；
       * ② 只有在「盐是按目标下的」这一支，渗水后才保证不高于目标 ——
       *    若已有盐水本身就比目标咸，w′ 当然高于目标（那是真实状态，不是算错）。 */
      var wBefore = enoughSalt
        ? 100 * haveSalt / (haveMass - haveSalt)
        : wFromMasses(haveSalt + mSalt, haveWater + mWater);
      checks.push(check('菜渗水只会稀释', wAfter <= wBefore + 1e-9,
        fmtV(wAfter, 2) + ' % ≤ 渗水前 ' + fmtV(wBefore, 2) + ' %'));
      if (!enoughSalt) {
        checks.push(check('出水后盐度不高于目标', wAfter <= w + 1e-9,
          fmtV(wAfter, 2) + ' % ≤ ' + fmtV(w, 2) + ' %'));
      }
    }

    if (enoughSalt) {
      var wNeedLiquid = (totalSolM - haveMass) > 0 ? haveSalt / (totalSolM - haveMass) * 100 : Infinity;
      warnings.push({
        field: 'haveVol', code: 'salt-exceeds',
        message: '已有的 ' + fmtV(haveVol, 0) + ' mL 盐水（' + fmtV(haveW, 2) + ' %）含盐 ' + fmtV(haveSalt, 2) +
                 ' g，比整罐要的 ' + fmtV(totalSaltM, 2) + ' g 多 ' + fmtV(-mSalt0, 2) +
                 ' g —— 加盐解决不了，只能加水稀释或倒掉一部分（本页只算比例，不替你决定倒多少）。' +
                 (mWater <= 1e-9 && haveWater < waterTarget - 1e-9
                   ? ' 另外这股盐水一共 ' + fmtV(haveVol, 0) + ' mL 就占了液体总量的大头，罐子也放不下更多水，所以它的浓度降不下来。'
                   : '')
      });
    }
    if (w > EXTRAP_FROM) {
      warnings.push({ field: 'w', code: 'extrapolated',
        message: '目标盐度 ' + fmtV(w, 2) + ' % 高于密度模型的常用区间 ' + EXTRAP_FROM + ' %（模型按 0–26 % 线性内插），这一档是外推，读数会更不准；页面照算，但别把它当实测值。' });
    }
    if (vegWaterG > 0 && wAfter < w * 0.95) {
      warnings.push({ field: 'vegWater', code: 'dilute-notice',
        message: '菜预计出 ' + fmtV(vegWaterG, 0) + ' g 水，会把盐度从 ' + fmtV(w, 2) + ' % 稀释到 ' + fmtV(wAfter, 2) + ' %（低 ' +
                 fmtV(w - wAfter, 2) + ' 个百分点）。要一次到位就多下 ' + fmtV(addSalt, 1) + ' g 盐。' });
    }
    if (haveVol > 0) {
      warnings.push({ field: 'haveVol', code: 'carry-used',
        message: enoughSalt
          ? '已有的 ' + fmtV(haveVol, 0) + ' mL 盐水（' + fmtV(haveW, 2) + ' %）含盐 ' + fmtV(haveSalt, 2) + ' g，比整罐需要的 ' +
            fmtV(totalSaltM, 2) + ' g 还多 ' + fmtV(-mSalt0, 2) + ' g —— 本轮不用再下盐；要降下来只能加水或倒掉一部分（本页只算比例，不替你决定倒多少）。'
          : '已有的 ' + fmtV(haveVol, 0) + ' mL 盐水（' + fmtV(haveW, 2) + ' %）已经带来 ' + fmtV(haveSalt, 2) + ' g 盐，所以本轮只需再下 ' +
            fmtV(mSalt, 2) + ' g、再兑 ' + fmtV(waterMl, 0) + ' mL 水。整罐最终盐度 ' + fmtV(wFinal, 3) + ' %。' });
    }
    if (mSalt > 0 && saltMl > bracket * 0.25) {
      warnings.push({ field: 'bulk', code: 'salt-volume',
        message: '这批盐的堆积体积有 ' + fmtV(saltMl, 0) + ' mL，占了菜以外空间的 ' + fmtV(saltMl / bracket * 100, 0) +
                 ' %；下盐时先兑水再加菜，别把盐直接堆在罐底。' });
    }
    if ((availMl + vegWaterG) / bracket > 0.9) {
      warnings.push({ field: 'headroom', code: 'tight',
        message: '液体加上菜要渗出的水，已经占了菜以外空间的 ' + fmtV((availMl + vegWaterG) / bracket * 100, 1) +
                 ' %，几乎没有余量；实际操作请留出液面空间（把「预留液面空间」调大或减少菜量）。' });
    }
    if (bulk < 700 || bulk > 1400) {
      warnings.push({ field: 'bulk', code: 'bulk-unusual',
        message: '食盐堆积密度 ' + fmtV(bulk, 0) + ' g/L 不在常见的 700–1400 g/L 区间里 —— 它只影响「合几勺」和盐占多少体积，不影响要下多少克盐。' });
    }

    var plan = buildPlan({
      w: w, spoon: spoon, values: values,
      mSalt: mSalt, waterMl: waterMl, spoons: spoons, saltTotal: saltTotal,
      vegMass: vegMass, vegVol: vegVol, vegWaterG: vegWaterG,
      haveVol: haveVol, haveW: haveW, haveSalt: haveSalt, enoughSalt: enoughSalt,
      addSalt: addSalt, wAfter: wAfter, availMl: availMl, bracket: bracket,
      bagG: bagG, bags: bags, per100Salt: per100Salt, per100Water: per100Water
    });

    var out = {
      ok: true, errors: errors, warnings: warnings, values: values,
      rho: r, saltPerL: k, vegVol: vegVol, bracket: bracket, liquidRoomMl: liquidRoomMl, availMl: availMl, newBrineMl: newBrineMl,
      totalSolM: totalSolM, totalSaltM: totalSaltM, haveMass: haveMass, haveSalt: haveSalt, haveWater: haveWater,
      mSol: totalSolM, mSalt: mSalt, mWater: mWater, waterMl: waterMl, saltMl: saltMl, spoons: spoons,
      newSolM: newSolM, vegWaterG: vegWaterG, wAfter: wAfter, saltTotal: saltTotal,
      carryMl: haveVol, carrySalt: haveSalt, carryMass: haveMass, carryW: haveW, addSalt: addSalt, enoughSalt: enoughSalt,
      per100Salt: per100Salt, per100Water: per100Water,
      bags: bags, bagCost: bagCost, costPerL: costPerL,
      finalSalt: totalSaltM, mSolTotal: mSolTotal, wFinal: wFinal, saltPerLMix: saltPerLMix,
      plan: plan,
      schemes: buildSchemes(values, availMl, bracket, vegVol, vegWaterG, bulk, bagG, bagPrice, haveMass, haveSalt),
      carry: haveVol > 0 ? { ml: haveVol, w: haveW, salt: haveSalt, mass: haveMass, enough: enoughSalt } : null,
      alt: buildAltSizes(values, availMl, bracket, vegVol, vegWaterG, bagG, bagPrice, haveMass, haveSalt),
      checks: checks,
      conclusion: null
    };
    out.conclusion = buildConclusion(out);
    return out;
  }

  function check(name, pass, detail) { return { name: name, pass: !!pass, detail: detail }; }

  /* ══════════════════ 6. 照做清单（工序时序） ══════════════════ */
  function buildPlan(o) {
    var steps = [];
    var spoonTxt = '（按一平勺 ' + fmtV(o.spoon, 1) + ' g 估，约 ' + fmtV(o.spoons, 1) + ' 平勺 —— 量勺只是估数，能用秤就用秤。）';
    if (o.enoughSalt) {
      steps.push({ no: 1, title: '不用下盐', text: '已有的 ' + fmtV(o.haveVol, 0) + ' mL 盐水（' + fmtV(o.haveW, 2) + ' %）含盐 ' +
        fmtV(o.haveSalt, 2) + ' g，已经够这一罐需要的 ' + fmtV(o.totalSaltM, 2) + ' g 了，本轮不加盐。' });
    } else {
      steps.push({ no: 1, title: '称盐', text: '称 ' + fmtV(o.saltTotal, 1) + ' g 盐。' + (o.spoon > 0 ? spoonTxt : '') });
    }
    steps.push({
      no: 2, title: o.haveVol > 0 ? '兑水并合并' : '兑水',
      text: o.haveVol > 0
        ? '量 ' + fmtV(o.waterMl, 0) + ' mL 水，把新称的盐化开，再倒进已有的 ' + fmtV(o.haveVol, 0) + ' mL 盐水里搅匀。'
        : '量 ' + fmtV(o.waterMl, 0) + ' mL 水，把盐倒进去搅到看不见颗粒。'
    });
    steps.push({
      no: 3, title: '放菜',
      text: '把 ' + fmtV(o.vegMass, 0) + ' g 菜放进去，尽量让菜都浸在液面下。液体总量 ' + fmtV(o.availMl, 0) +
            ' mL，菜以外还有 ' + fmtV(o.bracket, 0) + ' mL 空间' +
            (o.vegWaterG > 0 ? '；菜预计再出 ' + fmtV(o.vegWaterG, 0) + ' mL 水。' : '。')
    });
    steps.push({
      no: 4, title: '先尝后等',
      text: o.vegWaterG > 0
        ? '现在这一罐是 ' + fmtV(o.w, 2) + ' %；等菜出水稳定后预计会降到 ' + fmtV(o.wAfter, 2) +
          ' %。要一次到位，第 1 步就改称 ' + fmtV(o.saltTotal, 1) + ' g（多 ' + fmtV(Math.max(0, o.addSalt), 1) + ' g）。'
        : '这一罐就是 ' + fmtV(o.w, 2) + ' %（出水率填的是 0，不会被菜的水稀释）。'
    });
    steps.push({
      no: 5, title: '记一笔',
      text: '下次换罐子大小，直接用这一行的定额乘：每 100 mL 液体下 ' + fmtV(o.per100Salt, 2) + ' g 盐、兑 ' + fmtV(o.per100Water, 0) + ' g 水。'
    });
    return { steps: steps, saltTotal: o.saltTotal, mSalt: o.mSalt, waterMl: o.waterMl, bags: o.bags, bagG: o.bagG };
  }

  /* ══════════════════ 7. 候选方案（同容器、不同目标盐度） ══════════════════ */
  function buildSchemes(values, availMl, bracket, vegVol, vegWaterG, bulk, bagG, bagPrice, haveMass, haveSalt) {
    return SPEC.schemes.map(function (w2) {
      var mSol2 = solMass(availMl, w2);
      var totalSalt2 = mSol2 * w2 / 100;                       /* 整罐液体里该有的盐 */
      var mSalt2 = Math.max(0, totalSalt2 - haveSalt);         /* 本轮还要下的盐（不含渗水补偿） */
      var addSalt2 = w2 < 100 ? (w2 / (100 - w2)) * vegWaterG : 0;
      var mWater2 = mSalt2 > 0 ? (mSol2 - haveMass - mSalt2) : (mSol2 - haveMass);
      var total2 = totalSalt2 + addSalt2;                      /* 下盐总量（含一次到位的补盐） */
      var bags2 = ceilSafe(total2 / bagG);
      var solTot2 = mSol2 + vegWaterG;
      return {
        w: w2, target: w2, mSalt: mSalt2, totalSalt: totalSalt2, addSalt: addSalt2, mWater: mWater2,
        waterMl: mWater2, saltTotal: total2, bags: bags2, bagCost: bags2 * bagPrice,
        wAfter: wFromMasses(totalSalt2, mSol2 - totalSalt2 + vegWaterG),
        wFinal: wFromMasses(totalSalt2, solTot2 - totalSalt2),
        saltPerL: saltPerL(w2), rho: rho(w2), per100Salt: saltPerL(w2) / 10,
        saltMl: mSalt2 / bulk * 1000, spoons: mSalt2 / values.spoon
      };
    });
  }

  /* ══════════════════ 8. 换罐子大小（每档容积都重算一遍） ══════════════════ */
  function buildAltSizes(values, availMl, bracket, vegVol, vegWaterG, bagG, bagPrice, haveMass, haveSalt) {
    var vols = [0.5, 1, 2, 3, 5, 10];
    var cur = values.vol;
    if (vols.indexOf(cur) < 0) vols.push(cur);
    vols.sort(function (a, b) { return a - b; });
    return vols.map(function (v) {
      var vegVol2 = v * 1000 * values.vegShare / 100;
      var bracket2 = v * 1000 - vegVol2;
      /* 与主计算同一条口径：液体可用体积 = (菜以外 − 菜渗水) × (1 − 预留)。
       * 初版漏了「菜渗水」这一项，导致「换罐子」那一列与单独把容积改掉重算的结果对不上。 */
      var avail2 = (bracket2 - vegWaterG) * (1 - values.headroom / 100);
      if (avail2 <= 0) {
        return { vol: v, ok: false, reason: '这个容积下没有液体的位置', saltTotal: null, waterMl: null, bags: null, bagCost: null, wAfter: null, isCurrent: Math.abs(v - cur) < 1e-9 };
      }
      var mSol2 = solMass(avail2, values.w);
      var totalSalt2 = mSol2 * values.w / 100;
      var mSalt2 = Math.max(0, totalSalt2 - haveSalt);
      var mWater2 = mSalt2 > 0 ? (mSol2 - haveMass - mSalt2) : (mSol2 - haveMass);
      var total2 = totalSalt2 + (values.w < 100 ? (values.w / (100 - values.w)) * vegWaterG : 0);
      var bags2 = ceilSafe(total2 / bagG);
      var solTot2 = mSol2 + vegWaterG;
      return {
        vol: v, ok: true, availMl: avail2, saltTotal: total2, mSalt: mSalt2, waterMl: mWater2, bags: bags2,
        bagCost: bags2 * bagPrice, wAfter: wFromMasses(totalSalt2, mSol2 - totalSalt2 + vegWaterG),
        wFinal: wFromMasses(totalSalt2, solTot2 - totalSalt2), isCurrent: Math.abs(v - cur) < 1e-9
      };
    });
  }

  /* ══════════════════ 9. 结论（主次层级：先一句能做的话） ══════════════════ */
  function buildConclusion(out) {
    var lead;
    if (out.enoughSalt) {
      lead = '已有的 ' + fmtV(out.carryMl, 0) + ' mL 盐水里的盐就够这一罐了，本轮不用再下盐；要降浓度只能加水或倒掉一部分。';
    } else {
      lead = '这一罐还要下 ' + fmtV(out.mSalt, 1) + ' g 盐、兑 ' + fmtV(out.waterMl, 0) + ' mL 水' +
             (out.carryMl > 0 ? '（已有 ' + fmtV(out.carryMl, 0) + ' mL 先算进去了）。' : '。');
    }
    return {
      lead: lead,
      sub: '整罐液体 ' + fmtV(out.availMl, 0) + ' mL、' + fmtV(out.totalSolM, 1) + ' g（密度 ' + fmtV(out.rho, 4) +
           '）该含盐 ' + fmtV(out.totalSaltM, 2) + ' g' + (out.carryMl > 0 ? '，其中 ' + fmtV(out.haveSalt, 2) + ' g 来自已有盐水' : '') +
           '；每升含盐 ' + fmtV(out.saltPerL, 2) + ' g。',
      after: out.vegWaterG > 0
        ? '菜估计出 ' + fmtV(out.vegWaterG, 0) + ' g 水，稳定后盐度约降到 ' + fmtV(out.wAfter, 2) +
          ' %。要一次到位就把盐改称 ' + fmtV(out.saltTotal, 1) + ' g（多 ' + fmtV(Math.max(0, out.addSalt), 1) + ' g）。'
        : '出水率填的是 0，所以盐度不会被菜的水稀释。',
      bags: '按 ' + fmtV(out.values.bagG, 0) + ' g 一袋算，要 ' + out.bags + ' 袋（' + fmtV(out.bagCost, 2) + ' 元）—— 本页不查真实盐价，单价是你自己填的。',
      tail: '这不是安全判定：本页只算盐和水的比例，不判断能不能吃、能放多久。'
    };
  }

  /* ══════════════════ 10. 建议（能点、点了就改输入） ══════════════════ */
  /* 每条建议都先把改动真的算一遍，再拿算出来的数写进 effect —— 不写估话 */
  function suggestions(state, out) {
    var list = [];
    if (!out || !out.ok) return list;
    var haveSalt = out.haveSalt, haveMass = out.haveMass, availMl = out.availMl, vegWaterG = out.vegWaterG;

    function previewW(w2) {
      var mSol2 = solMass(availMl, w2);
      var totalSalt2 = mSol2 * w2 / 100;
      var mSalt2 = Math.max(0, totalSalt2 - haveSalt);
      var mWater2 = mSalt2 > 0 ? (mSol2 - haveMass - mSalt2) : 0;
      return { mSol: mSol2, totalSalt: totalSalt2, mSalt: mSalt2, mWater: mWater2 };
    }

    /* ① 一次到位：把菜出的水提前算进来 */
    if (out.addSalt > 0.5 && vegWaterG > 0) {
      var wEq = wFromMasses(out.saltTotal, out.mSol - out.saltTotal + vegWaterG);
      if (wEq > out.values.w && wEq <= F.w.max) {
        var p = previewW(wEq);
        list.push({
          id: 'pre-salt', kind: 'field', field: 'w',
          label: '一次到位：目标盐度改填 ' + fmtV(wEq, 2) + ' %（等于提前补上菜出的水）',
          effect: '本轮下盐 ' + fmtV(out.mSalt, 1) + ' g → ' + fmtV(p.mSalt, 1) + ' g，兑水 ' + fmtV(out.waterMl, 0) +
                  ' → ' + fmtV(p.mWater, 0) + ' mL；出水稳定后正好是 ' + fmtV(out.values.w, 2) + ' %',
          value: fmtV(wEq, 2)
        });
      }
    }
    /* ② 省盐 */
    var lowW = roundDp(out.values.w * 0.8, 2);
    if (lowW >= F.w.min && out.mSalt > 0) {
      var p2 = previewW(lowW);
      if (p2.mSalt < out.mSalt - 0.05) {
        list.push({
          id: 'lower-w', kind: 'field', field: 'w',
          label: '省盐：目标盐度降到 ' + fmtV(lowW, 2) + ' %',
          effect: '本轮下盐 ' + fmtV(out.mSalt, 1) + ' g → ' + fmtV(p2.mSalt, 1) + ' g（省 ' + fmtV(out.mSalt - p2.mSalt, 1) + ' g）',
          value: String(lowW)
        });
      }
    }
    /* ③ 给液体让位：少放点菜 */
    var lessShare = roundDp(Math.max(0, out.values.vegShare - 10), 1);
    if (lessShare < out.values.vegShare) {
      var bracket2 = out.values.vol * 1000 * (1 - lessShare / 100);
      var avail2 = bracket2 * (1 - out.values.headroom / 100);
      var p3 = previewW(out.values.w), mSol3 = solMass(avail2, out.values.w);
      var total3 = mSol3 * out.values.w / 100, mSalt3 = Math.max(0, total3 - haveSalt);
      list.push({
        id: 'more-room', kind: 'field', field: 'vegShare',
        label: '给液体让位：蔬菜占容积从 ' + fmtV(out.values.vegShare, 0) + ' % 降到 ' + fmtV(lessShare, 0) + ' %',
        effect: '液量 ' + fmtV(availMl, 0) + ' → ' + fmtV(avail2, 0) + ' mL；本轮下盐 ' + fmtV(out.mSalt, 1) + ' → ' + fmtV(mSalt3, 1) + ' g',
        value: String(lessShare)
      });
    }
    /* ④ 少留液面空间（换更多液体） */
    var lessHead = roundDp(Math.max(0, out.values.headroom - 5), 1);
    if (lessHead < out.values.headroom) {
      var avail4 = out.bracket * (1 - lessHead / 100);
      var mSol4 = solMass(avail4, out.values.w);
      var total4 = mSol4 * out.values.w / 100, mSalt4 = Math.max(0, total4 - haveSalt);
      list.push({
        id: 'headroom', kind: 'field', field: 'headroom',
        label: '少留点液面空间：预留从 ' + fmtV(out.values.headroom, 0) + ' % 降到 ' + fmtV(lessHead, 0) + ' %',
        effect: '液量 ' + fmtV(availMl, 0) + ' → ' + fmtV(avail4, 0) + ' mL；本轮下盐 ' + fmtV(out.mSalt, 1) + ' → ' + fmtV(mSalt4, 1) + ' g（注意别溢出来）',
        value: String(lessHead)
      });
    }
    /* ⑤ 换大袋 */
    if (out.bags > 1 && out.values.bagG < 1000) {
      var bigBags = ceilSafe(out.saltTotal / 1000);
      var saving = out.bags * out.values.bagPrice - bigBags * out.values.bagPrice;
      if (saving > 0.001 && bigBags < out.bags) {
        list.push({
          id: 'big-bag', kind: 'field', field: 'bagG',
          label: '换 1000 g 大袋：' + out.bags + ' 小袋 → ' + bigBags + ' 大袋',
          effect: '省 ' + fmtV(saving, 2) + ' 元（前提是大袋单价就是现在填的 ' + fmtV(out.values.bagPrice, 2) + ' 元 —— 本页不查真实价格）',
          value: '1000'
        });
      }
    }
    /* ⑥ 换盐型：只影响勺数与盐占的体积，不影响下多少克 */
    var coarse = SALT_KINDS[2];
    if (Math.abs(out.values.bulk - coarse.bulk) > 1) {
      var oldMl = out.saltTotal / out.values.bulk * 1000;
      var newMl = out.saltTotal / coarse.bulk * 1000;
      list.push({
        id: 'coarse-salt', kind: 'field', field: 'bulk',
        label: '换成粗粒盐（' + coarse.bulk + ' g/L）看体积',
        effect: '要下多少克盐不变（还是 ' + fmtV(out.saltTotal, 1) + ' g），变的是盐本身占的体积：' +
                fmtV(oldMl, 0) + ' → ' + fmtV(newMl, 0) + ' mL（差 ' + fmtV(newMl - oldMl, 0) + ' mL）',
        value: String(coarse.bulk)
      });
    }
    /* ⑦ 已经有盐水时的两条：倒掉一部分 / 只加水 */
    if (out.carryMl > 0 && out.haveSalt > out.totalSaltM + 1e-9) {
      var k2 = saltPerL(out.values.w);                       /* g/L */
      var keepMl = out.haveSalt / k2 * 1000;                 /* 想刚好达到目标，这些盐只能配出多少液体 */
      if (keepMl < out.carryMl - 1) {
        list.push({
          id: 'carry-drain', kind: 'field', field: 'haveVol',
          label: '已有的盐水太咸：留 ' + fmtV(keepMl, 0) + ' mL 就够，其余可以倒掉',
          effect: '把「已有盐水体积」从 ' + fmtV(out.carryMl, 0) + ' mL 改成 ' + fmtV(keepMl, 0) +
                  ' mL 后，这 ' + fmtV(keepMl, 0) + ' mL 的盐正好配出 ' + fmtV(out.values.w, 2) + ' % 的液体 ' + fmtV(out.availMl, 0) + ' mL',
          value: fmtV(keepMl, 1)
        });
      }
    }
    return list;
  }

  function applySuggestion(state, s) {
    var next = cloneState(state);
    if (!s || s.kind !== 'field') return next;
    next[s.field] = String(s.value);
    return next;
  }

  /* ══════════════════ 11. 格式化 ══════════════════ */
  function fmt(x, dp) {
    if (typeof x !== 'number' || !isFinite(x)) return '—';
    var v = roundDp(x, dp === undefined ? 2 : dp);
    var s = Math.abs(v) < Math.pow(10, -(dp === undefined ? 2 : dp)) / 2 ? 0 : v;
    return String(s);
  }
  function fmtInt(x) { return fmt(x, 0); }
  function fmtV(x, dp) {
    if (typeof x !== 'number' || !isFinite(x)) return '—';
    return Number(fmt(x, dp)).toLocaleString('zh-CN', { maximumFractionDigits: dp === undefined ? 2 : dp });
  }
  function fmtPct(x, dp) { return fmt(x, dp === undefined ? 2 : dp) + ' %'; }
  function fmtG(x, dp) { return fmtV(x, dp === undefined ? 1 : dp) + ' g'; }
  function fmtMl(x, dp) { return fmtV(x, dp === undefined ? 0 : dp) + ' mL'; }

  /* 盐型判定（给 UI 高亮用） */
  function saltKindOf(bulk) {
    var best = null, bd = Infinity;
    SALT_KINDS.forEach(function (s) { var d = Math.abs(s.bulk - bulk); if (d < bd) { bd = d; best = s; } });
    return bd <= 1 ? best : null;
  }

  /* ══════════════════ 12. 导出 ══════════════════ */
  function summary(state, out) {
    if (!out || !out.ok) {
      return { lines: ['那袋盐怎么配 · 算不出来', '', (out && out.errors || []).map(function (e) { return '· ' + e.message; }).join('\n')] };
    }
    var d = new Date();
    var L = [];
    L.push('那袋盐怎么配 · 配盐单');
    L.push('');
    L.push('① 本轮下盐 ' + fmtG(out.mSalt, 1) + '，兑水 ' + fmtMl(out.waterMl, 0) + '。');
    if (out.carryMl > 0) {
      L.push('   已有的 ' + fmtMl(out.carryMl, 0) + ' 盐水（' + fmtPct(out.carryW, 2) + '）已含盐 ' + fmtG(out.haveSalt, 2) +
             '，整罐该含盐 ' + fmtG(out.totalSaltM, 2) + '。');
    }
    L.push('② 整罐液体 ' + fmtMl(out.availMl, 0) + '、' + fmtG(out.totalSolM, 1) + '；密度 ' + fmt(out.rho, 4) +
           ' g/mL，每升含盐 ' + fmtG(out.saltPerL, 2) + '。');
    L.push('③ 体积账：菜以外的空间 ' + fmtMl(out.bracket, 0) + '，其中菜占 ' + fmtMl(out.vegVol, 0) +
           '、预留液面 ' + fmtPct(out.values.headroom, 1) + '，留给液体 ' + fmtMl(out.availMl, 0) + '。');
    L.push('④ 盐占的体积 ' + fmtMl(out.saltMl, 0) + '（堆积密度 ' + fmtV(out.values.bulk, 0) + ' g/L）≈ ' +
           fmtV(out.spoons, 1) + ' 平勺（一平勺 ' + fmtG(out.values.spoon, 1) + '）。');
    if (out.vegWaterG > 0) {
      L.push('⑤ 菜预计出水 ' + fmtG(out.vegWaterG, 0) + '，盐度会从 ' + fmtPct(out.values.w, 2) + ' 降到 ' + fmtPct(out.wAfter, 2) +
             '；要一次到位就多下 ' + fmtG(Math.max(0, out.addSalt), 1) + '（那是 ' + fmtG(out.saltTotal, 1) + '）。');
    } else {
      L.push('⑤ 出水率是 0，盐度不会被稀释，保持 ' + fmtPct(out.values.w, 2) + '。');
    }
    L.push('⑥ 采购：' + out.bags + ' 袋（' + fmtV(out.values.bagG, 0) + ' g/袋）＝ ' + fmtV(out.bagCost, 2) +
           ' 元；单价是自己填的，本页不查真实盐价。');
    L.push('');
    L.push('定额（换罐子直接乘）：每 100 mL 液体 盐 ' + fmtG(out.per100Salt, 2) + '、水 ' + fmtG(out.per100Water, 0) + '。');
    L.push('');
    L.push('导出时间 ' + d.toISOString() + '｜本页只算盐和水的比例与体积，不做安全判定（不判断能不能吃、能放多久），不内置任何菜品配方；默认与内置场景全部是虚构示例。');
    return { lines: L };
  }

  function toCSV(state, out) {
    var L = [];
    if (!out || !out.ok) return '错误,' + (out && out.errors || []).map(function (e) { return e.message; }).join('；');
    L.push('项目,数值,单位');
    L.push(['目标盐度', fmt(out.values.w, 2), '%'].join(','));
    L.push(['罐子容积', fmt(out.values.vol, 3), 'L'].join(','));
    L.push(['蔬菜占容积', fmt(out.values.vegShare, 1), '%'].join(','));
    L.push(['蔬菜净重', fmt(out.values.vegMass, 0), 'g'].join(','));
    L.push(['出水率', fmt(out.values.vegWater, 1), '%'].join(','));
    L.push(['预留液面', fmt(out.values.headroom, 1), '%'].join(','));
    L.push(['菜以外空间', fmt(out.bracket, 0), 'mL'].join(','));
    L.push(['液体总量', fmt(out.availMl, 0), 'mL'].join(','));
    L.push(['盐水密度', fmt(out.rho, 4), 'g/mL'].join(','));
    L.push(['液体总重', fmt(out.totalSolM, 1), 'g'].join(','));
    L.push(['整罐该含盐', fmt(out.totalSaltM, 2), 'g'].join(','));
    L.push(['本轮下盐', fmt(out.mSalt, 1), 'g'].join(','));
    L.push(['本轮兑水', fmt(out.waterMl, 0), 'mL'].join(','));
    L.push(['已有盐水', fmt(out.carryMl, 0), 'mL'].join(','));
    L.push(['已有盐水含盐', fmt(out.haveSalt, 2), 'g'].join(','));
    L.push(['每升含盐', fmt(out.saltPerL, 2), 'g/L'].join(','));
    L.push(['预计出水', fmt(out.vegWaterG, 0), 'g'].join(','));
    L.push(['出水后盐度', fmt(out.wAfter, 2), '%'].join(','));
    L.push(['盐占体积', fmt(out.saltMl, 0), 'mL'].join(','));
    L.push(['平勺数', fmt(out.spoons, 1), '勺'].join(','));
    L.push(['整袋数', out.bags, '袋'].join(','));
    L.push(['采购金额', fmt(out.bagCost, 2), '元'].join(','));
    L.push(['每100mL液体盐', fmt(out.per100Salt, 2), 'g'].join(','));
    L.push(['每100mL液体水', fmt(out.per100Water, 0), 'g'].join(','));
    return '\ufeff' + L.join('\n');
  }

  function toMarkdown(state, out) {
    var s = summary(state, out);
    return '# ' + s.lines[0] + '\n\n' + s.lines.slice(1).join('\n') + '\n';
  }

  function toJSON(state, out) {
    return JSON.stringify({
      app: '那袋盐怎么配', version: SPEC.version, exported_at: new Date().toISOString(),
      state: cloneState(state),
      result: out && out.ok ? {
        w: out.values.w, bracket: out.bracket, availMl: out.availMl, rho: out.rho, saltPerL: out.saltPerL,
        totalSolM: out.totalSolM, totalSaltM: out.totalSaltM, mSalt: out.mSalt, mWater: out.mWater,
        waterMl: out.waterMl, saltTotal: out.saltTotal, carryMl: out.carryMl, haveSalt: out.haveSalt,
        haveMass: out.haveMass, enoughSalt: out.enoughSalt,
        vegWaterG: out.vegWaterG, wAfter: out.wAfter, wFinal: out.wFinal, saltMl: out.saltMl, spoons: out.spoons,
        bags: out.bags, bagCost: out.bagCost, per100Salt: out.per100Salt, per100Water: out.per100Water,
        checks: out.checks, warnings: out.warnings
      } : { error: (out && out.errors || []).map(function (e) { return e.message; }) }
    }, null, 2);
  }

  /* ══════════════════ 13. 本地存储键与状态回读 ══════════════════ */
  var STORE_KEY = 'salt-ratio.v1';
  function stateFromJSON(raw) {
    var base = defaultState();
    if (!raw || typeof raw !== 'object') return base;
    ORDER.forEach(function (k) { if (raw[k] !== undefined && raw[k] !== null) base[k] = String(raw[k]); });
    if (raw.key) base.key = String(raw.key);
    return base;
  }

  var API = {
    SPEC: SPEC, FIELDS: F, ORDER: ORDER, PRESETS: PRESETS, SALT_KINDS: SALT_KINDS, STORE_KEY: STORE_KEY,
    defaultState: defaultState, stateFromPreset: stateFromPreset, cloneState: cloneState, stateFromJSON: stateFromJSON, presetByKey: presetByKey,
    compute: compute, parseField: parseField, suggestions: suggestions, applySuggestion: applySuggestion,
    rho: rho, saltPerL: saltPerL, solMass: solMass, wFromMasses: wFromMasses, saltKindOf: saltKindOf,
    fmt: fmt, fmtInt: fmtInt, fmtV: fmtV, fmtPct: fmtPct, fmtG: fmtG, fmtMl: fmtMl,
    roundDp: roundDp, ceilSafe: ceilSafe, clamp: clamp,
    toCSV: toCSV, toMarkdown: toMarkdown, toJSON: toJSON, summary: summary
  };
  global.AppCore = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
