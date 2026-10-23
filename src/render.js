// Markdown -> sanitized HTML pipeline (CommonMark + GFM + extras).
import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import anchor from 'markdown-it-anchor';
import { full as emoji } from 'markdown-it-emoji';
import frontMatter from 'markdown-it-front-matter';
import taskLists from 'markdown-it-task-lists';
import alerts from 'markdown-it-github-alerts';
import mark from 'markdown-it-mark';
import { mathPlugin, mathBlockHtml, sources, ensureKatexCss } from './math.js';
import { ALIASES as HL_NAMES, DEPS as HL_DEPS, LOADERS as HL_LOADERS } from './gen/hljs-langs.js';
import DOMPurify from 'dompurify';
import { isLocalRef, resolvePath } from './path.js';

// highlight.js core, each grammar and the YAML parser are loaded on demand: a document only pays
// for the languages its code blocks actually use (plain prose loads none of them).
let hljs = null;
let yamlLoad = null;
const hlLoaded = new Set();

const ALIAS = { sh: 'bash', zsh: 'bash', shell: 'bash', console: 'bash', ps: 'powershell', ps1: 'powershell', pwsh: 'powershell',
  bat: 'dos', cmd: 'dos', batch: 'dos', yml: 'yaml', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', py: 'python', rb: 'ruby', rs: 'rust', cs: 'csharp', 'c#': 'csharp', 'c++': 'cpp',
  html: 'xml', xhtml: 'xml', svg: 'xml', vue: 'xml', md: 'markdown', docker: 'dockerfile', kt: 'kotlin', toml: 'ini', jsonc: 'json', json5: 'json', proto: 'protobuf' };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// --- Bare URLs in code and plain text: spans that open with Ctrl+click (app.js), not links ---
