import { host } from './host.js';
import { renderMarkdown, renderMermaid, renderMath, attachSources } from './render.js';
import { resolvePath, splitHash, isMarkdownPath, basename, dirname } from './path.js';

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const content = $('mk-content');
const scroller = $('mk-scroller');
const welcome = $('mk-welcome');
const tocList = $('toc-list');

const LS = {
  get: (k, d) => { try { const v = localStorage.getItem('markly.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('markly.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

// Links to these are never launched from a document (they could run code).
// Windows, then macOS (bundles, Terminal scripts, installers), then Linux (launchers, scripts, packages).
const UNSAFE_EXT = new RegExp('\\.(' + [
  'exe|com|bat|cmd|msi|msix|msp|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|scr|pif|cpl|msc|jar|lnk|reg|url|appx|appref-ms|application|gadget|inf|scf|sys|dll|ocx|iso|img|vhd|vhdx',
  'app|command|tool|terminal|workflow|action|pkg|mpkg|dmg|scpt|scptd|applescript|webloc|inetloc|fileloc|dylib|kext|prefpane|saver',
  'sh|bash|zsh|csh|ksh|fish|desktop|appimage|run|deb|rpm|flatpakref|snap|so|bin|elf|py|pl|rb',
].join('|') + ')$', 'i');

// macOS shows ⌘ where Windows and Linux show Ctrl (the shortcuts accept either key everywhere).
const IS_MAC = /^Mac/.test(navigator.platform || '') || /Mac OS X/.test(navigator.userAgent);
const THEME_KEY = IS_MAC ? '⇧⌘L' : 'Ctrl+Shift+L';
if (IS_MAC) {
  document.querySelectorAll('[title*="Ctrl+"]').forEach((el) => { el.title = el.title.replace(/Ctrl\+/g, '⌘'); });
  document.querySelectorAll('kbd').forEach((el) => { if (el.textContent === 'Ctrl') el.textContent = '⌘'; });
}

let current = null;               // { path, name, dir }
const back = [], fwd = [];
let shown = false;

// ---------------------------------------------------------------- utilities
let toastTimer;
function toast(msg, ms = 3200) {
  const t = $('mk-toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
function revealWindow() {
  if (shown) return;
  shown = true;
  requestAnimationFrame(() => requestAnimationFrame(() => host.show().catch(() => {})));
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------- theme
const THEMES = ['system', 'light', 'dark'];
const mq = matchMedia('(prefers-color-scheme: dark)');
let themePref = localStorage.getItem('markly.theme') || 'system';
function isDark() { return themePref === 'dark' || (themePref === 'system' && mq.matches); }
function applyTheme(rerender = true) {
  const before = root.dataset.theme;
  root.dataset.theme = isDark() ? 'dark' : 'light';
  root.dataset.pref = themePref;
  $('btn-theme').title = `Theme: ${themePref[0].toUpperCase() + themePref.slice(1)} (${THEME_KEY})`;
  if (rerender && before !== root.dataset.theme) refreshMermaid();
}
function cycleTheme() {
  themePref = THEMES[(THEMES.indexOf(themePref) + 1) % THEMES.length];
  localStorage.setItem('markly.theme', themePref);
  host.setTheme(themePref === 'system' ? null : themePref);
  applyTheme();
}
mq.addEventListener('change', () => { if (themePref === 'system') applyTheme(); });

function refreshMermaid() {
  const blocks = content.querySelectorAll('.mermaid-block');
  if (!blocks.length) return;
  renderMermaid(content, isDark());
}

// ---------------------------------------------------------------- zoom
const ZOOMS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
let zoom = parseFloat(localStorage.getItem('markly.zoom') || '1') || 1;
function setZoom(z) {
  zoom = Math.min(3, Math.max(0.5, z));
  root.style.setProperty('--zoom', zoom);
  localStorage.setItem('markly.zoom', String(zoom));
  $('btn-zoom-reset').textContent = Math.round(zoom * 100) + '%';
}
function stepZoom(dir) {
  const i = ZOOMS.findIndex((z) => z >= zoom - 0.001);
  const idx = dir > 0 ? (ZOOMS[i] > zoom + 0.001 ? i : i + 1) : i - 1;
  setZoom(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, idx))]);
}

// ---------------------------------------------------------------- TOC
function toggleToc(force) {
  const hidden = force === undefined ? !root.classList.contains('toc-hidden') : !force;
  root.classList.toggle('toc-hidden', hidden);
  localStorage.setItem('markly.toc', hidden ? '0' : '1');
}
let headings = [];
function buildToc() {
  headings = [...content.querySelectorAll('h1[id],h2[id],h3[id],h4[id]')].filter((h) => !h.closest('.footnotes, .front-matter'));
  root.classList.toggle('toc-empty', headings.length < 2);
  if (!headings.length) { tocList.innerHTML = ''; return; }
  const minLevel = Math.min(...headings.map((h) => +h.tagName[1]));
  tocList.innerHTML = headings.map((h) => {
    const text = [...h.childNodes].filter((n) => !(n.classList && n.classList.contains('heading-anchor'))).map((n) => n.textContent).join('').trim();
    return `<a href="#${esc(encodeURIComponent(h.id))}" data-id="${esc(h.id)}" class="toc-l${+h.tagName[1] - minLevel + 1}" dir="auto">${esc(text)}</a>`;
  }).join('');
}
let activeId = null;
function updateActiveToc() {
  if (!headings.length) return;
  const top = scroller.getBoundingClientRect().top + 90;
  let active = headings[0];
  for (const h of headings) { if (h.getBoundingClientRect().top <= top) active = h; else break; }
  if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) active = headings[headings.length - 1];
  if (active.id === activeId) return;
  activeId = active.id;
  tocList.querySelectorAll('a.active').forEach((a) => a.classList.remove('active'));
  const link = tocList.querySelector(`a[data-id="${CSS.escape(active.id)}"]`);
  if (link) {
    link.classList.add('active');
    const r = link.getBoundingClientRect(), pr = $('mk-toc').getBoundingClientRect();
    if (r.top < pr.top + 40 || r.bottom > pr.bottom - 10) link.scrollIntoView({ block: 'nearest' });
  }
}
let scrollRaf = 0;
scroller.addEventListener('scroll', () => {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; updateActiveToc(); });
}, { passive: true });
tocList.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-id]');
  if (!a) return;
  e.preventDefault();
  scrollToId(a.dataset.id);
});

