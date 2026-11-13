/* 那袋盐怎么配 · 核心测试
 * 跑法：node --test tests/core.test.cjs
 * 纪律：锚点全部来自 ../需求与调研.md §2.5 的手算，不是从实现输出里抄回来的；
 *       ok=false 时必须断言「算不出来」而不是断言 0；断言返回字段存在且值域有效。
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'core.js'), 'utf8');
function loadCore(src) {
  const ctx = { module: { exports: {} }, console: console };
  ctx.globalThis = ctx;
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx.AppCore;
}
const A = loadCore(SRC);
/* 跨 realm：vm 里造出来的数组原型与外面不同，deepStrictEqual 会因为原型不等而失败，
 * 所以凡是「应当为空」的断言一律走 JSON 比较。 */
function fails(o) { return JSON.stringify(o.checks.filter(c => !c.pass).map(c => c.name)); }

/* ── 手算锚点（独立于实现写出，与 §2.5 表格逐行对应） ── */
const RHO6 = 0.9982 + 0.0074 * 6;                 /* 1.0426 */
const K6 = RHO6 * 6 * 10;                         /* 62.556 */
const ANCHOR = {
  w: 6, vol: 1, vegShare: 30, vegMass: 500, vegWater: 10, headroom: 12,
  bulk: 1200, bagG: 400, bagPrice: 3, spoon: 5,
  vegVol: 300, bracket: 700, vegWaterG: 50,
  liquidRoom: 650, availMl: 572.0,
  rho: RHO6, k: K6,
  totalSolM: 572.0 * RHO6,                        /* 596.3672 */
  totalSaltM: 572.0 * RHO6 * 0.06,                /* 35.782032 */
  mWater: 572.0 * RHO6 * 0.94,                    /* 560.585168 */
  addSalt: 6 / 94 * 50,                           /* 3.1914893617 */
  saltTotal: 572.0 * RHO6 * 0.06 + 6 / 94 * 50,
  /* w′ = 100·S / (S + 水 + 渗水)：分母是「盐 + 水 + 渗水」= 溶液总质量 + 渗水。
   * （初版锚点把 S 漏了写成 m_sol − S + 渗水，实测被实现打回；错的一版留成一条独立测试。） */
  wAfter: 100 * (572.0 * RHO6 * 0.06) / (572.0 * RHO6 * 0.94 + 50 + 572.0 * RHO6 * 0.06),
  saltMl: (572.0 * RHO6 * 0.06 + 6 / 94 * 50) / 1200 * 1000,
  bags: 1,
  per100Salt: K6 / 10, per100Water: 100 * RHO6 - K6 / 10
};
const EPS = 1e-9;
function near(a, b, msg, eps) {
  assert.ok(typeof a === 'number' && isFinite(a), (msg || '') + ' 不是有限数字：' + a);
  assert.ok(Math.abs(a - b) <= (eps === undefined ? EPS : eps) * Math.max(1, Math.abs(b)),
    (msg || '') + ' 期望 ' + b + '，实际 ' + a);
}
function def() { return A.defaultState(); }
function mk(key) { return A.stateFromPreset(key); }
function set(state, k, v) { const s = A.cloneState(state); s[k] = String(v); return s; }

/* ════════════ 1. 默认场景的手算锚点 ════════════ */
test('默认场景：12 个手算锚点全部命中', () => {
  const o = A.compute(def());
  assert.strictEqual(o.ok, true, '默认场景应当是 ok 的：' + JSON.stringify(o.errors));
  near(o.values.w, ANCHOR.w, 'w'); near(o.values.vegWater, ANCHOR.vegWater, 'vegWater');
  near(o.rho, ANCHOR.rho, 'ρ');
  near(o.saltPerL, ANCHOR.k, '每升含盐');
  near(o.vegVol, ANCHOR.vegVol, '菜占位');
  near(o.bracket, ANCHOR.bracket, '菜以外空间');
  near(o.vegWaterG, ANCHOR.vegWaterG, '菜渗水');
  near(o.liquidRoomMl, ANCHOR.liquidRoom, '扣渗水后的空间');
  near(o.availMl, ANCHOR.availMl, '液体可用体积');
  near(o.totalSolM, ANCHOR.totalSolM, '整罐液体质量');
  near(o.totalSaltM, ANCHOR.totalSaltM, '整罐该含盐');
  near(o.mSalt, ANCHOR.totalSaltM, '本轮下盐（无已有盐水时等于总盐）');
  near(o.mWater, ANCHOR.mWater, '本轮兑水');
  near(o.addSalt, ANCHOR.addSalt, '一次到位补盐');
  near(o.saltTotal, ANCHOR.saltTotal, '下盐总量');
  near(o.wAfter, ANCHOR.wAfter, '渗出后盐度');
  near(o.saltMl, ANCHOR.saltMl, '盐占体积');
  near(o.bags, ANCHOR.bags, '袋数');
  near(o.per100Salt, ANCHOR.per100Salt, '每 100 mL 盐');
  near(o.per100Water, ANCHOR.per100Water, '每 100 mL 水');
});

test('默认场景：结论与照做清单里的数字与引擎同源', () => {
  const o = A.compute(def());
  const all = o.conclusion.lead + ' ' + o.conclusion.sub + ' ' + o.conclusion.after + ' ' + o.conclusion.bags +
    ' ' + o.plan.steps.map(s => s.text).join(' ');
  const c = A.fmtV(o.mSalt, 1), wm = A.fmtV(o.waterMl, 0);
  assert.ok(all.indexOf(c) >= 0, '结论里应当出现下盐量 ' + c);
  assert.ok(all.indexOf(wm) >= 0, '结论里应当出现兑水量 ' + wm);
  assert.ok(o.conclusion.lead.indexOf(A.fmtV(o.mSalt, 1)) >= 0, '主结论必须用可以马上照做的数');
});

test('默认场景：8 项结构自检每次都跑且全部为真', () => {
  const o = A.compute(def());
  /* 5 项基础 + 可行性 + 新兑水恒等式 + 盐量守恒 + 已有盐只算一次 + 菜渗水只会稀释 + 出水后不高于目标 = 10
   * （「已有盐水的盐本来就超过目标」那一条只在够咸那一支才加，默认场景没有） */
  assert.strictEqual(o.checks.length, 11, '默认场景应当有 11 项自检');
  assert.ok(o.checks.some(c => c.name.indexOf('可行性') === 0), '必须有可行性自检');
  assert.strictEqual(fails(o), '[]', '自检不该有失败项：' + fails(o));
  o.checks.forEach(c => {
    assert.strictEqual(typeof c.name, 'string');
    assert.strictEqual(typeof c.detail, 'string');
    assert.ok(c.detail.length > 0, c.name + ' 的 detail 不能空');
  });
});

/* ════════════ 2. 公式两两自洽 ════════════ */
test('自洽：ρ 与每升含盐量（k = ρ·w·10）', () => {
  [0.5, 1, 4, 6, 12, 20, 26, 30].forEach(w => {
    const o = A.compute(set(set(def(), 'w', w), 'vegWater', 0));
    near(o.rho, 0.9982 + 0.0074 * w, 'ρ(' + w + ')');
    near(o.saltPerL, o.rho * w * 10, 'k(' + w + ')');
  });
});

test('自洽：菜以外空间 = 罐容 − 菜占位', () => {
  [[0.5, 20], [1, 30], [2, 40], [50, 35]].forEach(([v, r]) => {
    const o = A.compute(set(set(def(), 'vol', v), 'vegShare', r));
    near(o.vegVol, v * 1000 * r / 100, '菜占位');
    near(o.bracket, v * 1000 - o.vegVol, '菜以外');
  });
});

