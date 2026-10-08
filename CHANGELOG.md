# Changelog

## 1.2.0 — 2026-10-08

### Added
- **Folder browser**: a panel on the right side of the window. Open it with the toolbar button
  next to Contents, or with Ctrl+Shift+E (⇧⌘E on macOS).
  - It shows the current document's folder, with the full path and a copy button, clickable
    breadcrumbs and an Up button.
  - Folders are listed first, sorted naturally.
  - Double-click a folder to open it. Click a Markdown file to open it in the same window.
  - Markdown files are shown in the accent colour. Other files are dimmed and never launched.
  - Hidden files are not shown.
  - The current file is highlighted, and the panel follows it to its folder.
  - Optional filter: show only Markdown files.
  - Full keyboard navigation (arrows, Enter, Backspace, type-ahead).
  - The panel is resizable, refreshes when the folder changes, and remembers whether it was open,
    its width and its filter.
  - It explains empty folders and folders it has no permission to open.
  - On Windows it can go up to "This PC" to switch drives.
  - It loads on first use, so start-up is unchanged while the panel is closed.
- **Copy** button in the header, next to Find. It opens a small menu:
  - **Copy path** copies the open file's full path with the OS's own separators. Ctrl+Shift+C does the
    same (⇧⌘C on macOS).
  - **Copy content** copies the file's raw Markdown source as read from disk, not the rendered HTML.
    Line endings, tabs and Unicode are kept as they are; a UTF-8/UTF-16 byte-order mark is not included.

  A checkmark and a short "Copied" toast confirm the copy. The button is disabled when no file is open.

### Fixed
- Release workflow: the release is now reliably found or created, so installers are attached to it
  (v1.1.0's builds were skipped and the files were attached by hand). Existing tags can be rebuilt
  with `gh workflow run release.yml -f tag=vX.Y.Z`, which replaces files that have the same names.
- macOS releases are a **universal** `.dmg` (Intel and Apple silicon). v1.1.0 shipped only an Apple
  silicon build.

## 1.1.0 — 2026-10-08

### Added
- **Linux**: `.deb`, `.rpm` and `.AppImage` builds. The desktop entry registers Markly for
  `text/markdown` (`Exec=markly %f`), so it appears under *Open With*.
- **macOS** (unsigned, untested on real hardware): `.dmg` (Apple silicon for v1.1.0). Markly is
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

## 1.0.0 — 2026-10-08

First release: a lightweight Markdown viewer for Windows (Tauri 2 + WebView2).
- CommonMark + GitHub Flavored Markdown: tables, task lists, footnotes, alerts, `==highlight==` and emoji.
- Syntax highlighting with copy buttons, KaTeX math and Mermaid diagrams (both loaded only when used).
- YAML front matter panel, and automatic right-to-left layout for Hebrew and Arabic.
- Light and dark themes that follow Windows, table of contents, find, zoom, and print / Save as PDF.
- Opens files from the command line, double-click, *Open with* or drag and drop. Keeps recent files,
  follows relative links and images, and reloads when the file changes.
- Remembers window size and position, theme, zoom and sidebar state.
- Strips scripts and unsafe HTML, and never launches executables from links.
- Per-user NSIS installer that registers *Open with* without taking over `.md`, plus a portable exe.
