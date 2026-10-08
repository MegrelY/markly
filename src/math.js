// Tiny $…$ / $$…$$ markdown-it plugin. KaTeX itself is loaded lazily only when a
// document actually contains math, so plain documents stay fast.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function isEscaped(src, pos) {
  let n = 0;
  for (let p = pos - 1; p >= 0 && src[p] === '\\'; p--) n++;
  return n % 2 === 1;
}

function mathInline(state, silent) {
  const src = state.src, start = state.pos;
  if (src.charCodeAt(start) !== 0x24 /* $ */) return false;
  const display = src.charCodeAt(start + 1) === 0x24;
  const delim = display ? '$$' : '$';
  const open = delim.length;
  if (!display) {
    const next = src[start + 1];
    if (!next || /\s/.test(next)) return false;
  }
  let pos = start + open;
  for (;;) {
    pos = src.indexOf(delim, pos);
    if (pos === -1 || pos >= state.posMax) return false;
    if (!isEscaped(src, pos)) break;
    pos += 1;
  }
  const content = src.slice(start + open, pos);
  if (!content.trim()) return false;
  if (!display) {
    if (/\s/.test(src[pos - 1])) return false;
    const after = src[pos + 1];
    if (after && /[0-9]/.test(after)) return false;
  }
  if (!silent) {
    const t = state.push('math_inline', 'math', 0);
    t.content = content;
    t.markup = delim;
  }
  state.pos = pos + open;
  return true;
}

function mathBlock(state, startLine, endLine, silent) {
  let pos = state.bMarks[startLine] + state.tShift[startLine];
  let max = state.eMarks[startLine];
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  if (state.src.slice(pos, pos + 2) !== '$$') return false;
  if (silent) return true;
  let first = state.src.slice(pos + 2, max);
  const lines = [];
  let next = startLine;
  let found = false;
  if (first.trim().endsWith('$$') && first.trim().length > 2) {
    lines.push(first.trim().slice(0, -2));
    found = true;
  } else {
    if (first.trim()) lines.push(first);
    while (++next < endLine) {
      pos = state.bMarks[next] + state.tShift[next];
      max = state.eMarks[next];
      if (pos < max && state.sCount[next] < state.blkIndent) break;
      const line = state.src.slice(pos, max);
      if (line.trim().endsWith('$$')) { lines.push(line.trim().slice(0, -2)); found = true; break; }
      lines.push(state.src.slice(state.bMarks[next], max));
    }
  }
  if (!found) return false;
  state.line = next + 1;
  const t = state.push('math_block', 'math', 0);
  t.block = true;
  t.content = lines.join('\n');
  t.map = [startLine, state.line];
  t.markup = '$$';
  return true;
}

export function mathPlugin(md) {
  md.inline.ruler.after('escape', 'math_inline', mathInline);
  md.block.ruler.after('blockquote', 'math_block', mathBlock, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  md.renderer.rules.math_inline = (tokens, idx) => `<span class="math-inline" data-tex="${sources.push(tokens[idx].content) - 1}">${esc(tokens[idx].content)}</span>`;
  md.renderer.rules.math_block = (tokens, idx) => mathBlockHtml(tokens[idx].content);
}
export const mathBlockHtml = (tex) => `<div class="math-block" data-tex="${sources.push(tex) - 1}">${esc(tex)}</div>\n`;

// Raw sources for math/diagrams of the most recent render, referenced by index.
// (DOMPurify strips attribute values containing "-->", common in Mermaid.)
export const sources = [];
export function hydrateSources(root) {
  root.querySelectorAll('[data-tex]').forEach((el) => { el._src ??= sources[+el.dataset.tex]; });
  root.querySelectorAll('[data-mmd]').forEach((el) => { el._src ??= sources[+el.dataset.mmd]; });
}

let katexP = null;
export async function renderMath(root) {
  hydrateSources(root);
  const nodes = root.querySelectorAll('[data-tex]');
  if (!nodes.length) return;
  katexP ??= import('katex').then((m) => m.default || m);
  const katex = await katexP;
  for (const el of nodes) {
    try {
      katex.render(el._src ?? el.textContent, el, { displayMode: el.classList.contains('math-block'), throwOnError: false, output: 'htmlAndMathml', strict: 'ignore' });
    } catch (e) {
      el.classList.add('math-error');
      el.title = String(e?.message || e);
    }
    el.removeAttribute('data-tex');
  }
}
