const fs = require('node:fs');
/* index.html 与 core.js / ui.js 是并列的独立文件（靠 <script src> 引），
 * 所以这里不再做「把源码拼进 HTML」的构建，只做一致性校验：
 *  - 模板里必须确实是外链引用（不能退回内联）
 *  - 三个文件都要存在且非空
 * 保留这个脚本是为了让「怎么出的 index.html」这件事有据可查。 */
const t = fs.readFileSync('template.html', 'utf8');
if (t.indexOf('<script src="./core.js"></script>') < 0 || t.indexOf('<script src="./ui.js"></script>') < 0) {
  throw new Error('模板里的脚本引用不是外链形式，检查 template.html');
}
if (/<script>[\s\S]*?<\/script>/.test(t)) {
  throw new Error('模板里还有内联 <script> 内容：源码会被当成页面正文，请改成 <script src>');
}
fs.copyFileSync('template.html', 'index.html');
for (const f of ['index.html', 'core.js', 'ui.js']) {
  const n = fs.statSync(f).size;
  if (!n) throw new Error(f + ' 是空的');
  console.log(f, n, 'bytes');
}
console.log('OK：index.html 由 template.html 直接产出（脚本外链）');
