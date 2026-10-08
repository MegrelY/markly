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
  assetUrl: (p) => convertFileSrc(p),
  readImage: (path) => invoke('read_image', { path }),
  pickFile: async () => {
    const r = await openDialog({
      multiple: false, directory: false, title: 'Open Markdown file',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdx', 'txt'] }, { name: 'All files', extensions: ['*'] }],
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

const browserHost = {
  kind: 'browser',
  initialFile: async () => new URLSearchParams(location.search).get('file'),
  read: async (path) => {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Could not open ${path} (${res.status})`);
    return { path, name: basename(path), dir: dirname(path), content: await res.text() };
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
