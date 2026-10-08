// Records a Chrome trace of loading a document and summarizes main-thread time by event type.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import puppeteer from 'puppeteer-core';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const doc = process.argv[2] || '/tests/fixtures/plain.md';
const T = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.md': 'text/markdown', '.woff2': 'font/woff2' };
const s = http.createServer((q, r) => { const u = decodeURIComponent(new URL(q.url, 'http://x').pathname); fs.readFile(path.join(ROOT, u), (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': T[path.extname(u)] || 'application/octet-stream' }); r.end(d); }); }).listen(0);
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const wc = await b.createBrowserContext(); const w = await wc.newPage(); await w.goto(`http://localhost:${s.address().port}/dist-web/index.html`, { waitUntil: 'load' }); await w.waitForSelector('#mk-welcome:not([hidden])'); await wc.close();
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 860 });
await p.tracing.start({ path: '/tmp/trace.json', categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8.execute', 'blink'] });
await p.goto(`http://localhost:${s.address().port}/dist-web/index.html?file=${doc}`, { waitUntil: 'load' });
await p.waitForSelector('body[data-ready="1"]');
await new Promise((r) => setTimeout(r, 300));
await p.tracing.stop();
await b.close(); s.close();
const ev = JSON.parse(fs.readFileSync('/tmp/trace.json', 'utf8')).traceEvents;
const main = ev.find((e) => e.name === 'thread_name' && e.args.name === 'CrRendererMain');
const tot = {};
for (const e of ev) {
  if (e.ph !== 'X' || !main || e.pid !== main.pid || e.tid !== main.tid || !e.dur) continue;
  tot[e.name] = (tot[e.name] || 0) + e.dur / 1000;
}
const nav = ev.find((e) => e.name === 'navigationStart') || ev.filter((e) => e.pid === main.pid && e.ts).sort((a, b) => a.ts - b.ts)[0];
if (process.env.TIMELINE) for (const e of ev) {
  if (e.ph === 'X' && e.pid === main.pid && e.tid === main.tid && e.dur > 8000 && /Layout|EvaluateScript|v8.evaluateModule|FunctionCall|ParseHTML|UpdateStyle|RecalculateStyles|TimerFire|FireAnimationFrame|Paint|XHR|ResourceReceive|RunMicrotasks/.test(e.name))
    console.log(((e.ts - nav.ts) / 1000).toFixed(1).padStart(8), (e.dur / 1000).toFixed(1).padStart(7), e.name, e.args?.data?.url || e.args?.data?.functionName || '');
}
console.log(Object.entries(tot).sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, v]) => `${v.toFixed(1).padStart(8)} ms  ${k}`).join('\n'));
