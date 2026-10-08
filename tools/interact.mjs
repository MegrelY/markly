// Headless interaction checks for the frontend (browser host mode).
import puppeteer from 'puppeteer-core';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { maybeServeList } from './dev-list.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const T = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.md': 'text/markdown', '.woff2': 'font/woff2' };
const s = http.createServer((q, r) => { if (maybeServeList(ROOT, q, r)) return; const u = decodeURIComponent(new URL(q.url, 'http://x').pathname); fs.readFile(path.join(ROOT, u), (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': T[path.extname(u)] || 'application/octet-stream' }); r.end(d); }); }).listen(0);
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
await p.click('#btn-files');
await p.waitForFunction(() => document.querySelector('#mk-files .fb-path')?.textContent.replace(/\u200E/g, '') === '/' && document.querySelectorAll('#mk-files .fb-item').length > 3, { timeout: 5000 });
check('folder browser works without a document (starts at home)', true);
await p.click('#btn-files');

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

// folder browser
await p.keyboard.press('Escape');
await p.evaluate(() => window.__marklyOpen('/samples/showcase.md'));
await p.waitForFunction(() => document.title.startsWith('showcase.md'));
const TMP = path.join(ROOT, 'tests/_fb_tmp');
try { fs.chmodSync(path.join(TMP, 'locked'), 0o755); } catch { /* not there */ }
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(path.join(TMP, 'empty'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'locked'));
fs.writeFileSync(path.join(TMP, 'a.md'), '# A\n');
for (const n of ['B.md', 'a10.md', 'a2.md']) fs.writeFileSync(path.join(TMP, n), '# x\n');
fs.writeFileSync(path.join(TMP, '.hidden.md'), '# hidden\n');
fs.writeFileSync(path.join(TMP, 'notes.txt.bak'), 'x');
fs.chmodSync(path.join(TMP, 'locked'), 0o000);
const fb = {
  names: () => p.$$eval('#mk-files .fb-item', (a) => a.map((x) => x.querySelector('.fb-name').textContent)),
  path: () => p.$eval('#mk-files .fb-path', (e) => e.textContent.replace(/\u200E/g, '')),
  waitPath: (want) => p.waitForFunction((w) => document.querySelector('#mk-files .fb-path')?.textContent.replace(/\u200E/g, '') === w, { timeout: 5000 }, want),
  sel: () => p.$eval('#mk-files .fb-item.sel .fb-name', (e) => e.textContent).catch(() => null),
};
check('files button between toc and open', await p.evaluate(() => document.getElementById('btn-toc').nextElementSibling.id === 'btn-files' && document.getElementById('btn-files').nextElementSibling.id === 'btn-open'));
check('folder browser not loaded at startup', await p.evaluate(() => !document.getElementById('mk-files') && !document.querySelector('link[href="files.css"]') && !performance.getEntriesByType('resource').some((r) => /\/files[-.]/.test(r.name))));
await p.click('#btn-files');
await p.waitForSelector('#mk-files .fb-item.current');
check('panel opens on the right', await p.evaluate(() => { const f = document.getElementById('mk-files').getBoundingClientRect(); return f.width >= 200 && Math.abs(f.right - innerWidth) < 2; }));
check('panel shows current folder', (await fb.path()) === '/samples', await fb.path());
check('breadcrumbs', JSON.stringify(await p.$$eval('#mk-files .fb-crumb', (a) => a.map((x) => x.textContent))) === '["/","samples"]');
check('folders first', JSON.stringify(await fb.names()) === '["images","other.md","showcase.md"]', JSON.stringify(await fb.names()));
check('current file highlighted', (await p.$eval('#mk-files .fb-item.current .fb-name', (e) => e.textContent)) === 'showcase.md');
check('markdown files accent', await p.$eval('#mk-files .fb-item.md:not(.current) .fb-name', (e) => { const t = document.createElement('span'); t.style.color = 'var(--accent)'; document.body.appendChild(t); const accent = getComputedStyle(t).color; t.remove(); return getComputedStyle(e).color === accent; }));
await p.click('#mk-files .fb-item.dir');
check('single click on folder only selects', (await fb.path()) === '/samples' && (await fb.sel()) === 'images');
await p.click('#mk-files .fb-item.dir', { count: 2 });
await fb.waitPath('/samples/images');
check('double click enters folder', true);
check('other files dimmed', await p.$eval('#mk-files .fb-item.other', (e) => +getComputedStyle(e).opacity < 0.7));
await p.click('#mk-files .fb-item.other', { count: 2 });
await sleep(300);
check('other files never opened', (await p.title()).startsWith('showcase.md'));
await p.click('#mk-files .fb-up');
await fb.waitPath('/samples');
check('up button returns and selects folder', (await fb.sel()) === 'images');
await p.click('#mk-files .fb-item.md:not(.current)');
await p.waitForFunction(() => document.title.startsWith('other.md'));
check('single click opens markdown in same window', (await p.$eval('#mk-files .fb-item.current .fb-name', (e) => e.textContent)) === 'other.md');
await p.click('#mk-files button.fb-crumb[data-path="/"]');
await fb.waitPath('/');
check('breadcrumb navigates', (await fb.names()).includes('samples'));
check('hidden files not listed', !(await fb.names()).some((n) => n.startsWith('.')));
await p.evaluate(() => window.__marklyOpen('/tests/_fb_tmp/a.md'));
await fb.waitPath('/tests/_fb_tmp');
check('follows the current file', (await p.$eval('#mk-files .fb-item.current .fb-name', (e) => e.textContent)) === 'a.md');
check('hidden markdown not listed', !(await fb.names()).includes('.hidden.md'));
await p.click('#mk-files .fb-filter');
check('only-markdown filter, natural case-insensitive sort', JSON.stringify(await fb.names()) === '["empty","locked","a.md","a2.md","a10.md","B.md"]' && (await p.$eval('#mk-files .fb-filter', (e) => e.getAttribute('aria-pressed'))) === 'true', JSON.stringify(await fb.names()));
await p.click('#mk-files .fb-filter');
check('filter off shows other files', (await fb.names()).includes('notes.txt.bak'));
// keyboard: Home -> "empty", Enter enters, Backspace goes up, type-ahead, Enter opens
await p.focus('#mk-files .fb-list');
await p.keyboard.press('Home');
check('keyboard home', (await fb.sel()) === 'empty');
await p.keyboard.press('Enter');
await fb.waitPath('/tests/_fb_tmp/empty');
check('empty folder state', (await p.$eval('#mk-files .fb-empty', (e) => e.textContent)) === 'This folder is empty');
await p.keyboard.press('Backspace');
await fb.waitPath('/tests/_fb_tmp');
check('keyboard backspace goes up', (await fb.sel()) === 'empty');
await p.keyboard.press('ArrowDown');
check('keyboard arrow down', (await fb.sel()) === 'locked');
await p.keyboard.press('ArrowRight');
await p.waitForSelector('#mk-files .fb-error');
check('permission denied state', (await p.$eval('#mk-files .fb-error strong', (e) => e.textContent)).includes('permission'));
await p.click('#mk-files .fb-up');
await fb.waitPath('/tests/_fb_tmp');
await p.focus('#mk-files .fb-list');
await p.keyboard.press('Home');
await p.keyboard.type('a');
check('type-ahead', (await fb.sel()) === 'a.md');
await p.evaluate(() => window.__marklyOpen('/samples/showcase.md'));
await fb.waitPath('/samples');
await p.focus('#mk-files .fb-list');
await p.keyboard.type('o');
await p.keyboard.press('Enter');
await p.waitForFunction(() => document.title.startsWith('other.md'));
check('keyboard enter opens markdown, focus stays', await p.evaluate(() => document.activeElement?.classList.contains('fb-list')));
await p.click('#mk-files .fb-copy');
await sleep(100);
check('copy folder path', (await clip()) === '/samples');
// resize + remembered state
const w0 = await p.$eval('#mk-files', (e) => e.getBoundingClientRect().width);
const hb = await p.$eval('#mk-files .fb-resize', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 200 }; });
await p.mouse.move(hb.x, hb.y); await p.mouse.down(); await p.mouse.move(hb.x - 80, hb.y, { steps: 5 }); await p.mouse.up();
const w1 = await p.$eval('#mk-files', (e) => e.getBoundingClientRect().width);
check('panel resizable', Math.abs(w1 - w0 - 80) <= 2, `${w0} -> ${w1}`);
await p.keyboard.down('Control'); await p.keyboard.down('Shift'); await p.keyboard.press('KeyE'); await p.keyboard.up('Shift'); await p.keyboard.up('Control');
check('ctrl+shift+e closes panel', await p.$eval('#mk-files', (e) => e.hidden));
await p.keyboard.down('Control'); await p.keyboard.down('Shift'); await p.keyboard.press('KeyE'); await p.keyboard.up('Shift'); await p.keyboard.up('Control');
await p.waitForSelector('#mk-files:not([hidden]) .fb-item.current');
check('ctrl+shift+e opens panel', true);
await p.goto(base + '?file=/samples/showcase.md', { waitUntil: 'load' });
await p.waitForSelector('#mk-files:not([hidden]) .fb-item.current', { timeout: 5000 });
const w2 = await p.$eval('#mk-files', (e) => e.getBoundingClientRect().width);
check('open state and width remembered', Math.abs(w2 - w1) <= 1, `${w2}`);
await p.click('#btn-files');
check('toolbar button closes panel', await p.$eval('#mk-files', (e) => e.hidden));
fs.chmodSync(path.join(TMP, 'locked'), 0o755);
fs.rmSync(TMP, { recursive: true, force: true });

// sanitizer
await p.evaluate(() => window.__marklyOpen('/tests/xss-test.md'));
await new Promise((r) => setTimeout(r, 500));
check('scripts stripped', await p.evaluate(() => !document.querySelector('#mk-content script') && !document.querySelector('#mk-content [onerror]') && !window.__pwned));

console.log(results.join('\n'));
if (errs.length) console.log('PAGE ERRORS:', errs);
await b.close(); s.close();
