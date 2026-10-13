// Unified-diff parsing and rendering (inline and side by side, with word-level highlights).
// Part of the lazily loaded history chunk.

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Rendering stops after this many diff lines (the page says so). */
export const MAX_LINES = 20000;
const WORD_MAX_CHARS = 1000;

/**
 * Parses `git diff` / `git show` output into files:
 * { oldPath, newPath, status, binary, hunks: [{ header, oldStart, newStart, lines: [{ t, text, o, n, eofnl }] }] }
 * where t is ' ', '-' or '+', and o / n are old / new line numbers.
 */
export function parsePatch(patch) {
  const files = [];
  let f = null, h = null, o = 0, n = 0;
  const lines = patch.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  for (const line of lines) {
    if (line.startsWith('diff --git ') || line.startsWith('diff --cc ')) {
      f = { oldPath: null, newPath: null, status: 'M', binary: false, hunks: [] };
      files.push(f); h = null;
      continue;
    }
    if (!f) continue;
    if (!h || (line[0] !== ' ' && line[0] !== '+' && line[0] !== '-' && line[0] !== '\\' && line !== '')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
      if (m) {
        o = +m[1]; n = +m[2];
        h = { header: line, oldStart: o, newStart: n, section: m[3].trim(), lines: [] };
        f.hunks.push(h);
        continue;
      }
      if (h) h = null;
      if (line.startsWith('new file mode')) f.status = 'A';
      else if (line.startsWith('deleted file mode')) f.status = 'D';
      else if (line.startsWith('rename from ')) { f.status = 'R'; f.oldPath = line.slice(12); }
      else if (line.startsWith('rename to ')) f.newPath = line.slice(10);
      else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) f.binary = true;
      else if (line.startsWith('--- ')) { if (line !== '--- /dev/null') f.oldPath ??= line.slice(4).replace(/^a\//, ''); }
      else if (line.startsWith('+++ ')) { if (line !== '+++ /dev/null') f.newPath ??= line.slice(4).replace(/^b\//, ''); }
      continue;
    }
    const t = line[0] || ' ';
    if (t === '\\') { const last = h.lines[h.lines.length - 1]; if (last) last.eofnl = true; continue; }
    const text = line.slice(1);
    if (t === ' ') h.lines.push({ t, text, o: o++, n: n++ });
    else if (t === '-') h.lines.push({ t, text, o: o++, n: null });
    else h.lines.push({ t, text, o: null, n: n++ });
  }
  return files;
}

export function stats(files) {
  let add = 0, del = 0;
  for (const f of files) for (const h of f.hunks) for (const l of h.lines) { if (l.t === '+') add++; else if (l.t === '-') del++; }
  return { add, del };
}

// ---------------------------------------------------------------- word-level changes
const TOKEN = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;

/** Returns [oldHtml, newHtml] with changed tokens wrapped, or null when the lines differ too much. */
export function wordDiff(a, b) {
  if (a.length > WORD_MAX_CHARS || b.length > WORD_MAX_CHARS) return null;
  const x = a.match(TOKEN) || [], y = b.match(TOKEN) || [];
  // Strip the common prefix/suffix first; LCS only on the middle.
  let p = 0;
  while (p < x.length && p < y.length && x[p] === y[p]) p++;
  let s = 0;
  while (s < x.length - p && s < y.length - p && x[x.length - 1 - s] === y[y.length - 1 - s]) s++;
  const xm = x.slice(p, x.length - s), ym = y.slice(p, y.length - s);
  if (xm.length * ym.length > 40000) return null;
  const W = ym.length + 1;
  const L = new Uint16Array((xm.length + 1) * W);
  for (let i = xm.length - 1; i >= 0; i--) {
    for (let j = ym.length - 1; j >= 0; j--) {
      L[i * W + j] = xm[i] === ym[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
    }
  }
  const keepX = new Array(xm.length).fill(false), keepY = new Array(ym.length).fill(false);
  for (let i = 0, j = 0; i < xm.length && j < ym.length;) {
    if (xm[i] === ym[j]) { keepX[i++] = true; keepY[j++] = true; }
    else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) i++;
    else j++;
  }
  // Too little in common: highlighting individual words would only add noise.
  const common = keepX.reduce((c, k, i) => c + (k ? xm[i].length : 0), 0) + x.slice(0, p).join('').length + x.slice(x.length - s).join('').length;
  if (common < 0.3 * Math.max(a.length, b.length)) return null;
  const mark = (all, mid, keep) => {
    let out = esc(all.slice(0, p).join(''));
    let run = '';
    mid.forEach((tok, i) => {
      if (keep[i]) { if (run) { out += `<span class="wd">${esc(run)}</span>`; run = ''; } out += esc(tok); }
      else run += tok;
    });
    if (run) out += `<span class="wd">${esc(run)}</span>`;
    return out + esc(all.slice(all.length - s).join(''));
  };
  return [mark(x, xm, keepX), mark(y, ym, keepY)];
}

/** Pairs the i-th removed line with the i-th added line of each change block for word diffs. */
function pairWords(lines) {
  const html = new Map();
  for (let i = 0; i < lines.length;) {
    if (lines[i].t !== '-') { i++; continue; }
    let d = i; while (d < lines.length && lines[d].t === '-') d++;
    let a = d; while (a < lines.length && lines[a].t === '+') a++;
    const dels = lines.slice(i, d), adds = lines.slice(d, a);
    for (let k = 0; k < Math.min(dels.length, adds.length); k++) {
      const w = wordDiff(dels[k].text, adds[k].text);
      if (w) { html.set(dels[k], w[0]); html.set(adds[k], w[1]); }
    }
    i = a;
  }
  return html;
}

const SIGN = { ' ': ' ', '-': '−', '+': '+' };
const CLS = { ' ': 'ctx', '-': 'del', '+': 'add' };
const eof = (l) => (l.eofnl ? '<span class="df-eof" title="No newline at end of file">⊘</span>' : '');
const codeCell = (l, words, cls = '') => `<td class="df-code${cls}"><span class="df-sign">${SIGN[l.t]}</span>${words.get(l) ?? esc(l.text)}${eof(l)}</td>`;
const hunkHead = (h, cols) => `<tr class="df-hunk"><td colspan="${cols}"><span class="df-hunk-range">${esc(h.header.replace(/@@(.*?)@@.*/, '@@$1@@'))}</span>${h.section ? ` <span class="df-hunk-sec">${esc(h.section)}</span>` : ''}</td></tr>`;

/** Renders parsed files; returns { html, shown, total }. */
export function renderDiff(files, { split = false } = {}) {
  let budget = MAX_LINES, total = 0;
  const parts = [];
  for (const f of files) {
    for (const h of f.hunks) total += h.lines.length;
    if (f.binary) { parts.push('<div class="df-note">Binary file — no line-by-line changes to show.</div>'); continue; }
    if (!f.hunks.length) continue;
    const cols = split ? 4 : 3;
    let rows = '';
    for (const h of f.hunks) {
      if (budget <= 0) break;
      const lines = h.lines.slice(0, budget);
      budget -= lines.length;
      const words = pairWords(lines);
      rows += hunkHead(h, cols);
      if (!split) {
        for (const l of lines) {
          rows += `<tr class="df-${CLS[l.t]}"><td class="df-ln" data-n="${l.o ?? ''}"></td><td class="df-ln" data-n="${l.n ?? ''}"></td>${codeCell(l, words)}</tr>`;
        }
        continue;
      }
      for (let i = 0; i < lines.length;) {
        const l = lines[i];
        if (l.t === ' ') {
          rows += `<tr class="df-ctx"><td class="df-ln" data-n="${l.o}"></td>${codeCell(l, words, ' df-left')}<td class="df-ln" data-n="${l.n}"></td>${codeCell(l, words)}</tr>`;
          i++; continue;
        }
        let d = i; while (d < lines.length && lines[d].t === '-') d++;
        let a = d; while (a < lines.length && lines[a].t === '+') a++;
        const dels = lines.slice(i, d), adds = lines.slice(d, a);
        for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
          const L = dels[k], R = adds[k];
          rows += '<tr class="df-pair">'
            + (L ? `<td class="df-ln df-del" data-n="${L.o}"></td>${codeCell(L, words, ' df-left df-del')}` : '<td class="df-ln df-empty"></td><td class="df-code df-left df-empty"></td>')
            + (R ? `<td class="df-ln df-add" data-n="${R.n}"></td>${codeCell(R, words, ' df-add')}` : '<td class="df-ln df-empty"></td><td class="df-code df-empty"></td>')
            + '</tr>';
        }
        i = a;
      }
    }
    const colgroup = split
      ? '<colgroup><col class="c-ln"><col><col class="c-ln"><col></colgroup>'
      : '<colgroup><col class="c-ln"><col class="c-ln"><col></colgroup>';
    parts.push(`<table class="df-table${split ? ' df-split' : ''}">${colgroup}<tbody>${rows}</tbody></table>`);
  }
  return { html: parts.join(''), shown: MAX_LINES - Math.max(budget, 0), total };
}