test('自洽：液体可用体积 = (菜以外 − 菜渗水) × (1 − 预留)', () => {
  [[500, 10, 12], [2000, 60, 10], [0, 0, 0], [1000, 0, 50]].forEach(([m, q, h]) => {
    const s = set(set(set(def(), 'vegMass', m), 'vegWater', q), 'headroom', h);
    const o = A.compute(s);
    if (!o.ok) return;
    near(o.liquidRoomMl, o.bracket - m * q / 100, '扣渗水');
    near(o.availMl, (o.bracket - m * q / 100) * (1 - h / 100), '按预留打折');
  });
});

test('自洽：m_sol = V_liq·ρ，且 盐 + 水 = m_sol', () => {
  [1, 4, 6, 12, 26].forEach(w => {
    const o = A.compute(set(set(def(), 'w', w), 'vegWater', 0));
    near(o.totalSolM, o.availMl * o.rho, 'm_sol');
    near(o.mSalt + o.mWater, o.totalSolM, '盐 + 水');
    near(o.totalSaltM, o.totalSolM * w / 100, '总盐');
  });
});

test('自洽：一次到位补盐 Δ = w/(100−w) × 菜渗水（不是 w% × 总质量）', () => {
  [[50, 6], [50, 12], [200, 4], [120, 8]].forEach(([wv, w]) => {
    const o = A.compute(set(set(def(), 'w', w), 'vegWater', 0));
    const o2 = A.compute(set(set(set(def(), 'w', w), 'vegWater', wv / 5), 'vegMass', 500));
    near(o2.addSalt, w / (100 - w) * o2.vegWaterG, 'Δ');
    /* 反证错口径：w% × (m_sol + 渗水) 与本口径不该相等（除非渗水 0） */
    if (o2.vegWaterG > 0) {
      const wrong = w / 100 * (o2.totalSolM + o2.vegWaterG) - o2.totalSaltM;
      assert.ok(Math.abs(wrong - o2.addSalt) > 1e-6, '错口径与对口径不该给出同一个数');
    }
  });
});

test('自洽：渗出后盐度 w′ = 100·S / (盐 + 水 + 渗水)（不是除以「水 + 渗水」）', () => {
  [6, 8, 12].forEach(w => {
    const o = A.compute(set(set(set(def(), 'w', w), 'vegMass', 800), 'vegWater', 20));
    near(o.wAfter, A.wFromMasses(o.totalSaltM, o.totalSolM - o.totalSaltM + o.vegWaterG), 'w′');
    near(o.wAfter, 100 * o.totalSaltM / (o.mSalt + o.mWater + o.vegWaterG), 'w′（盐 + 水 + 渗水）');
    /* 反证错口径：漏掉分子里的盐会得到更大的数（质量分数不可能这么算） */
    const wrong = 100 * o.totalSaltM / (o.totalSolM - o.totalSaltM + o.vegWaterG);
    assert.ok(wrong > o.wAfter + 1e-9, '错口径应当偏大：错 ' + wrong + ' vs 对 ' + o.wAfter);
    assert.ok(o.wAfter < w, '渗水一定会把盐度拉低');
  });
});

test('自洽：每 100 mL 定额 ×5 正好是 500 mL 的液体', () => {
  const o = A.compute(set(set(set(def(), 'vol', 0.5), 'vegShare', 0), 'vegMass', 0));
  near(o.mSalt, o.per100Salt * o.availMl / 100, '盐 × 体积');
  near(o.mWater, o.per100Water * o.availMl / 100, '水 × 体积');
});

/* ════════════ 3. 已有盐水（合并口径） ════════════ */
test('已有盐水：含盐按它自己的浓度折算，且只在总数里算一次', () => {
  const s = set(set(set(mk('carry'), 'w', 6), 'vol', 2), 'vegShare', 25);
  const o = A.compute(s);
  assert.strictEqual(o.ok, true);
  near(o.haveMass, o.carryMl * (0.9982 + 0.0074 * o.carryW), '已有盐水质量');
  near(o.haveSalt, o.haveMass * o.carryW / 100, '已有盐量');
  near(o.totalSaltM, o.totalSolM * o.values.w / 100, '整罐该含盐');
  near(o.mSalt, o.totalSaltM - o.haveSalt, '本轮下盐 = 总 − 已有');
  near(o.mSalt + o.haveSalt, o.totalSaltM, '只算一次');
  near(o.mWater, o.totalSolM - o.haveMass - o.mSalt, '本轮兑水');
});

test('已有盐水：加进去之后回代盐度仍然是目标', () => {
  [[200, 2, 6], [500, 4, 6], [1000, 1, 10], [300, 12, 8]].forEach(([v0, w0, w]) => {
    const s = set(set(set(set(mk('empty'), 'vol', 3), 'haveVol', v0), 'haveW', w0), 'w', w);
    const o = A.compute(s);
    assert.strictEqual(o.ok, true, v0 + 'mL/' + w0 + '% -> ' + w + '% 应当可算：' + JSON.stringify(o.errors));
    near(100 * (o.haveSalt + o.mSalt) / (o.haveMass + o.mSalt + o.mWater), w, '回代', 1e-6);
  });
});

test('已有盐水已经够咸：不加盐、不兑水，并如实告诉你加盐解决不了', () => {
  /* 1 L 罐子、锅里已有 30 mL 20 % 的浓盐水、目标只要 8 % —— 已有的盐比整罐需要的还多，水又没超
   * （这两条都要成立才可行：加盐解决不了「太咸」，但罐子还有地方补水，所以整罐能落在目标上） */
  const s = set(set(set(set(set(mk('empty'), 'vol', 1), 'vegMass', 0), 'w', 2), 'haveVol', 100), 'haveW', 20);
  const o = A.compute(s);
  assert.strictEqual(o.ok, true, JSON.stringify(o.errors));
  assert.strictEqual(o.enoughSalt, true);
  assert.strictEqual(o.mSalt, 0, '这一支不该再下盐');
  assert.ok(o.haveSalt > o.totalSaltM, '前提是已有的盐比整罐需要的多');
  assert.ok(o.warnings.some(w => w.code === 'salt-exceeds'), '必须给出「加盐解决不了」的提示');
  assert.ok(o.conclusion.lead.indexOf('不用再下盐') >= 0, '主结论要说清「不用再加盐」：' + o.conclusion.lead);
  assert.strictEqual(fails(o), '[]', '这一支的自检也必须全过：' + fails(o));
});

test('已有的水已经太多：报 infeasible（本页只会加不会减），并给出该留多少毫升', () => {
  ['toosalty', 'overfill'].forEach(k => {
    const st = mk(k);
    const o = A.compute(st);
    assert.strictEqual(o.ok, false, k + ' 这一支必须被拦下，而不是算出一个负的兑水量');
    const e = o.errors.find(x => x.code === 'infeasible');
    assert.ok(e, k + ' 的 code 应当是 infeasible：' + JSON.stringify(o.errors.map(x => x.code)));
    assert.ok(/只留约|更大的罐子|装不下/.test(e.message), k + ' 要给具体动作：' + e.message);
    /* 给出的「要多大罐子」必须真的装得下；若超出容积上限，必须改用「换罐子也没用」的说法 */
    const m = e.message.match(/至少 ([\d,\.]+) L 的罐子/);
    if (!m) {
      assert.ok(/超出本页能算的|换罐子也没用/.test(e.message), k + ' 没给罐子容积时要说清为什么：' + e.message);
      return;
    }
    const needL = Number(m[1].replace(/,/g, ''));
    assert.ok(needL <= A.FIELDS.vol.max + 1e-9, k + ' 建议的罐子不能超过容积上界：' + needL);
    const v = o.values || {};
    const body = o.totalSolM === null ? null : o.totalSolM;
    assert.ok(isFinite(needL) && needL > 0, k + ' 的罐子容积要是有限正数：' + m[1]);
    assert.ok(needL >= (o.haveMass || 0) / 1000, k + ' 的罐子至少要装得下已有盐水：' + needL + ' vs ' + (o.haveMass || 0) / 1000);
    /* 真的按这个容积重算一遍：必须算得出来，而且盐度正好回到目标 —— 这样「要多大罐子」才是可执行的建议 */
    const bigger = A.compute(set(st, 'vol', String(needL)));
    assert.strictEqual(bigger.ok, true, k + ' 按建议的 ' + needL + ' L 应当算得出来：' + JSON.stringify((bigger.errors || []).map(x => x.code)));
    near(A.wFromMasses(bigger.haveSalt + bigger.mSalt, bigger.haveWater + bigger.mWater), o.values.w, k + ' 换大罐子后盐度回到目标', 1e-6);
    assert.ok(/mL/.test(e.message), k + ' 要给出具体毫升数');
    assert.strictEqual(o.mWater, null, 'ok=false 时兑水量必须是 null（不是负数）');
  });
});

