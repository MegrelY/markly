// Reproducible frontend performance benchmark (headless Chrome, browser-host mode).
// Usage: [DIST=dir] [BENCH_DOCS=plain,showcase] node tools/bench.mjs [runs=7] [outJson]
// Measures per document: time to first content (content inserted into #mk-content) and time to
// "ready" (math + diagrams finished), measured from navigation start; bytes fetched; JS heap after GC;
// renderer process memory (RSS / PSS). Also reports startup vs lazy bundle sizes of dist-web/.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const RUNS = +(process.argv[2] || 7);
const OUT = process.argv[3];
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const DIST = path.resolve(process.env.DIST || path.join(ROOT, 'dist-web')); // build to measure
const ALL_DOCS = { showcase: '/samples/showcase.md', plain: '/tests/fixtures/plain.md' };
const DOCS = process.env.BENCH_DOCS ? Object.fromEntries(process.env.BENCH_DOCS.split(',').map((k) => [k, ALL_DOCS[k]])) : ALL_DOCS;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.md': 'text/markdown; charset=utf-8' };

let log = [];
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const p = u.startsWith('/dist-web/') ? path.join(DIST, u.slice('/dist-web/'.length)) : path.join(ROOT, u);
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    log.push({ path: u, bytes: data.length, t: Date.now() });
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  });
}).listen(0);
const port = server.address().port;

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function procMem(rootPid) {
  // walk /proc to find renderer descendants of the browser process
  const kids = {};
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const st = fs.readFileSync(`/proc/${d}/stat`, 'utf8');
      const ppid = +st.slice(st.lastIndexOf(')') + 2).split(' ')[1];
      (kids[ppid] ||= []).push(+d);
    } catch { /* gone */ }
  }
  const all = []; const q = [rootPid];
  while (q.length) { const p = q.shift(); all.push(p); q.push(...(kids[p] || [])); }
  let rss = 0, pss = 0; // the page's renderer = the largest renderer process
  for (const p of all) {
    try {
      const cmd = fs.readFileSync(`/proc/${p}/cmdline`, 'utf8');
      if (!cmd.includes('--type=renderer')) continue;
      const sr = fs.readFileSync(`/proc/${p}/smaps_rollup`, 'utf8');
      const r = +(/^Rss:\s+(\d+)/m.exec(sr)[1]), ps = +(/^Pss:\s+(\d+)/m.exec(sr)[1]);
      if (ps > pss) { pss = ps; rss = r; }
    } catch { /* ignore */ }
  }
  return { rssKB: rss, pssKB: pss };
}

