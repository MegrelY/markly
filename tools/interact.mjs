// Headless interaction checks for the frontend (browser host mode).
import puppeteer from 'puppeteer-core';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { maybeServeList, maybeServeGit } from './dev-list.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const T = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.md': 'text/markdown', '.woff2': 'font/woff2' };
const s = http.createServer((q, r) => { if (maybeServeList(ROOT, q, r) || maybeServeGit(ROOT, q, r)) return; const u = decodeURIComponent(new URL(q.url, 'http://x').pathname); fs.readFile(path.join(ROOT, u), (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': T[path.extname(u)] || 'application/octet-stream' }); r.end(d); }); }).listen(0);
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

// ---------------------------------------------------------------- file history (git fixture)
{
  const { execFileSync } = await import('node:child_process');
  const FX = path.join(ROOT, 'tests/_git_fixture');
  execFileSync('bash', [path.join(ROOT, 'tools/make-git-fixture.sh'), FX, '--dirty']);
  fs.writeFileSync(path.join(FX, 'untracked.md'), '# Not committed\n');
  const FILE = '/tests/_git_fixture/docs/Guides ü/User guide.md';
  const hk = async () => { await p.keyboard.down('Control'); await p.keyboard.down('Shift'); await p.keyboard.press('KeyH'); await p.keyboard.up('Shift'); await p.keyboard.up('Control'); };
  const settled = () => p.waitForFunction(() => { const d = document.querySelector('.hs-diff'); return d && !d.classList.contains('busy') && d.querySelector('.hs-stat, .hs-empty, .df-note'); }, { timeout: 8000 });
  const pickRow = async (i, mods = []) => { for (const m of mods) await p.keyboard.down(m); await p.click(`.hs-item[data-i="${i}"]`); for (const m of mods) await p.keyboard.up(m); await sleep(150); await settled(); };

  await p.goto(base + '?file=' + encodeURIComponent('/tests/_git_fixture/untracked.md') + '&git=1', { waitUntil: 'load' });
  await p.waitForSelector('body[data-ready="1"]'); await sleep(300);
  check('history button hidden for untracked file', await p.$eval('#btn-history', (e) => e.hidden));
  await hk(); await sleep(150);
  check('history shortcut explains when not tracked', /Git repository/.test(await p.$eval('#mk-toast', (e) => e.textContent)));

  await p.goto(base + '?file=' + encodeURIComponent(FILE) + '&git=1', { waitUntil: 'load' });
  await p.waitForSelector('body[data-ready="1"]');
  await p.waitForSelector('#btn-history:not([hidden])', { timeout: 5000 });
  check('history button shown for tracked file', true);
  check('history button title', await p.$eval('#btn-history', (e) => e.title) === 'File history (Ctrl+Shift+H)');
  check('history code not loaded until used', await p.evaluate(() => !performance.getEntriesByType('resource').some((r) => /history/.test(r.name)) && !document.querySelector('link[href="history.css"]')));
  await hk();
  await p.waitForSelector('#mk-history:not([hidden]) .hs-item.sel'); await settled();
  check('ctrl+shift+h opens history', true);
  const rows = await p.$$eval('.hs-item', (els) => els.map((e) => e.querySelector('.hs-subj').textContent));
  check('commits listed newest first, with uncommitted entry', JSON.stringify(rows) === JSON.stringify(['Uncommitted changes', 'Add a shortcuts table', 'Clarify wording', 'Move the guide into docs/', 'Expand install steps, add Open files', 'Add the guide']), JSON.stringify(rows));
  check('history follows the rename', /Renamed from guide\.md/.test(await p.$eval('.hs-item[data-i="3"]', (e) => e.textContent)));
  const meta = await p.$eval('.hs-item[data-i="2"]', (e) => ({ hash: e.querySelector('.hs-hash').textContent, author: e.querySelector('.hs-author').textContent, rel: e.querySelector('.hs-date').textContent, abs: e.querySelector('.hs-abs').textContent }));
  const expAbs = await p.evaluate(() => new Date(Date.parse('2026-10-05T14:22:00+03:00')).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }));
  check('commit row: short hash, author, relative + local date', /^[0-9a-f]{7,}$/.test(meta.hash) && meta.author === 'Dana Levi' && /ago|week|month|day/.test(meta.rel) && meta.abs === expAbs, JSON.stringify(meta));
  check('uncommitted changes selected first', await p.$eval('.hs-item.sel', (e) => e.classList.contains('hs-wt')) && /Unstaged/i.test(await p.$eval('.hs-item.sel', (e) => e.textContent)));
  check('uncommitted diff with word highlight', await p.$$eval('.df-add .wd', (w) => w.some((x) => x.textContent.includes('and private'))));

  await pickRow(2);
  const u = await p.evaluate(() => ({
    del: document.querySelectorAll('tr.df-del').length, add: document.querySelectorAll('tr.df-add').length,
    hunk: document.querySelector('.df-hunk')?.textContent.trim(), stat: document.querySelector('.hs-stat')?.textContent,
    nums: [...document.querySelectorAll('tr.df-del .df-ln')].map((t) => t.dataset.n).join(','),
    words: [...document.querySelectorAll('tr.df-add .wd')].map((w) => w.textContent),
    title: document.querySelector('.hs-dtitle').textContent,
  }));
  check('commit diff: unified rows, hunk header, line numbers', u.del === 3 && u.add === 3 && u.hunk.startsWith('@@ -1,12 +1,12 @@') && u.nums.startsWith('3,,8,,12,') && u.title === 'Clarify wording', JSON.stringify(u));
  check('commit diff: +/- stats and word-level highlights', /\+3.*−3/.test(u.stat) && u.words.includes('start') && u.words.includes('onto'), JSON.stringify(u.words));
  await p.click('.hs-mode[data-split="1"]');
  const sp = await p.evaluate(() => ({ split: !!document.querySelector('table.df-split'), pairs: [...document.querySelectorAll('tr.df-pair')].filter((r) => r.querySelector('td.df-del') && r.querySelector('td.df-add')).length }));
  check('split view pairs removed and added lines', sp.split && sp.pairs === 3, JSON.stringify(sp));
  check('split preference remembered', await p.evaluate(() => localStorage.getItem('markly.history.split')) === 'true');
  await p.click('.hs-mode[data-split="0"]');
  check('back to unified view', await p.$$eval('table.df-split', (t) => t.length) === 0);

  await pickRow(3);
  check('rename commit shown as rename', /File renamed/.test(await p.$eval('.hs-stat', (e) => e.textContent)) && /Renamed without changes/.test(await p.$eval('.hs-diff', (e) => e.textContent)));
  await pickRow(5);
  check('first commit shows the file as added', /\+7.*File added/.test(await p.$eval('.hs-stat', (e) => e.textContent)), await p.$eval('.hs-stat', (e) => e.textContent));
  await pickRow(1, ['Control']);
  const cmpTitle = await p.$eval('.hs-dtitle', (e) => e.textContent);
  const cmpAdds = await p.$$eval('tr.df-add', (r) => r.length);
  const cmpDels = await p.$$eval('tr.df-del', (r) => r.length);
  const cmpStat = await p.$eval('.hs-stat', (e) => e.textContent);
  check('ctrl+click compares two commits', cmpTitle === 'Comparing two commits' && await p.$$eval('.hs-item.cmp', (e) => e.length) === 1, cmpTitle);
  check('comparison across the rename diffs the two versions', cmpAdds === 15 && cmpDels === 2 && !/File added/.test(cmpStat) && cmpStat.includes('docs/Guides ü/User guide.md'), `${cmpAdds} ${cmpDels} ${cmpStat}`);
  await p.click('[data-act="uncompare"]'); await settled();
  check('leave comparison', await p.$$eval('.hs-item.cmp', (e) => e.length) === 0);

  await p.click('.hs-item[data-i="2"] .hs-hash'); await sleep(150);
  const full = await clip();
  check('copy commit hash', /^[0-9a-f]{40}$/.test(full) && full.startsWith(meta.hash), full);

  // keyboard: up/down moves, Enter shows the file at that commit
  await p.focus('.hs-list');
  await p.keyboard.press('Home'); await p.keyboard.press('ArrowDown'); await sleep(200); await settled();
  check('Home / arrow keys move the selection', await p.$eval('.hs-item.sel', (e) => e.dataset.i) === '1');
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown');
  await sleep(200); await settled();
  await p.keyboard.press('Enter');
  await p.waitForSelector('#mk-revbar', { timeout: 5000 }); await sleep(200);
  const rv = await p.evaluate(() => ({ hidden: document.getElementById('mk-history').hidden, text: document.getElementById('mk-content').textContent, bar: document.getElementById('mk-revbar').textContent }));
  check('view file at commit (rendered, read-only banner)', rv.hidden && rv.text.includes('or drop it on the window') && !rv.text.includes('Shortcuts') && /Expand install steps/.test(rv.bar) && /Read-only/i.test(rv.bar), rv.bar.replace(/\s+/g, ' '));
  await p.click('#mk-revbar [data-act="history"]');
  await p.waitForSelector('#mk-history:not([hidden])');
  check('back to history keeps the selection', await p.$eval('.hs-item.sel', (e) => e.dataset.i) === '4');
  await p.keyboard.press('Escape');
  check('esc closes history', await p.$eval('#mk-history', (e) => e.hidden) && !!(await p.$('#mk-revbar')));
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !document.getElementById('mk-revbar'), { timeout: 5000 }).catch(() => {}); await sleep(100);
  check('esc returns to the current version', !(await p.$('#mk-revbar')) && (await p.$eval('#mk-content', (e) => e.textContent)).includes('and private'));
  await p.click('#btn-history'); await p.waitForSelector('#mk-history:not([hidden]) .hs-item.sel'); await settled();
  await pickRow(2); await p.click('[data-act="view"]'); await p.waitForSelector('#mk-revbar'); await sleep(300);
  await p.click('#mk-revbar [data-act="current"]');
  await p.waitForFunction(() => !document.getElementById('mk-revbar'), { timeout: 5000 }).catch(() => {}); await sleep(100);
  check('return to current version button', !(await p.$('#mk-revbar')) && (await p.$eval('#mk-content', (e) => e.textContent)).includes('Shortcuts'));
  await p.click('#btn-history'); await p.waitForSelector('#mk-history:not([hidden])');
  await p.click('#btn-history');
  check('toolbar button closes history', await p.$eval('#mk-history', (e) => e.hidden));
  fs.rmSync(FX, { recursive: true, force: true });
}

// sanitizer
await p.evaluate(() => window.__marklyOpen('/tests/xss-test.md'));
await new Promise((r) => setTimeout(r, 500));
check('scripts stripped', await p.evaluate(() => !document.querySelector('#mk-content script') && !document.querySelector('#mk-content [onerror]') && !window.__pwned));

console.log(results.join('\n'));
if (errs.length) console.log('PAGE ERRORS:', errs);
await b.close(); s.close();