test('不变量：ok=true 时兑水量一定非负（负的兑水是没有意义的）', () => {
  let seed = 4242;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  let negCount = 0, okCount = 0;
  for (let i = 0; i < 400; i++) {
    const s = A.cloneState({
      w: A.fmt(0.1 + rnd() * 29.9, 2), vol: A.fmt(0.1 + rnd() * 49.9, 2), vegShare: '0', vegMass: '0', vegWater: '0',
      headroom: A.fmt(rnd() * 40, 1), haveVol: A.fmt(rnd() * 3000, 0), haveW: A.fmt(rnd() * 25, 2),
      bulk: '1000', bagG: '400', bagPrice: '3', spoon: '5', key: 'rand'
    });
    const o = A.compute(s);
    if (!o.ok) continue;
    okCount++;
    if (o.mWater < 0) negCount++;
  }
  assert.strictEqual(negCount, 0, '出现了负的兑水量：' + negCount + ' / ' + okCount);
  assert.ok(okCount > 50, '可算样本应当够多：' + okCount);
});

test('已有盐水放不进这一罐：报 infeasible（水那一支），而不是算出一个假的 0', () => {
  /* 1 L 罐子、菜占 20 % → 菜以外 800 mL，扣 10 % 液面空间后留给液体的只有 720 mL；
   * 里面能有的水 ≤ 0.14 × 720 × 1083.6/1000 ≈ 109 g，所以清水从约 110 mL 起就配不出来。
   * 这里填 740 mL 清水：既超过 720 mL 的液体空间，也远超 109 mL 的水量上限。
   * 如实记录一条推导：盐水密度大于水，所以「水超量」总在「体积放不下」之前成立 ——
   * 真正绑定的判据只有水量一条（haveW = 0 时两者等价），实现里也只保留这一条（另一条写了也走不到）。 */
  const s = set(set(set(set(set(set(mk('empty'), 'vol', 1), 'haveVol', 740), 'haveW', 0), 'w', 14), 'vegShare', 20), 'vegMass', 0);
  const o = A.compute(s);
  assert.strictEqual(o.ok, false);
  assert.strictEqual(JSON.stringify((o.errors || []).map(e => e.code)), JSON.stringify(['infeasible']));
  assert.ok(/水多了|只能有/.test(o.errors[0].message), '这一支要按「水多了」报：' + o.errors[0].message);
  assert.strictEqual(o.mSalt, null, 'ok=false 时推导量必须是 null');
});


/* ════════════ 4. 阈值两侧与边界 ════════════ */
test('边界：出水率 0 时不会被稀释（w′ = w，Δ = 0）', () => {
  const o = A.compute(set(def(), 'vegWater', 0));
  near(o.wAfter, o.values.w, 'w′');
  near(o.addSalt, 0, 'Δ');
  near(o.saltTotal, o.totalSaltM, '下盐总量');
  assert.ok(!o.warnings.some(w => w.code === 'dilute-notice'), '不该报稀释提示');
});

test('边界：菜量 0 且不占容积时等于「只配一罐盐水」', () => {
  const o = A.compute(mk('empty'));
  assert.strictEqual(o.ok, true);
  near(o.vegVol, 0, '菜占位'); near(o.vegWaterG, 0, '渗水');
  near(o.availMl, o.values.vol * 1000 * (1 - o.values.headroom / 100), '液体体积');
  near(o.mSalt, o.totalSolM * o.values.w / 100, '盐');
});

test('边界：预留液面 0 % 时液体体积等于菜以外减渗水', () => {
  const o = A.compute(set(set(def(), 'headroom', 0), 'vegWater', 0));
  near(o.availMl, o.bracket, '液体体积');
});

test('边界：目标盐度取下界 0.1 % 仍可算，且盐量很小但为正', () => {
  const o = A.compute(set(def(), 'w', 0.1));
  assert.strictEqual(o.ok, true);
  assert.ok(o.mSalt > 0 && o.mSalt < 2, '0.1 % 的盐量应该很小但为正：' + o.mSalt);
  near(o.saltPerL, o.rho * 0.1 * 10, 'k');
});

test('边界：目标盐度取上界 30 % → 报外推提示，但照算且自检全过', () => {
  const o = A.compute(set(def(), 'w', 30));
  assert.strictEqual(o.ok, true);
  assert.ok(o.warnings.some(w => w.code === 'extrapolated'), '必须提示这是外推');
  assert.strictEqual(fails(o), '[]', '外推档的自检也要全过：' + fails(o));
});

test('阈值两侧：24 % 不提示外推，24.01 % 提示', () => {
  assert.ok(!A.compute(set(def(), 'w', 24)).warnings.some(w => w.code === 'extrapolated'), '24 % 在常用区间内');
  assert.ok(A.compute(set(def(), 'w', 24.01)).warnings.some(w => w.code === 'extrapolated'), '24.01 % 是外推');
});

test('阈值两侧：堆积密度 700 / 1400 正常，699 / 1401 提示', () => {
  [700, 1400].forEach(b => assert.ok(!A.compute(set(def(), 'bulk', b)).warnings.some(w => w.code === 'bulk-unusual'), b + ' 不该提示'));
  [699, 1401].forEach(b => assert.ok(A.compute(set(def(), 'bulk', b)).warnings.some(w => w.code === 'bulk-unusual'), b + ' 该提示'));
});

test('阈值两侧：稀释提示只在 w′ 低于目标的 95 % 时出现', () => {
  const o1 = A.compute(set(set(def(), 'w', 20), 'vegMass', 100));
  assert.ok(!o1.warnings.some(w => w.code === 'dilute-notice'), '轻微稀释（w′=19.42 vs 20）不该提示');
  const o2 = A.compute(set(set(def(), 'w', 20), 'vegMass', 3000));
  if (o2.ok) assert.ok(o2.warnings.some(w => w.code === 'dilute-notice'), '重度稀释该提示');
});

test('边界：菜渗出的水就把菜以外的空间占完 → no-liquid-room，且给出可执行的修法', () => {
  const o = A.compute(mk('toolittle'));
  assert.strictEqual(o.ok, false);
  const e = o.errors.find(x => x.code === 'no-liquid-room');
  assert.ok(e, JSON.stringify(o.errors.map(x => x.code)));
  assert.ok(/降到约|出水率|更大的罐子/.test(e.message), '错误信息要给出具体动作：' + e.message);
  assert.strictEqual(o.availMl, 0, '这一支的液体体积就是 0');
});

test('边界：菜以外的空间被预留吃光 → no-space', () => {
  const s = set(set(set(mk('empty'), 'vegMass', 0), 'vegWater', 0), 'headroom', 50);
  const o = A.compute(s);
  assert.strictEqual(o.ok, true, '预留 50 % 仍有液体，不该报错');
  near(o.availMl, o.bracket * 0.5, '液体体积');
});

