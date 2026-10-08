# Changelog

## 1.1.0 — 2026-10-08

### Added
- **Linux**: `.deb`, `.rpm` and `.AppImage` builds. The desktop entry registers Markly for
  `text/markdown` (`Exec=markly %f`), so it appears under *Open With*.
- **macOS** (unsigned, untested on real hardware): universal `.dmg` built by CI. Markly is
  offered under *Open With* for `.md`, `.markdown`, `.mdown` and `.mkd` (as an alternate viewer,
  not the default), and Finder double-clicks work whether or not Markly is already running.
  The UI shows ⌘ instead of Ctrl, and ⌘[ / ⌘] go back and forward.
- GitHub Actions: CI builds for Windows, Linux and macOS on every push and pull request, and a
  release workflow that publishes all installers when a `v*` tag is pushed.
- `build-linux.sh`, plus benchmark and verification tools in `tools/`.

### Changed
- Faster first render, with identical output (pixel-identical screenshots and identical HTML):
  - The text font is preloaded, and the browser's default text rendering is used, so pages are laid out once.
  - Highlight.js grammars, the YAML parser and KaTeX's stylesheet now load only when a document needs them.
  - The start-up bundle is about 46% smaller.
- The Windows/Linux executable is built for size (`opt-level = "z"`).
- Links to macOS app bundles, scripts and installers, and to Linux launchers, scripts and packages,
  are never launched from documents (on top of the existing Windows list).
