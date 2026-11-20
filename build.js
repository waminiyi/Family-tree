// Concatenates src/* into a single self-contained index.html (no runtime dependencies).
const fs = require('fs'), path = require('path');
const S = (f) => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const js = ['i18n.js', 'model.js', 'layout.js', 'draw.js', 'export.js', 'app.js'].map(S).join('\n');
const html = S('index.template.html').replace('/*__CSS__*/', () => S('styles.css')).replace('/*__JS__*/', () => js);
fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log('index.html', fs.statSync(path.join(__dirname, 'index.html')).size, 'bytes');
