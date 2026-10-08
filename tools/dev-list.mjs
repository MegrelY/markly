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
