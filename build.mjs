// Bundles the frontend into dist-web/ (consumed by Tauri as frontendDist).
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const out = 'dist-web';
const watch = process.argv.includes('--watch');
fs.rmSync(out, { recursive: true, force: true });

fs.mkdirSync(`${out}/katex/fonts`, { recursive: true });


// --- KaTeX: keep woff2 only ---
const kdir = 'node_modules/katex/dist';
let kcss = fs.readFileSync(`${kdir}/katex.min.css`, 'utf8');
kcss = kcss.replace(/,\s*url\([^)]*\.woff\)\s*format\("woff"\)/g, '').replace(/,\s*url\([^)]*\.ttf\)\s*format\("truetype"\)/g, '');
fs.writeFileSync(`${out}/katex/katex.css`, kcss);
for (const f of fs.readdirSync(`${kdir}/fonts`)) if (f.endsWith('.woff2')) fs.copyFileSync(`${kdir}/fonts/${f}`, `${out}/katex/fonts/${f}`);

// --- Static files ---
fs.copyFileSync('src/index.html', `${out}/index.html`);
fs.copyFileSync('src/theme-init.js', `${out}/theme-init.js`);

// Lazy highlight.js language table (aliases/sub-languages resolved like the eager build).
execFileSync(process.execPath, ['tools/gen-hljs.cjs'], { stdio: 'inherit' });

const opts = {
  entryPoints: { app: 'src/app.js', style: 'src/style.css' },
  bundle: true,
  format: 'esm',
  splitting: true,          // mermaid becomes a lazily loaded chunk
  minify: true,
  target: ['chrome105'],
  outdir: out,
  chunkNames: 'chunks/[name]-[hash]',
  assetNames: 'assets/[name]-[hash]',
  legalComments: 'none',
  loader: { '.woff2': 'file', '.svg': 'dataurl' },
  logLevel: 'info',
  metafile: true,
};
// Preload the body text font (Inter latin, upright) so the first layout already uses it instead of
// laying the page out with a fallback font and again when Inter arrives.
function injectPreload(meta) {
  const font = Object.keys(meta.outputs).find((f) => /assets\/inter-latin-wght-normal-[^/]+\.woff2$/.test(f));
  if (!font) throw new Error('Inter font asset not found');
  const href = path.relative(out, font).split(path.sep).join('/');
  const cur = fs.readFileSync(`${out}/index.html`, 'utf8');
  if (cur.includes('rel="preload"')) return;
  const html = cur
    .replace('<link rel="stylesheet" href="style.css">', `<link rel="preload" href="${href}" as="font" type="font/woff2" crossorigin>\n  <link rel="stylesheet" href="style.css">`);
  fs.writeFileSync(`${out}/index.html`, html);
}
if (watch) {
  const ctx = await esbuild.context({ ...opts, plugins: [{ name: 'preload', setup(b) { b.onEnd((r) => r.metafile && injectPreload(r.metafile)); } }] });
  await ctx.watch();
} else {
  const r = await esbuild.build(opts);
  injectPreload(r.metafile);
}