function scrollToId(id, smooth = true) {
  if (!id) return false;
  let el = document.getElementById(id);
  if (!el || !content.contains(el)) el = content.querySelector(`[id="${CSS.escape(id)}"], a[name="${CSS.escape(id)}"]`);
  if (!el) return false;
  el.closest('details')?.setAttribute('open', '');
  el.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
  return true;
}

// ---------------------------------------------------------------- recent files
function getRecent() { return LS.get('recent', []); }
function addRecent(path) {
  const list = getRecent().filter((p) => p.toLowerCase() !== path.toLowerCase());
  list.unshift(path);
  LS.set('recent', list.slice(0, 12));
}
function removeRecent(path) { LS.set('recent', getRecent().filter((p) => p !== path)); }
function recentHtml(list) {
  return list.map((p) => `<button class="recent-item" data-path="${esc(p)}"><span class="ri-name">${esc(basename(p))}</span><span class="ri-dir">${esc(dirname(p))}</span></button>`).join('');
}
function renderRecentMenu() {
  const list = getRecent();
  $('recent-menu').innerHTML = list.length
    ? `<div class="menu-head">Recent files</div>${recentHtml(list)}<button class="menu-clear" id="recent-clear">Clear list</button>`
    : '<div class="menu-empty">No recent files yet</div>';
}
function renderWelcomeRecent() {
  const list = getRecent().slice(0, 6);
  $('welcome-recent').innerHTML = list.length ? `<div class="wr-head">Recent</div>${recentHtml(list)}` : '';
}
document.addEventListener('click', (e) => {
  const item = e.target.closest('.recent-item');
  if (item) { closeMenus(); openFile(item.dataset.path); return; }
  if (e.target.closest('#recent-clear')) { LS.set('recent', []); renderRecentMenu(); renderWelcomeRecent(); return; }
  if (!e.target.closest('.menu-wrap')) closeMenus();
});
function closeMenus() { $('recent-menu').hidden = true; }

// ---------------------------------------------------------------- loading & rendering
function showWelcome() {
  current = null;
  content.innerHTML = '';
  welcome.hidden = false;
  root.classList.add('no-doc');
  $('doc-title').querySelector('.doc-name').textContent = 'Markly';
  $('doc-dir').textContent = '';
  host.setTitle('Markly');
  renderWelcomeRecent();
  revealWindow();
}

