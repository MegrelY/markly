// Views for files that aren't Markdown: plain text, highlighted code with line numbers, CSV/TSV
// tables, pretty-printed JSON and HTML (source or a sandboxed preview). Loaded on first use (lazy
// chunk + viewer.css); the formatters (format.js, Prettier plugins) load only for the types that use
// them. Helpers from the start-up bundle come in through init(ctx) so this chunk shares no code with it.

let ctx = null;
let view = null;            // state of the file on screen

/** Files larger than this are shown as plain text: no highlighting, formatting or table. */
const MAX_RICH = 5 * 1024 * 1024;
const MAX_LINE_NUMBERS = 50000;
const MAX_ROWS = 10000;

export async function init(c) {
  ctx = c;
  if (!document.querySelector('link[href="viewer.css"]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = 'viewer.css';
    const loaded = new Promise((r) => { l.onload = l.onerror = r; });
    document.head.appendChild(l);
    await loaded;
  }
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pref = (k, d) => { const v = ctx.LS.get('view.' + k); return v == null ? d : v === '1'; };
const setPref = (k, v) => ctx.LS.set('view.' + k, v ? '1' : '0');
function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;

export const ICONS = {
  text: '<path d="M4 4h12M4 8h12M4 12h12M4 16h7"/>',
  code: '<path d="M7 5 2.5 10 7 15M13 5l4.5 5L13 15"/>',
  csv: '<rect x="3" y="4" width="14" height="12" rx="1.5"/><path d="M3 8.5h14M3 12.5h14M8 4v12"/>',
  json: '<path d="M7 3.5C5 3.5 5.5 6 5.5 7.5S4 10 3 10c1 0 2.5.5 2.5 2.5S5 16.5 7 16.5M13 3.5c2 0 1.5 2.5 1.5 4S16 10 17 10c-1 0-2.5.5-2.5 2.5s.5 4-1.5 4"/>',
  html: '<circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3c2.2 2 2.2 12 0 14M10 3c-2.2 2-2.2 12 0 14"/>',
  binary: '<path d="M5 3h7l3 3v11H5z"/><path d="M12 3v3h3M8 10v4M12 10v4"/>',
};
export const icon = (kind) => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[kind] || ICONS.text}</svg>`;

// ---------------------------------------------------------------- lines
/** Splits highlighted HTML into lines, closing and reopening the spans that cross a line break. */
function splitLines(html) {
  const out = [];
  const stack = [];
  let cur = '';
  const re = /(<span[^>]*>)|(<\/span>)|(\n)|([^<\n]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[1]) { stack.push(m[1]); cur += m[1]; }
    else if (m[2]) { stack.pop(); cur += m[2]; }
    else if (m[3]) { out.push(cur + '</span>'.repeat(stack.length)); cur = stack.join(''); }
    else cur += m[4];
  }
  out.push(cur);
  if (out.length > 1 && out[out.length - 1].replace(/<[^>]+>/g, '') === '') out.pop(); // the final newline
  return out;
}
function linesHtml(html, { numbers, wrap, prose, plain }) {
  if (plain) {
    // very large files: one text block (no per-line elements), so they still open quickly
    const count = countLines(html);
    return { html: `<div class="vw-lines ${wrap ? 'wrap' : ''} ${prose ? 'prose' : 'mono'}"><code class="hljs">${html}</code></div>`, count };
  }
  const lines = splitLines(html);
  numbers = numbers && lines.length <= MAX_LINE_NUMBERS;
  const cls = ['vw-lines', numbers ? 'nums' : '', wrap ? 'wrap' : '', prose ? 'prose' : 'mono'].filter(Boolean).join(' ');
  const w = String(lines.length).length;
  const body = lines.map((l, i) => `<div class="vl">${numbers ? `<span class="vn" data-n="${i + 1}"></span>` : ''}<span class="vc">${l}</span></div>`).join('');
  return { html: `<div class="${cls}" style="--vw-digits:${w}ch"><code class="hljs">${body}</code></div>`, count: lines.length };
}

function countLines(t) {
  let n = 1;
  for (let i = t.indexOf('\n'); i !== -1; i = t.indexOf('\n', i + 1)) n++;
  return t.endsWith('\n') ? n - 1 : n;
}

// ---------------------------------------------------------------- CSV
function sniff(text) {
  const first = text.slice(0, 4096).split('\n')[0];
  let best = ',', n = 0;
  for (const c of [',', ';', '\t', '|']) {
    let k = 0, q = false;
    for (const ch of first) { if (ch === '"') q = !q; else if (ch === c && !q) k++; }
    if (k > n) { n = k; best = c; }
  }
  return best;
}
export function parseCsv(text, sep) {
  const rows = [];
  let row = [], f = '', q = false, i = 0;
  const s = text.replace(/^\ufeff/, '');
  while (i < s.length) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; }
      f += c; i++; continue;
    }
    if (c === '"' && f === '') { q = true; i++; continue; }
    if (c === sep) { row.push(f); f = ''; i++; continue; }
    if (c === '\r' || c === '\n') {
      row.push(f); f = ''; rows.push(row); row = [];
      if (c === '\r' && s[i + 1] === '\n') i++;
      i++; continue;
    }
    f += c; i++;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const NUM = /^\s*[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?(?:[eE][-+]?\d+)?\s*%?\s*$/;
const toNum = (v) => parseFloat(v.replace(/[,%\s]/g, ''));
function tableHtml(v) {
  const { rows, sort } = v.csv;
  const head = rows[0] || [];
  const cols = Math.max(...rows.slice(0, 200).map((r) => r.length), head.length);
  let body = rows.slice(1).map((r, i) => ({ r, i }));
  if (sort) {
    const { col, dir } = sort;
    const vals = body.map((x) => x.r[col] ?? '');
    const numeric = vals.every((x) => x.trim() === '' || NUM.test(x)) && vals.some((x) => x.trim() !== '');
    const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    body.sort((a, b) => {
      const x = a.r[col] ?? '', y = b.r[col] ?? '';
      // empty cells sort last either way
      if (!x.trim() !== !y.trim()) return x.trim() ? -1 : 1;
      const d = numeric ? toNum(x) - toNum(y) : coll.compare(x, y);
      return (d || a.i - b.i) * (d ? dir : 1);
    });
  }
  const total = body.length;
  body = body.slice(0, MAX_ROWS);
  const th = Array.from({ length: cols }, (_, c) => {
    const s = sort?.col === c ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none';
    return `<th aria-sort="${s}"><button type="button" class="vw-sort" data-col="${c}" title="Sort by this column">${esc(head[c] ?? '') || '&nbsp;'}<span class="vw-arrow"></span></button></th>`;
  }).join('');
  const tr = body.map(({ r, i }) => `<tr><td class="vw-rn">${i + 1}</td>${Array.from({ length: cols }, (_, c) => {
    const x = r[c] ?? '';
    return `<td${NUM.test(x) && x.trim() ? ' class="num"' : ''}>${esc(x)}</td>`;
  }).join('')}</tr>`).join('');
  const more = total > MAX_ROWS ? `<p class="vw-more">Showing the first ${MAX_ROWS.toLocaleString()} of ${total.toLocaleString()} rows. Switch to Raw to see everything.</p>` : '';
  return `<div class="table-wrap vw-table-wrap"><table class="vw-table"><thead><tr><th class="vw-rn" aria-label="Row"></th>${th}</tr></thead><tbody>${tr}</tbody></table></div>${more}`;
}

// ---------------------------------------------------------------- HTML preview
function previewHtml(v) {
  const clean = ctx.sanitizePreview(v.doc.content, { baseDir: v.doc.dir, assetUrl: ctx.assetUrl });
  // The frame runs nothing (sandbox without allow-scripts) and its own CSP forbids every load
  // except inline styles and local images; links have been removed by the sanitizer.
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: asset: http://asset.localhost https://asset.localhost; style-src 'unsafe-inline'; font-src data:; form-action 'none'">`;
  const doc = /<head[^>]*>/i.test(clean) ? clean.replace(/<head([^>]*)>/i, `<head$1>${csp}`) : `${csp}${clean}`;
  return `<div class="vw-frame-wrap"><iframe class="vw-frame" sandbox="" referrerpolicy="no-referrer" title="Preview of ${esc(v.doc.name)}" srcdoc="${esc("<!doctype html>" + doc)}"></iframe></div>`;
}

