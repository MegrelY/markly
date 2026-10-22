// What kind of view a file gets, decided from its name (part of the start-up bundle, so kept tiny).
//   md    Markdown (the main renderer)
//   text  plain text (readable view)
//   code  highlighted source with line numbers (lang = highlight.js name)
//   csv   table (sortable) or raw
//   json  pretty-printed JSON
//   html  source, or a sandboxed preview
// `fmt` names the formatter used by the Formatted view (absent: shown as written).
const CODE = {
  py: 'python', pyw: 'python', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript',
  yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini', env: 'ini', properties: 'ini', editorconfig: 'ini',
  css: 'css', scss: 'scss', less: 'less', xml: 'xml', svg: 'xml', xsd: 'xml', xsl: 'xml', plist: 'xml',
  sql: 'sql', sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell', psm1: 'powershell', bat: 'dos', cmd: 'dos',
  rs: 'rust', go: 'go', java: 'java', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', cs: 'csharp',
  rb: 'ruby', php: 'php', kt: 'kotlin', kts: 'kotlin', swift: 'swift', lua: 'lua', pl: 'perl', r: 'r', vb: 'vbnet',
  dockerfile: 'dockerfile', gitignore: 'bash', gitattributes: 'bash', dockerignore: 'bash', npmignore: 'bash',
  diff: 'diff', patch: 'diff', graphql: 'graphql', proto: 'protobuf', mk: 'makefile', nginx: 'nginx',
};
const FMT = { js: 'babel', mjs: 'babel', cjs: 'babel', jsx: 'babel', ts: 'babel-ts', mts: 'babel-ts', cts: 'babel-ts', tsx: 'babel-ts',
  css: 'css', scss: 'scss', less: 'less', yaml: 'yaml', yml: 'yaml', xml: 'xml', svg: 'xml', xsd: 'xml', xsl: 'xml', plist: 'xml',
  json: 'json', jsonc: 'json', json5: 'json', html: 'html', htm: 'html', xhtml: 'html' };
const LABEL = { python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript', yaml: 'YAML', ini: 'Config', css: 'CSS', scss: 'SCSS',
  less: 'Less', xml: 'XML', sql: 'SQL', bash: 'Shell', powershell: 'PowerShell', dos: 'Batch', rust: 'Rust', go: 'Go', java: 'Java',
  c: 'C', cpp: 'C++', csharp: 'C#', ruby: 'Ruby', php: 'PHP', kotlin: 'Kotlin', swift: 'Swift', lua: 'Lua', perl: 'Perl', r: 'R',
  vbnet: 'VB.NET', dockerfile: 'Dockerfile', diff: 'Diff', graphql: 'GraphQL', protobuf: 'Protocol Buffers', makefile: 'Makefile', nginx: 'nginx' };
const MD = /^(md|markdown|mdown|mkdn|mkd|mdwn|mdx)$/;
const TEXT = /^(txt|text|log|out|nfo|asc|rst|adoc)$/;
// Extension-less names that are plain text (README, LICENSE, …) or code (Makefile, Dockerfile).
const BARE_TEXT = /^(readme|license|licence|copying|authors|contributors|changelog|changes|history|news|notice|todo|install|thanks|version|codeowners)$/i;
const BARE_CODE = { makefile: 'makefile', gnumakefile: 'makefile', dockerfile: 'dockerfile', containerfile: 'dockerfile', gemfile: 'ruby', rakefile: 'ruby', vagrantfile: 'ruby', jenkinsfile: 'javascript' };

const EXT_LABEL = { toml: 'TOML', svg: 'SVG', jsx: 'JSX', tsx: 'TSX', env: 'Environment', editorconfig: 'EditorConfig',
  gitignore: 'Git ignore', gitattributes: 'Git attributes', dockerignore: 'Docker ignore', npmignore: 'npm ignore', plist: 'Property list' };
const base = (p) => p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);

/** { kind, lang?, fmt?, label, ext } or null when Markly doesn't view this kind of file. */
export function fileType(path) {
  const name = base(path);
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  // ".gitignore" style names: the part after the dot is the type
  const ext = dot >= 0 ? lower.slice(dot + 1) : '';
  const stem = dot > 0 ? lower.slice(0, dot) : lower;
  if (MD.test(ext)) return { kind: 'md', label: 'Markdown', ext };
  if (dot <= 0 && BARE_CODE[lower.replace(/^\./, '')]) { const l = BARE_CODE[lower.replace(/^\./, '')]; return { kind: 'code', lang: l, label: LABEL[l], ext: lower }; }
  if (stem === 'dockerfile' || ext === 'dockerfile') return { kind: 'code', lang: 'dockerfile', label: 'Dockerfile', ext };
  if (TEXT.test(ext) || (dot < 0 && BARE_TEXT.test(lower)) || (BARE_TEXT.test(stem) && !CODE[ext] && ext.length <= 4 && !/^(json|html?|csv|tsv|xml)$/.test(ext))) return { kind: 'text', label: ext === 'log' ? 'Log' : 'Text', ext, mono: ext === 'log' || ext === 'out' };
  if (ext === 'csv' || ext === 'tsv') return { kind: 'csv', label: ext.toUpperCase(), ext, sep: ext === 'tsv' ? '\t' : null };
  if (ext === 'json' || ext === 'jsonc' || ext === 'json5' || ext === 'geojson' || ext === 'webmanifest') return { kind: 'json', lang: 'json', fmt: 'json', label: 'JSON', ext };
  if (ext === 'html' || ext === 'htm' || ext === 'xhtml') return { kind: 'html', lang: 'xml', fmt: 'html', label: 'HTML', ext };
  if (CODE[ext]) return { kind: 'code', lang: CODE[ext], fmt: FMT[ext], label: EXT_LABEL[ext] || LABEL[CODE[ext]], ext };
  // dotenv variants: .env.local, .env.example, .env.production, … (".env" itself is handled above)
  if (lower.startsWith('.env.')) return { kind: 'code', lang: 'ini', label: EXT_LABEL.env, ext: 'env' };
  return null;
}
export const isMarkdownPath = (p) => fileType(p)?.kind === 'md';
/** Files Markly opens itself (Markdown, text, code, data). */
export const isViewable = (p) => !!fileType(p);