let loadSeq = 0;
async function openFile(path, opts = {}) {
  const { hash = '', keepScroll = false, history = true, silent = false } = opts;
  const seq = ++loadSeq;
  let doc;
  try {
    doc = await host.read(path);
  } catch (err) {
    if (silent) throw err;
    if (seq !== loadSeq) return false;
    toast(String(err?.message || err));
    if (!keepScroll) removeRecent(path);
    if (!current) showWelcome();
    return false;
  }
  if (seq !== loadSeq) return false;
  const t0 = performance.now();
  // Rendering may first fetch the highlight.js grammars / YAML parser the document needs.
  const rendered = await renderMarkdown(doc.content, { baseDir: doc.dir, assetUrl: host.assetUrl });
  if (seq !== loadSeq) return false; // a newer open/reload superseded this one

  if (history && current && current.path !== doc.path) { back.push({ path: current.path, top: scroller.scrollTop }); fwd.length = 0; }
  const prevTop = scroller.scrollTop;
  const samePath = current && current.path === doc.path;
  current = doc;

  delete document.body.dataset.ready;
  content.innerHTML = rendered.html;
  attachSources(content, rendered.sources);
  postProcess();
  welcome.hidden = true;
  root.classList.remove('no-doc');
  $('doc-title').querySelector('.doc-name').textContent = doc.name;
  $('doc-dir').textContent = doc.dir;
  $('doc-title').title = doc.path;
  host.setTitle(`${doc.name} — Markly`);
  addRecent(doc.path);
  if (!samePath) host.watch(doc.path);

  // All DOM writes (TOC included) happen before the first layout read, so the browser lays the
  // new document out once instead of twice.
  buildToc();
  if (keepScroll || (samePath && !hash && opts.reload)) scroller.scrollTop = prevTop;
  else if (!(hash && scrollToId(hash, false))) scroller.scrollTop = opts.top || 0;
  updateActiveToc();
  if (findState.open && findState.query) runFind(findState.query, false);
  revealWindow();
  scroller.focus({ preventScroll: true });
  Promise.all([renderMath(content), renderMermaid(content, isDark())])
    .catch((e) => console.error(e))
    .finally(() => {
      if (seq !== loadSeq) return;
      if (keepScroll) scroller.scrollTop = prevTop;
      updateActiveToc();
      document.body.dataset.ready = '1';
    });
  window.__marklyRenderMs = performance.now() - t0;
  return true;
}

function postProcess() {
  content.querySelectorAll('p,li,ul,ol,h1,h2,h3,h4,h5,h6,blockquote,td,th,table,dt,dd,summary,figcaption')
    .forEach((el) => { if (!el.hasAttribute('dir')) el.setAttribute('dir', 'auto'); });
  content.querySelectorAll('a[href]').forEach((a) => {
    const h = a.getAttribute('href');
    if (/^(https?:|mailto:|tel:)/i.test(h)) { a.classList.add('external'); a.title ||= h; }
  });
  content.querySelectorAll('img').forEach((img) => {
    img.addEventListener('error', async () => {
      const local = img.dataset.localSrc;
      if (local && !img.dataset.fallback) {
        img.dataset.fallback = '1';
        try { img.src = await host.readImage(local); return; } catch { /* fall through */ }
      }
      img.classList.add('img-broken');
    });
  });
}

async function pickAndOpen() {
  try { const p = await host.pickFile(); if (p) openFile(p); } catch (e) { toast(String(e?.message || e)); }
}

function goBack() {
  const prev = back.pop(); if (!prev || !current) return;
  fwd.push({ path: current.path, top: scroller.scrollTop });
  openFile(prev.path, { history: false, top: prev.top });
}
function goForward() {
  const next = fwd.pop(); if (!next || !current) return;
  back.push({ path: current.path, top: scroller.scrollTop });
  openFile(next.path, { history: false, top: next.top });
}

