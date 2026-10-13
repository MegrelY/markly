// File history: commits that changed the open file (git log --follow), each commit's diff of the
// file (inline or side by side), the file as it was at a commit, and a comparison of two commits.
// Loaded on first use (lazy chunk + history.css), so it costs nothing at start-up.
import { parsePatch, renderDiff, stats, MAX_LINES } from './diff.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const WT = 'worktree';

const ICON = {
  copy: '<svg viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.2"/><path d="M15.5 8.5V6.2A2.2 2.2 0 0 0 13.3 4H6.2A2.2 2.2 0 0 0 4 6.2v7.1a2.2 2.2 0 0 0 2.2 2.2h2.3"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  history: '<svg viewBox="0 0 24 24"><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4.5v4h4M12 7.5V12l3 2"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
  pencil: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
};

let ctx, root, panel, listEl, detailEl, diffEl, titleEl, modeBtns, toggleBtn;
let banner = null;
let git = null;            // { root, rel, available } for the open file
let log = null;            // { commits, truncated, staged, unstaged }
let items = [];            // [{ kind: 'wt' | 'commit', c? }]
let sel = -1, cmp = -1;    // selected item, and the second item when comparing
let isOpen = false, split = false;
let logSeq = 0, diffSeq = 0, diffTimer = 0;
let lastFocus = null;

function loadCss() {
  return new Promise((resolve) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = 'history.css';
    l.onload = l.onerror = () => resolve();
    document.head.appendChild(l);
  });
}

// ---------------------------------------------------------------- dates
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const UNITS = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
function relTime(t) {
  const diff = t - Date.now() / 1000;
  for (const [u, s] of UNITS) if (Math.abs(diff) >= s) return rtf.format(Math.round(diff / s), u);
  return 'just now';
}
const absTime = (t) => new Date(t * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// ---------------------------------------------------------------- setup
export async function init(c) {
  ctx = c; root = document.documentElement;
  split = !!ctx.LS.get('history.split', false);
  toggleBtn = document.getElementById('btn-history');
  await loadCss();
  panel = document.createElement('section');
  panel.id = 'mk-history'; panel.hidden = true;
  panel.setAttribute('aria-label', 'File history');
  panel.innerHTML = `
    <div class="hs-head">
      <span class="hs-icon">${ICON.history}</span>
      <div class="hs-title"><span class="hs-label">History</span><span class="hs-file" dir="auto"></span></div>
      <div class="hs-seg" role="group" aria-label="Diff layout">
        <button class="hs-mode" data-split="0" title="Inline diff">Unified</button>
        <button class="hs-mode" data-split="1" title="Side-by-side diff">Split</button>
      </div>
      <button class="icon-btn hs-close" title="Close history (Esc)" aria-label="Close history">${ICON.close}</button>
    </div>
    <div class="hs-body">
      <div class="hs-list" role="listbox" tabindex="0" aria-label="Commits"></div>
      <div class="hs-detail">
        <div class="hs-dhead"></div>
        <div class="hs-diff" tabindex="-1"></div>
      </div>
    </div>`;
  document.getElementById('mk-layout').appendChild(panel);
  listEl = panel.querySelector('.hs-list');
  detailEl = panel.querySelector('.hs-dhead');
  diffEl = panel.querySelector('.hs-diff');
  titleEl = panel.querySelector('.hs-file');
  modeBtns = [...panel.querySelectorAll('.hs-mode')];
  modeBtns.forEach((b) => { b.onclick = () => setSplit(b.dataset.split === '1'); });
  panel.querySelector('.hs-close').onclick = () => hide();
  syncMode();

  listEl.addEventListener('click', onListClick);
  listEl.addEventListener('keydown', onListKey);
  detailEl.addEventListener('click', onDetailClick);
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); hide(); }
  });
}

function syncMode() {
  modeBtns.forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.split === '1') === split)));
}
function setSplit(v) {
  if (split === v) return;
  split = v; ctx.LS.set('history.split', v); syncMode();
  if (lastDiff) paintDiff(lastDiff);
}