async function runOnce(doc) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--enable-precise-memory-info', '--disable-features=SpareRendererForSitePerProcess'] });
  // Warm up process-wide caches (system font fallback, GPU/raster init) on a throwaway page so the
  // measured page reflects app costs rather than one-time browser start-up costs.
  // The warm-up page loads the app's welcome screen (same font stacks) in a separate context.
  const wctx = await browser.createBrowserContext();
  const warm = await wctx.newPage();
  await warm.goto(`http://localhost:${port}/dist-web/index.html`, { waitUntil: 'load' });
  await warm.waitForSelector('#mk-welcome:not([hidden])');
  await wctx.close();
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('markly.theme', 'light'); localStorage.setItem('markly.toc', '1');
    window.__bench = {};
    new MutationObserver((_, obs) => {
      const c = document.getElementById('mk-content');
      if (c && c.childElementCount && !window.__bench.content) {
        window.__bench.content = performance.now();
        // two animation frames later the inserted content has been styled, laid out and painted
        requestAnimationFrame(() => requestAnimationFrame(() => { window.__bench.paint = performance.now(); }));
      }
      if (document.body && document.body.dataset.ready === '1' && !window.__bench.ready) { window.__bench.ready = performance.now(); obs.disconnect(); }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-ready'] });
  });
  log = [];
  await page.goto(`http://localhost:${port}/dist-web/index.html?file=${encodeURIComponent(doc)}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__bench.ready && window.__bench.paint, { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 600));
  const t = await page.evaluate(() => window.__bench);
  const cdp = await page.target().createCDPSession();
  await cdp.send('HeapProfiler.collectGarbage');
  await new Promise((r) => setTimeout(r, 200));
  await cdp.send('Performance.enable');
  const { metrics } = await cdp.send('Performance.getMetrics');
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  const mem = procMem(browser.process().pid);
  const fetched = log.filter((l) => !l.path.endsWith('.md'));
  const res = {
    contentMs: t.content, paintMs: t.paint, readyMs: t.ready,
    jsHeapMB: (m.JSHeapUsedSize || 0) / 1048576,
    rendererRssMB: mem.rssKB / 1024, rendererPssMB: mem.pssKB / 1024,
    requests: fetched.length, fetchedKB: fetched.reduce((s, l) => s + l.bytes, 0) / 1024,
    files: fetched.map((l) => l.path.replace('/dist-web/', '')),
  };
  await browser.close();
  return res;
}

function bundleSizes() {
  const dir = DIST;
  const files = [];
  (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : files.push(path.relative(dir, p)); } })(dir);
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const initial = new Set(['index.html']);
  for (const m of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) initial.add(m[1]);
  // static import closure of JS entry points
  const q = [...initial].filter((f) => f.endsWith('.js'));
  while (q.length) {
    const f = q.shift();
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/(?:^|[;}\s])(?:import\s*(?:[\w{},*\s$]+from\s*)?|export\s*[\w{},*\s$]*from\s*)["']([^"']+\.js)["']/g)) {
      const rel = path.normalize(path.join(path.dirname(f), m[1]));
      if (!initial.has(rel)) { initial.add(rel); q.push(rel); }
    }
  }
  const sum = (list, ext) => list.filter((f) => !ext || f.endsWith(ext)).reduce((s, f) => s + fs.statSync(path.join(dir, f)).size, 0);
  const gz = (list) => list.reduce((s, f) => s + zlib.gzipSync(fs.readFileSync(path.join(dir, f))).length, 0);
  const init = [...initial];
  const lazy = files.filter((f) => !initial.has(f));
  return {
    initialFiles: init,
    initialJsKB: sum(init, '.js') / 1024, initialCssKB: sum(init, '.css') / 1024, initialGzipKB: gz(init) / 1024,
    lazyFiles: lazy.length, lazyJsKB: sum(lazy, '.js') / 1024, lazyFontKB: sum(lazy, '.woff2') / 1024, totalKB: sum(files) / 1024,
  };
}

const report = { date: new Date().toISOString(), runs: RUNS, bundle: bundleSizes(), docs: {} };
for (const [name, doc] of Object.entries(DOCS)) {
  await runOnce(doc); // warm-up (OS file cache), not counted
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await runOnce(doc));
  const med = (k) => +median(runs.map((r) => r[k])).toFixed(1);
  report.docs[name] = {
    contentMs: med('contentMs'), paintMs: med('paintMs'), readyMs: med('readyMs'), jsHeapMB: med('jsHeapMB'),
    rendererRssMB: med('rendererRssMB'), rendererPssMB: med('rendererPssMB'),
    requests: runs[0].requests, fetchedKB: +runs[0].fetchedKB.toFixed(1), files: runs[0].files,
    raw: runs.map((r) => [+r.contentMs.toFixed(1), +r.paintMs.toFixed(1), +r.readyMs.toFixed(1)]),
  };
}
server.close();
const b = report.bundle;
console.log(`bundle: startup JS ${b.initialJsKB.toFixed(1)} KB, startup CSS ${b.initialCssKB.toFixed(1)} KB, startup gzip ${b.initialGzipKB.toFixed(1)} KB, lazy JS ${b.lazyJsKB.toFixed(1)} KB in ${b.lazyFiles} files, total dist-web ${b.totalKB.toFixed(1)} KB`);
console.log('startup files:', b.initialFiles.join(' '));
for (const [n, d] of Object.entries(report.docs)) {
  console.log(`${n}: content ${d.contentMs} ms, painted ${d.paintMs} ms, ready ${d.readyMs} ms, heap ${d.jsHeapMB} MB, renderer RSS ${d.rendererRssMB} MB / PSS ${d.rendererPssMB} MB, ${d.requests} requests ${d.fetchedKB} KB`);
  console.log('   fetched:', d.files.join(' '));
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
