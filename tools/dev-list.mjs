// Folder listings for the dev/test servers, in the same shape as the Rust `list_dir` command, so
// the folder browser works in plain-browser previews. URL paths map onto the repo root.
import fs from 'node:fs';
import path from 'node:path';

export function devList(root, urlPath) {
  const rel = urlPath.replace(/\/+$/, '') || '/';
  const abs = path.join(root, rel);
  let names;
  try {
    names = fs.readdirSync(abs, { withFileTypes: true });
  } catch (e) {
    const kind = e.code === 'EACCES' || e.code === 'EPERM' ? 'denied' : e.code === 'ENOENT' ? 'notfound' : 'other';
    return { status: kind === 'notfound' ? 404 : 403, body: { kind, message: `${rel}: ${e.code}` } };
  }
  const entries = names
    .filter((d) => !d.name.startsWith('.'))
    .map((d) => {
      const p = (rel === '/' ? '' : rel) + '/' + d.name;
      let dir = d.isDirectory();
      if (d.isSymbolicLink()) { try { dir = fs.statSync(path.join(abs, d.name)).isDirectory(); } catch { dir = false; } }
      return { name: d.name, path: p, dir };
    });
  const parts = rel.split('/').filter(Boolean);
  const crumbs = [{ name: '/', path: '/' }, ...parts.map((n, i) => ({ name: n, path: '/' + parts.slice(0, i + 1).join('/') }))];
  const parent = rel === '/' ? null : (crumbs[crumbs.length - 2]?.path ?? '/');
  return { status: 200, body: { path: rel, parent, crumbs, entries, truncated: false } };
}

/** Handles "<folder>/?__list" requests; returns true when it answered. */
export function maybeServeList(root, req, res) {
  const u = new URL(req.url, 'http://x');
  if (!u.searchParams.has('__list')) return false;
  const { status, body } = devList(root, decodeURIComponent(u.pathname));
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
  return true;
}

// ---------------------------------------------------------------- file history (dev/test only)
// Mirrors the Rust git commands (src-tauri/src/git.rs) with the same read-only git invocations, so
// the history view works in browser previews opened with ?git=1. Paths are URL paths.
import { execFileSync } from 'node:child_process';

const GIT_BASE = ['--no-pager', '--literal-pathspecs', '-c', 'core.quotepath=off', '-c', 'core.fsmonitor=false', '-c', 'color.ui=never'];
function git(cwd, args, max = 16 * 1024 * 1024) {
  try {
    return execFileSync('git', [...GIT_BASE, ...args], { cwd, maxBuffer: max, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8');
  } catch (e) {
    const msg = String(e.stderr || e.message).split('\n').find((l) => l.trim()) || 'git failed';
    throw { kind: e.code === 'ENOENT' ? 'nogit' : 'git', message: msg.replace(/^fatal: /, '') };
  }
}
const hex = (r) => { if (r != null && !/^[0-9a-f]{4,64}$/i.test(r)) throw { kind: 'git', message: `Not a commit id: ${r}` }; return r; };

export function devGit(root, op, a) {
  if (op === 'info') {
    const abs = path.join(root, a.path);
    let d = path.dirname(abs), top = null;
    for (;;) { if (fs.existsSync(path.join(d, '.git'))) { top = d; break; } const up = path.dirname(d); if (up === d) break; d = up; }
    if (!top) return null;
    let rel;
    try { rel = git(path.dirname(abs), ['ls-files', '--full-name', '-z', '--error-unmatch', '--', './' + path.basename(abs)]).split('\0')[0]; }
    catch { return null; }
    const depth = rel.split('/').length;
    const topAbs = abs.split(path.sep).slice(0, -depth).join(path.sep);
    return { root: '/' + path.relative(root, topAbs).split(path.sep).join('/'), rel, available: true };
  }
  const cwd = path.join(root, a.root);
  if (op === 'log') {
    const raw = git(cwd, ['log', '--follow', '-z', '-M', '--name-status', '--no-color', '-n2001', '--format=%x1e%H%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%s', '--', a.rel]);
    const commits = [];
    let cur = a.rel;
    for (const rec of raw.split('\x1e').filter(Boolean)) {
      const z = rec.indexOf('\0');
      const f = rec.slice(0, z).split('\x1f');
      const parts = rec.slice(z + 1).replace(/^\n/, '').split('\0').filter(Boolean);
      let status = '', oldPath = null, p = cur;
      if (parts.length >= 3 && /^[RC]/.test(parts[0])) { status = parts[0][0]; oldPath = parts[1]; p = parts[2]; }
      else if (parts.length >= 2) { status = parts[0][0]; p = parts[1]; }
      cur = oldPath || p;
      commits.push({ hash: f[0], short: f[1], author: f[2], email: f[3], time: +f[4], subject: f[5] ?? '', path: p, old_path: oldPath, status });
    }
    const st = git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=no', '--no-renames', '--', a.rel]);
    let staged = false, unstaged = false;
    for (const e of st.split('\0').filter((x) => x.length > 3)) { staged ||= e[0] !== ' ' && e[0] !== '?'; unstaged ||= e[1] !== ' ' && e[1] !== '?'; }
    return { commits: commits.slice(0, 2000), truncated: commits.length > 2000, staged, unstaged };
  }
  if (op === 'diff') {
    const common = ['-M', '--no-color', '--no-ext-diff', '--no-textconv', '-U3'];
    const args = a.base && a.rev ? ['diff', ...common, hex(a.base), hex(a.rev)]
      : a.rev ? ['show', '--format=', '--diff-merges=first-parent', ...common, hex(a.rev)]
      : ['diff', ...common, 'HEAD'];
    return { patch: git(cwd, [...args, '--', ...a.paths]), truncated: false };
  }
  if (op === 'file') return git(cwd, ['cat-file', 'blob', `${hex(a.rev)}:${a.rel}`]);
  throw { kind: 'git', message: `unknown op ${op}` };
}

/** Handles POST "/?__git=<op>" requests; returns true when it answered. */
export function maybeServeGit(root, req, res) {
  const u = new URL(req.url, 'http://x');
  const op = u.searchParams.get('__git');
  if (!op) return false;
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let status = 200, out;
    try { out = devGit(root, op, JSON.parse(body || '{}')); } catch (e) { status = 500; out = e.kind ? e : { kind: 'git', message: String(e) }; }
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out));
  });
  return true;
}