// ---------------------------------------------------------------- open / close
export function opened() { return isOpen; }

/** The app tells us which file is open and whether git tracks it ({ root, rel, available } or null). */
export function setFile(info) {
  const changed = !git || !info || git.root !== info.root || git.rel !== info.rel;
  git = info;
  if (!isOpen) return;
  if (!info) { hide(); return; }
  if (changed) { sel = -1; cmp = -1; load(); }
}

/** The open file changed on disk: refresh the list (uncommitted changes may come or go). */
export function refresh() { if (isOpen && git) load({ keep: true }); }

export async function show({ focus = true } = {}) {
  if (!git) return;
  if (!isOpen) {
    isOpen = true;
    lastFocus = document.activeElement;
    panel.hidden = false;
    root.classList.add('history-open');
    toggleBtn.setAttribute('aria-pressed', 'true');
  }
  if (focus) listEl.focus({ preventScroll: true });
  if (!log || log.for !== git.root + '\n' + git.rel) await load();
  else if (focus) scrollSelIntoView();
}

export function hide() {
  if (!isOpen) return;
  isOpen = false;
  panel.hidden = true;
  root.classList.remove('history-open');
  toggleBtn.setAttribute('aria-pressed', 'false');
  ctx.focusContent();
}

// ---------------------------------------------------------------- data
function errorHtml(e) {
  const kind = e?.kind;
  const title = kind === 'nogit' ? 'Git is not available'
    : kind === 'timeout' ? 'Git took too long to answer' : "Couldn't read the history";
  const hint = kind === 'nogit' ? 'Install Git (git-scm.com) and make sure it is on the PATH, then reopen this file.' : esc(e?.message || e || '');
  return `<div class="hs-empty"><strong>${title}</strong><span>${hint}</span></div>`;
}

async function load({ keep = false } = {}) {
  const seq = ++logSeq;
  titleEl.textContent = git.rel || ctx.getCurrent()?.name || '';
  titleEl.title = git.rel;
  if (!git.available) {
    log = null; items = [];
    listEl.innerHTML = errorHtml({ kind: 'nogit' });
    detailEl.innerHTML = ''; diffEl.innerHTML = '';
    return;
  }
  if (!keep) { listEl.innerHTML = '<div class="hs-empty hs-loading">Loading history…</div>'; detailEl.innerHTML = ''; diffEl.innerHTML = ''; }
  let res;
  try { res = await ctx.host.gitLog(git.root, git.rel); }
  catch (e) {
    if (seq !== logSeq) return;
    log = null; items = []; listEl.innerHTML = errorHtml(e); detailEl.innerHTML = ''; diffEl.innerHTML = '';
    return;
  }
  if (seq !== logSeq) return;
  const prevKey = items[sel] ? key(items[sel]) : null;
  const prevCmp = items[cmp] ? key(items[cmp]) : null;
  log = { ...res, for: git.root + '\n' + git.rel };
  items = [];
  if (res.staged || res.unstaged) items.push({ kind: 'wt' });
  for (const c of res.commits) items.push({ kind: 'commit', c });
  sel = keep && prevKey ? items.findIndex((it) => key(it) === prevKey) : -1;
  cmp = keep && prevCmp ? items.findIndex((it) => key(it) === prevCmp) : -1;
  if (sel < 0) sel = items.length ? 0 : -1;
  renderList();
  if (sel >= 0) selectItem(sel, { immediate: true, force: true });
  else { detailEl.innerHTML = ''; diffEl.innerHTML = '<div class="hs-empty"><strong>No commits yet</strong><span>This file has not been committed.</span></div>'; }
}
const key = (it) => (it.kind === 'wt' ? WT : it.c.hash);