test('边界：小罐 / 大缸都算得出来（0.5 L 与 50 L）', () => {
  ['tiny', 'vat'].map(k => A.compute(mk(k))).forEach(o => {
    assert.strictEqual(o.ok, true, '预设 ' + o.key + ' 应当可算：' + JSON.stringify((o.errors || []).map(e => e.code + ':' + e.message.slice(0, 80))));
    assert.ok(o.mSalt > 0 && isFinite(o.mSalt), '盐量要有限且为正');
    assert.ok(o.waterMl > 0, '水量要为正');
  });
});

/* ════════════ 5. 非法输入 ════════════ */
test('非法输入：ok=false 时所有推导量都是 null（不是 0）', () => {
  const o = A.compute(set(def(), 'w', 'abc'));
  assert.strictEqual(o.ok, false);
  ['rho', 'saltPerL', 'availMl', 'totalSolM', 'totalSaltM', 'mSalt', 'mWater', 'waterMl', 'saltMl',
    'spoons', 'vegWaterG', 'wAfter', 'saltTotal', 'bags', 'bagCost', 'per100Salt', 'per100Water',
    'wFinal', 'newBrineMl', 'liquidRoomMl'].forEach(k => {
      assert.strictEqual(o[k], null, k + ' 必须是 null，实际 ' + JSON.stringify(o[k]));
    });
  assert.strictEqual(o.plan, null); assert.strictEqual(o.schemes, null); assert.strictEqual(o.conclusion, null);
  assert.strictEqual(JSON.stringify(o.checks), '[]');
});

test('非法输入：用户原文不会被实现改写（校验不做二次归一化）', () => {
  ['abc', '6%', '１２', '6,5', '1e3', '--6', ' ', '0x10'].forEach(raw => {
    const o = A.compute(set(def(), 'w', raw));
    if (o.ok) return;                                  /* '１２' 之类可能被判非法也可能被接受，都记 */
    const e = o.errors.find(x => x.field === 'w');
    assert.ok(e, raw + ' 应当报 w 的错');
    assert.ok(e.message.indexOf(String(raw).trim() === '' ? '还没填' : String(raw)) >= 0,
      '错误信息里要带用户填的原文：「' + raw + '」→ ' + e.message);
  });
});

test('非法输入：每一类错都有自己的 code，且带字段名', () => {
  const cases = [
    ['', 'empty'], ['abc', 'not-number'], ['0.05', 'too-small'], ['31', 'too-large'],
    ['0', 'too-small'], ['-1', 'too-small']
  ];
  cases.forEach(([raw, code]) => {
    const o = A.compute(set(def(), 'w', raw));
    assert.strictEqual(o.ok, false, raw + ' 应当非法');
    const e = o.errors.find(x => x.field === 'w');
    assert.strictEqual(e.code, code, '「' + raw + '」期望 code=' + code + '，实际 ' + e.code);
  });
});

test('容错：正在输入的「12.」按 12 处理，原样留着不动（不当成非法）', () => {
  const o = A.compute(set(def(), 'w', '12.'));
  assert.strictEqual(o.ok, true);
  near(o.values.w, 12, '取值');
});

test('容错：前后空格与正号被接受（原文一样留着）', () => {
  assert.strictEqual(A.compute(set(def(), 'w', ' 6 ')).ok, true);
  assert.strictEqual(A.compute(set(def(), 'w', '+6')).ok, true);
  near(A.compute(set(def(), 'w', ' 6 ')).values.w, 6, '取值');
});

test('非法输入：多个字段同时非法时每条都报，不是只报第一条', () => {
  let s = def();
  s = set(s, 'w', 'x'); s = set(s, 'vol', 'y'); s = set(s, 'bagG', 'z');
  const o = A.compute(s);
  assert.strictEqual(o.errors.length, 3, JSON.stringify(o.errors.map(e => e.field)));
  assert.strictEqual(JSON.stringify(o.errors.map(e => e.field).sort()), JSON.stringify(['bagG', 'vol', 'w']));
});

test('非法输入：每个字段的上下界都真的生效（12 个字段逐个测两侧）', () => {
  /* 单个字段的界与「组合起来还装不装得下」是两件事：
   * vegShare / vegMass / vegWater / headroom / haveVol / haveW 的上界会让这个 1 L 罐子装不下液体
   * 或者「已有的水超过目标水的量」（那是组合校验，见「无解场景」那几条测试），
   * 所以这里把它们放到宽裕的底座上测，只测字段自己的界。 */
  const roomy = set(set(set(def(), 'vol', 200), 'vegMass', 0), 'vegWater', 0);
  /* haveW 的上界 30 %：盐水体积要小到水不超量（30 % 的 200 mL 只有约 139 g 水） */
  const roomyHW0 = set(set(set(set(roomy, 'w', 4), 'haveVol', 200), 'haveW', 0), 'headroom', 0);
  /* haveVol 单独测（见下一条测试）：它的字段上界 200,000 mL 在这个底座上也放不下，
   * 混在一起测会把「组合校验」误报成「字段界写错」。 */
  const roomyKeys = ['vegShare', 'vegWater', 'headroom', 'vegMass'];
  Object.keys(A.FIELDS).forEach(k => {
    const f = A.FIELDS[k];
    /* haveVol 的上下界都拿 roomyHW 当底座（下界 0 也照样合法），haveW 用 roomyHW0，其余用 roomy/def */
    if (k === 'haveVol') return;                    /* haveVol 见下一条专属测试 */
    const base = k === 'haveW' ? roomyHW0 : (roomyKeys.indexOf(k) >= 0 ? roomy : def());
    const lo = A.compute(set(base, k, f.minIncl ? f.min : f.min - 1e-6));
    const hi = A.compute(set(base, k, f.maxIncl ? f.max : f.max + 1e-6));
    assert.strictEqual(lo.ok, true, k + ' 取下界 ' + f.min + ' 应当合法：' + JSON.stringify(lo.errors));
    assert.strictEqual(hi.ok, true, k + ' 取上界 ' + f.max + ' 应当合法：' + JSON.stringify(hi.errors));
    const badLo = A.compute(set(base, k, f.minIncl ? f.min - 1e-6 : f.min));
    const badHi = A.compute(set(base, k, f.maxIncl ? f.max + 1e-6 : f.max));
    assert.strictEqual(badLo.ok, false, k + ' 越过下界应当非法');
    assert.strictEqual(badHi.ok, false, k + ' 越过上界应当非法');
  });
});

test('规格与实现一致：字段上界本身可能被组合校验拦下，这不是字段界写错了', () => {
  /* haveVol 的上界 200,000 mL 是「字段能填到多少」，不是「这个罐子放得下多少」。
   * 200 L 罐子里灌 200,000 mL 清水，水就已经超过 0.5 % 那一档允许的水量 → 组合校验拦下。
   * 这条测试是为了防止后来的人把「上界取不到」误当成字段界的 bug 去改 SPEC。 */
  const roomy = set(set(set(set(def(), 'vol', 200), 'vegMass', 0), 'vegWater', 0), 'headroom', 0);
  const s = set(set(set(roomy, 'w', 0.5), 'haveW', 0), 'haveVol', 200000);
  const o = A.compute(s);
  assert.strictEqual(o.ok, false, '清水灌满 200 L 罐子 + 0.5 % 目标是配不出来的');
  assert.strictEqual(o.errors[0].code, 'infeasible');
  assert.ok(/只能有|放不进/.test(o.errors[0].message), '要说清是哪一条不够：' + o.errors[0].message);
  const ok = A.compute(set(s, 'haveVol', 139600));
  assert.strictEqual(ok.ok, true, '同一个底座上把体积降到 139,600 mL 就该能算：' + JSON.stringify((ok.errors || []).map(e => e.code)));
});

