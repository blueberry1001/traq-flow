import { readFile, mkdir, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const core = (await readFile(new URL('src/core.js', root), 'utf8')).replace(/^export /gm, '');
const runtime = await readFile(new URL('src/runtime.js', root), 'utf8');
const code = `(() => {\n'use strict';\n${core}\n${runtime}\n})();\n`;
const metadata = `// ==UserScript==
// @name         traQ Flow — 連投をまとめる
// @namespace    https://github.com/blueberry1001/traq-flow
// @version      0.1.1
// @description  自分の連投を直近の投稿に追記し、連続した発言の表示をまとめます。秒数は設定できます。
// @author       blueberry1001
// @license      MIT
// @match        https://q.trap.jp/*
// @run-at       document-start
// @grant        none
// @sandbox      raw
// @inject-into  page
// @noframes
// ==/UserScript==
`;
await mkdir(new URL('dist/chrome/', root), { recursive: true });
await writeFile(new URL('dist/traq-flow.user.js', root), metadata + code);
await writeFile(new URL('dist/chrome/content.js', root), code);
await writeFile(new URL('dist/chrome/manifest.json', root), JSON.stringify({
  manifest_version: 3, name: 'traQ Flow', version: '0.1.1', minimum_chrome_version: '116',
  description: 'traQの連投を直近メッセージへの追記に変換し、連続した発言の表示をまとめます。',
  homepage_url: 'https://github.com/blueberry1001/traq-flow',
  content_scripts: [{ matches: ['https://q.trap.jp/*'], js: ['content.js'], run_at: 'document_start', world: 'MAIN' }]
}, null, 2) + '\n');
console.log('Built userscript and Chrome extension.');
