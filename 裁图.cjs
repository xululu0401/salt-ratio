#!/usr/bin/env node
/* 按 evidence/截图-<TAG>/区块矩形.json 里的 DOM 矩形，从整页截图里裁出区块图。
 * 用工作区自带的 Python + Pillow（不装新依赖）。
 */
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const TAG = process.argv[2] || '本地';
const SHOT = path.join(__dirname, '..', 'evidence', '截图-' + TAG);
const meta = JSON.parse(fs.readFileSync(path.join(SHOT, '区块矩形.json'), 'utf8'));
const py = `
import json, os, sys
from PIL import Image
shot = ${JSON.stringify(SHOT)}
meta = json.load(open(os.path.join(shot, '区块矩形.json'), encoding='utf-8'))
im = Image.open(meta['page'])
W, H = im.size
outdir = os.path.join(shot, '区块')
os.makedirs(outdir, exist_ok=True)
made = []
items = [(k, v) for k, v in meta['rects'].items() if k != '__sections']
for i, r in enumerate(meta['rects']['__sections']):
    items.append(('section-%02d' % (i + 1), r))
for name, r in items:
    x = max(0, r['x'] - 8); y = max(0, r['y'] - 8)
    x2 = min(W, r['x'] + r['w'] + 8); y2 = min(H, r['y'] + r['h'] + 8)
    if x2 - x < 20 or y2 - y < 12:
        made.append((name, None, 'too-small'))
        continue
    im.crop((x, y, x2, y2)).save(os.path.join(outdir, name + '.png'))
    made.append((name, (x2 - x, y2 - y), os.path.getsize(os.path.join(outdir, name + '.png'))))
print(json.dumps({'page': [W, H], 'made': made}, ensure_ascii=False))
`;
const PY = process.env.DSH_PYTHON || '/Users/xululu/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3';
const r = execFileSync(PY, ['-c', py], { encoding: 'utf8', maxBuffer: 1e8 });
const j = JSON.parse(r);
console.log('整页 ' + j.page[0] + '×' + j.page[1] + '，裁出 ' + j.made.filter(function (m) { return m[1]; }).length + ' 张区块图：');
j.made.forEach(function (m) { console.log('  ' + m[0] + '  ' + (m[1] ? m[1][0] + '×' + m[1][1] + '  ' + m[2] + ' 字节' : m[2])); });