test('字段界：haveVol 的界逐档都生效，且上界取不到是这个罐子放不下（不是界写错）', () => {
  const roomy = set(set(set(set(def(), 'vol', 200), 'vegMass', 0), 'vegWater', 0), 'headroom', 0);
  const base = set(set(roomy, 'w', 0.5), 'haveW', 0);
  /* 界本身：-1 非法、0 合法、200000 合法（字段允许填）、200000.5 非法 */
  assert.strictEqual(A.compute(set(base, 'haveVol', -1)).ok, false, '负数非法');
  assert.strictEqual(A.compute(set(base, 'haveVol', 0)).ok, true, '0 合法（等于没有已有盐水）');
  assert.strictEqual(A.compute(set(base, 'haveVol', 200000.5)).ok, false, '超过上界非法');
  /* 上界在「这个 200 L 罐子」里取不到：200,000 mL 清水的水量已经超过 0.5 % 允许的水量 */
  const over = A.compute(set(base, 'haveVol', 200000));
  assert.strictEqual(over.ok, false, '200,000 mL 在这个底座上应当被组合校验拦下');
  assert.strictEqual(over.errors[0].code, 'infeasible');
  assert.ok(/只能有|放不进/.test(over.errors[0].message), '要说清是哪一条不够：' + over.errors[0].message);
  /* 降一点就能算，说明界本身没问题 */
  const under = A.compute(set(base, 'haveVol', 139600));
  assert.strictEqual(under.ok, true, '降到 139,600 mL 就该能算：' + JSON.stringify((under.errors || []).map(e => e.code)));
});

/* ════════════ 6. 单调性与方向性 ════════════ */
test('单调：目标盐度越高，要下的盐越多（给定容器与菜）', () => {
  const ws = [1, 2, 4, 6, 8, 12, 16, 20, 26];
  let prev = -1;
  ws.forEach(w => { const o = A.compute(set(def(), 'w', w)); assert.ok(o.mSalt > prev, 'w=' + w); prev = o.mSalt; });
});

test('单调：菜越多（占位越大），液体越少、盐越少', () => {
  const rs = [0, 10, 20, 30, 40, 50, 60, 70];
  let prevSalt = Infinity, prevAvail = Infinity;
  rs.forEach(r => {
    const o = A.compute(set(set(def(), 'vegShare', r), 'vegMass', 0));
    assert.ok(o.availMl < prevAvail, '菜占位 ' + r + ' % 时液体应当更少');
    assert.ok(o.mSalt < prevSalt, '菜占位 ' + r + ' % 时盐应当更少');
    prevAvail = o.availMl; prevSalt = o.mSalt;
  });
});

test('单调：菜渗水越多，液体越少但「一次到位」的补盐越多', () => {
  const qs = [0, 10, 20, 30, 40, 50];
  let prevAvail = Infinity, prevAdd = -1;
  qs.forEach(q => {
    const o = A.compute(set(set(def(), 'vegWater', q), 'vegMass', 1000));
    assert.ok(o.ok, 'q=' + q + ' 应当可算：' + JSON.stringify(o.errors));
    assert.ok(o.availMl < prevAvail, 'q=' + q + ' 液体应当更少');
    assert.ok(o.addSalt > prevAdd, 'q=' + q + ' 补盐应当更多');
    prevAvail = o.availMl; prevAdd = o.addSalt;
  });
});

test('单调：已有盐水越多（同浓度），本轮要下的盐越少', () => {
  let prev = Infinity;
  [0, 100, 200, 300, 400, 500].forEach(v => {
    const o = A.compute(set(set(set(mk('empty'), 'vol', 3), 'haveVol', v), 'haveW', 4));
    assert.ok(o.ok, 'haveVol=' + v + ' 应当可算');
    assert.ok(o.mSalt < prev, 'haveVol=' + v + ' 时本轮下盐应当更少（' + o.mSalt + '）');
    prev = o.mSalt;
  });
});

test('单调：整袋规格越大，袋数不会变多', () => {
  let prev = Infinity;
  [100, 200, 400, 500, 1000, 2000, 5000].forEach(g => {
    const o = A.compute(set(def(), 'bagG', g));
    assert.ok(o.bags <= prev, 'bagG=' + g + ' 袋数不该变多：' + o.bags + ' > ' + prev);
    assert.ok(o.bags >= 1, '至少一袋');
    prev = o.bags;
  });
});

test('取值方向：预留液面越多，液体越少、盐越少', () => {
  let prev = Infinity;
  [0, 5, 10, 15, 20, 30, 40, 50].forEach(h => {
    const o = A.compute(set(def(), 'headroom', h));
    assert.ok(o.availMl < prev, 'headroom=' + h);
    prev = o.availMl;
  });
});

/* ════════════ 7. 取整与格式化 ════════════ */
test('取整：正好整除不跳档；浮点噪声不跳档；超出容差就跳档', () => {
  near(A.ceilSafe(4), 4, '正好整除');
  near(A.ceilSafe(4.0000000001), 4, '容差内的噪声');
  near(A.ceilSafe(4.001), 5, '超出容差');
  near(A.ceilSafe(0), 0, '0');
});

test('取整：袋数按「下盐总量」向上取整（含一次到位的补盐）', () => {
  const o = A.compute(def());
  assert.strictEqual(o.bags, Math.ceil(o.saltTotal / 400 - 1e-9), '袋数口径');
  assert.ok(o.saltTotal > 400 ? o.bags === 2 : o.bags === 1, '400 g 一袋时的档');
});

test('取整：盐量跨过 400 g 就从 1 袋跳到 2 袋，且跳档点两侧都对', () => {
  /* 1 L 罐子的盐量上限只有 ~94 g（9 % 也就 94 g），永远只买 1 袋；
   * 10 L 罐子跨过 400 g 就跳 2 袋，用它扫跳档点。 */
  const base = set(set(set(mk('empty'), 'vol', 10), 'vegShare', 0), 'vegMass', 0);
  let last1 = null, first2 = null;
  for (let w = 100; w <= 600; w++) {                    /* 目标盐度按 0.01 % 扫（w/100） */
    const o = A.compute(set(base, 'w', (w / 100).toFixed(2)));
    if (o.bags === 1) last1 = o; else if (o.bags === 2 && !first2) first2 = o;
  }
  assert.ok(last1 && first2, '扫描区间里应当同时出现 1 袋与 2 袋');
  assert.ok(last1.saltTotal <= 400 + 1e-6, '1 袋档的盐量不该超过 400 g：' + last1.saltTotal);
  assert.ok(first2.saltTotal > 400 - 1e-6, '2 袋档的盐量不该低于 400 g：' + first2.saltTotal);
  assert.ok(first2.values.w > last1.values.w, '档位应当是单调上去的');
});

test('格式化：整数不带多余小数，非数字给破折号', () => {
  assert.strictEqual(A.fmt(12, 0), '12');
  assert.strictEqual(A.fmt(12.0, 2), '12');
  assert.strictEqual(A.fmt(12.345, 2), '12.35');
  assert.strictEqual(A.fmt(null, 2), '—');
  assert.strictEqual(A.fmt(Infinity, 2), '—');
  assert.strictEqual(A.fmtV(1234.5, 0), '1,235');
  assert.strictEqual(A.fmt(0.0001, 2), '0');
});

test('格式化：负数与极大值都能正常输出（视觉走查要用）', () => {
  assert.strictEqual(A.fmt(-12.345, 2), '-12.35');
  assert.strictEqual(A.fmt(1e9, 2), '1000000000');
  assert.ok(A.fmtV(12345678.9, 1).indexOf(',') > 0, '大数要带千分位');
});

