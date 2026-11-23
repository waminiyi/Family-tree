// Concatenates src/* into a single self-contained index.html (no runtime dependencies).
// If prettier is installed in tests/ (npm install there), the output is formatted with it.
const fs = require('fs'), path = require('path');
const S = (f) => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const js = ['i18n.js', 'model.js', 'layout.js', 'draw.js', 'export.js', 'app.js'].map(S).join('\n');
let html = S('index.template.html').replace('/*__CSS__*/', () => S('styles.css')).replace('/*__JS__*/', () => js);
const out = path.join(__dirname, 'index.html');
(async () => {
  try { const prettier = require(path.join(__dirname, 'tests', 'node_modules', 'prettier')); html = await prettier.format(html, { parser: 'html' }); } catch (e) { /* prettier not installed: keep compact output */ }
  fs.writeFileSync(out, html);
  console.log('index.html', fs.statSync(out).size, 'bytes');
})();