// ---------------------------------------------------------------- links & copy
content.addEventListener('click', async (e) => {
  const copy = e.target.closest('.code-copy');
  if (copy) {
    const code = copy.closest('.code-block')?.querySelector('code');
    if (!code) return;
    try { await navigator.clipboard.writeText(code.textContent); }
    catch {
      const r = document.createRange(); r.selectNodeContents(code);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.execCommand('copy'); s.removeAllRanges();
    }
    copy.textContent = 'Copied'; copy.classList.add('done');
    setTimeout(() => { copy.textContent = 'Copy'; copy.classList.remove('done'); }, 1400);
    return;
  }
  const a = e.target.closest('a[href]');
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute('href');
  if (href.startsWith('#')) { scrollToId(decodeURIComponent(href.slice(1))); return; }
  if (/^(https?:|mailto:|tel:)/i.test(href)) { host.openExternal(href).catch((err) => toast(String(err))); return; }
  if (!current) return;
  const [p, hash] = splitHash(href);
  const target = p ? resolvePath(current.dir, p) : current.path;
  if (!p) { scrollToId(hash); return; }
  if (isMarkdownPath(target)) openFile(target, { hash });
  else if (UNSAFE_EXT.test(target)) toast(`Blocked: Markly won't launch programs or scripts from documents (${basename(target)})`, 4500);
  else host.openPath(target).catch((err) => toast(`Could not open ${basename(target)}: ${err}`));
});
document.addEventListener('auxclick', (e) => { if (e.target.closest('a')) e.preventDefault(); });
document.addEventListener('contextmenu', (e) => {
  const sel = getSelection();
  if (sel && !sel.isCollapsed) return;
  if (e.target.closest('input')) return;
  e.preventDefault();
});

// ---------------------------------------------------------------- find (Ctrl+F)
const findState = { open: false, query: '', ranges: [], idx: -1 };
const hasHighlights = typeof CSS !== 'undefined' && 'highlights' in CSS;
function openFind() {
  const bar = $('mk-findbar');
  bar.hidden = false; findState.open = true;
  const sel = getSelection()?.toString().trim();
  const input = $('find-input');
  if (sel && sel.length < 100 && !sel.includes('\n')) input.value = sel;
  input.focus(); input.select();
  if (input.value) runFind(input.value, true);
}
function closeFind() {
  $('mk-findbar').hidden = true; findState.open = false;
  if (hasHighlights) { CSS.highlights.delete('mk-find'); CSS.highlights.delete('mk-find-current'); }
  findState.ranges = []; findState.idx = -1;
  scroller.focus({ preventScroll: true });
}
function runFind(q, jump) {
  findState.query = q; findState.ranges = []; findState.idx = -1;
  if (hasHighlights) { CSS.highlights.delete('mk-find'); CSS.highlights.delete('mk-find-current'); }
  if (!q) { $('find-count').textContent = ''; return; }
  const needle = q.toLocaleLowerCase();
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement.closest('.katex-mathml, .heading-anchor, svg style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let n;
  while ((n = walker.nextNode())) {
    const text = n.nodeValue.toLocaleLowerCase();
    let i = text.indexOf(needle);
    while (i !== -1) {
      const r = new Range(); r.setStart(n, i); r.setEnd(n, i + q.length);
      findState.ranges.push(r);
      if (findState.ranges.length > 5000) break;
      i = text.indexOf(needle, i + needle.length);
    }
  }
  if (hasHighlights && findState.ranges.length) CSS.highlights.set('mk-find', new Highlight(...findState.ranges));
  if (findState.ranges.length) {
    // start at first match below the current viewport top
    const top = scroller.getBoundingClientRect().top;
    const first = findState.ranges.findIndex((r) => r.getBoundingClientRect().bottom >= top);
    gotoMatch(first < 0 ? 0 : first, jump);
  } else $('find-count').textContent = 'No results';
}
function gotoMatch(i, scroll = true) {
  const n = findState.ranges.length; if (!n) return;
  findState.idx = (i + n) % n;
  const r = findState.ranges[findState.idx];
  if (hasHighlights) CSS.highlights.set('mk-find-current', new Highlight(r));
  $('find-count').textContent = `${findState.idx + 1} / ${n}`;
  if (scroll) {
    r.startContainer.parentElement.closest('details')?.setAttribute('open', '');
    const rect = r.getBoundingClientRect(), sr = scroller.getBoundingClientRect();
    if (rect.top < sr.top + 60 || rect.bottom > sr.bottom - 40) scroller.scrollBy({ top: rect.top - sr.top - sr.height / 3 });
  }
}
let findTimer;
$('find-input').addEventListener('input', (e) => { clearTimeout(findTimer); findTimer = setTimeout(() => runFind(e.target.value, true), 120); });
$('find-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); if (findState.query !== e.target.value) runFind(e.target.value, true); else gotoMatch(findState.idx + (e.shiftKey ? -1 : 1)); }
  if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
});
$('find-next').onclick = () => gotoMatch(findState.idx + 1);
$('find-prev').onclick = () => gotoMatch(findState.idx - 1);
$('find-close').onclick = closeFind;