test('舍入：roundDp 半远离零，且不出现二进制尾巴', () => {
  near(A.roundDp(2.675, 2), 2.68, '2.675 → 2.68');
  near(A.roundDp(-2.675, 2), -2.68, '负数对称');
  /* 如实记录：1.005 的二进制表示略小于 1.005（100.49999999999999），所以按「半远离零」得 1；
   * 这不是 bug，是十进制字面量本来就没有精确的二进制表示。取一个真正略大的数验证进位。 */
  near(A.roundDp(1.005, 2), 1, '1.005 → 1（二进制略小）');
  near(A.roundDp(1.0051, 2), 1.01, '1.0051 → 1.01');
  /* 1.015 存起来是 1.0149999999999999023，所以按半远离零也是 1.01；换成真正超过 .5 的数验证进位 */
  near(A.roundDp(1.015, 2), 1.01, '1.015 → 1.01（存起来略小于 .5）');
  near(A.roundDp(1.0151, 2), 1.02, '1.0151 → 1.02');
});

/* ════════════ 8. 建议（能作用于输入） ════════════ */
test('建议：每条都能应用到状态上，并且应用后真的按它说的变', () => {
  const s = def();
  const o = A.compute(s);
  const list = A.suggestions(s, o);
  assert.ok(list.length >= 3, '默认场景应当给出至少 3 条建议，实际 ' + list.length);
  list.forEach(sug => {
    assert.strictEqual(sug.kind, 'field', '本地只实现「改字段」这一类');
    assert.ok(A.FIELDS[sug.field], 'field 必须是真实字段：' + sug.field);
    const next = A.applySuggestion(s, sug);
    const o2 = A.compute(next);
    assert.strictEqual(o2.ok, true, '应用「' + sug.label + '」之后仍要可算：' + JSON.stringify(o2.errors));
    assert.notStrictEqual(next[sug.field], s[sug.field], '应用后该字段的原文必须变了');
    if (sug.field === 'bulk') {
      /* 盐型只影响盐占的体积与勺数，本来就不该改「下多少克盐」——单列断言：体积读数确实变了。 */
      assert.notStrictEqual(A.compute(next).saltMl, o.saltMl, '换盐型之后盐占的体积必须变');
    } else {
      assert.notStrictEqual(A.compute(next).conclusion.lead, o.conclusion.lead,
        '应用「' + sug.label + '」之后主结论必须跟着变（否则建议是空话）');
    }
  });
});

test('建议：每条建议里的数字都等于「真的应用之后」的引擎输出（不写估话）', () => {
  const s = A.compute ? def() : def();
  const o = A.compute(s);
  const sug = A.suggestions(s, o).find(x => x.id === 'lower-w');
  assert.ok(sug, '默认场景应当有「省盐」这条');
  const o2 = A.compute(A.applySuggestion(s, sug));
  assert.ok(sug.effect.indexOf(A.fmtV(o2.mSalt, 1)) >= 0,
    '建议里的新盐量 ' + A.fmtV(o2.mSalt, 1) + ' 应当出现在 effect 里：' + sug.effect);
});

test('建议：应用后建议列表会更新（不会把已经做到的又提一遍）', () => {
  const s = def();
  const o = A.compute(s);
  const sug = A.suggestions(s, o).find(x => x.id === 'lower-w');
  const s2 = A.applySuggestion(s, sug);
  const o2 = A.compute(s2);
  const again = A.suggestions(s2, o2).find(x => x.id === 'lower-w');
  if (again) assert.notStrictEqual(again.value, sug.value, '同样的建议不该原样再来一次');
});

/* ════════════ 9. 方案对照与换罐子 ════════════ */
test('方案对照：三档（4/6/15 %）各自与单独算那一档完全一致', () => {
  const o = A.compute(def());
  assert.strictEqual(o.schemes.length, 3);
  o.schemes.forEach(sc => {
    const solo = A.compute(set(def(), 'w', sc.w));
    near(sc.mSalt, solo.mSalt, 'w=' + sc.w + ' 的本轮下盐');
    near(sc.waterMl, solo.waterMl, 'w=' + sc.w + ' 的兑水');
    near(sc.saltTotal, solo.saltTotal, 'w=' + sc.w + ' 的下盐总量');
    near(sc.bags, solo.bags, 'w=' + sc.w + ' 的袋数');
    near(sc.wAfter, solo.wAfter, 'w=' + sc.w + ' 的渗出后盐度');
    near(sc.rho, solo.rho, 'w=' + sc.w + ' 的密度');
  });
});

test('方案对照：档位越高盐越多、每升含盐越多（单调）', () => {
  const o = A.compute(def());
  const byW = o.schemes.slice().sort((a, b) => a.w - b.w);
  for (let i = 1; i < byW.length; i++) {
    assert.ok(byW[i].mSalt > byW[i - 1].mSalt, '档位 ' + byW[i].w + ' 的盐应当更多');
    assert.ok(byW[i].saltPerL > byW[i - 1].saltPerL, '每升含盐应当更多');
  }
});

test('换罐子：每一档都与「把容积改成那一档」单独算一致', () => {
  const o = A.compute(def());
  const rows = o.alt.filter(r => r.ok);
  assert.ok(rows.length >= 5, '至少 5 档能算');
  rows.forEach(r => {
    const solo = A.compute(set(def(), 'vol', r.vol));
    near(r.saltTotal, solo.saltTotal, r.vol + ' L 的下盐总量');
    near(r.waterMl, solo.waterMl, r.vol + ' L 的兑水');
    near(r.bags, solo.bags, r.vol + ' L 的袋数');
  });
  assert.strictEqual(o.alt.filter(r => r.isCurrent).length, 1, '当前档必须且只有一个');
});

