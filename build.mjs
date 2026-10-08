// Bundles the frontend into dist-web/ (consumed by Tauri as frontendDist).
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

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
};
if (watch) { const ctx = await esbuild.context(opts); await ctx.watch(); }
else await esbuild.build(opts);
