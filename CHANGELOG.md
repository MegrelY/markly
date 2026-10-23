# Changelog

## Unreleased

### Added
- **Pins**: right-click a paragraph, heading, list item, code line or table row and choose *Pin this
  spot* to mark a place to come back to (Ctrl+F2 pins the top of the window; ⌘F2 on macOS). F2 and
  Shift+F2 go to the next and previous pin, wrapping around. A pinned block gets a bar in the margin.
- **Highlights**: select text, right-click and choose *Highlight* (green, so find's yellow matches
  stay visible on it). Highlighting across an existing highlight joins the two; right-click a
  highlight to remove it.
- Pins and highlights are listed in the sidebar under the contents, where a click goes to one and
  × removes it. The sidebar also opens for them in text, code and data files. They are kept by
  Markly per file (the file is never changed) and follow their text when the file is edited:
  a pin by the start of its paragraph (else its section), a highlight by its text and the words
  around it. Not shown on earlier versions from the file history.
- **Continue where you left off**: reopening a file (recent files, folder browser, command line,
  drag and drop) returns to the place you were reading, by the section on screen, so edits above it
  don't move it. Following a link still opens at the top or the anchor, and Back / Forward return
  to where you were in the page as before.
- **URLs in code and plain text open with Ctrl+click** (⌘-click on macOS) in your default browser:
  in Markdown code blocks and inline code, and in text, code, JSON, CSV and HTML source views. A
  plain click still selects text. Hovering a URL shows a hint, and holding Ctrl shows it as a link.
- **Right-click menu.** On selected text: *Copy* and *Search Google for “…”*, or *Open in browser*
  when the selection is a web address. On a web link or a URL in code: *Open link in browser* and
  *Copy link address* (*Copy email address* for `mailto:` links). Esc or a click elsewhere closes it.
- **Link tooltips always show the address**, so a link's text can't hide where it goes: now also
  for links with their own title (shown first, the address below) and for links to other files.
- **Middle-click** opens a web link, or a URL in code, in your default browser.

### Changed
- **New tagline: *Read anything, beautifully.*** Markly opens more than Markdown now, so the welcome
  screen (*Open a file…*), the sample banner, the README and the app's descriptions in the
  installers, Windows *Open with* and the Linux app menu say so.
- **Open dialog** (Ctrl+O): titled *Open a file*, and it lists every type Markly opens by default
  (Markdown, text, code and data) instead of Markdown only. *Markdown*, *Text, code and data* and
  *All files* are still in the type list.

### Fixed
- **Web links open in your default browser.** Clicking an `https://`, `http://`, `mailto:` or
  `tel:` link showed "Not allowed to open url …": the window was allowed to open URLs, but no
  address was in scope.
- The Copy menu showed *Copy formatted* for Markdown files too, where it does nothing. It now only
  appears in the Formatted view of code and data files.
- Copying or searching for a selected heading no longer includes its hidden `#` anchor.

## 1.5.0 — 2026-10-23

### Added
- **Folder browser: filter by file type.** The filter button opens a menu listing the file types in
  the current folder with a count for each (Markdown, JSON, Python, Environment, …). Pick one or
  several to show only those files, or show every file, or only the files Markly opens. Folders
  always stay visible; the choice carries over to other folders and is remembered. The status line
  says how many files are shown. Replaces the *only Markdown* switch (that setting carries over).
- **`.env` files**: `.env` and its variants (`.env.local`, `.env.example`, `.env.production`, …)
  open highlighted and are listed in the folder browser (other dot-files stay hidden). The Windows
  installer offers Markly in *Open with* for `.env`.

### Changed
- **New look.** A teal accent replaces the purple across the app: Markdown files in the folder
  browser, selected rows, toggles and the contents highlight. Diagrams use matching teal tones.
- **New icon**: a teal bookmark with an "M", on a transparent background, in the installers, the
  window and taskbar, and the welcome screen. The sample banner uses it too.
- **Better contrast**: secondary text (status line, counts, menu headings, captions) now meets
  WCAG AA (4.5:1) in both themes, and buttons in the accent color use dark text in dark mode.

### Performance
- Folder browser: a listing is classified and sorted once, so changing the filter only redraws the
  list; rows scrolled out of view are not laid out or painted; and listings no longer carry a full
  path per entry (the panel joins folder and name), which makes them 50–75% smaller.

