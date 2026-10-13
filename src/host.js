// Host abstraction: the real Tauri runtime, or a plain browser (used for previews/screenshots).
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { openUrl, openPath } from '@tauri-apps/plugin-opener';
import { basename, dirname } from './path.js';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const tauriHost = {
  kind: 'tauri',
  initialFile: () => invoke('initial_file'),
  read: (path) => invoke('read_markdown', { path }),
  watch: (path) => invoke('watch_file', { path }).catch(() => {}),
  onChange: (cb) => listen('file-changed', (e) => cb(e.payload)),
  onOpenFile: (cb) => listen('open-file', (e) => cb(e.payload)),
  listDir: (path) => invoke('list_dir', { path }),
  watchDir: (path) => invoke('watch_dir', { path }).catch(() => {}),
  onDirChange: (cb) => listen('dir-changed', (e) => cb(e.payload)),
  gitInfo: (path) => invoke('git_info', { path }),
  gitLog: (root, rel) => invoke('git_log', { root, rel }),
  gitDiff: (root, { rev = null, base = null, paths }) => invoke('git_diff', { root, rev, base, paths }),
  gitFile: (root, rev, rel) => invoke('git_file', { root, rev, rel }),
  assetUrl: (p) => convertFileSrc(p),
  readImage: (path) => invoke('read_image', { path }),
  pickFile: async () => {
    const r = await openDialog({
      multiple: false, directory: false, title: 'Open Markdown file',
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdx'] },
        { name: 'Text, code and data', extensions: ['txt', 'log', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'csv', 'tsv',
          'xml', 'svg', 'html', 'htm', 'css', 'scss', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'sh', 'ps1', 'bat', 'sql', 'rs', 'go',
          'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'rb', 'php', 'kt', 'swift', 'lua', 'env', 'gitignore', 'editorconfig', 'dockerfile'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    return Array.isArray(r) ? r[0] : r;
  },
  openExternal: (url) => openUrl(url),
  openPath: (p) => openPath(p),
  setTitle: (t) => getCurrentWindow().setTitle(t),
  setTheme: (t) => getCurrentWindow().setTheme(t).catch(() => {}),
  show: () => getCurrentWindow().show(),
  close: () => getCurrentWindow().close(),
  onDrop: (cb) => getCurrentWebview().onDragDropEvent((e) => cb(e.payload)),
};

const devGit = !isTauri && typeof location !== 'undefined' && new URLSearchParams(location.search).has('git');
async function gitFetch(op, args) {
  const res = await fetch(`/?__git=${op}`, { method: 'POST', body: JSON.stringify(args), cache: 'no-store' });
  const body = await res.json().catch(() => ({ kind: 'git', message: `HTTP ${res.status}` }));
  if (!res.ok) throw body;
  return body;
}

const browserHost = {
  kind: 'browser',
  initialFile: async () => new URLSearchParams(location.search).get('file'),
  read: async (path) => {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Could not open ${path} (${res.status})`);
    // Same rules as the Rust side: NUL bytes near the start mean binary; UTF-8/UTF-16 BOMs decoded.
    const b = new Uint8Array(await res.arrayBuffer());
    const le = b[0] === 0xff && b[1] === 0xfe, be = b[0] === 0xfe && b[1] === 0xff;
    const binary = !le && !be && b.subarray(0, 8192).includes(0);
    const content = binary ? '' : new TextDecoder(le ? 'utf-16le' : be ? 'utf-16be' : 'utf-8').decode(b);
    return { path, name: basename(path), dir: dirname(path), content, size: b.length, binary };
  },
  watch: async () => {},
  onChange: async () => {},
  onOpenFile: async () => {},
  // Dev/test servers (tools/dev-list.mjs) answer "<folder>/?__list" with the same JSON as list_dir.
  listDir: async (path) => {
    const dir = !path || path === '~' ? '' : path.replace(/\/+$/, '');
    const res = await fetch(`${dir}/?__list=1`, { cache: 'no-store' });
    const body = await res.json().catch(() => ({ kind: 'other', message: `HTTP ${res.status}` }));
    if (!res.ok) throw body;
    return body;
  },
  watchDir: async () => {},
  onDirChange: async () => {},
  // File history: only when the page was opened with ?git=1 by a dev/test server that answers
  // "/?__git=<op>" (tools/dev-list.mjs); plain previews and benchmarks make no extra request.
  gitInfo: async (path) => (devGit ? gitFetch('info', { path }) : null),
  gitLog: (root, rel) => gitFetch('log', { root, rel }),
  gitDiff: (root, { rev = null, base = null, paths }) => gitFetch('diff', { root, rev, base, paths }),
  gitFile: (root, rev, rel) => gitFetch('file', { root, rev, rel }),
  assetUrl: (p) => p,
  readImage: async () => { throw new Error('unsupported'); },
  pickFile: async () => null,
  openExternal: async (url) => { window.open(url, '_blank', 'noopener'); },
  openPath: async (p) => { window.open(p, '_blank', 'noopener'); },
  setTitle: async (t) => { document.title = t; },
  setTheme: async () => {},
  show: async () => {},
  close: async () => window.close(),
  onDrop: async () => {},
};

export const host = isTauri ? tauriHost : browserHost;
