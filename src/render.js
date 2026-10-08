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
  const label = lang || 'text';
  return `<div class="code-block"><div class="code-head"><span class="code-lang">${esc(label)}</span>` +
    `<button class="code-copy" type="button" aria-label="Copy code">Copy</button></div>` +
    `<pre><code class="hljs${l ? ' language-' + esc(l) : ''}">${html}</code></pre></div>\n`;
};

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

/** Loads highlight.js grammars (plus the grammars they embed) and js-yaml as the tokens require. */
async function ensureDeps(tokens) {
  const need = new Set();
  let yaml = false;
  for (const t of tokens) {
    if (t.type === 'front_matter') yaml = true;
    else if (t.type === 'fence') {
      const lang = fenceLang(t);
      const name = HL_NAMES[ALIAS[lang] || lang];
      if (name) { need.add(name); for (const d of HL_DEPS[name] || []) need.add(d); }
    }
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

/** Attaches raw math/diagram sources to the placeholders of freshly inserted HTML. */
export function attachSources(root, list) {
  root.querySelectorAll('[data-tex]').forEach((el) => { el._src = list[+el.dataset.tex]; });
  root.querySelectorAll('[data-mmd]').forEach((el) => { el._src = list[+el.dataset.mmd]; });
}

// --- Mermaid: loaded lazily only when a document contains diagrams ---
let mermaidP = null;
const MERMAID_LIGHT = {
  darkMode: false, fontSize: '14px', background: '#f7f8fa',
  primaryColor: '#eef0ff', primaryBorderColor: '#a9acf2', primaryTextColor: '#1c2129',
  secondaryColor: '#f4efff', secondaryBorderColor: '#c4b5fd', tertiaryColor: '#ffffff', tertiaryBorderColor: '#d5d9e0',
  lineColor: '#8a929d', textColor: '#1c2129', edgeLabelBackground: '#f7f8fa', clusterBkg: '#ffffff', clusterBorder: '#d5d9e0',
  actorBkg: '#eef0ff', actorBorder: '#a9acf2', actorTextColor: '#1c2129', actorLineColor: '#b8bec7', signalColor: '#5d6673', signalTextColor: '#1c2129',
  noteBkgColor: '#fff8db', noteBorderColor: '#ead27a', noteTextColor: '#3d3200', labelBoxBkgColor: '#eef0ff', labelBoxBorderColor: '#a9acf2',
};
const MERMAID_DARK = {
  darkMode: true, fontSize: '14px', background: '#171a1f',
  primaryColor: '#262850', primaryBorderColor: '#5f63d0', primaryTextColor: '#e6e8eb',
  secondaryColor: '#2b2442', secondaryBorderColor: '#7c5cc4', tertiaryColor: '#1d2127', tertiaryBorderColor: '#3a414b',
  lineColor: '#7d8590', textColor: '#dfe3e8', mainBkg: '#262850', nodeBorder: '#5f63d0', edgeLabelBackground: '#171a1f', clusterBkg: '#1d2127', clusterBorder: '#3a414b',
  actorBkg: '#262850', actorBorder: '#5f63d0', actorTextColor: '#e6e8eb', actorLineColor: '#4a515c', signalColor: '#9aa3ae', signalTextColor: '#dfe3e8',
  noteBkgColor: '#3a3320', noteBorderColor: '#7a6a30', noteTextColor: '#f0e6c0', labelBoxBkgColor: '#262850', labelBoxBorderColor: '#5f63d0', labelTextColor: '#e6e8eb', loopTextColor: '#dfe3e8',
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
