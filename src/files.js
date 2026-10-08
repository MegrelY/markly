// Folder browser: a right-side panel listing the current folder. Loaded on first use (lazy chunk +
// files.css), so it costs nothing at start-up while closed.
// Path helpers come from the app via init() (importing path.js here would split it into a shared
// chunk and add a request at start-up).
let isMarkdownPath, dirname;

const DEFAULT_W = 300, MIN_W = 200, MAX_W = 640;
// Explicit locale: some web views run with a POSIX locale whose collation is case-sensitive.
const coll = new Intl.Collator([navigator.language, 'en'].filter((l) => l && !/^(c|posix)$/i.test(l)), { numeric: true, sensitivity: 'base' });
const byName = (a, b) => coll.compare(a.toLowerCase(), b.toLowerCase()) || coll.compare(a, b);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const winLike = (p) => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\');
const samePath = (a, b) => !!a && !!b && (winLike(a) || winLike(b) ? a.toLowerCase() === b.toLowerCase() : a === b);

const ICONS = {
  dir: '<svg viewBox="0 0 24 24"><path d="M3.5 7.5V17a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2V9.5a2 2 0 0 0-2-2h-6.5l-2-2.5H5.5a2 2 0 0 0-2 2z"/></svg>',
  drive: '<svg viewBox="0 0 24 24"><rect x="3.5" y="7" width="17" height="10" rx="2"/><path d="M7 13.5h.01M10 13.5h.01"/></svg>',
  md: '<svg viewBox="0 0 24 24"><path d="M6 3.5h7.5L18 8v12.5H6z"/><path d="M13.5 3.5V8H18M8.8 16.5v-4.2l1.6 1.9 1.6-1.9v4.2M14.6 12.3v4.2m-1.3-1.3 1.3 1.3 1.3-1.3"/></svg>',
  other: '<svg viewBox="0 0 24 24"><path d="M6 3.5h7.5L18 8v12.5H6z"/><path d="M13.5 3.5V8H18"/></svg>',
};

let ctx, root, panel, listEl, pathEl, crumbsEl, upBtn, copyBtn, filterBtn, statusEl, toggleBtn;
let listing = null;        // last listing shown: { path, parent, crumbs, entries, truncated }
let failed = null;         // { path, kind, message } when the last navigation failed
let view = [];             // entries as displayed (sorted, filtered)
let sel = -1;
let seq = 0;
let isOpen = false;
let lastFollowed = null;
let mdOnly, width;
let refreshTimer, typeBuf = '', typeTimer;

function loadCss() {
  return new Promise((resolve) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = 'files.css';
    l.onload = l.onerror = () => resolve();
    document.head.appendChild(l);
  });
}