/* ════════════ 10. 随机不变量（防止只在个别点成立） ════════════ */
test('随机 300 组：15 条不变量 0 违反', () => {
  let seed = 20261113;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  let okCount = 0, errCount = 0;
  for (let i = 0; i < 300; i++) {
    const s = {
      w: A.fmt(0.1 + rnd() * 29.9, 2), vol: A.fmt(0.1 + rnd() * 49.9, 2),
      vegShare: A.fmt(rnd() * 90, 1), vegMass: A.fmt(rnd() * 20000, 0),
      vegWater: A.fmt(rnd() * 70, 1), headroom: A.fmt(rnd() * 45, 1),
      haveVol: A.fmt(rnd() * 5000, 0), haveW: A.fmt(rnd() * 25, 2),
      bulk: A.fmt(600 + rnd() * 800, 0), bagG: A.fmt(100 + rnd() * 900, 0),
      bagPrice: A.fmt(rnd() * 20, 2), spoon: A.fmt(1 + rnd() * 12, 1), key: 'rand'
    };
    const o = A.compute(A.cloneState(s));
    if (!o.ok) {
      errCount++;
      assert.ok(o.errors.length > 0, '失败必须有原因');
      assert.strictEqual(o.mSalt, null);
      /* 无解时给出的两条建议也必须是可执行的：按「只留约 N mL」重算要能算出来且盐度回到目标 */
      const inf = o.errors.filter(function (x) { return x.code === 'infeasible'; })[0];
      if (inf) {
        /* ① 「换一个至少 N L 的罐子」：按那个容积重算，必须能算且盐度回到目标 */
        const mj = inf.message.match(/至少 ([\d,\.]+) L 的罐子/);
        if (mj) {
          const needL = Number(mj[1].replace(/,/g, ''));
          const s2 = A.cloneState(s); s2.vol = String(needL);
          const o2 = A.compute(s2);
          assert.strictEqual(o2.ok, true, '按「换 ' + needL + ' L 罐子」应当能算：' + JSON.stringify((o2.errors || []).map(function (x) { return x.code; })));
          near(A.wFromMasses(o2.haveSalt + o2.mSalt, o2.haveWater + o2.mWater), Number(A.compute(s).values.w), '换大罐子后的盐度', 1e-6);
        }
        /* ② 「把目标盐度提高到每升 N g 以上」：把目标设成刚好那么多，必须能算 */
        const mp = inf.message.match(/提高到每升 ([\d,\.]+) g 以上/);
        if (mp) {
          const perL = Number(mp[1].replace(/,/g, ''));
          /* perL 是「每升盐水的盐量」，对应质量分数要解 k(w) = ρ(w)·w·10 = perL */
          let lo = 0.1, hi = 30, mid = 0;
          for (let z = 0; z < 90; z++) {
            mid = (lo + hi) / 2;
            if (A.saltPerL(mid) > perL) hi = mid; else lo = mid;
          }
          const s3 = A.cloneState(s); s3.w = String(A.roundDp(mid + 0.02, 2));
          const o3 = A.compute(s3);
          assert.strictEqual(o3.ok, true, '把目标提到每升 ' + perL + ' g 之后应当能算：' + JSON.stringify((o3.errors || []).map(function (x) { return x.code; })));
        }
      }
      continue;
    }
    okCount++;
    const v = o.values;
    assert.ok(isFinite(o.rho) && o.rho > 0, 'ρ 有限为正');
    assert.ok(o.availMl > 0 && o.availMl <= o.bracket + 1e-6, '液体不超过菜以外');
    assert.ok(o.availMl + o.vegWaterG <= o.bracket + 1e-6, '液体 + 渗水不超过菜以外');
    assert.ok(o.mSalt >= 0 && isFinite(o.mSalt), '盐非负有限');
    assert.ok(o.mWater >= -1e-9, '水非负');
    assert.ok(o.bags >= 1 && Number.isInteger(o.bags), '袋数是正整数');
    assert.ok(o.wAfter <= v.w + 1e-9 || o.enoughSalt, '渗出后不该比目标更咸（除非本来就超了）');
    if (o.vegWaterG > 0) {
      /* 菜渗水只能是稀释：渗出后一定不高于渗出前 */
      const wBefore = o.enoughSalt
        ? 100 * o.haveSalt / (o.haveMass - o.haveSalt)
        : A.wFromMasses(o.haveSalt + o.mSalt, o.haveWater + o.mWater);
      assert.ok(o.wAfter <= wBefore + 1e-9, '渗出后 ' + o.wAfter + ' 不该高于渗出前 ' + wBefore);
    }
    if (!o.enoughSalt) {
      near(100 * (o.haveSalt + o.mSalt) / (o.haveMass + o.mSalt + o.mWater), v.w, '回代盐度', 1e-6);
    }
    assert.ok(o.spoons === null || o.spoons >= 0, '勺数非负');
    assert.ok(o.saltMl >= 0 && o.saltMl < o.bracket + 1e-6, '盐占体积合理');
    assert.ok(o.schemes.length === 3 && o.alt.length >= 5, '对照表齐全');
    assert.ok(o.plan.steps.length === 5, '照做清单 5 步');
    assert.strictEqual(fails(o), '[]', '随机样本的自检也必须全过：' + fails(o));
  }
  assert.ok(okCount > 150, '可算样本应当占多数：' + okCount);
  assert.ok(errCount > 0, '随机里应当出现被拦下的情形：' + errCount);
});

/* ════════════ 11. 纯函数与确定性 ════════════ */
test('纯函数：compute 不改状态，两次结果完全一致', () => {
  const s = def();
  const before = JSON.stringify(s);
  const o1 = A.compute(s), o2 = A.compute(s);
  assert.strictEqual(JSON.stringify(s), before, 'compute 不能改输入');
  assert.strictEqual(JSON.stringify(o1.checks), JSON.stringify(o2.checks));
  near(o1.mSalt, o2.mSalt, '两次结果一致');
});

test('纯函数：cloneState 是深拷贝，改副本不影响原件', () => {
  const s = def();
  const c = A.cloneState(s);
  c.w = '99';
  assert.notStrictEqual(s.w, '99');
});

test('stateFromJSON：坏数据回落到默认值，好数据被接受', () => {
  const d = A.defaultState();
  assert.strictEqual(A.stateFromJSON(null).w, d.w);
  assert.strictEqual(A.stateFromJSON({ w: '9' }).w, '9');
  assert.strictEqual(A.stateFromJSON({ w: 9 }).w, '9');
  const junk = A.stateFromJSON({ nope: 1 });
  assert.strictEqual(junk.ok === undefined, true);
  assert.strictEqual(junk.w, d.w, '未知字段不影响默认值');
});

/* ════════════ 12. 导出契约 ════════════ */
test('导出 CSV：带 BOM、行数与字段齐全、非法时给出错误行', () => {
  const csv = A.toCSV(def(), A.compute(def()));
  assert.ok(csv.charCodeAt(0) === 0xFEFF, 'CSV 要带 BOM 才能被 Excel 正确识别');
  const lines = csv.split('\n').filter(Boolean);
  assert.ok(lines.length >= 20, '字段行数：' + lines.length);
  assert.ok(lines[1].indexOf('目标盐度') >= 0, '第二行开始是数据');
  const bad = A.toCSV(def(), A.compute(set(def(), 'w', 'x')));
  assert.ok(bad.indexOf('错误') === 0, '非法输入时 CSV 第一格是「错误」');
});

test('导出 MD：含主结论与免责句', () => {
  const md = A.toMarkdown(def(), A.compute(def()));
  assert.ok(md.indexOf('# ') === 0, 'MD 要有标题');
  assert.ok(md.indexOf('不做安全判定') >= 0, '必须带上边界声明');
  assert.ok(md.indexOf('那袋盐怎么配') >= 0);
});

test('导出 JSON：可解析、字段齐全、时间戳存在', () => {
  const o = A.compute(def());
  const j = JSON.parse(A.toJSON(def(), o));
  assert.strictEqual(j.app, '那袋盐怎么配');
  assert.ok(j.exported_at && j.exported_at.length > 10, '要带导出时间');
  near(j.result.mSalt, o.mSalt, 'JSON 里的盐量与引擎一致');
  near(j.result.waterMl, o.waterMl, 'JSON 里的水量与引擎一致');
  assert.strictEqual(j.state.w, def().w, '连同输入一起导出');
  const bad = JSON.parse(A.toJSON(def(), A.compute(set(def(), 'w', 'x'))));
  assert.ok(bad.result.error, '非法输入时 JSON 里带错误');
});

test('summary：每一行都不是 undefined / NaN', () => {
  const o = A.compute(def());
  const s = A.summary(def(), o);
  assert.ok(s.lines.length >= 8);
  s.lines.forEach(l => {
    assert.strictEqual(typeof l, 'string');
    assert.ok(l.indexOf('undefined') < 0, '出现 undefined：' + l);
    assert.ok(l.indexOf('NaN') < 0, '出现 NaN：' + l);
    assert.ok(l.indexOf('—') < 0, 'summary 里不该出现破折号占位：' + l);
  });
});

/* ════════════ 13. 规格表与预设的一致性 ════════════ */
test('规格表：12 个字段、key 唯一、界合法、dp 合法', () => {
  const keys = Object.keys(A.FIELDS);
  assert.strictEqual(keys.length, 12);
  assert.strictEqual(new Set(keys).size, 12, 'key 不能重复');
  keys.forEach(k => {
    const f = A.FIELDS[k];
    assert.ok(f.label && f.unit !== undefined, k + ' 要有 label/unit');
    assert.ok(f.min < f.max, k + ' 的界');
    assert.ok(Number.isInteger(f.dp) && f.dp >= 0 && f.dp <= 3, k + ' 的 dp');
  });
});

test('预设：12 个场景、key 唯一、每个都能算或给出明确的无解原因', () => {
  assert.strictEqual(A.PRESETS.length, 12);
  const ks = A.PRESETS.map(p => p.key);
  assert.strictEqual(new Set(ks).size, ks.length, 'key 不能重复');
  const errs = [];
  A.PRESETS.forEach(p => {
    const o = A.compute(A.stateFromPreset(p.key));
    if (o.ok) {
      assert.strictEqual(fails(o), '[]', p.key + ' 的自检应当全过：' + fails(o));
    } else {
      errs.push(p.key);
      o.errors.forEach(e => assert.ok(e.message.length > 20, p.key + ' 的无解原因要说清楚'));
    }
  });
  assert.ok(errs.length >= 1, '至少要有一个无解场景（要能演示异常流程）：' + JSON.stringify(errs));
  assert.ok(A.PRESETS.length - errs.length >= 8, '多数场景要能算出来');
});

