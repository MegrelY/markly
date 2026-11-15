// "Copy reference": the file, the lines and a quote of a selection or a spot in it, to point an agent
// (or a person) at exactly that place. Loaded on first use.
//
//   docs/guide.md:42-45 (Install › Windows)
//   > Run the setup file. It installs for the current user only.
//
// Markdown blocks carry the lines they were rendered from (data-line, render.js); a selection inside
// a paragraph is narrowed to its own lines by finding its words in the source. Text and code files
// are shown one row per line (viewer.js); in the Formatted view, rows are matched back to the file.
//
// "Go to" (Ctrl+G) is the way back: paste a reference (or type a line number) to open the file at
// those lines.

// { content, scroller, getCurrent, getGit, formattedText, openFile, toast, closeFind, focusContent,
//   resolvePath, isAbsolute, dirname } (path helpers come from the start-up bundle, not imported, so
//   this chunk shares no code with it)
let ctx = null;

export function init(c) { ctx = c; }

const SKIP = '.heading-anchor, .code-head, .katex-mathml, .vw-bar, .vn, .mermaid-status, script, style';
const MAX_QUOTE = 400;      // characters of prose
const MAX_CODE_LINES = 12;

const norm = (s) => s.replace(/\s+/g, ' ').trim();
const count = (s, ch) => { let n = 0; for (let i = s.indexOf(ch); i !== -1; i = s.indexOf(ch, i + 1)) n++; return n; };
const skel = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); // letters and digits only
const elementOf = (node) => (node?.nodeType === 1 ? node : node?.parentElement) || null;
const linesOf = (text) => text.replace(/\r\n?/g, '\n').split('\n');

/**
 * The reference to `range` (a selection in the document) if given, else to the spot at `el` / `x`,
 * `y` (a right-click), else to the top of the window. Returns { text, label } or null.
 */
export function reference({ range = null, el = null, x = null, y = null } = {}) {
  const doc = ctx.getCurrent();
  if (!doc) return null;
  if (range && (range.collapsed || !ctx.content.contains(range.commonAncestorContainer))) range = null;
  const spot = (doc.view ? fileSpot : markdownSpot)(doc, { range, el, x, y }) || {};
  const rev = doc.revision;
  const git = ctx.getGit();
  const path = (rev && rev.path) || (git && git.available && git.rel) || doc.path;
  const notes = [spot.section?.length ? spot.section.join(' › ') : '', spot.note || '', rev ? `as of commit ${rev.short}` : ''].filter(Boolean);
  let loc = path + (spot.a ? `:${spot.a}${spot.b && spot.b !== spot.a ? '-' + spot.b : ''}` : '');
  const label = loc;
  if (/\s/.test(loc)) loc = '`' + loc + '`';
  let text = notes.length ? `${loc} (${notes.join('; ')})` : loc;
  if (spot.quote) text += '\n' + quoteBlock(spot.quote, spot.lang);
  return { text, label };
}

