// Renders documents with two builds (dist dirs) in headless Chrome and compares the resulting
// #mk-content HTML. Usage: node tools/html-equiv.mjs <distA> <distB> <doc.md>...
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import puppeteer from 'puppeteer-core';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const [A, B, ...docs] = process.argv.slice(2);
const T = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.md': 'text/markdown', '.woff2': 'font/woff2' };
function serve(dist) {
  return http.createServer((q, r) => {
    const u = decodeURIComponent(new URL(q.url, 'http://x').pathname);
    const p = u.startsWith('/app/') ? path.join(dist, u.slice(5)) : path.join(ROOT, u);
    fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': T[path.extname(p)] || 'application/octet-stream' }); r.end(d); });
  }).listen(0);
}
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
async function html(srv, doc) {
  const p = await b.newPage();
  await p.evaluateOnNewDocument(() => localStorage.setItem('markly.theme', 'light'));
  await p.goto(`http://localhost:${srv.address().port}/app/index.html?file=${encodeURIComponent(doc)}`, { waitUntil: 'load' });
  await p.waitForSelector('body[data-ready="1"]', { timeout: 30000 });
  // mermaid ids are a global counter; normalize them
  const h = await p.$eval('#mk-content', (c) => c.innerHTML.replace(/mmd-\d+/g, 'mmd-N'));
  const toc = await p.$eval('#toc-list', (c) => c.innerHTML);
  await p.close();
  return h + '\n<!--toc-->\n' + toc;
}
const sa = serve(path.resolve(A)), sb = serve(path.resolve(B));
let bad = 0;
for (const d of docs) {
  const [x, y] = [await html(sa, d), await html(sb, d)];
  if (x === y) console.log(`IDENTICAL ${d} (${x.length} chars)`);
  else {
    bad++;
    let i = 0; while (x[i] === y[i]) i++;
    console.log(`DIFFERENT ${d} at ${i}:\n A: ${x.slice(Math.max(0, i - 80), i + 120)}\n B: ${y.slice(Math.max(0, i - 80), i + 120)}`);
  }
}
await b.close(); sa.close(); sb.close();
process.exitCode = bad ? 1 : 0;