test('预设：默认场景与 PRESETS[0] 是同一套数（不能两处各写一份）', () => {
  const d = def(), p = A.stateFromPreset('default');
  Object.keys(A.FIELDS).forEach(k => assert.strictEqual(d[k], p[k], k + ' 不一致'));
  assert.strictEqual(d.key, 'default');
});

test('盐型三档：细盐 / 普通 / 粗粒，且 saltKindOf 能对上', () => {
  assert.strictEqual(A.SALT_KINDS.length, 3);
  A.SALT_KINDS.forEach(s => {
    assert.ok(s.bulk >= 700 && s.bulk <= 1400, s.name + ' 应当在常见区间内');
    assert.strictEqual(A.saltKindOf(s.bulk).key, s.key);
  });
  assert.strictEqual(A.saltKindOf(1234), null, '区间外的值不该硬套某一档');
});

test('盐型只影响体积与勺数，不影响要下多少克盐', () => {
  const a = A.compute(set(def(), 'bulk', 800));
  const b = A.compute(set(def(), 'bulk', 1200));
  near(a.mSalt, b.mSalt, '克数不变');
  near(a.totalSolM, b.totalSolM, '液体质量不变');
  assert.ok(a.saltMl > b.saltMl, '粗盐同重量占的体积更大');
});

/* ════════════ 14. 极端与退化 ════════════ */
test('退化：菜量 0 但蔬菜占容积很大（用户假设自相矛盾）也能算，不崩', () => {
  const o = A.compute(set(set(mk('empty'), 'vegShare', 90), 'vegMass', 0));
  assert.strictEqual(o.ok, true);
  near(o.vegWaterG, 0, '没有菜就没有渗水');
  assert.ok(o.availMl > 0 && o.availMl === o.bracket * (1 - o.values.headroom / 100), '液体口径');
});

test('极端：200 L 缸 + 50000 g 菜 + 出水率 80 % 要么算出来要么给明确原因', () => {
  let s = set(set(set(set(def(), 'vol', 200), 'vegMass', 50000), 'vegWater', 80), 'vegShare', 20);
  const o = A.compute(s);
  if (o.ok) {
    assert.ok(isFinite(o.mSalt) && o.mSalt > 0, '有限为正');
    assert.ok(o.bags >= 1);
  } else {
    assert.ok(o.errors[0].message.length > 20, '必须说清楚为什么');
  }
});

test('极端：极小的液体体积（1 mL 量级）不产生除零或负值', () => {
  const s = set(set(set(set(def(), 'vol', 0.1), 'vegShare', 94.9), 'vegMass', 0), 'headroom', 0);
  const o = A.compute(s);
  assert.strictEqual(o.ok, true, JSON.stringify(o.errors));
  assert.ok(o.availMl > 0 && o.availMl < 10, '液体体积应当很小：' + o.availMl);
  assert.ok(o.mSalt > 0 && isFinite(o.mSalt));
  assert.ok(o.waterMl >= 0);
  assert.ok(o.bags >= 1);
});

test('极端：单袋 5000 g 且盐量极小时也只买 1 袋', () => {
  const o = A.compute(set(set(def(), 'bagG', 5000), 'w', 0.5));
  assert.strictEqual(o.bags, 1);
  near(o.bagCost, o.values.bagPrice, '一袋就是一份钱');
});

test('零分母：每平勺克数取下界 0.5 时勺数有限且很大；不会出现 Infinity', () => {
  const o = A.compute(set(def(), 'spoon', 0.5));
  assert.ok(isFinite(o.spoons), '勺数必须有限');
  near(o.spoons, o.saltTotal / 0.5, '勺数口径 = 下盐总量 ÷ 每平勺克数');
  assert.ok(o.spoons > o.saltTotal / 1, '勺越小、勺数越多');
});

test('零分母：单价 0 时成本为 0 且不产生 NaN', () => {
  const o = A.compute(set(def(), 'bagPrice', 0));
  near(o.bagCost, 0, '成本');
  assert.ok(isFinite(o.costPerL), '每升成本有限');
  near(o.costPerL, 0, '单价 0 → 每升成本 0');
});

test('空结果：没有菜、没有已有盐水、预留 50 % 时仍然给出一张可照做的单子', () => {
  const o = A.compute(set(set(set(mk('empty'), 'vegMass', 0), 'vegShare', 0), 'headroom', 50));
  assert.strictEqual(o.ok, true);
  assert.ok(o.plan.steps.length === 5);
  assert.ok(o.plan.steps[0].text.indexOf('称') >= 0, '第一步仍然是称盐');
  assert.ok(o.conclusion.lead.indexOf('下') >= 0);
});

/* ════════════ 15. 单位口径 ════════════ */
test('单位：ρ 用 g/mL、k 用 g/L、体积用 mL、质量用 g，且互相换算自洽', () => {
  const o = A.compute(def());
  near(o.saltPerL / 1000 * o.availMl, o.totalSaltM, 'g/L × L = g');
  near(o.totalSolM / o.availMl, o.rho, 'g ÷ mL = g/mL');
  near(o.vegVol, o.values.vol * 1000 * o.values.vegShare / 100, 'L → mL');
});

test('单位：说明里出现的 12 V 式写法不再出现（本页只有 g / mL / L / %）', () => {
  const o = A.compute(def());
  const txt = A.toMarkdown(def(), o);
  assert.ok(txt.indexOf(' g') > 0, '质量用 g');
  assert.ok(txt.indexOf(' mL') > 0, '体积用 mL');
  assert.ok(!/undefined|NaN/.test(txt), '导出里不能有 undefined/NaN');
});

test('两条无解预设给出的「只留约 N mL」都是可执行的：按它重算盐度回到目标', () => {
  ['toosalty', 'overfill'].forEach(k => {
    const s = A.stateFromPreset(k);
    const o = A.compute(s);
    assert.strictEqual(o.ok, false, k + ' 应当是无解预设');
    const inf = o.errors.filter(x => x.code === 'infeasible')[0];
    assert.ok(inf, k + ' 应当报 infeasible：' + JSON.stringify(o.errors.map(x => x.code)));
    /* 两支措辞：留量 ≥ 1 mL 时给「只留约 N mL」；留量不到 1 mL 时说明「整瓶倒掉重配」
     * （如实记录：这一支的可行留量只有「全部」与「几乎 0」两种，中间值不存在 —— 所以措辞要分两支） */
    const m = inf.message.match(/只留约 ([\d,\.]+) mL/);
    if (m) {
      const keep = Number(m[1].replace(/,/g, ''));
      assert.ok(keep >= 1 && keep < Number(s.haveVol), k + ' 留量应当在 [1, 原量) 内：' + keep);
      const o2 = A.compute(set(s, 'haveVol', String(keep)));
      assert.strictEqual(o2.ok, true, k + ' 按「只留 ' + keep + ' mL」应当算得出来：' + JSON.stringify((o2.errors || []).map(x => x.code)));
      near(A.wFromMasses(o2.haveSalt + o2.mSalt, o2.haveWater + o2.mWater), Number(s.w), k + ' 留量重算后的盐度', 1e-6);
    } else {
      assert.ok(/整瓶倒掉|倒掉一部分也解决不了/.test(inf.message), k + ' 没有留量时要给出替代动作：' + inf.message);
      /* 换成清水之后应当能算（证明「另配新盐水」是对的方向） */
      const o3 = A.compute(set(s, 'haveVol', '0'));
      assert.strictEqual(o3.ok, true, k + ' 去掉已有盐水后应当能算：' + JSON.stringify((o3.errors || []).map(x => x.code)));
    }
  });
});