function quoteBlock(quote, lang) {
  if (lang != null) { // code, verbatim
    let lines = quote.replace(/\n+$/, '').split('\n');
    if (lines.length > MAX_CODE_LINES) lines = [...lines.slice(0, MAX_CODE_LINES), '…'];
    const body = lines.join('\n');
    const fence = '`'.repeat(Math.max(3, ...[...body.matchAll(/`+/g)].map((m) => m[0].length + 1)));
    return `${fence}${lang}\n${body}\n${fence}`;
  }
  let lines = quote.split('\n').map(norm).filter(Boolean);
  let total = 0;
  const kept = [];
  for (const l of lines) {
    if (total + l.length > MAX_QUOTE) {
      const room = MAX_QUOTE - total;
      if (room > 20 || !kept.length) kept.push(l.slice(0, Math.max(room, 20)).replace(/\s+\S*$/, '') + ' …');
      else kept[kept.length - 1] += ' …';
      break;
    }
    kept.push(l); total += l.length;
  }
  lines = kept;
  return lines.map((l) => '> ' + l).join('\n');
}

// ---------------------------------------------------------------- shared helpers
/** The text of `range` as read: user-interface parts left out, a line break between blocks. */
function rangeText(range, blockSel) {
  const root = elementOf(range.commonAncestorContainer);
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (range.intersectsNode(n) && !n.parentElement.closest(SKIP) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  let out = '', lastBlock = null;
  for (let n; (n = walk.nextNode());) {
    let t = n.data;
    if (n === range.endContainer) t = t.slice(0, range.endOffset);
    if (n === range.startContainer) t = t.slice(range.startOffset);
    const block = n.parentElement.closest(blockSel);
    if (lastBlock && block !== lastBlock && !out.endsWith('\n')) out += '\n';
    out += t; lastBlock = block;
  }
  return out;
}
/** The text of an element as read (no heading "#", no code block header). */
function elementText(el) {
  const r = document.createRange();
  r.selectNodeContents(el);
  return rangeText(r, '[data-line], li, p, tr, td, th');
}
/** Where the caret would go at (x, y), as { node, offset }. */
function caretAt(x, y) {
  if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); return p ? { node: p.offsetNode, offset: p.offset } : null; }
  const r = document.caretRangeFromPoint?.(x, y);
  return r ? { node: r.startContainer, offset: r.startOffset } : null;
}
/** The top of the reading area: below the window edge and anything that stays on top there. */
function readingTop() {
  let top = ctx.scroller.getBoundingClientRect().top + 8;
  for (const el of document.querySelectorAll('#mk-revbar, #mk-content .vw-bar')) {
    const r = el.getBoundingClientRect();
    if (r.height) top = Math.max(top, r.bottom + 4);
  }
  return top;
}
/** The first of `els` (in vertical order) whose bottom is below `y`. */
function firstBelow(els, y) {
  let lo = 0, hi = els.length - 1, hit = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (els[mid].getBoundingClientRect().bottom > y) { hit = els[mid]; hi = mid - 1; } else lo = mid + 1;
  }
  return hit;
}

// ---------------------------------------------------------------- Markdown
function markdownSpot(doc, { range, el, x, y }) {
  const src = linesOf(doc.content);
  const blockOf = (node) => { const b = elementOf(node)?.closest('[data-line]'); return b && ctx.content.contains(b) ? b : null; };
  /** A block's lines, without the blank lines a list item or quote may end with. */
  const linesOfBlock = (b) => {
    const a = +b.dataset.line;
    let z = Math.max(a, +b.dataset.lineEnd || a);
    while (z > a && !(src[z - 1] || '').trim()) z--;
    return [a, z];
  };
  const codeOf = (node) => elementOf(node)?.closest('code[data-code-line]') || null;
  /** The source line of a position in a code block; `end` steps back from the start of a line. */
  const codeLine = (code, node, offset, end) => {
    const r = document.createRange();
    r.selectNodeContents(code);
    r.setEnd(node, offset);
    const before = r.toString();
    const last = count(code.textContent.replace(/\n$/, ''), '\n');
    let n = count(before, '\n');
    if (end && n > 0 && before.endsWith('\n')) n--;
    return +code.dataset.codeLine + Math.min(n, last);
  };
  /** The block at a position; between blocks, the next one (or, for an end, the one before). */
  const blockAtPos = (node, offset, end) => {
    if (node.nodeType === 1 && node.childNodes.length) {
      const kids = node.childNodes;
      node = kids[Math.max(0, Math.min(end ? offset - 1 : offset, kids.length - 1))];
    }
    const b = blockOf(node);
    if (b || node.nodeType !== 1) return b;
    const inside = node.querySelectorAll('[data-line]');
    return inside.length ? (end ? inside[inside.length - 1] : inside[0]) : null;
  };
  const codeText = (code, n) => code.textContent.split('\n')[n - +code.dataset.codeLine] ?? '';
  // the language the fence was given (its label), "" for plain text
  const codeLang = (code) => (code.closest('.code-block')?.querySelector('.code-lang')?.textContent || '').replace(/^text$/, '');

  if (range) {
    const startCode = codeOf(range.startContainer), endCode = codeOf(range.endContainer);
    const startBlock = blockAtPos(range.startContainer, range.startOffset, false);
    const endBlock = blockAtPos(range.endContainer, range.endOffset, true) || startBlock;
    if (!startBlock && !startCode) return { quote: rangeText(range, '[data-line], li, p, tr') };
    const a = startCode ? codeLine(startCode, range.startContainer, range.startOffset, false)
      : refineLine(src, startBlock, linesOfBlock(startBlock), range, false);
    const b = endCode ? codeLine(endCode, range.endContainer, range.endOffset, true)
      : refineLine(src, endBlock, linesOfBlock(endBlock), range, true);
    const inOneCode = startCode && startCode === endCode;
    return {
      a: Math.min(a, b), b: Math.max(a, b),
      section: sectionOf(startCode || startBlock),
      quote: inOneCode ? range.toString() : rangeText(range, '[data-line], li, p, tr, td, th'),
      lang: inOneCode ? codeLang(startCode) : null,
    };
  }

  // A spot: the block (or code line) under the pointer, or at the top of the window.
  let block = el && ctx.content.contains(el) ? blockOf(el) : null;
  let px = x, py = y;
  if (!block) {
    const top = readingTop();
    const all = [...ctx.content.querySelectorAll('[data-line]')].filter((b) => !b.parentElement.closest('[data-line]'));
    block = firstBelow(all, top);
    // the innermost block there (a list item rather than its list, a row rather than its table)
    for (let inner; block && (inner = [...block.querySelectorAll('[data-line]')].find((c) => c.getBoundingClientRect().bottom > top));) block = inner;
    if (block) { const r = block.getBoundingClientRect(); px = r.left + 12; py = Math.max(r.top + 4, top); }
  }
  if (!block) return null;
  // a code line: the pointer is on a code block, or the code block is at the top of the window
  const codeHost = el ? elementOf(el).closest('.code-block, pre') : block.matches('.code-block, pre') ? block : null;
  const code = codeHost && ctx.content.contains(codeHost) ? codeHost.querySelector('code[data-code-line]') : null;
  if (code && px != null) {
    const pre = code.closest('pre').getBoundingClientRect();
    const c = caretAt(Math.max(px, pre.left + 2), Math.min(Math.max(py, pre.top + 2), pre.bottom - 2));
    const n = c && code.contains(c.node) ? codeLine(code, c.node, c.offset, false) : +code.dataset.codeLine;
    return { a: n, b: n, section: sectionOf(block), quote: codeText(code, n), lang: codeLang(code) };
  }
  const [a, b] = linesOfBlock(block);
  return { a, b, section: sectionOf(block), quote: block.tagName === 'TR' ? [...block.cells].map((c) => norm(c.textContent)).join(' | ') : elementText(block) };
}

/**
 * The source line where `range` starts (or ends, with `end`) inside `block`, whose source is lines
 * a..z. The selected words are looked up in the source, letters and digits only, so Markdown syntax
 * around them (**bold**, [links](…)) doesn't get in the way. Falls back to the block's first or last
 * line.
 */
function refineLine(src, block, [a, z], range, end) {
  if (a === z) return a;
  let s = '';
  const at = [];
  for (let i = a; i <= z; i++) { const k = skel(src[i - 1] || ''); s += k; for (let j = 0; j < k.length; j++) at.push(i); }
  // the part of the selection inside this block, and the text of the block before it
  const inner = document.createRange();
  inner.selectNodeContents(block);
  if (block.contains(range.startContainer)) inner.setStart(range.startContainer, range.startOffset);
  if (block.contains(range.endContainer)) inner.setEnd(range.endContainer, range.endOffset);
  const before = document.createRange();
  before.selectNodeContents(block);
  before.setEnd(inner.startContainer, inner.startOffset);
  const sel = skel(inner.toString()), pre = skel(before.toString());
  if (!sel) return end ? z : a;
  for (const len of [24, 12, 6]) {
    const key = end ? sel.slice(-len) : sel.slice(0, len);
    const want = end ? pre.length + sel.length - key.length : pre.length; // where it would be with no syntax
    let best = -1;
    for (let i = s.indexOf(key); i !== -1; i = s.indexOf(key, i + 1)) if (best < 0 || Math.abs(i - want) < Math.abs(best - want)) best = i;
    if (best >= 0) return at[end ? best + key.length - 1 : best];
    if (key.length < len) break; // the whole selection was tried
  }
  return end ? z : a;
}

/** The headings above `el`, outermost first (at most the three nearest levels). */
function sectionOf(el) {
  if (!el) return [];
  const stack = [];
  for (const h of ctx.content.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    if (h === el || h.contains(el) || (el.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
    const level = +h.tagName[1];
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    stack.push({ level, text: norm(elementText(h)) });
  }
  return stack.slice(-3).map((s) => s.text).filter(Boolean);
}

// ---------------------------------------------------------------- text, code and data files
function fileSpot(doc, { range, el, x, y }) {
  const type = doc.view;
  const lang = type.kind === 'text' ? null : (type.lang || '');
  const body = ctx.content.querySelector('.vw-body') || ctx.content;
  // CSV/TSV table: one table row per record, which knows its line (viewer.js)
  const rows = body.querySelectorAll('.vw-table tr[data-line]');
  if (rows.length) {
    const rowOf = (node) => elementOf(node)?.closest('tr[data-line]');
    let r1, r2;
    if (range) { r1 = rowOf(range.startContainer); r2 = rowOf(range.endContainer) || r1; }
    else { r1 = r2 = (el && rowOf(el)) || firstBelow([...rows], readingTop()); }
    if (!r1) return null;
    const a = +r1.dataset.line, b = +r2.dataset.line;
    const cells = (tr) => [...tr.cells].filter((c) => !c.classList.contains('vw-rn')).map((c) => norm(c.textContent)).join(' | ');
    return { a: Math.min(a, b), b: Math.max(a, b), quote: range ? rangeText(range, 'tr') : cells(r1) };
  }
  const code = body.querySelector('.vw-lines code');
  if (!code) return null; // HTML preview, binary file
  const formatted = ctx.formattedText();
  const shown = linesOf(formatted ?? doc.content);
  const rowEls = code.querySelectorAll(':scope > .vl');
  // the shown line (1-based) at a position
  const lineAt = (node, offset, end) => {
    if (rowEls.length) {
      let row = elementOf(node)?.closest('.vl');
      if (!row && node === code) row = rowEls[Math.min(end ? offset - 1 : offset, rowEls.length - 1)];
      if (!row) return null;
      let i = Array.prototype.indexOf.call(rowEls, row);
      if (end && i > 0) { // a selection that ends at the very start of a row ends on the row before
        const r = document.createRange(); r.selectNodeContents(row); r.setEnd(node, offset);
        if (!r.toString() && row.contains(node)) i--;
      }
      return i + 1;
    }
    const r = document.createRange(); r.selectNodeContents(code); r.setEnd(node, offset); // one block: count lines
    const before = r.toString();
    let n = count(before, '\n');
    if (end && n > 0 && before.endsWith('\n')) n--;
    return n + 1;
  };
  let s1, s2;
  if (range) { s1 = lineAt(range.startContainer, range.startOffset, false); s2 = lineAt(range.endContainer, range.endOffset, true) ?? s1; }
  else if (rowEls.length) {
    const row = (el && elementOf(el)?.closest('.vl')) || firstBelow([...rowEls], readingTop());
    s1 = s2 = row ? Array.prototype.indexOf.call(rowEls, row) + 1 : null;
  } else {
    const r = code.getBoundingClientRect();
    const c = caretAt(x ?? r.left + 4, Math.max(y ?? readingTop(), r.top + 2));
    s1 = s2 = c && code.contains(c.node) ? lineAt(c.node, c.offset, false) : 1;
  }
  if (!s1) return null;
  if (s2 < s1) [s1, s2] = [s2, s1];
  // a selection within a row as selected; across rows, the whole lines (rows hold no line breaks)
  const quote = range && s1 === s2 ? range.toString() : shown.slice(s1 - 1, s2).join('\n');
  if (!formatted) return { a: s1, b: s2, quote, lang };
  // Formatted view: the rows aren't the file's lines; find them in the file
  const file = linesOf(doc.content);
  const a = mapLine(shown, file, s1, false), b = mapLine(shown, file, s2, true);
  if (a && b) return { a: Math.min(a, b), b: Math.max(a, b), quote, lang };
  return { quote, lang, note: 'in the Formatted view' };
}

/**
 * Line `n` (1-based) of the text `from` as a line of `to`, where one is a file and the other the same
 * file in the Formatted view; or null. Lines are matched by their text, nearest to where they would
 * be; a minified file is all one line.
 */
function mapLine(from, to, n, end) {
  const oneLine = (l) => l.length === 1 || (l.length === 2 && l[1] === '');
  if (from.length === to.length && from.every((l, i) => l === to[i])) return n;
  if (oneLine(to) || oneLine(from)) return 1;
  for (let i = n - 1, step = 0; step < 50 && i >= 0 && i < from.length; step++, i += end ? -1 : 1) {
    const t = from[i].trim();
    if (t.length < 2) continue; // a lone brace says nothing; try the next line
    const want = Math.round(i * to.length / from.length);
    let best = -1;
    for (const exact of [true, false]) {
      to.forEach((l, j) => { if ((exact ? l.trim() === t : l.includes(t)) && (best < 0 || Math.abs(j - want) < Math.abs(best - want))) best = j; });
      if (best >= 0) break;
    }
    if (best >= 0) return best + 1;
  }
  return null;
}

// ---------------------------------------------------------------- go to a reference (Ctrl+G)
/**
 * { path, a, b } from a reference as agents, terminals and pull requests write it, or null. `path` is
 * '' for the open file; `a`/`b` are 0 for no lines. Takes the first line of what was pasted, so a whole
 * reference copied with Copy reference works too. Understood:
 *   42   42-45   docs/guide.md   docs/guide.md:42   docs/guide.md:42-45   docs/guide.md:42:7 (column)
 *   @docs/guide.md   guide.md#L42-L45   https://github.com/owner/repo/blob/main/docs/guide.md#L42
 * Quotes or backticks around it, and "(the section)" after it, are left out.
 */
export function parseRef(text) {
  let s = (text || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
  // a whole reference pasted as one line: what follows its lines (section, quote) is left out
  s = s.replace(/^(.*?(?::\d+(?:\s*[-–]\s*\d+)?(?::\d+)?|#L\d+(?:-L?\d+)?))\s.*$/, '$1');
  s = s.replace(/\s+\([^()]*\)$/, '').replace(/^[`'"<]+|[`'">]+$/g, '').replace(/^@/, '').replace(/[.,;]+$/, '').trim();
  if (!s) return null;
  const range = (a, b) => { a = +a || 0; b = +b || a; return a > b ? [b, a] : [a, b]; };
  // a link to a file on GitHub or GitLab: its path inside the repository
  let m = /^https?:\/\/[^/]+\/[^/]+\/[^/]+\/(?:-\/)?blob\/[^/]+\/([^?#]+)(?:\?[^#]*)?(?:#L(\d+)(?:-L?(\d+))?)?$/i.exec(s);
  if (m) { const [a, b] = range(m[2], m[3]); return { path: safeDecode(m[1]), a, b }; }
  m = /^(\d+)(?:\s*[-–]\s*(\d+))?(?::\d+)?$/.exec(s); // lines of the open file
  if (m) { const [a, b] = range(m[1], m[2]); return { path: '', a, b }; }
  m = /^(.+?)(?:#L(\d+)(?:-L?(\d+))?|:(\d+)(?:\s*[-–]\s*(\d+))?(?::\d+)?)$/.exec(s);
  if (m) { const [a, b] = range(m[2] || m[4], m[3] || m[5]); return { path: m[1], a, b }; }
  return { path: s, a: 0, b: 0 };
}
const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

let bar = null;
/** Opens the Go to box. */
export function openGoTo() {
  ctx.closeFind();
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'mk-gotobar';
    bar.innerHTML = '<input id="goto-input" type="text" spellcheck="false" autocomplete="off" aria-label="Go to"' +
      ' placeholder="Line, or a reference such as docs/guide.md:42">' +
      '<button class="icon-btn" id="goto-close" title="Close (Esc)" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>';
    (document.getElementById('mk-findbar') || document.body.lastChild).after(bar);
    const input = bar.querySelector('input');
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // the app's own shortcuts don't apply while typing here
      if (e.key === 'Enter') { e.preventDefault(); goTo(input.value); }
      else if (e.key === 'Escape') { e.preventDefault(); closeGoTo(true); }
    });
    // a whole reference copied with Copy reference (or an agent's answer): just its first line
    input.addEventListener('paste', (e) => {
      const t = e.clipboardData?.getData('text/plain');
      if (!t || !/[\r\n]/.test(t.trim())) return;
      e.preventDefault();
      input.setRangeText(t.split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '', input.selectionStart, input.selectionEnd, 'end');
    });
    bar.querySelector('#goto-close').onclick = () => closeGoTo(true);
  }
  bar.hidden = false;
  const input = bar.querySelector('input');
  input.focus(); input.select();
}
export const goToOpen = () => !!bar && !bar.hidden;
/** Closes the Go to box (`refocus`: give the document the focus back). */
export function closeGoTo(refocus) {
  if (!bar || bar.hidden) return;
  bar.hidden = true;
  if (refocus) ctx.focusContent();
}

/** Goes to the reference in `text`: opens its file if it isn't the open one, then shows the lines. */
export async function goTo(text) {
  const ref = parseRef(text);
  if (!ref) return;
  const doc = ctx.getCurrent();
  if (!ref.path) {
    if (!doc) { ctx.toast('Open a file first, or give a file with the line'); return; }
    if (doc.revision) await ctx.openFile(doc.path, { history: false, resume: false });
    closeGoTo(true);
    showLines(ref.a, ref.b);
    return;
  }
  // Agents write paths from the top of the repository: try its root, then the open file's folder and
  // the folders above it (also for files Git doesn't track, or without Git).
  const { resolvePath, isAbsolute, dirname } = ctx;
  const cands = [];
  if (isAbsolute(ref.path)) cands.push(ref.path);
  else if (doc) {
    const git = ctx.getGit();
    if (git?.root) cands.push(resolvePath(git.root, ref.path));
    for (let d = doc.dir, i = 0; d && i < 12; i++) {
      cands.push(resolvePath(d, ref.path));
      const up = dirname(d);
      if (!up || up === d) break;
      d = up;
    }
  }
  const key = (p) => { const k = p.replace(/\\/g, '/'); return /^[a-z]:/i.test(k) ? k.toLowerCase() : k; }; // Windows ignores case
  const same = (p) => doc && !doc.revision && key(p) === key(doc.path);
  for (const path of [...new Set(cands)]) {
    if (same(path)) { closeGoTo(true); showLines(ref.a, ref.b); return; }
    let opened;
    try { opened = await ctx.openFile(path, { silent: true, resume: false }); } catch { continue; }
    if (!opened) return; // something else was opened meanwhile
    closeGoTo(true);
    await settled(); // math and diagrams can move things
    showLines(ref.a, ref.b);
    return;
  }
  ctx.toast(doc || isAbsolute(ref.path) ? `Couldn't find ${ref.path}` : 'Open a file first, or give the full path');
}
/** Resolves once the document on screen has finished rendering (math, diagrams), or after 4 s. */
function settled() {
  return new Promise((resolve) => {
    const t0 = Date.now();
    (function poll() { if (document.body.dataset.ready === '1' || Date.now() - t0 > 4000) resolve(); else setTimeout(poll, 40); })();
  });
}

let flashTimer = 0;
/** Scrolls to lines a..b of the open file (its own lines, as on disk) and lights them up briefly. */
export function showLines(a, b) {
  const doc = ctx.getCurrent();
  if (!doc) return;
  if (!a) { ctx.scroller.scrollTop = 0; return; }
  clearTimeout(flashTimer);
  for (const el of document.querySelectorAll('.ref-flash')) el.classList.remove('ref-flash');
  if (typeof CSS !== 'undefined' && CSS.highlights) CSS.highlights.delete('mk-goto');
  const marks = []; // elements to light up
  const ranges = []; // or text ranges, where the highlight API exists
  const hl = typeof CSS !== 'undefined' && !!CSS.highlights && typeof Highlight === 'function';
  let target = null; // element or range to scroll to
  if (!doc.view) {
    const all = [...ctx.content.querySelectorAll('[data-line]')];
    const overlaps = (el) => +el.dataset.line <= b && +el.dataset.lineEnd >= a;
    // the innermost blocks on those lines (a paragraph rather than its list item)
    let hits = all.filter((el) => overlaps(el) && ![...el.querySelectorAll('[data-line]')].some(overlaps));
    if (!hits.length) hits = [all.find((el) => +el.dataset.line >= a) || all[all.length - 1]].filter(Boolean);
    for (const el of hits) {
      const code = el.querySelector('code[data-code-line]');
      const r = code && hl ? codeRange(code, a, b) : null;
      if (r) ranges.push(r); else marks.push(el);
      target ||= r || el;
    }
  } else {
    const body = ctx.content.querySelector('.vw-body') || ctx.content;
    const rows = [...body.querySelectorAll('.vw-table tr[data-line]')];
    if (rows.length) { // CSV table: the records that start on those lines (or the one they are part of)
      let hit = rows.filter((r) => +r.dataset.line >= a && +r.dataset.line <= b);
      if (!hit.length) hit = [rows.filter((r) => +r.dataset.line <= a).pop() || rows[0]];
      marks.push(...hit); target = hit[0];
    } else {
      const code = body.querySelector('.vw-lines code');
      if (!code) return;
      const formatted = ctx.formattedText();
      let s1 = a, s2 = b;
      if (formatted) { // Formatted view: find the file's lines among the rows
        const file = linesOf(doc.content), shown = linesOf(formatted);
        s1 = mapLine(file, shown, a, false) || 1; s2 = Math.max(s1, mapLine(file, shown, b, true) || s1);
      }
      const rowEls = code.querySelectorAll(':scope > .vl');
      if (rowEls.length) {
        s1 = Math.min(s1, rowEls.length); s2 = Math.min(s2, rowEls.length);
        for (let i = s1; i <= s2; i++) marks.push(rowEls[i - 1]);
        target = rowEls[s1 - 1];
      } else { // a very large file, shown as one block
        const r = codeRange(code, s1, s2, 1);
        if (r) { if (hl) ranges.push(r); target = r; }
      }
    }
  }
  if (!target) return;
  // near the top of the window, with a little of what comes before
  const top = target.getBoundingClientRect().top;
  const sc = ctx.scroller.getBoundingClientRect();
  ctx.scroller.scrollTop += top - sc.top - Math.min(120, sc.height * 0.2);
  for (const el of marks) el.classList.add('ref-flash');
  if (ranges.length) CSS.highlights.set('mk-goto', new Highlight(...ranges));
  flashTimer = setTimeout(() => {
    for (const el of marks) el.classList.remove('ref-flash');
    if (ranges.length) CSS.highlights.delete('mk-goto');
  }, 2600);
}
/** The text range of lines a..b (file lines) of a code element whose first line is `first`. */
function codeRange(code, a, b, first = +code.dataset.codeLine) {
  const text = code.textContent;
  const lines = text.replace(/\n$/, '').split('\n');
  const i1 = Math.max(0, Math.min(a - first, lines.length - 1)), i2 = Math.max(i1, Math.min(b - first, lines.length - 1));
  let start = 0;
  for (let i = 0; i < i1; i++) start += lines[i].length + 1;
  let end = start;
  for (let i = i1; i <= i2; i++) end += lines[i].length + (i < i2 ? 1 : 0);
  // text offsets to a DOM range
  const walk = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  const r = document.createRange();
  let pos = 0, set = false;
  for (let n; (n = walk.nextNode());) {
    const len = n.data.length;
    if (!set && start <= pos + len) { r.setStart(n, start - pos); set = true; }
    if (set && end <= pos + len) { r.setEnd(n, end - pos); return r; }
    pos += len;
  }
  return set ? r : null;
}