// ---------------------------------------------------------------- rendering
const seg = (name, opts, cur) => `<div class="vw-seg" role="group">${opts.map(([val, label]) =>
  `<button type="button" data-seg="${name}" data-val="${val}" aria-pressed="${val === cur}">${label}</button>`).join('')}</div>`;
const tog = (name, label, on, title) => `<button type="button" class="vw-tog" data-tog="${name}" aria-pressed="${on}" title="${title}">${label}</button>`;

async function body(v) {
  const { doc, type } = v;
  const big = doc.content.length > MAX_RICH;
  v.formatted = null; v.note = '';
  if (big) v.note = `Large file (${fmtSize(doc.size ?? doc.content.length)}): shown as plain text.`;
  if (type.kind === 'csv' && !big && !pref('csvRaw', false)) {
    v.csv.rows ||= parseCsv(doc.content, type.sep || sniff(doc.content));
    v.mode = 'table';
    return { html: tableHtml(v), count: v.csv.rows.length };
  }
  if (type.kind === 'html' && !big && pref('htmlPreview', false)) { v.mode = 'preview'; return { html: previewHtml(v), count: null }; }
  v.mode = 'source';
  let text = doc.content;
  if (type.fmt && !big && pref('formatted', true)) {
    const m = await (ctx.formatP ||= import('./format.js'));
    const r = await m.format(text, type.fmt, { ext: type.ext });
    if (r.text != null) { text = r.text; v.formatted = r.text; }
    else if (r.error) v.note = r.error;
  }
  const lang = big ? null : type.lang || (type.kind === 'csv' ? null : null);
  const html = lang ? await ctx.highlightCode(text, lang) : esc(text);
  const prose = type.kind === 'text' && !type.mono && !pref('textMono', false);
  return linesHtml(html, {
    plain: big || countLines(text) > MAX_LINE_NUMBERS,
    numbers: type.kind === 'text' ? pref('textLines', false) : pref('lines', true),
    wrap: type.kind === 'text' || pref('wrap', false),
    prose,
  });
}