// ---------------------------------------------------------------- list
function itemHtml(it, i) {
  const cls = ['hs-item', i === sel ? 'sel' : '', i === cmp ? 'cmp' : ''].filter(Boolean).join(' ');
  if (it.kind === 'wt') {
    const tags = [log.staged && '<span class="hs-tag">Staged</span>', log.unstaged && '<span class="hs-tag">Unstaged</span>'].filter(Boolean).join('');
    return `<div class="${cls} hs-wt" role="option" data-i="${i}" aria-selected="${i === sel}">
      <span class="hs-dot hs-dot-wt"></span>
      <div class="hs-main"><div class="hs-subj">Uncommitted changes</div><div class="hs-meta">${tags}<span>Working copy vs. last commit</span></div></div></div>`;
  }
  const c = it.c;
  const ren = c.old_path ? `<div class="hs-ren" title="${esc(c.old_path)} → ${esc(c.path)}">Renamed from ${esc(c.old_path)}</div>` : '';
  const st = c.status === 'A' ? '<span class="hs-tag hs-tag-a">Added</span>' : c.status === 'D' ? '<span class="hs-tag hs-tag-d">Deleted</span>' : '';
  return `<div class="${cls}" role="option" data-i="${i}" aria-selected="${i === sel}">
    <span class="hs-dot"></span>
    <div class="hs-main">
      <div class="hs-subj" dir="auto" title="${esc(c.subject)}">${esc(c.subject || '(no message)')}</div>
      <div class="hs-meta"><button class="hs-hash" data-copy="${c.hash}" title="Copy ${c.hash}">${esc(c.short)}</button>${st}<span class="hs-author" title="${esc(c.author)} &lt;${esc(c.email)}&gt;">${esc(c.author)}</span><span class="hs-date" title="${esc(absTime(c.time))}">${esc(relTime(c.time))}</span></div>
      <div class="hs-abs">${esc(absTime(c.time))}</div>${ren}
    </div></div>`;
}
function renderList() {
  const tip = items.filter((i) => i.kind === 'commit').length > 1
    ? `<div class="hs-tip">${ctx.IS_MAC ? '⌘' : 'Ctrl'}+click a second commit to compare the two</div>` : '';
  const more = log?.truncated ? `<div class="hs-tip">Showing the latest ${log.commits.length.toLocaleString()} commits</div>` : '';
  listEl.innerHTML = items.map(itemHtml).join('') + more + tip;
  if (!items.length) listEl.innerHTML = '<div class="hs-empty"><strong>No commits yet</strong><span>This file has not been committed.</span></div>';
}
function updateListSel() {
  listEl.querySelectorAll('.hs-item').forEach((el) => {
    const i = +el.dataset.i;
    el.classList.toggle('sel', i === sel); el.classList.toggle('cmp', i === cmp);
    el.setAttribute('aria-selected', String(i === sel));
  });
}
function scrollSelIntoView() {
  listEl.querySelector(`.hs-item[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
}

async function copyHash(hash) {
  if (await ctx.copyText(hash)) ctx.toast(`Copied ${hash.slice(0, 12)}`, 1600);
  else ctx.toast("Couldn't copy to the clipboard");
}

function onListClick(e) {
  const hb = e.target.closest('[data-copy]');
  if (hb) { e.stopPropagation(); copyHash(hb.dataset.copy); return; }
  const el = e.target.closest('.hs-item');
  if (!el) return;
  const i = +el.dataset.i;
  if ((e.ctrlKey || e.metaKey || e.shiftKey) && sel >= 0 && i !== sel && items[i].kind === 'commit' && items[sel].kind === 'commit') {
    cmp = cmp === i ? -1 : i;
    updateListSel(); loadDiff();
    return;
  }
  selectItem(i, { immediate: true });
}
function onListKey(e) {
  if (!items.length) return;
  let i = sel;
  switch (e.key) {
    case 'ArrowDown': i = Math.min(items.length - 1, sel + 1); break;
    case 'ArrowUp': i = Math.max(0, sel - 1); break;
    case 'Home': i = 0; break;
    case 'End': i = items.length - 1; break;
    case 'PageDown': i = Math.min(items.length - 1, sel + 8); break;
    case 'PageUp': i = Math.max(0, sel - 8); break;
    case 'Enter': e.preventDefault(); if (items[sel]?.kind === 'commit') viewAtCommit(); return;
    default: return;
  }
  e.preventDefault();
  selectItem(i);
}

function selectItem(i, { immediate = false, force = false } = {}) {
  if (i === sel && !force && !immediate) return;
  if (i !== sel) cmp = -1;
  sel = i;
  updateListSel(); scrollSelIntoView();
  clearTimeout(diffTimer);
  if (immediate) loadDiff();
  else diffTimer = setTimeout(loadDiff, 90);   // holding an arrow key doesn't start a git call per row
}

// ---------------------------------------------------------------- diff
let lastDiff = null;

function detailHtml(it, other) {
  if (it.kind === 'wt') {
    return `<div class="hs-dtitle">Uncommitted changes</div>
      <div class="hs-dmeta">${log.staged ? '<span class="hs-tag">Staged</span>' : ''}${log.unstaged ? '<span class="hs-tag">Unstaged</span>' : ''}<span>Working copy compared with the last commit (HEAD)</span></div>`;
  }
  const c = it.c;
  const viewBtn = c.status === 'D' ? '' : `<button class="hs-btn" data-act="view" title="Show the rendered file as it was in this commit (Enter)">${ICON.eye}<span>View file at this commit</span></button>`;
  if (other) {
    const [a, b] = other;
    return `<div class="hs-dtitle">Comparing two commits</div>
      <div class="hs-dmeta"><button class="hs-hash" data-copy="${a.hash}" title="Copy ${a.hash}">${esc(a.short)}</button><span class="hs-arrow">→</span><button class="hs-hash" data-copy="${b.hash}" title="Copy ${b.hash}">${esc(b.short)}</button>
      <span>${esc(absTime(a.time))} → ${esc(absTime(b.time))}</span></div>
      <div class="hs-dact"><button class="hs-btn" data-act="uncompare">${ICON.back}<span>Back to single commit</span></button></div>`;
  }
  return `<div class="hs-dtitle" dir="auto">${esc(c.subject || '(no message)')}</div>
    <div class="hs-dmeta">
      <button class="hs-hash hs-hash-full" data-copy="${c.hash}" title="Copy full hash">${esc(c.hash.slice(0, 12))}${ICON.copy}</button>
      <span class="hs-author" title="${esc(c.email)}">${esc(c.author)}</span>
      <span title="${esc(relTime(c.time))}">${esc(absTime(c.time))} · ${esc(relTime(c.time))}</span>
      ${c.old_path ? `<span class="hs-ren-d">Renamed ${esc(c.old_path)} → ${esc(c.path)}</span>` : ''}
    </div>
    <div class="hs-dact">${viewBtn}</div>`;
}

async function loadDiff() {
  const it = items[sel];
  if (!it || !git) return;
  const seq = ++diffSeq;
  let other = null, args;
  if (cmp >= 0 && items[cmp]?.kind === 'commit' && it.kind === 'commit') {
    // older → newer, whichever order they were picked in
    const [newer, older] = sel < cmp ? [it.c, items[cmp].c] : [items[cmp].c, it.c];
    other = [older, newer];
    args = { base: older.hash, rev: newer.hash, paths: [...new Set([older.path, newer.path])] };
  } else if (it.kind === 'wt') args = { rev: null, base: null, paths: [git.rel] };
  else args = { rev: it.c.hash, base: null, paths: [...new Set([it.c.old_path, it.c.path].filter(Boolean))] };
  detailEl.innerHTML = detailHtml(it, other);
  diffEl.classList.add('busy');
  let res;
  try { res = await ctx.host.gitDiff(git.root, args); }
  catch (e) { if (seq === diffSeq) { diffEl.classList.remove('busy'); diffEl.innerHTML = errorHtml(e); lastDiff = null; } return; }
  if (seq !== diffSeq) return;
  diffEl.classList.remove('busy');
  lastDiff = { res, files: parsePatch(res.patch) };
  paintDiff(lastDiff);
  diffEl.scrollTop = 0;
}

function paintDiff({ res, files }) {
  const { add, del } = stats(files);
  const out = renderDiff(files, { split });
  const notes = [];
  if (res.truncated) notes.push('This diff is very large; only its first 4 MB are shown.');
  if (out.total > out.shown) notes.push(`Showing the first ${MAX_LINES.toLocaleString()} of ${out.total.toLocaleString()} changed lines.`);
  const f = files[0];
  const kind = f?.status === 'A' ? 'File added' : f?.status === 'D' ? 'File deleted' : f?.status === 'R' ? 'File renamed' : '';
  const bar = files.length
    ? `<div class="hs-stat"><span class="hs-add">+${add.toLocaleString()}</span><span class="hs-del">−${del.toLocaleString()}</span>${kind ? `<span class="hs-kind">${kind}</span>` : ''}<span class="hs-path" dir="auto">${esc(f.newPath || f.oldPath || '')}</span></div>`
    : '';
  const body = !files.length
    ? '<div class="hs-empty"><strong>No changes to this file</strong><span>Git reports no differences here.</span></div>'
    : out.html || (f.status === 'R' ? '<div class="df-note">Renamed without changes to its content.</div>' : '<div class="df-note">No line changes (only the file mode changed).</div>');
  diffEl.innerHTML = bar + notes.map((n) => `<div class="df-note df-warn">${esc(n)}</div>`).join('') + body;
}

function onDetailClick(e) {
  const hb = e.target.closest('[data-copy]');
  if (hb) { copyHash(hb.dataset.copy); return; }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'view') viewAtCommit();
  if (act === 'uncompare') { cmp = -1; updateListSel(); loadDiff(); }
}

// ---------------------------------------------------------------- file at a commit
async function viewAtCommit() {
  const it = items[sel];
  if (!it || it.kind !== 'commit' || it.c.status === 'D') return;
  const c = it.c;
  let content;
  try { content = await ctx.host.gitFile(git.root, c.hash, c.path); }
  catch (e) { ctx.toast(`Couldn't read this version: ${e?.message || e}`); return; }
  hide();
  await ctx.showRevision(content, { hash: c.hash, short: c.short, subject: c.subject, time: c.time, path: c.path });
}

/** Called by the app after every document is shown, to add or remove the revision banner. */
export function docShown(doc) {
  const rev = doc?.revision;
  if (!rev) { banner?.remove(); banner = null; root.classList.remove('at-revision'); return; }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'mk-revbar';
    banner.setAttribute('role', 'status');
    banner.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'history') show();
      if (act === 'current') ctx.returnToCurrent();
      const hb = e.target.closest('[data-copy]');
      if (hb) copyHash(hb.dataset.copy);
    });
  }
  if (banner.dataset.hash !== rev.hash) banner.innerHTML = `<span class="rv-icon">${ICON.history}</span>
    <span class="rv-text">Earlier version <button class="hs-hash" data-copy="${rev.hash}" title="Copy ${rev.hash}">${esc(rev.short)}</button>
    <span class="rv-subj" dir="auto">${esc(rev.subject)}</span><span class="rv-date">· ${esc(absTime(rev.time))}</span><span class="rv-ro">Read-only</span></span>
    <button class="hs-btn" data-act="history">${ICON.back}<span>Back to history</span></button>
    <button class="hs-btn hs-btn-primary" data-act="current">${ICON.pencil}<span>Return to current version</span></button>`;
  banner.dataset.hash = rev.hash;
  const scroller = document.getElementById('mk-scroller');
  if (banner.parentNode !== scroller) scroller.prepend(banner);
  root.classList.add('at-revision');
}