// Works on escaped HTML: `&amp;` belongs to the URL; any other entity, a quote or a tag ends it.
const BARE_URL = /\bhttps?:\/\/(?:[^\s<>"'`&]|&amp;)+/gi;
const CLOSERS = { ')': '(', ']': '[', '}': '{' };
function trimUrl(u) {
  for (;;) {
    const c = u[u.length - 1];
    if (u.endsWith('&amp;')) u = u.slice(0, -5);
    else if ('.,:;!?*'.includes(c)) u = u.slice(0, -1);
    else if (CLOSERS[c] && u.split(c).length > u.split(CLOSERS[c]).length) u = u.slice(0, -1); // unbalanced
    else return u;
  }
}
/** Wraps the http(s) URLs in `html` in `.bare-url` spans. `html` is escaped text or highlight.js
 *  output: a URL can't cross a tag, and the tags themselves hold none. */
export function linkifyUrls(html) {
  if (!html.includes('://')) return html;
  return html.replace(BARE_URL, (u) => {
    const url = trimUrl(u);
    if (url.length <= url.indexOf('://') + 3) return u;
    return `<span class="bare-url" data-url="${url}">${url}</span>${u.slice(url.length)}`;
  });
}

function slugify(s) {
  return String(s).trim().toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

const md = MarkdownIt({ html: true, linkify: true, typographer: false, breaks: false });
md.use(frontMatter, () => {})
  .use(footnote)
  .use(taskLists, { label: true })
  .use(emoji)
  .use(mark)
  .use(alerts)
  .use(mathPlugin)
  .use(anchor, {
    slugify,
    level: [1, 2, 3, 4, 5, 6],
    permalink: anchor.permalink.linkInsideHeader({ symbol: '#', placement: 'before', class: 'heading-anchor', ariaHidden: true }),
  });

// --- Front matter: collapsible "properties" panel ---
function fmValue(v) {
  if (v === null || v === undefined) return '<span class="fm-null">—</span>';
  if (Array.isArray(v)) return v.map((x) => `<span class="fm-chip">${esc(typeof x === 'object' ? JSON.stringify(x) : x)}</span>`).join(' ');
  if (v instanceof Date) return esc(v.toISOString().replace(/T00:00:00\.000Z$/, '').replace('.000Z', 'Z'));
  if (typeof v === 'object') return `<code>${esc(JSON.stringify(v))}</code>`;
  return esc(v);
}
md.renderer.rules.front_matter = (tokens, idx) => {
  const raw = tokens[idx].meta || '';
  let body;
  try {
    const data = yamlLoad(raw);
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const rows = Object.entries(data).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${fmValue(v)}</td></tr>`).join('');
      body = `<table class="fm-table">${rows}</table>`;
    }
  } catch { /* fall through to raw */ }
  if (!body) body = `<pre class="fm-raw"><code>${esc(raw)}</code></pre>`;
  return `<details class="front-matter"><summary>Properties</summary>${body}</details>\n`;
};

// --- Tables: wrapped for horizontal scrolling ---
md.renderer.rules.table_open = () => '<div class="table-wrap"><table>\n';
md.renderer.rules.table_close = () => '</table></div>\n';

// --- Code fences: highlight.js, copy button, mermaid placeholder, ```math ---
md.renderer.rules.fence = (tokens, idx) => {
  const t = tokens[idx];
  const info = t.info ? md.utils.unescapeAll(t.info).trim() : '';
  const lang = (info.split(/\s+/)[0] || '').toLowerCase();
  const code = t.content;
  if (lang === 'mermaid') {
    // Source kept in a side table: DOMPurify drops attributes containing "-->".
    return `<div class="mermaid-block" data-mmd="${sources.push(code) - 1}"><div class="mermaid-status">Rendering diagram…</div></div>\n`;
  }
  if (lang === 'math' || lang === 'katex') return mathBlockHtml(code);
  const l = ALIAS[lang] || lang;
  let html;
  if (l && hljs && hljs.getLanguage(l)) {
    try { html = hljs.highlight(code, { language: l, ignoreIllegals: true }).value; } catch { html = esc(code); }
  } else html = esc(code);
  html = linkifyUrls(html);
  const label = lang || 'text';
  return `<div class="code-block"><div class="code-head"><span class="code-lang">${esc(label)}</span>` +
    `<button class="code-copy" type="button" aria-label="Copy code">Copy</button></div>` +
    `<pre><code class="hljs${l ? ' language-' + esc(l) : ''}">${html}</code></pre></div>\n`;
};
md.renderer.rules.code_block = (tokens, idx, opts, env, self) =>
  `<pre${self.renderAttrs(tokens[idx])}><code>${linkifyUrls(esc(tokens[idx].content))}</code></pre>\n`;
md.renderer.rules.code_inline = (tokens, idx, opts, env, self) =>
  `<code${self.renderAttrs(tokens[idx])}>${linkifyUrls(esc(tokens[idx].content))}</code>`;

// --- Sanitizing (documents may come from anywhere; the webview has IPC access) ---
let ctx = { baseDir: '', assetUrl: (p) => p };
const LOCAL_SRC_TAGS = new Set(['IMG', 'VIDEO', 'AUDIO', 'SOURCE']);
DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
  const v = data.attrValue;
  if (!v) return;
  if (data.attrName === 'src' && LOCAL_SRC_TAGS.has(node.nodeName) && isLocalRef(v) && !/^data:/i.test(v)) {
    const local = resolvePath(ctx.baseDir, v.split('#')[0]);
    data.attrValue = ctx.assetUrl(local);
    if (node.nodeName === 'IMG') node.setAttribute('data-local-src', local);
  } else if (data.attrName === 'srcset' && LOCAL_SRC_TAGS.has(node.nodeName)) {
    data.attrValue = v.split(',').map((part) => {
      const [u, ...rest] = part.trim().split(/\s+/);
      return [isLocalRef(u) ? ctx.assetUrl(resolvePath(ctx.baseDir, u)) : u, ...rest].join(' ');
    }).join(', ');
  } else if (data.attrName === 'href' && /^[a-zA-Z]:[\\/]/.test(v)) {
    data.attrValue = 'file:///' + v.replace(/\\/g, '/'); // keep absolute Windows paths clickable
  }
});
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.nodeName === 'A') node.removeAttribute('target');
  if (node.nodeName === 'IMG') { node.setAttribute('loading', 'lazy'); node.setAttribute('decoding', 'async'); }
});