// ---------------------------------------------------------------- toolbar
$('btn-open').onclick = pickAndOpen;
$('welcome-open').onclick = pickAndOpen;
$('btn-toc').onclick = () => toggleToc();
$('btn-find').onclick = () => (findState.open ? closeFind() : openFind());
$('btn-zoom-in').onclick = () => stepZoom(1);
$('btn-zoom-out').onclick = () => stepZoom(-1);
$('btn-zoom-reset').onclick = () => setZoom(1);
$('btn-print').onclick = () => window.print();
$('btn-theme').onclick = cycleTheme;
$('btn-recent').onclick = (e) => { e.stopPropagation(); const m = $('recent-menu'); if (m.hidden) renderRecentMenu(); m.hidden = !m.hidden; };

// ---------------------------------------------------------------- keyboard
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  let handled = true;
  if (mod && !e.shiftKey && k === 'o') pickAndOpen();
  else if (mod && k === 'f') openFind();
  else if (mod && k === 'p') window.print();
  else if (mod && (k === '=' || k === '+' || e.code === 'NumpadAdd')) stepZoom(1);
  else if (mod && (k === '-' || k === '_' || e.code === 'NumpadSubtract')) stepZoom(-1);
  else if (mod && (k === '0' || e.code === 'Numpad0')) setZoom(1);
  else if (mod && (k === '\\' || (e.shiftKey && k === 'o'))) toggleToc();
  else if (mod && e.shiftKey && k === 'l') cycleTheme();
  else if (mod && k === 'w') host.close();
  else if (mod && k === 'r' || e.key === 'F5') { if (current) openFile(current.path, { history: false, reload: true }); }
  else if (e.key === 'F3') { if (!findState.open) openFind(); else gotoMatch(findState.idx + (e.shiftKey ? -1 : 1)); }
  else if (e.altKey && e.key === 'ArrowLeft') goBack();
  else if (e.altKey && e.key === 'ArrowRight') goForward();
  else if (IS_MAC && e.metaKey && e.key === '[') goBack();
  else if (IS_MAC && e.metaKey && e.key === ']') goForward();
  else if (e.key === 'BrowserBack') goBack();
  else if (e.key === 'BrowserForward') goForward();
  else if (e.key === 'Escape') { if (findState.open) closeFind(); else closeMenus(); }
  else handled = false;
  if (handled) e.preventDefault();
});
document.addEventListener('mouseup', (e) => { if (e.button === 3) goBack(); if (e.button === 4) goForward(); });
document.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  stepZoom(e.deltaY < 0 ? 1 : -1);
}, { passive: false });

// ---------------------------------------------------------------- drag & drop, live reload
const drop = $('mk-drop');
host.onDrop((p) => {
  if (p.type === 'enter' || p.type === 'over') drop.hidden = false;
  else if (p.type === 'leave') drop.hidden = true;
  else if (p.type === 'drop') {
    drop.hidden = true;
    const paths = p.paths || [];
    const target = paths.find(isMarkdownPath) || paths[0];
    if (target) openFile(target);
  }
});

let reloadTimer;
host.onChange((path) => {
  if (!current || path !== current.path) return;
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    try { await openFile(current.path, { keepScroll: true, history: false, silent: true }); }
    catch { setTimeout(() => openFile(current.path, { keepScroll: true, history: false, silent: true }).catch(() => {}), 400); }
  }, 120);
});

// ---------------------------------------------------------------- boot
applyTheme(false);
setZoom(zoom);
if (themePref !== 'system') host.setTheme(themePref);
(async () => {
  // macOS: files opened while the app is running (Finder / "Open With") arrive as events.
  // Listen before asking for the start-up file so a request arriving in between is not lost.
  // (Windows and Linux open each file in its own window via the command line.)
  if (IS_MAC) { try { await host.onOpenFile((path) => { if (path) openFile(path); }); } catch { /* browser */ } }
  let initial = null;
  try { initial = await host.initialFile(); } catch { /* none */ }
  if (initial) { if (!(await openFile(initial))) showWelcome(); }
  else showWelcome();
})();
window.__marklyOpen = openFile;
