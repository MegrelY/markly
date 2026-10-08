// Minimal cross-platform path helpers (Windows + POSIX style).
const DRIVE = /^[a-zA-Z]:[\\/]/;
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

export const isWinPath = (p) => DRIVE.test(p) || p.startsWith('\\\\') || (p.includes('\\') && !p.includes('/'));

export function dirname(p) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  if (i < 0) return '';
  if (i === 2 && DRIVE.test(p)) return p.slice(0, 3);
  return i === 0 ? p[0] : p.slice(0, i);
}

export function basename(p) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i < 0 ? p : p.slice(i + 1);
}

export const isAbsolute = (p) => DRIVE.test(p) || p.startsWith('/') || p.startsWith('\\\\');

/** true if href points at a local file (relative path, absolute path or file: URL). */
export function isLocalRef(href) {
  if (!href) return false;
  const h = href.trim();
  if (h.startsWith('#') || h.startsWith('//')) return false;
  if (DRIVE.test(h)) return true;
  if (/^file:/i.test(h)) return true;
  return !SCHEME.test(h);
}

function safeDecode(s) { try { return decodeURIComponent(s); } catch { return s; } }

/** Splits "a/b.md#sec" -> ["a/b.md", "sec"]; also drops ?query. */
export function splitHash(href) {
  const i = href.indexOf('#');
  let p = i >= 0 ? href.slice(0, i) : href;
  const hash = i >= 0 ? safeDecode(href.slice(i + 1)) : '';
  const q = p.indexOf('?');
  if (q >= 0 && !DRIVE.test(p)) p = p.slice(0, q);
  return [p, hash];
}

/** Resolve a link/image reference relative to the folder of the current document. */
export function resolvePath(baseDir, ref) {
  let r = safeDecode(ref.trim());
  if (/^file:/i.test(r)) {
    r = r.replace(/^file:\/*/i, '');
    if (!DRIVE.test(r)) r = (r.startsWith('/') ? '' : '/') + r; // file:///home/x -> /home/x
    if (DRIVE.test(r.slice(1))) r = r.slice(1);
  }
  const win = isWinPath(baseDir) || DRIVE.test(r);
  const sep = win ? '\\' : '/';
  let full;
  if (DRIVE.test(r) || r.startsWith('\\\\')) full = r;
  else if (r.startsWith('/') || r.startsWith('\\')) full = (win && DRIVE.test(baseDir)) ? baseDir.slice(0, 2) + r : r;
  else full = baseDir ? baseDir.replace(/[\\/]+$/, '') + sep + r : r;
  return normalize(full, sep);
}

function normalize(p, sep) {
  let prefix = '';
  if (p.startsWith('\\\\') || (sep === '\\' && p.startsWith('//'))) { prefix = '\\\\'; p = p.slice(2); }
  else if (DRIVE.test(p)) { prefix = p.slice(0, 2) + sep; p = p.slice(3); }
  else if (p.startsWith('/') || p.startsWith('\\')) { prefix = sep; p = p.replace(/^[\\/]+/, ''); }
  const out = [];
  for (const part of p.split(/[\\/]+/)) {
    if (!part || part === '.') continue;
    if (part === '..') { if (out.length && out[out.length - 1] !== '..') out.pop(); else if (!prefix) out.push('..'); }
    else out.push(part);
  }
  return prefix + out.join(sep);
}

export const MD_EXT = /\.(md|markdown|mdown|mkdn|mkd|mdwn|mdx|txt)$/i;
export const isMarkdownPath = (p) => MD_EXT.test(p);
