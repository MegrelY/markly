// Renders a sample in headless Chrome (browser host mode) and saves light/dark screenshots.
// Usage: node tools/screenshot.mjs [file=/samples/showcase.md] [outDir=dist]
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { maybeServeList, maybeServeGit } from './dev-list.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2] || '/samples/showcase.md';
const outDir = process.argv[3] || path.join(ROOT, 'dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.md': 'text/markdown; charset=utf-8', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  if (maybeServeList(ROOT, req, res) || maybeServeGit(ROOT, req, res)) return;
  let u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (u === '/' ) u = '/dist-web/index.html';
  let p = path.join(ROOT, u.startsWith('/samples') || u.startsWith('/tests') || u.startsWith('/dist-web') ? u : '/dist-web' + u);
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(0);
const port = server.address().port;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--font-render-hinting=none'] });
const errors = [];
async function shot(theme, name, opts = {}) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(`[${theme}] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${theme}] console: ${m.text()}`); });
  await page.setViewport({ width: opts.width || 1280, height: opts.height || 860, deviceScaleFactor: opts.dpr || 1.5 });
  await page.evaluateOnNewDocument((t, toc, files) => { localStorage.setItem('markly.theme', t); localStorage.setItem('markly.toc', toc); localStorage.setItem('markly.files.open', files); }, theme, opts.toc ?? '1', String(!!opts.files));
  await page.evaluateOnNewDocument((sp) => localStorage.setItem('markly.history.split', sp), String(!!opts.split));
  await page.goto(`http://localhost:${port}/dist-web/index.html?file=${encodeURIComponent(opts.file || file)}${opts.git ? '&git=1' : ''}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('body[data-ready="1"]', { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  if (opts.scrollTo) await page.evaluate((id) => { document.getElementById(id)?.scrollIntoView({ block: 'start' }); }, opts.scrollTo);
  if (opts.before) await opts.before(page);
  for (const step of opts.steps || []) {                          // e.g. [["wait", sel], ["click", sel]]
    const [kind, sel] = step;
    if (kind === 'wait') await page.waitForSelector(sel, { visible: true, timeout: 20000 });
    else if (kind === 'click') { await page.waitForSelector(sel, { visible: true, timeout: 20000 }); await page.click(sel); }
    else if (kind === 'sleep') await new Promise((r) => setTimeout(r, sel));
  }
  if (opts.click) { await page.click(opts.click); }              // e.g. open a menu
  if (opts.hover) { await page.hover(opts.hover); }
  if (opts.waitFor) { await page.waitForSelector(opts.waitFor); await page.evaluate(() => document.fonts.ready); }
  await new Promise((r) => setTimeout(r, 400));
  const out = path.join(outDir, name);
  if (opts.full) {
    // expand the scroller so the whole document is captured
    const h = await page.evaluate(() => document.getElementById('mk-scroller').scrollHeight + 44);
    await page.setViewport({ width: opts.width || 1280, height: h, deviceScaleFactor: 1 });
    await new Promise((r) => setTimeout(r, 300));
  }
  await page.screenshot({ path: out });
  const info = await page.evaluate(() => ({ ms: window.__marklyRenderMs, imgs: [...document.images].map((i) => [i.getAttribute('src'), i.naturalWidth]) }));
  console.log('saved', out, JSON.stringify(info));
  await page.close();
}
const FIX = '/tests/_git_fixture/docs/Guides ü/User guide.md';
const HIST = (extra = []) => ({ file: FIX, git: true, toc: '0', steps: [['click', '#btn-history'], ['wait', '.hs-item.sel'], ...extra, ['wait', '.hs-diff:not(.busy) .hs-stat'], ['sleep', 250]] });
const pick = (n) => [['click', `.hs-item[data-i="${n}"]`], ['sleep', 300]];
const jobs = JSON.parse(process.env.SHOTS || 'null') || [
  ['light', 'markly-light.png', {}],
  ['dark', 'markly-dark.png', { scrollTo: 'math' }],
  ['light', 'markly-copy-light.png', { click: '#btn-copy', hover: '#copy-path' }],
  ['dark', 'markly-copy-dark.png', { click: '#btn-copy', hover: '#copy-path' }],
  ['light', 'markly-files-light.png', { files: true, waitFor: '.fb-item.current' }],
  ['dark', 'markly-files-dark.png', { files: true, waitFor: '.fb-item.current' }],
  ['light', 'markly-history-light.png', HIST(pick(2))],
  ['dark', 'markly-history-dark.png', HIST(pick(2))],
  ['light', 'markly-history-split-light.png', { ...HIST(pick(2)), split: true }],
  ['dark', 'markly-history-split-dark.png', { ...HIST(pick(2)), split: true }],
  ['light', 'markly-history-uncommitted-light.png', HIST()],
  ['light', 'markly-revision-light.png', { file: FIX, git: true, toc: '1', steps: [...HIST(pick(4)).steps, ['click', '[data-act="view"]'], ['wait', '#mk-revbar'], ['sleep', 300]] }],
  ['dark', 'markly-revision-dark.png', { file: FIX, git: true, toc: '1', steps: [...HIST(pick(4)).steps, ['click', '[data-act="view"]'], ['wait', '#mk-revbar'], ['sleep', 300]] }],
];
if (jobs.some((j) => j[2]?.git)) {
  const { execFileSync } = await import('node:child_process');
  execFileSync('bash', [path.join(ROOT, 'tools/make-git-fixture.sh'), path.join(ROOT, 'tests/_git_fixture'), '--dirty']);
}
for (const [t, n, o] of jobs) await shot(t, n, o);
await browser.close();
server.close();
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exitCode = 1; }