export async function init(c) {
  ctx = c; root = document.documentElement;
  ({ isMarkdownPath, dirname } = c);
  mdOnly = ctx.LS.get('files.mdOnly', false);
  width = +ctx.LS.get('files.width', DEFAULT_W) || DEFAULT_W;   // preferred width; clamped when applied
  toggleBtn = document.getElementById('btn-files');
  await loadCss();
  panel = document.createElement('aside');
  panel.id = 'mk-files'; panel.hidden = true;
  panel.setAttribute('aria-label', 'Folder browser');
  panel.innerHTML = `
    <div class="fb-resize" title="Drag to resize (double-click to reset)"></div>
    <div class="fb-head">
      <div class="fb-row">
        <button class="icon-btn fb-up" title="Up one folder (Backspace)" aria-label="Up one folder"><svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg></button>
        <div class="fb-path" dir="auto"></div>
        <button class="icon-btn fb-copy" title="Copy folder path" aria-label="Copy folder path"><svg viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.2"/><path d="M15.5 8.5V6.2A2.2 2.2 0 0 0 13.3 4H6.2A2.2 2.2 0 0 0 4 6.2v7.1a2.2 2.2 0 0 0 2.2 2.2h2.3"/></svg></button>
        <button class="icon-btn fb-filter" title="Show only Markdown files" aria-label="Show only Markdown files" aria-pressed="false"><svg viewBox="0 0 24 24"><path d="M4 5.5h16l-6.2 7.2v5.6l-3.6 1.9v-7.5z"/></svg></button>
      </div>
      <nav class="fb-crumbs" aria-label="Folder path"></nav>
    </div>
    <div class="fb-list" role="listbox" tabindex="0" aria-label="Folder contents"></div>
    <div class="fb-status"></div>`;
  document.getElementById('mk-layout').appendChild(panel);
  const q = (s) => panel.querySelector(s);
  listEl = q('.fb-list'); pathEl = q('.fb-path'); crumbsEl = q('.fb-crumbs');
  upBtn = q('.fb-up'); copyBtn = q('.fb-copy'); filterBtn = q('.fb-filter'); statusEl = q('.fb-status');
  applyWidth();
  filterBtn.setAttribute('aria-pressed', String(mdOnly));

  upBtn.onclick = goUp;
  copyBtn.onclick = async () => {
    const p = listing && !failed ? listing.path : failed?.path;
    if (p && await ctx.copyText(p)) ctx.toast('Copied folder path', 1600);
  };
  filterBtn.onclick = () => {
    mdOnly = !mdOnly; ctx.LS.set('files.mdOnly', mdOnly);
    filterBtn.setAttribute('aria-pressed', String(mdOnly));
    if (listing && !failed) render({ keep: true });
  };
  crumbsEl.addEventListener('click', (e) => {
    const b = e.target.closest('button.fb-crumb');
    if (b) navigate(b.dataset.path, { select: listing?.path });
  });
  listEl.addEventListener('click', (e) => {
    const it = e.target.closest('.fb-item'); if (!it) return;
    const i = +it.dataset.i; setSel(i);
    if (view[i].kind === 'md') openEntry(view[i]);
  });
  listEl.addEventListener('dblclick', (e) => {
    const it = e.target.closest('.fb-item'); if (!it) return;
    const en = view[+it.dataset.i];
    if (en.dir) enter(en);
  });
  listEl.addEventListener('keydown', onKey);
  panel.querySelector('.fb-resize').addEventListener('pointerdown', startResize);
  panel.querySelector('.fb-resize').addEventListener('dblclick', () => { width = DEFAULT_W; applyWidth(); ctx.LS.set('files.width', width); });
  addEventListener('resize', () => applyWidth());
  ctx.host.onDirChange((p) => {
    if (!isOpen || !listing || failed || !samePath(p, listing.path)) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refresh(), 250);
  });
}

function clampW(w) {
  const room = innerWidth >= 400 ? innerWidth * 0.6 : MAX_W; // the window may not be laid out yet at start-up
  return Math.round(Math.max(MIN_W, Math.min(+w || DEFAULT_W, MAX_W, room)));
}
function applyWidth() {
  const w = clampW(width);
  panel.style.width = w + 'px';
  root.style.setProperty('--files-w', w + 'px');
}
function startResize(e) {
  e.preventDefault();
  const handle = e.currentTarget;
  handle.setPointerCapture(e.pointerId);
  root.classList.add('fb-resizing');
  const move = (ev) => { width = clampW(innerWidth - ev.clientX); applyWidth(); };
  const up = () => {
    handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up);
    root.classList.remove('fb-resizing');
    ctx.LS.set('files.width', width);
  };
  handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
}

export function opened() { return isOpen; }

export async function show({ focus = false } = {}) {
  if (!isOpen) {
    isOpen = true; panel.hidden = false; applyWidth();
    root.classList.add('files-open');
    toggleBtn?.setAttribute('aria-pressed', 'true');
    ctx.LS.set('files.open', true);
    const cur = ctx.getCurrent();
    lastFollowed = cur?.path || null;
    if (cur && listing && !failed && samePath(listing.path, cur.dir)) { render({ select: cur.path }); ctx.host.watchDir(listing.path || null); }
    else await navigate(cur ? cur.dir : (listing?.path ?? ctx.LS.get('files.dir', null) ?? '~'), { select: cur?.path, fallback: true });
  }
  if (focus) listEl.focus({ preventScroll: true });
}

export function hide() {
  if (!isOpen) return;
  const hadFocus = panel.contains(document.activeElement);
  isOpen = false; panel.hidden = true;
  root.classList.remove('files-open');
  toggleBtn?.setAttribute('aria-pressed', 'false');
  ctx.LS.set('files.open', false);
  ctx.host.watchDir(null);
  if (hadFocus) ctx.focusContent();
}