const PURIFY = {
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|file|asset):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  FORBID_TAGS: ['style', 'form', 'textarea', 'select'],
  ADD_ATTR: ['align'],
};

const fenceLang = (t) => ((t.info ? md.utils.unescapeAll(t.info).trim() : '').split(/\s+/)[0] || '').toLowerCase();

function addLang(need, lang) {
  const name = HL_NAMES[ALIAS[lang] || lang];
  if (name) { need.add(name); for (const d of HL_DEPS[name] || []) need.add(d); }
}

/** Loads highlight.js grammars (plus the grammars they embed) and js-yaml as the tokens require. */
async function ensureDeps(tokens, extra = []) {
  const need = new Set();
  let yaml = false;
  for (const l of extra) addLang(need, l);
  for (const t of tokens) {
    if (t.type === 'front_matter') yaml = true;
    else if (t.type === 'fence') addLang(need, fenceLang(t));
  }
  const jobs = [];
  if (yaml && !yamlLoad) jobs.push(import('js-yaml').then((m) => { yamlLoad = m.load; }));
  const missing = [...need].filter((n) => !hlLoaded.has(n));
  if (missing.length) {
    jobs.push((async () => {
      const [core, ...mods] = await Promise.all([hljs ? null : import('highlight.js/lib/core'), ...missing.map((n) => HL_LOADERS[n]())]);
      hljs ??= core.default || core;
      missing.forEach((n, i) => { hljs.registerLanguage(n, mods[i].default || mods[i]); hlLoaded.add(n); });
      // Re-assert alias ownership exactly as when all grammars are registered up front.
      for (const [alias, owner] of Object.entries(HL_NAMES)) if (alias !== owner && hlLoaded.has(owner)) hljs.registerAliases(alias, { languageName: owner });
    })());
  }
  if (jobs.length) await Promise.all(jobs);
}

/** Renders Markdown to sanitized HTML. `sources` holds raw math/diagram sources (see attachSources). */
export async function renderMarkdown(src, { baseDir = '', assetUrl = (p) => p } = {}) {
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  const env = {};
  const tokens = md.parse(src, env);
  await ensureDeps(tokens);
  ctx = { baseDir, assetUrl };
  sources.length = 0;
  const html = DOMPurify.sanitize(md.renderer.render(tokens, md.options, env), PURIFY);
  return { html, sources: sources.splice(0) };
}

/** Highlights a whole file (text/code views); loads the grammar first. Returns HTML. */
export async function highlightCode(code, lang) {
  await ensureDeps([], [lang]);
  const l = ALIAS[lang] || lang;
  if (!hljs || !hljs.getLanguage(l)) return esc(code);
  try { return hljs.highlight(code, { language: l, ignoreIllegals: true }).value; } catch { return esc(code); }
}

// --- HTML file preview: a whole document, sanitized like Markdown, shown in a sandboxed frame ---
const PREVIEW = {
  WHOLE_DOCUMENT: true,
  ALLOWED_URI_REGEXP: PURIFY.ALLOWED_URI_REGEXP,
  ADD_TAGS: ['style'],
  FORBID_TAGS: ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base', 'meta', 'link', 'form', 'portal', 'noscript', 'template'],
  FORBID_ATTR: ['srcdoc', 'action', 'formaction', 'ping', 'http-equiv'],
  ADD_ATTR: ['align'],
};
let previewing = false;
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (!previewing) return;
  // Links can't navigate anywhere from the preview; the address stays visible as a tooltip.
  if (node.hasAttribute('href') && node.nodeName !== 'USE') { node.setAttribute('title', node.getAttribute('href')); node.removeAttribute('href'); }
  if (node.hasAttribute('xlink:href') && !/^#/.test(node.getAttribute('xlink:href'))) node.removeAttribute('xlink:href');
});
/** Sanitizes an HTML file for the preview frame; local images resolve from the file's folder. */
export function sanitizePreview(src, { baseDir = '', assetUrl = (p) => p } = {}) {
  ctx = { baseDir, assetUrl };
  previewing = true;
  try { return DOMPurify.sanitize(src, PREVIEW); } finally { previewing = false; }
}