## 1.4.0 — 2026-10-13

### Added
- **Text, code and data files.** Markly now opens more than Markdown, read-only as always:
  - **Plain text** (`.txt`, `.log`, `.text`, and extension-less `README`, `LICENSE`, `CHANGELOG` and
    similar): a calm reading view with wrapped lines and comfortable type. Line numbers and a
    monospace font are a click away; logs open in monospace.
  - **Code and config** (Python, JavaScript/TypeScript, JSON, YAML, TOML, INI/CFG/CONF/.env, HTML,
    CSS/SCSS, XML/SVG, SQL, shell/PowerShell/batch, Rust, Go, Java, C/C++, C#, Ruby, PHP, Kotlin,
    Swift, Lua, Dockerfile, .gitignore, .editorconfig and more): syntax highlighting with line
    numbers, plus a Wrap toggle.
  - **CSV/TSV** as a table in the Markdown table style. Click a column header to sort (numbers sort
    as numbers; a third click restores file order), or switch to Raw.
  - **HTML**: the source, or a **Preview**. The preview is sanitized like Markdown and shown in a
    sandboxed frame. Scripts can't run, links don't go anywhere, and nothing is loaded from the
    network (only inline styles and local images).
  - **Formatted / Original** toggle: JSON, YAML, XML/SVG, HTML, CSS/SCSS/Less and JavaScript/TypeScript
    are shown nicely formatted by default, like Prettier in an editor. JSON keeps its key order,
    number text and comments (JSONC). Formatting changes only what you see, never the file. If a
    file can't be parsed, Markly shows it as written with a short note. Files over 1 MB are shown as
    written.
  - **Copy formatted** in the Copy menu when the formatted view is on screen. *Copy content* still
    copies the file exactly as it is on disk.
  - Files over 5 MB open as plain text (no highlighting or formatting). Binary files show a short
    "not a text file" message. UTF-8 and UTF-16 files with a byte-order mark are decoded correctly.
  - Find, zoom, themes, auto-reload, recent files, back/forward, the window title and file history
    (diffs and *view at this commit*) all work for these files.
- **Folder browser**: these files can be opened from the panel too, and are listed with muted
  per-type icons. Markdown keeps its accent colour.
- Links from a Markdown document to these files open them in Markly.
- Installers offer Markly in *Open with* for `.txt .log .json .yaml .yml .toml .ini .csv .xml .html
  .htm .css .js .ts .py`. These are never made the default; Markdown registration is unchanged.

### Changed
- `.txt` files open in the plain-text view instead of being rendered as Markdown.

### Performance
- Opening a Markdown file is unchanged: the new views, formatters and their styles are separate
  chunks that load only when such a file is opened, and Prettier's parsers load per language
  (TypeScript uses Prettier's Babel parser rather than the 900 KB TypeScript plugin). Rendered
  Markdown is identical to 1.3.0 (pixel-identical screenshots, identical HTML).

### Fixed
- Folder browser: after closing the panel with Esc, focus stays in the document, so keys no longer
  reach the hidden folder list.

## 1.3.0 — 2026-10-12

### Added
- **File history**: when the open file is tracked in a Git repository, a History button appears in the
  header (Ctrl+Shift+H, ⇧⌘H on macOS). The check runs after the document is shown, so it never delays it.
  - The history lists every commit that changed the file, following renames (`git log --follow`): short
    hash, subject, author, and relative and local date. An *Uncommitted changes* entry at the top shows
    staged and unstaged edits against the last commit.
  - Click a commit to see exactly how the file changed in it: green/red lines with old and new line
    numbers, hunk headers and word-level highlights. Switch between Unified and Split (side-by-side)
    views; the choice is remembered.
  - *View file at this commit* (or Enter) renders the Markdown as it was then, read-only, under a banner
    with *Back to history* and *Return to current version* (or Esc).
  - Ctrl+click (⌘-click) a second commit to compare two commits. Each hash has a copy button.
  - Keyboard: ↑ ↓ Home End PageUp PageDown to move through commits, Esc to close.
  - Markly runs the `git` command-line tool you have installed and only reads the repository. It never
    runs a command that changes it, and turns off pagers, external diff tools, text-conversion filters
    and fsmonitor hooks. Calls time out after 20 s, and very large diffs are cut off with a note.
    If Git isn't installed, the history explains that instead.
  - The history code and styles load only when the history is first opened.

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
