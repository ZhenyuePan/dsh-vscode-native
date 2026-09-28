const fs = require('node:fs');
const path = require('node:path');
const root = path.dirname(require.resolve('markdown-it/package.json'));
fs.copyFileSync(path.join(root, 'dist/markdown-it.min.js'), path.join(__dirname, '../media/markdown-it.min.js'));
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(__dirname, '../media/markdown-it.LICENSE'));