/** Called after a document opens: show its folder and highlight it. */
export function follow(doc) {
  if (!isOpen || !doc || samePath(doc.path, lastFollowed)) return;
  lastFollowed = doc.path;
  if (listing && !failed && samePath(listing.path, doc.dir)) markCurrent(doc.path);
  else navigate(doc.dir, { select: doc.path });
}

async function navigate(path, { select, keep = false, fallback = false } = {}) {
  const my = ++seq;
  let res = null, err = null;
  try { res = await ctx.host.listDir(path); } catch (e) { err = e && e.kind ? e : { kind: 'other', message: String(e?.message || e) }; }
  if (my !== seq) return;
  if (err && fallback && path !== '~' && path !== '') return navigate('~', { select });
  if (err) {
    failed = { path, kind: err.kind, message: err.message };
    renderError();
    return;
  }
  const same = listing && samePath(listing.path, res.path);
  failed = null; listing = res;
  if (res.path) ctx.LS.set('files.dir', res.path);
  if (isOpen) ctx.host.watchDir(res.path || null);
  render({ select, keep: keep && same });
}

function refresh() { if (listing) navigate(listing.path, { keep: true }); }

function kindOf(en) {
  if (listing.path === '' && en.dir) return 'drive';
  if (en.dir) return 'dir';
  return isMarkdownPath(en.name) ? 'md' : 'other';
}

function renderHead(path, parentAvailable) {
  pathEl.textContent = path ? `\u200E${path}\u200E` : 'This PC'; // LRMs keep the path LTR inside the RTL ellipsis box
  pathEl.title = path || 'This PC';
  copyBtn.disabled = !path;
  upBtn.disabled = !parentAvailable;
}

function render({ select, keep = false } = {}) {
  const prevSel = keep && sel >= 0 ? view[sel]?.path : null;
  const prevTop = listEl.scrollTop;
  const cur = ctx.getCurrent()?.path;
  const all = listing.entries.map((en) => ({ ...en, kind: kindOf(en) }))
    .sort((a, b) => (b.dir - a.dir) || byName(a.name, b.name));
  view = mdOnly ? all.filter((en) => en.dir || en.kind === 'md') : all;
  renderHead(listing.path, listing.parent != null);
  const cr = listing.crumbs || [];
  crumbsEl.innerHTML = cr.map((c, i) => (i === cr.length - 1
    ? `<span class="fb-crumb here" title="${esc(c.path || c.name)}">${esc(c.name)}</span>`
    : `<button class="fb-crumb" data-path="${esc(c.path)}" title="${esc(c.path || c.name)}">${esc(c.name)}</button>`)).join('<span class="fb-sep">›</span>');
  crumbsEl.scrollLeft = crumbsEl.scrollWidth;
  if (!view.length) {
    listEl.innerHTML = `<div class="fb-empty">${listing.entries.length ? 'No Markdown files in this folder' : 'This folder is empty'}</div>`;
  } else {
    listEl.innerHTML = view.map((en, i) => {
      const title = en.kind === 'other' ? `${en.name} — not a Markdown file` : en.dir ? `${en.name} — double-click to open` : en.name;
      return `<div class="fb-item ${en.kind}${cur && samePath(en.path, cur) ? ' current' : ''}" role="option" id="fb-i${i}" data-i="${i}" aria-selected="false" title="${esc(title)}">${ICONS[en.kind]}<span class="fb-name">${esc(en.name)}</span></div>`;
    }).join('');
  }
  const counts = all.reduce((a, en) => { a[en.dir ? 0 : en.kind === 'md' ? 1 : 2]++; return a; }, [0, 0, 0]);
  const parts = [];
  if (counts[0]) parts.push(`${counts[0]} ${listing.path === '' ? (counts[0] === 1 ? 'drive' : 'drives') : (counts[0] === 1 ? 'folder' : 'folders')}`);
  if (counts[1]) parts.push(`${counts[1]} Markdown`);
  if (counts[2]) parts.push(`${counts[2]} other${mdOnly ? ' (hidden)' : ''}`);
  statusEl.textContent = (parts.join(' · ') || 'Empty') + (listing.truncated ? ' · list cut off' : '');
  sel = -1; typeBuf = '';
  const want = select || prevSel || cur;
  const idx = want ? view.findIndex((en) => samePath(en.path, want)) : -1;
  if (keep) listEl.scrollTop = prevTop;
  else listEl.scrollTop = 0;
  if (idx >= 0) setSel(idx, !keep || !prevSel);
}

