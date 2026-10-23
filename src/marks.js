// Pins (spots to come back to) and highlights for the file on screen, kept in localStorage per
// file: the files themselves are never written. Loaded on first use, or when opening a file that
// has either; marks.css comes with it. Continuing where you left off is in app.js (every file).
//
// A pin is anchored to a block (heading, paragraph, list item, code line, …) by the start of its
// text, falling back to its section and then to its position among the blocks; a highlight to its
// exact text plus a little of the text around it. So both survive edits to the file and reloads.

let ctx = null;
let file = null;            // { key, pins, hls } for the file on screen, or null
let placed = { pins: [], hls: [] }; // where they are now: pins → elements, highlights → ranges
let index = null;           // text of the document (see textIndex), cached until the next apply

const BLOCKS = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,dt,dd,summary,.code-block,.table-wrap,.markdown-alert,.mermaid-block,.math-block,.vl,.vw-table tbody tr';
const SKIP = '.katex-mathml, .heading-anchor, svg, .vw-bar, .code-head';
const CONTEXT = 32;
const MAX_HL = 5000;

export async function init(c) {
  ctx = c;
  if (!document.querySelector('link[href="marks.css"]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = 'marks.css';
    const loaded = new Promise((r) => { l.onload = l.onerror = r; });
    document.head.appendChild(l);
    await loaded;
  }
  ctx.list.addEventListener('click', onListClick);
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const shorten = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const isHeading = (el) => /^H[1-6]$/.test(el.tagName);
/** The text of a block as the reader sees it (no heading "#" anchor). */
const blockText = (el) => norm(isHeading(el) ? el.textContent.replace(/^#\s*/, '') : el.textContent);

// ---------------------------------------------------------------- storage
const storeKey = () => 'marks.' + file.key;
function save() {
  if (!file) return;
  if (file.pins.length || file.hls.length) ctx.LS.set(storeKey(), { pins: file.pins, hls: file.hls });
  else ctx.LS.del(storeKey());
}

/** Shows the marks of `doc` (a file read by the host; null or an earlier version: none). */
export function docShown(doc) {
  file = doc && !doc.revision ? { key: ctx.fileKey(doc.path), pins: [], hls: [] } : null;
  if (file) Object.assign(file, ctx.LS.get(storeKey(), {}));
  apply();
}

/** Places them again once the document is complete (math and diagrams drawn) or a view option
 *  changed it. */
export const refresh = () => apply(true);

// ---------------------------------------------------------------- text index
// The document's text as one string, with the text node each part comes from, so a selection can
// be stored as offsets into it and offsets turned back into ranges.
function textIndex() {
  if (index && index.nodes[0]?.isConnected !== false) return index;
  const nodes = [], starts = [];
  let full = '';
  const w = document.createTreeWalker(ctx.content, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n; (n = w.nextNode());) { nodes.push(n); starts.push(full.length); full += n.nodeValue; }
  return (index = { nodes, starts, full });
}
/** The offset in the text index of the boundary point (node, off). */
function offsetOf(ix, node, off) {
  const r = new Range(); r.setStart(node, off);
  let lo = 0, hi = ix.nodes.length; // first indexed text node that starts after the point
  while (lo < hi) { const mid = (lo + hi) >> 1; if (r.comparePoint(ix.nodes[mid], 0) > 0) hi = mid; else lo = mid + 1; }
  if (lo > 0 && ix.nodes[lo - 1] === node) return ix.starts[lo - 1] + off;
  return lo < ix.nodes.length ? ix.starts[lo] : ix.full.length;
}
function pointAt(ix, o) {
  let lo = 0, hi = ix.nodes.length - 1; // last text node starting at or before o
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ix.starts[mid] <= o) lo = mid; else hi = mid - 1; }
  return [ix.nodes[lo], Math.min(o - ix.starts[lo], ix.nodes[lo].nodeValue.length)];
}
function rangeAt(ix, s, e) {
  const r = new Range(); r.setStart(...pointAt(ix, s)); r.setEnd(...pointAt(ix, e));
  return r;
}
const commonPrefix = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
const commonSuffix = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++; return i; };
/** Where highlight `h` is in the text now: the occurrence of its text whose surroundings match best. */
function locate(ix, h) {
  let best = -1, score = -Infinity;
  for (let i = ix.full.indexOf(h.text), k = 0; i !== -1 && k < 2000; i = ix.full.indexOf(h.text, i + 1), k++) {
    const around = commonSuffix(h.pre, ix.full.slice(Math.max(0, i - CONTEXT), i)) + commonPrefix(h.post, ix.full.slice(i + h.text.length, i + h.text.length + CONTEXT));
    const sc = around * 1e7 - Math.abs(i - h.at);
    if (sc > score) { score = sc; best = i; }
  }
  return best;
}

// ---------------------------------------------------------------- placing
function apply(complete = false) {
  index = null; lastStep = null;
  for (const p of placed.pins) p.el.classList.remove('pinned');
  placed = { pins: [], hls: [] };
  if (file && (file.pins.length || file.hls.length)) {
    // Marks found in text that was edited are anchored to the new text, so they keep up with edits
    // (only in the complete document: math is still TeX source before it is drawn).
    let moved = false;
    const blocks = file.pins.length ? [...ctx.content.querySelectorAll(BLOCKS)] : [];
    const texts = blocks.map(blockText);
    for (const pin of file.pins) {
      const i = findBlock(blocks, texts, pin);
      const el = i >= 0 ? blocks[i] : fallbackBlock(blocks, pin);
      if (!el || el.classList.contains('pinned')) continue;
      el.classList.add('pinned'); placed.pins.push({ pin, el });
      if (complete && i >= 0 && (pin.n !== i || pin.text !== texts[i].slice(0, 80))) { pin.n = i; pin.text = texts[i].slice(0, 80); moved = true; }
    }
    placed.pins.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    if (file.hls.length) {
      const ix = textIndex();
      for (const h of file.hls) {
        const s = locate(ix, h), e = s + h.text.length;
        if (s < 0) continue;
        placed.hls.push({ h, s, e, range: rangeAt(ix, s, e) });
        if (!complete) continue;
        const pre = ix.full.slice(Math.max(0, s - CONTEXT), s), post = ix.full.slice(e, e + CONTEXT);
        if (h.at !== s || h.pre !== pre || h.post !== post) { Object.assign(h, { at: s, pre, post }); moved = true; }
      }
      placed.hls.sort((a, b) => a.s - b.s);
    }
    if (moved) save();
  }
  paint();
  renderList();
}
/** The index of the block of the same kind that starts most like the pinned one (at least 24
 *  characters, or all of a shorter text), the nearest one on a tie; -1 when none does. */
function findBlock(blocks, texts, pin) {
  const need = Math.min(pin.text.length, 24);
  let best = -1, most = 0, dist = Infinity;
  texts.forEach((t, i) => {
    if (pin.tag && blocks[i].tagName !== pin.tag) return;
    const c = commonPrefix(t, pin.text), d = Math.abs(i - pin.n);
    if (c >= need && (c > most || (c === most && d < dist))) { best = i; most = c; dist = d; }
  });
  return best;
}
/** Where a pin goes when its text is gone: the section it was in, else the same position. */
const fallbackBlock = (blocks, pin) =>
  (pin.h && ctx.content.querySelector(`[id="${CSS.escape(pin.h)}"]`)) || blocks[Math.min(pin.n, blocks.length - 1)] || null;
function paint() {
  if (!ctx.hasHighlights) return;
  if (!placed.hls.length) { CSS.highlights.delete('mk-hl'); return; }
  const hl = new Highlight(...placed.hls.map((p) => p.range));
  hl.priority = -1; // find's matches paint over highlights
  CSS.highlights.set('mk-hl', hl);
}

// ---------------------------------------------------------------- the sidebar list
const PIN_ICON = '<svg viewBox="0 0 24 24"><path d="M9.5 3.5h5l-.8 5.6 3.3 3.4H7l3.3-3.4z"/><path d="M12 12.5V20"/></svg>';
const HL_ICON = '<svg viewBox="0 0 24 24"><path d="m14.5 5 4.5 4.5-7.5 7.5H7v-4.5z"/><path d="M4 20.5h16"/></svg>';
const X_ICON = '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7 7 17"/></svg>';
function pinLabel(el) {
  if (el.classList.contains('vl')) return `Line ${[...el.parentNode.children].indexOf(el) + 1} · ${blockText(el) || '(blank)'}`;
  if (el.tagName === 'TR') return `Row ${el.cells[0].textContent} · ${[...el.cells].slice(1).map((c) => norm(c.textContent)).join(' · ')}`;
  if (el.classList.contains('code-block')) return `Code · ${norm(el.querySelector('code')?.textContent || '')}`;
  return blockText(el) || el.tagName.toLowerCase();
}
function renderList() {
  const row = (k, icon, label, title, x) => `<div class="mk-row"><button class="mk-go" data-k="${k}" title="${esc(title)}" dir="auto">${icon}<span>${esc(label)}</span></button>` +
    `<button class="mk-x" data-x="${k}" title="${x}" aria-label="${x}">${X_ICON}</button></div>`;
  const pins = placed.pins.map((p, i) => { const l = pinLabel(p.el); return row(`p${i}`, PIN_ICON, shorten(l, 80), l, 'Unpin'); }).join('');
  const hls = placed.hls.map((p, i) => row(`h${i}`, HL_ICON, `“${shorten(norm(p.h.text), 70)}”`, norm(p.h.text), 'Remove highlight')).join('');
  ctx.list.innerHTML = (pins ? `<div class="toc-head">Pinned</div>${pins}` : '') + (hls ? `<div class="toc-head">Highlights</div>${hls}` : '');
  ctx.root.classList.toggle('has-marks', !!(pins || hls));
}
function onListClick(e) {
  const x = e.target.closest('[data-x]'), go = e.target.closest('[data-k]');
  const k = (x || go)?.dataset[x ? 'x' : 'k'];
  if (!k) return;
  const item = (k[0] === 'p' ? placed.pins : placed.hls)[+k.slice(1)];
  if (!item) return;
  if (x) { k[0] === 'p' ? removePin(item.pin) : removeHighlight(item.h); ctx.focusContent(); return; }
  if (k[0] === 'p') goToPin(item); else goToHighlight(item);
}

// ---------------------------------------------------------------- going there
function flashEl(el) {
  el.classList.remove('mk-flash'); void el.offsetWidth; el.classList.add('mk-flash');
  setTimeout(() => el.classList.remove('mk-flash'), 1500);
}
/** The scroll position that shows a pinned block: headings at the top, others a quarter down. */
function pinTop(el) {
  const s = ctx.scroller, max = s.scrollHeight - s.clientHeight;
  const y = s.scrollTop + el.getBoundingClientRect().top - s.getBoundingClientRect().top - (isHeading(el) ? 16 : s.clientHeight / 4);
  return Math.round(Math.max(0, Math.min(max, y)));
}
function goToPin({ el }) {
  el.closest('details')?.setAttribute('open', '');
  ctx.scroller.scrollTo({ top: pinTop(el), behavior: 'smooth' });
  flashEl(el);
}
function goToHighlight({ range }) {
  range.startContainer.parentElement.closest('details')?.setAttribute('open', '');
  const rect = range.getBoundingClientRect(), sr = ctx.scroller.getBoundingClientRect();
  ctx.scroller.scrollBy({ top: rect.top - sr.top - sr.height / 3, behavior: 'smooth' });
  if (!ctx.hasHighlights) return;
  CSS.highlights.set('mk-hl-now', new Highlight(range));
  setTimeout(() => CSS.highlights.delete('mk-hl-now'), 1500);
}
let lastStep = null; // the pin F2 went to last: { i, top, t }
/** Goes to the next (dir 1) or previous (-1) pin: after the one gone to last while the window is
 *  still there, else after the spot on screen. Wraps around at either end. */
export function step(dir) {
  if (!file) return;
  const n = placed.pins.length;
  if (!n) { ctx.toast(`No pins in this file. Right-click a paragraph and choose Pin this spot (${ctx.keys.pin}).`, 4000); return; }
  const now = ctx.scroller.scrollTop;
  let i;
  if (lastStep && (Math.abs(now - lastStep.top) < 4 || Date.now() - lastStep.t < 800)) i = (lastStep.i + dir + n) % n;
  else {
    const tops = placed.pins.map((p) => pinTop(p.el));
    i = dir > 0 ? tops.findIndex((t) => t > now + 4) : tops.findLastIndex((t) => t < now - 4);
    if (i < 0) i = dir > 0 ? 0 : n - 1;
  }
  goToPin(placed.pins[i]);
  lastStep = { i, top: pinTop(placed.pins[i].el), t: Date.now() };
}

// ---------------------------------------------------------------- pins
/** The block a pin at `el` (or at height y, or at the top of the window) is for. */
function blockFor(el, y) {
  const b = el?.closest?.(BLOCKS);
  if (b && ctx.content.contains(b)) return b;
  const top = y ?? ctx.scroller.getBoundingClientRect().top + 8;
  return [...ctx.content.querySelectorAll(BLOCKS)].find((x) => x.getBoundingClientRect().bottom > top) || null;
}
/** Pins the block at `el` (or the one at the top of the window), or unpins it when it has a pin. */
export function togglePin(el, y) {
  if (!file) return;
  const block = blockFor(el, y);
  if (!block) return;
  const here = placed.pins.find((p) => p.el === block || block.contains(p.el) || p.el.contains(block));
  if (here) { removePin(here.pin); ctx.toast('Unpinned', 1400); return; }
  const blocks = [...ctx.content.querySelectorAll(BLOCKS)];
  let h = null;
  for (const b of blocks) { if (isHeading(b) && b.id) h = b.id; if (b === block) break; }
  file.pins.push({ text: blockText(block).slice(0, 80), tag: block.tagName, n: blocks.indexOf(block), h, t: Date.now() });
  save(); apply();
  ctx.toast(`Pinned · ${ctx.keys.next} goes to the next pin`, 2200);
}
function removePin(pin) {
  file.pins = file.pins.filter((p) => p !== pin);
  save(); apply();
}

// ---------------------------------------------------------------- highlights
function selectionInContent(r) {
  if (!r) {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    r = sel.getRangeAt(0);
  }
  return !r.collapsed && ctx.content.contains(r.commonAncestorContainer) ? r : null;
}
function selectionSpan(r) {
  const ix = textIndex();
  let s = offsetOf(ix, r.startContainer, r.startOffset), e = offsetOf(ix, r.endContainer, r.endOffset);
  while (s < e && /\s/.test(ix.full[s])) s++;
  while (e > s && /\s/.test(ix.full[e - 1])) e--;
  return s < e ? [s, e] : null;
}
/** What the right-click menu offers at the point (x, y) for the current selection. */
export function menuState(x, y) {
  if (!file || !ctx.hasHighlights) return {};
  const r = selectionInContent();
  if (r) {
    const span = selectionSpan(r);
    return { canHighlight: !!span, selHighlight: span && placed.hls.find((p) => p.s <= span[0] && span[1] <= p.e)?.h };
  }
  const pos = document.caretPositionFromPoint?.(x, y);
  const pt = pos ? [pos.offsetNode, pos.offset] : (() => { const c = document.caretRangeFromPoint?.(x, y); return c && [c.startContainer, c.startOffset]; })();
  if (!pt || !ctx.content.contains(pt[0])) return {};
  const o = offsetOf(textIndex(), ...pt);
  return { atHighlight: placed.hls.find((p) => p.s <= o && o < p.e)?.h };
}
/** Highlights the text of `range` (default: the selection), joining any highlight it overlaps. */
export function highlightSelection(range) {
  const r = file && selectionInContent(range);
  const span = r && selectionSpan(r);
  if (!span) return;
  let [s, e] = span;
  if (e - s > MAX_HL) { ctx.toast(`Select less text to highlight (at most ${MAX_HL.toLocaleString()} characters)`); return; }
  const joined = placed.hls.filter((p) => p.s < e && s < p.e);
  for (const p of joined) { s = Math.min(s, p.s); e = Math.max(e, p.e); }
  const full = textIndex().full;
  file.hls = file.hls.filter((h) => !joined.some((p) => p.h === h));
  file.hls.push({ text: full.slice(s, e), pre: full.slice(Math.max(0, s - CONTEXT), s), post: full.slice(e, e + CONTEXT), at: s, t: Date.now() });
  getSelection().removeAllRanges();
  save(); apply();
}
export function removeHighlight(h) {
  if (!file || !h) return;
  file.hls = file.hls.filter((x) => x !== h);
  save(); apply();
}