/** Attaches raw math/diagram sources to the placeholders of freshly inserted HTML. */
export function attachSources(root, list) {
  root.querySelectorAll('[data-tex]').forEach((el) => { el._src = list[+el.dataset.tex]; });
  root.querySelectorAll('[data-mmd]').forEach((el) => { el._src = list[+el.dataset.mmd]; });
}

// --- Mermaid: loaded lazily only when a document contains diagrams ---
let mermaidP = null;
const MERMAID_LIGHT = {
  darkMode: false, fontSize: '14px', background: '#f7f8fa',
  primaryColor: '#e7f5f2', primaryBorderColor: '#8ccfc2', primaryTextColor: '#1c2129',
  secondaryColor: '#ebf4fa', secondaryBorderColor: '#a7cbe3', tertiaryColor: '#ffffff', tertiaryBorderColor: '#d5d9e0',
  lineColor: '#8a929d', textColor: '#1c2129', edgeLabelBackground: '#f7f8fa', clusterBkg: '#ffffff', clusterBorder: '#d5d9e0',
  actorBkg: '#e7f5f2', actorBorder: '#8ccfc2', actorTextColor: '#1c2129', actorLineColor: '#b8bec7', signalColor: '#5d6673', signalTextColor: '#1c2129',
  noteBkgColor: '#fff8db', noteBorderColor: '#ead27a', noteTextColor: '#3d3200', labelBoxBkgColor: '#e7f5f2', labelBoxBorderColor: '#8ccfc2',
};
const MERMAID_DARK = {
  darkMode: true, fontSize: '14px', background: '#171a1f',
  primaryColor: '#12352f', primaryBorderColor: '#2f9585', primaryTextColor: '#e6e8eb',
  secondaryColor: '#152c3b', secondaryBorderColor: '#3a7ca3', tertiaryColor: '#1d2127', tertiaryBorderColor: '#3a414b',
  lineColor: '#7d8590', textColor: '#dfe3e8', mainBkg: '#12352f', nodeBorder: '#2f9585', edgeLabelBackground: '#171a1f', clusterBkg: '#1d2127', clusterBorder: '#3a414b',
  actorBkg: '#12352f', actorBorder: '#2f9585', actorTextColor: '#e6e8eb', actorLineColor: '#4a515c', signalColor: '#9aa3ae', signalTextColor: '#dfe3e8',
  noteBkgColor: '#3a3320', noteBorderColor: '#7a6a30', noteTextColor: '#f0e6c0', labelBoxBkgColor: '#12352f', labelBoxBorderColor: '#2f9585', labelTextColor: '#e6e8eb', loopTextColor: '#dfe3e8',
};
let mermaidSeq = 0;
export async function renderMermaid(root, dark) {
  const blocks = root.querySelectorAll('.mermaid-block');
  if (!blocks.length) return;
  mermaidP ??= import('mermaid').then((m) => m.default);
  // Mermaid renders $$…$$ labels with KaTeX, which needs its stylesheet.
  const needsCss = [...blocks].some((b) => b._src && b._src.includes('$$'));
  const [mermaid] = await Promise.all([mermaidP, needsCss ? ensureKatexCss() : null]);
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    fontFamily: 'InterVariable, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
    themeVariables: dark ? MERMAID_DARK : MERMAID_LIGHT,
  });
  for (const b of blocks) {
    const id = `mmd-${++mermaidSeq}`;
    try {
      const { svg } = await mermaid.render(id, b._src);
      b.innerHTML = svg;
      b.classList.remove('mermaid-error');
    } catch (e) {
      document.getElementById(id)?.remove();
      document.getElementById('d' + id)?.remove();
      b.classList.add('mermaid-error');
      b.innerHTML = `<div class="mermaid-status">Diagram error: ${esc(e?.message || e)}</div><pre><code>${esc(b._src)}</code></pre>`;
    }
  }
}

export { renderMath } from './math.js';