function renderError() {
  const { path, kind } = failed;
  renderHead(path, !!path && dirname(path) !== path);
  crumbsEl.innerHTML = '';
  view = []; sel = -1;
  const msg = kind === 'denied' ? 'Markly doesn’t have permission to open this folder.'
    : kind === 'notfound' ? 'This folder doesn’t exist anymore.'
      : 'This folder can’t be opened.';
  listEl.innerHTML = `<div class="fb-empty fb-error"><strong>${msg}</strong><span>${esc(failed.message || '')}</span></div>`;
  statusEl.textContent = '';
}

function markCurrent(path) {
  listEl.querySelectorAll('.fb-item.current').forEach((el) => el.classList.remove('current'));
  const idx = view.findIndex((en) => samePath(en.path, path));
  if (idx >= 0) { listEl.children[idx].classList.add('current'); setSel(idx, true); }
}

function setSel(i, scroll = true) {
  if (!view.length) return;
  i = Math.max(0, Math.min(view.length - 1, i));
  if (sel >= 0 && listEl.children[sel]) { listEl.children[sel].classList.remove('sel'); listEl.children[sel].setAttribute('aria-selected', 'false'); }
  sel = i;
  const el = listEl.children[i];
  el.classList.add('sel'); el.setAttribute('aria-selected', 'true');
  listEl.setAttribute('aria-activedescendant', el.id);
  if (scroll) el.scrollIntoView({ block: 'nearest' });
}

function enter(en) { navigate(en.path); }

function goUp() {
  if (failed) { const p = dirname(failed.path); if (p && p !== failed.path) navigate(p); return; }
  if (listing && listing.parent != null) navigate(listing.parent, { select: listing.path });
}

async function openEntry(en) {
  const refocus = panel.contains(document.activeElement);
  await ctx.openFile(en.path);
  if (refocus && isOpen) listEl.focus({ preventScroll: true });
}

function activate(i) {
  const en = view[i]; if (!en) return;
  if (en.dir) enter(en);
  else if (en.kind === 'md') openEntry(en);
}

function onKey(e) {
  if (e.ctrlKey || e.metaKey) return;
  const page = Math.max(1, Math.floor(listEl.clientHeight / 30) - 1);
  let handled = true;
  switch (e.key) {
    case 'ArrowDown': setSel(sel < 0 ? 0 : sel + 1); break;
    case 'ArrowUp': if (e.altKey) goUp(); else setSel(sel < 0 ? 0 : sel - 1); break;
    case 'Home': setSel(0); break;
    case 'End': setSel(view.length - 1); break;
    case 'PageDown': setSel(sel + page); break;
    case 'PageUp': setSel(sel - page); break;
    case 'Enter': activate(sel); break;
    case 'ArrowRight': if (view[sel]?.dir) enter(view[sel]); else handled = false; break;
    case 'ArrowLeft': case 'Backspace': if (!e.altKey) goUp(); else handled = false; break;
    case 'Escape': ctx.focusContent(); break;
    default:
      if (e.key.length === 1 && !e.altKey && e.key !== ' ') {
        // type-ahead: jump to the next entry starting with the typed letters
        clearTimeout(typeTimer);
        typeBuf += e.key.toLowerCase();
        typeTimer = setTimeout(() => { typeBuf = ''; }, 700);
        const start = typeBuf.length === 1 ? sel + 1 : Math.max(sel, 0);
        for (let k = 0; k < view.length; k++) {
          const i = (start + k) % view.length;
          if (view[i].name.toLowerCase().startsWith(typeBuf)) { setSel(i); break; }
        }
      } else handled = false;
  }
  if (handled) { e.preventDefault(); e.stopPropagation(); }
}
