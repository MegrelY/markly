// "Formatted" view: re-lays out JSON, XML/SVG, HTML, CSS/SCSS/Less, YAML and JavaScript/TypeScript
// for reading, like Prettier in an editor. Only ever changes what is shown, never the file.
// JSON and XML use the small formatters below; the rest use Prettier, loaded per language on first
// use (lazy chunks), so a file type that is never opened costs nothing.

/** Files larger than this are shown as written (formatting would be slow). */
export const MAX_FORMAT = 1024 * 1024;

// ---------------------------------------------------------------- JSON (keeps key order and numbers)
const PRIMITIVE = /^(?:"(?:[^"\\]|\\.)*"|-?\d[\d.eE+-]*|true|false|null)$/;
function tokenizeJson(s) {
  const out = [];
  let i = 0, line = 1;
  while (i < s.length) {
    const c = s[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\ufeff') { i++; continue; }
    if ('{}[]:,'.includes(c)) { out.push({ t: c, line }); i++; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < s.length && s[j] !== c) { if (s[j] === '\\') j++; if (s[j] === '\n') throw new Error(`Unterminated string on line ${line}`); j++; }
      if (j >= s.length) throw new Error(`Unterminated string on line ${line}`);
      out.push({ t: 'v', v: s.slice(i, j + 1), line }); i = j + 1; continue;
    }
    if (c === '/' && s[i + 1] === '/') { const j = s.indexOf('\n', i); const v = s.slice(i, j < 0 ? s.length : j).trimEnd(); out.push({ t: 'c', v, line }); i = j < 0 ? s.length : j; continue; }
    if (c === '/' && s[i + 1] === '*') {
      const j = s.indexOf('*/', i + 2); if (j < 0) throw new Error(`Unterminated comment on line ${line}`);
      const v = s.slice(i, j + 2); line += (v.match(/\n/g) || []).length; out.push({ t: 'c', v, line, block: true }); i = j + 2; continue;
    }
    let j = i;
    while (j < s.length && !/[\s{}[\]:,"'/]/.test(s[j])) j++;
    if (j === i) throw new Error(`Unexpected "${c}" on line ${line}`);
    out.push({ t: 'v', v: s.slice(i, j), line }); i = j;
  }
  return out;
}
export function formatJson(src, { strict = true } = {}) {
  if (strict) {
    try { JSON.parse(src.replace(/^\ufeff/, '')); } catch (e) {
      const m = /position (\d+)/.exec(e.message);
      throw new Error(m ? `${e.message.replace(/ in JSON at position \d+.*/, '')} on line ${src.slice(0, +m[1]).split('\n').length}` : e.message);
    }
  }
  const toks = tokenizeJson(src);
  let pos = 0, out = '';
  const pad = (n) => '  '.repeat(n);
  const peek = () => toks[pos];
  // A comment on the same line as the previous token stays there; others get their own line.
  function comments(depth, prevLine) {
    while (peek()?.t === 'c') {
      const c = toks[pos++];
      if (c.line === prevLine && !c.block) out += ' ' + c.v;
      else out += '\n' + pad(depth) + c.v.replace(/\n\s*/g, '\n' + pad(depth) + ' ');
    }
  }
  function value(depth) {
    const tk = toks[pos++];
    if (!tk) throw new Error('Unexpected end of file');
    if (tk.t === 'v') { out += tk.v; return tk.line; }
    if (tk.t !== '{' && tk.t !== '[') throw new Error(`Unexpected "${tk.t}" on line ${tk.line}`);
    const close = tk.t === '{' ? '}' : ']';
    const start = pos;
    // Short arrays of plain values stay on one line, like Prettier.
    if (close === ']') {
      const items = [];
      let k = pos, ok = true;
      while (k < toks.length && toks[k].t !== ']') {
        const x = toks[k];
        if (x.t === 'v' && PRIMITIVE.test(x.v)) items.push(x.v);
        else if (x.t !== ',') { ok = false; break; }
        k++;
      }
      const line = '[' + items.join(', ') + ']';
      if (ok && k < toks.length && pad(depth).length + line.length <= 80) { out += line; pos = k + 1; return toks[k].line; }
    }
    if (peek()?.t === close) { out += tk.t + close; return toks[pos++].line; }
    out += tk.t;
    let prevLine = tk.line;
    pos = start;
    for (;;) {
      comments(depth + 1, prevLine);
      if (peek()?.t === close) break;
      out += '\n' + pad(depth + 1);
      if (close === '}') {
        const k = toks[pos++];
        if (!k || k.t !== 'v') throw new Error(`Expected a key on line ${k?.line ?? '?'}`);
        out += k.v;
        if (toks[pos++]?.t !== ':') throw new Error(`Expected ":" after ${k.v} on line ${k.line}`);
        out += ': ';
      }
      prevLine = value(depth + 1);
      const n = peek();
      if (n?.t === ',') {
        pos++;
        // drop a trailing comma before the closing bracket (JSONC)
        let k = pos; while (toks[k]?.t === 'c') k++;
        if (toks[k]?.t !== close) out += ',';
        prevLine = n.line;
        continue;
      }
      comments(depth + 1, prevLine);
      if (peek()?.t !== close) throw new Error(`Expected "," or "${close}" on line ${peek()?.line ?? '?'}`);
    }
    const end = toks[pos++];
    out += '\n' + pad(depth) + close;
    return end.line;
  }
  comments(0, -1);
  if (out) out += '\n';
  value(0);
  comments(0, toks[pos - 1]?.line ?? 0);
  if (pos < toks.length) throw new Error(`Unexpected content after the end on line ${toks[pos].line}`);
  return out.replace(/^\n/, '') + '\n';
}

// ---------------------------------------------------------------- XML / SVG
export function formatXml(src) {
  const doc = new DOMParser().parseFromString(src, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) {
    const m = /(?:error )?on line (\d+) at column (\d+): ([^\n]+)/i.exec(err.textContent || '');
    throw new Error(m ? `line ${m[1]}: ${m[3].trim()}` : 'not well-formed XML');
  }
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>|<\/?[^>]+>|[^<]+/gi;
  const parts = src.replace(/^\ufeff/, '').match(re) || [];
  const lines = [];
  let depth = 0;
  const pad = () => '  '.repeat(depth);
  const tidyTag = (t) => {
    const one = t.replace(/\s+/g, ' ').replace(/\s+(\/?>)$/, '$1');
    if (pad().length + one.length <= 100) return one;
    // long tags: one attribute per line
    const m = /^<([^\s/>]+)([\s\S]*?)(\/?>)$/.exec(t);
    if (!m) return one;
    const attrs = m[2].match(/[^\s=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/g) || [];
    return `<${m[1]}\n${attrs.map((a) => pad() + '  ' + a.replace(/\s*=\s*/, '=')).join('\n')}\n${pad()}${m[3]}`;
  };
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p.startsWith('<')) { const t = p.trim(); if (t) lines.push(pad() + t.replace(/\s*\n\s*/g, '\n' + pad())); continue; }
    if (p.startsWith('</')) { depth = Math.max(0, depth - 1); lines.push(pad() + p.replace(/\s+/g, '')); continue; }
    if (/^<(!|\?)/.test(p)) { lines.push(pad() + p.trim()); continue; }
    const selfClosing = p.endsWith('/>');
    // <a>short text</a> stays on one line
    const text = parts[i + 1], close = parts[i + 2];
    if (!selfClosing && text !== undefined && !text.startsWith('<') && close?.startsWith('</') && !text.includes('\n') && text.trim().length < 80) {
      lines.push(pad() + tidyTag(p) + text.trim() + close.replace(/\s+/g, ''));
      i += 2; continue;
    }
    if (!selfClosing && close?.startsWith('</') && text?.startsWith('</') === false && text.trim() === '' ) { /* fallthrough */ }
    if (!selfClosing && text?.startsWith('</')) { lines.push(pad() + tidyTag(p) + text.replace(/\s+/g, '')); i += 1; continue; }
    lines.push(pad() + tidyTag(p));
    if (!selfClosing) depth++;
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------- Prettier (lazy, per language)
const PLUGINS = {
  babel: () => [import('prettier/plugins/babel'), import('prettier/plugins/estree')],
  postcss: () => [import('prettier/plugins/postcss')],
  yaml: () => [import('prettier/plugins/yaml')],
  html: () => [import('prettier/plugins/html')],
};
const PARSER_PLUGINS = { babel: 'babel', 'babel-ts': 'babel', css: 'postcss', scss: 'postcss', less: 'postcss', yaml: 'yaml', html: 'html' };
let prettierP = null;
async function prettier(src, parser) {
  prettierP ||= import('prettier/standalone');
  const [p, ...plugins] = await Promise.all([prettierP, ...PLUGINS[PARSER_PLUGINS[parser]]()]);
  return p.format(src, {
    parser, plugins: plugins.map((m) => m.default || m),
    printWidth: 80, tabWidth: 2, embeddedLanguageFormatting: 'off', htmlWhitespaceSensitivity: 'css',
  });
}

/**
 * Formats `src` for display. Resolves to { text } or { error } (the view then shows the original
 * with a note). `fmt` comes from filetypes.js.
 */
export async function format(src, fmt, { ext = '' } = {}) {
  if (src.length > MAX_FORMAT) return { error: 'Shown as written: the file is over 1 MB.' };
  try {
    if (fmt === 'json') return { text: formatJson(src, { strict: ext === 'json' || ext === 'geojson' || ext === 'webmanifest' }) };
    if (fmt === 'xml') return { text: formatXml(src) };
    if (PARSER_PLUGINS[fmt]) return { text: await prettier(src, fmt) };
  } catch (e) {
    const msg = String(e?.message || e).split('\n')[0].replace(/\s*\(\d+:\d+\)$/, '')
      .replace(/,\s*(?:\.\.\.)?".*$/, '').replace(/\s+is not valid JSON$/, '');
    return { error: `Shown as written: couldn't format it (${msg}).` };
  }
  return { error: null };
}