function bar(v, count) {
  const { type, doc } = v;
  const meta = [];
  if (v.mode === 'table') meta.push(plural(Math.max(0, count - 1), 'row'));
  else if (count != null) meta.push(plural(count, 'line'));
  meta.push(fmtSize(doc.size ?? doc.content.length));
  const big = doc.content.length > MAX_RICH;
  const tools = [];
  if (!big) {
    if (type.kind === 'csv') tools.push(seg('csv', [['table', 'Table'], ['raw', 'Raw']], v.mode === 'table' ? 'table' : 'raw'));
    if (type.kind === 'html') tools.push(seg('html', [['source', 'Source'], ['preview', 'Preview']], v.mode));
    if (type.fmt && v.mode === 'source' && doc.content.length <= 1024 * 1024) tools.push(seg('fmt', [['formatted', 'Formatted'], ['original', 'Original']], pref('formatted', true) ? 'formatted' : 'original'));
  }
  if (v.mode === 'source') {
    if (type.kind === 'text') {
      tools.push(tog('textLines', 'Line numbers', pref('textLines', false), 'Show line numbers'));
      if (!type.mono) tools.push(tog('textMono', 'Monospace', pref('textMono', false), 'Use a fixed-width font'));
    } else {
      tools.push(tog('lines', 'Line numbers', pref('lines', true), 'Show line numbers'));
      tools.push(tog('wrap', 'Wrap', pref('wrap', false), 'Wrap long lines'));
    }
  }
  const kindIcon = type.kind === 'json' ? 'json' : type.kind;
  return `<div class="vw-bar" data-nofind>
    <span class="vw-type">${icon(kindIcon)}${esc(type.label)}</span>
    <span class="vw-meta">${meta.join(' · ')}</span>
    ${v.note ? `<span class="vw-note" role="status">${esc(v.note)}</span>` : ''}
    <span class="vw-tools">${tools.join('')}</span>
  </div>`;
}

/** Renders `doc` (a file read by the host) as `type` (from filetypes.js). Resolves to HTML. */
export async function render(doc, type) {
  if (doc.binary) {
    view = { doc, type, mode: 'binary', formatted: null };
    return `<div class="vw vw-binary">${icon('binary')}<h2>Not a text file</h2>
      <p>${esc(doc.name)} (${fmtSize(doc.size ?? 0)}) looks like binary data, so Markly can't show it.</p></div>`;
  }
  const keep = view && view.doc.path === doc.path ? view.csv : null;
  const v = { doc, type, csv: { rows: null, sort: keep?.sort || null } };
  const b = await body(v);
  view = v;
  return `<div class="vw" data-kind="${type.kind}">${bar(v, b.count)}<div class="vw-body">${b.html}</div></div>`;
}

/** The formatted text, when the Formatted view is on screen (for "Copy formatted"). */
export const formattedText = () => (view && view.mode === 'source' ? view.formatted : null);

/** Handles clicks on the view's own controls; returns true when it re-rendered. */
export async function click(e, contentEl) {
  if (!view) return false;
  const b = e.target.closest('.vw-bar button, .vw-sort');
  if (!b) return false;
  const v = view;
  if (b.classList.contains('vw-sort')) {
    const col = +b.dataset.col;
    const s = v.csv.sort;
    v.csv.sort = !s || s.col !== col ? { col, dir: 1 } : s.dir > 0 ? { col, dir: -1 } : null;
    contentEl.querySelector('.vw-body').innerHTML = tableHtml(v);
    if (e.detail === 0) contentEl.querySelector(`.vw-sort[data-col="${col}"]`)?.focus({ preventScroll: true }); // keyboard: keep focus
    ctx.changed();
    return true;
  }
  if (b.dataset.seg) {
    const val = b.dataset.val;
    if (b.dataset.seg === 'csv') setPref('csvRaw', val === 'raw');
    if (b.dataset.seg === 'html') setPref('htmlPreview', val === 'preview');
    if (b.dataset.seg === 'fmt') setPref('formatted', val === 'formatted');
  } else if (b.dataset.tog) setPref(b.dataset.tog, b.getAttribute('aria-pressed') !== 'true');
  else return false;
  const which = b.dataset.seg ? `[data-seg="${b.dataset.seg}"][data-val="${b.dataset.val}"]` : `[data-tog="${b.dataset.tog}"]`;
  const html = await render(v.doc, v.type);
  if (view !== null && view.doc !== v.doc) return false; // another file opened meanwhile
  contentEl.innerHTML = html;
  if (e.detail === 0) contentEl.querySelector(`.vw-bar ${which}`)?.focus({ preventScroll: true }); // keyboard: keep focus
  ctx.changed();
  return true;
}

export function clear() { view = null; }
