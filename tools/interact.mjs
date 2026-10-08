// Headless interaction checks for the frontend (browser host mode).
import puppeteer from 'puppeteer-core';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const T = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.md': 'text/markdown', '.woff2': 'font/woff2' };
const s = http.createServer((q, r) => { const u = decodeURIComponent(new URL(q.url, 'http://x').pathname); fs.readFile(path.join(ROOT, u), (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': T[path.extname(u)] || 'application/octet-stream' }); r.end(d); }); }).listen(0);
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const p = await b.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.setViewport({ width: 1200, height: 800 });
const base = `http://localhost:${s.address().port}/dist-web/index.html`;
await b.defaultBrowserContext().overridePermissions(`http://localhost:${s.address().port}`, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
const clip = () => p.evaluate(() => navigator.clipboard.readText());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`);

// welcome screen
await p.goto(base, { waitUntil: 'load' });
await p.waitForSelector('#mk-welcome:not([hidden])');
check('welcome screen when no file', true);
check('copy disabled without a file', await p.$eval('#btn-copy', (e) => e.disabled && getComputedStyle(e).pointerEvents === 'none'));

await p.goto(base + '?file=/samples/showcase.md', { waitUntil: 'load' });
await p.waitForSelector('body[data-ready="1"]');
check('title', (await p.title()) === 'showcase.md — Markly', await p.title());
check('toc entries', (await p.$$eval('#toc-list a', (a) => a.length)) >= 10);
check('tables wrapped', (await p.$$eval('.table-wrap', (a) => a.length)) === 2);
check('wide table scrolls', await p.$$eval('.table-wrap', (a) => a[1].scrollWidth > a[1].clientWidth));
check('task checkboxes', (await p.$$eval('.task-list-item-checkbox', (a) => a.length)) === 5);
check('alerts', (await p.$$eval('.markdown-alert', (a) => a.length)) === 5);
check('footnotes', (await p.$$eval('.footnotes li', (a) => a.length)) === 1);
check('katex rendered', (await p.$$eval('.katex', (a) => a.length)) >= 3);
check('mermaid svgs', (await p.$$eval('.mermaid-block svg', (a) => a.length)) === 2);
check('hljs tokens', (await p.$$eval('.hljs-keyword', (a) => a.length)) > 5);
check('emoji', (await p.$eval('#mk-content', (c) => c.textContent.includes('🚀'))));
check('mark', (await p.$$eval('mark', (a) => a.length)) >= 1);
check('front matter table', (await p.$$eval('.fm-table tr', (a) => a.length)) === 5);
check('hebrew rtl', await p.$eval('#mk-content', (c) => [...c.querySelectorAll('p')].some((x) => /[\u0590-\u05FF]/.test(x.textContent) && getComputedStyle(x).direction === 'rtl')));
check('image resolved', await p.$eval('img', (i) => i.naturalWidth > 0 && i.getAttribute('src') === '/samples/images/banner.svg'));

// find
await p.keyboard.down('Control'); await p.keyboard.press('f'); await p.keyboard.up('Control');
await p.type('#find-input', 'markly');
await new Promise((r) => setTimeout(r, 300));
const cnt = await p.$eval('#find-count', (e) => e.textContent);
check('find count', /\d+ \/ \d+/.test(cnt), cnt);
await p.keyboard.press('Enter');
const cnt2 = await p.$eval('#find-count', (e) => e.textContent);
check('find next', cnt2 !== cnt, cnt2);
await p.keyboard.press('Escape');
check('find closes', await p.$eval('#mk-findbar', (e) => e.hidden));

// zoom
await p.keyboard.down('Control'); await p.keyboard.press('Equal'); await p.keyboard.up('Control');
check('zoom in', (await p.$eval('#btn-zoom-reset', (e) => e.textContent)) === '110%');
await p.keyboard.down('Control'); await p.keyboard.press('Digit0'); await p.keyboard.up('Control');
check('zoom reset', (await p.$eval('#btn-zoom-reset', (e) => e.textContent)) === '100%');

// toc toggle
await p.keyboard.down('Control'); await p.keyboard.press('Backslash'); await p.keyboard.up('Control');
check('toc toggle hides', await p.$eval('#mk-toc', (e) => getComputedStyle(e).display === 'none'));
await p.click('#btn-toc');
check('toc toggle shows', await p.$eval('#mk-toc', (e) => getComputedStyle(e).display !== 'none'));

// theme cycle
const t0 = await p.$eval('html', (h) => h.dataset.pref);
await p.click('#btn-theme');
const t1 = await p.$eval('html', (h) => [h.dataset.pref, h.dataset.theme].join('/'));
await p.click('#btn-theme');
const t2 = await p.$eval('html', (h) => [h.dataset.pref, h.dataset.theme].join('/'));
check('theme cycle', t1 === 'light/light' && t2 === 'dark/dark', `${t0} -> ${t1} -> ${t2}`);

// TOC click scrolls
await p.click('#toc-list a[data-id="math"]');
await new Promise((r) => setTimeout(r, 900));
check('toc click scrolls', await p.$eval('#mk-scroller', (e) => e.scrollTop > 500));

// relative md link navigation + back
await p.evaluate(() => document.getElementById('mk-scroller').scrollTo(0, 0));
await p.click('a[href="other.md#welcome-back"]');
await p.waitForFunction(() => document.title.startsWith('other.md'));
check('relative md link opens', true, await p.title());
await p.keyboard.down('Alt'); await p.keyboard.press('ArrowLeft'); await p.keyboard.up('Alt');
await p.waitForFunction(() => document.title.startsWith('showcase.md'));
check('alt+left goes back', true);

// copy path / content
check('copy enabled with a file', await p.$eval('#btn-copy', (e) => !e.disabled));
check('copy button next to find', await p.$eval('#btn-find', (e) => e.nextElementSibling?.querySelector('#btn-copy') !== null));
await p.click('#btn-copy');
check('copy menu opens', await p.$eval('#copy-menu', (e) => !e.hidden && e.querySelectorAll('.copy-item').length === 2));
check('copy menu shows path', (await p.$eval('#copy-path-sub', (e) => e.textContent)) === '/samples/showcase.md');
await p.click('#copy-path');
await sleep(100);
check('copy path', (await clip()) === '/samples/showcase.md', JSON.stringify(await clip()));
check('copy menu closes', await p.$eval('#copy-menu', (e) => e.hidden));
check('copy confirmation', await p.evaluate(() => document.getElementById('btn-copy').classList.contains('done') && document.getElementById('mk-toast').textContent === 'Copied path'));
await p.evaluate(() => navigator.clipboard.writeText('-'));
await p.click('#btn-copy');
await p.click('#copy-content');
await sleep(100);
const raw = fs.readFileSync(path.join(ROOT, 'samples/showcase.md'), 'utf8');
const got = await clip();
check('copy content is the raw markdown', got === raw, `${got.length}/${raw.length} chars`);
await p.evaluate(() => navigator.clipboard.writeText('-'));
await p.keyboard.down('Control'); await p.keyboard.down('Shift'); await p.keyboard.press('KeyC'); await p.keyboard.up('Shift'); await p.keyboard.up('Control');
await sleep(100);
check('ctrl+shift+c copies path', (await clip()) === '/samples/showcase.md');
await p.click('#btn-copy');
await p.keyboard.press('Escape');
check('escape closes copy menu', await p.$eval('#copy-menu', (e) => e.hidden));
await p.click('#btn-copy');
await p.click('#btn-recent');
check('recent closes copy menu', await p.$eval('#copy-menu', (e) => e.hidden));
await p.click('#btn-recent');

// recent menu
await p.click('#btn-recent');
check('recent menu lists files', (await p.$$eval('#recent-menu .recent-item', (a) => a.length)) >= 2);

// sanitizer
await p.evaluate(() => window.__marklyOpen('/tests/xss-test.md'));
await new Promise((r) => setTimeout(r, 500));
check('scripts stripped', await p.evaluate(() => !document.querySelector('#mk-content script') && !document.querySelector('#mk-content [onerror]') && !window.__pwned));

console.log(results.join('\n'));
if (errs.length) console.log('PAGE ERRORS:', errs);
await b.close(); s.close();
