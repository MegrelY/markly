#!/usr/bin/env bash
# Creates a small git repository for the file-history tests and screenshots:
#   make-git-fixture.sh <dir> [--dirty]
# Five commits by two authors touch one Markdown file, including a rename into a folder whose name
# has a space and non-ASCII letters; --dirty leaves an uncommitted edit in the working copy.
set -euo pipefail
dir=$1
rm -rf "$dir"; mkdir -p "$dir"; cd "$dir"
g() { git -c commit.gpgsign=false -c init.defaultBranch=main "$@"; }
commit() { # author email date message
  GIT_AUTHOR_NAME=$1 GIT_AUTHOR_EMAIL=$2 GIT_COMMITTER_NAME=$1 GIT_COMMITTER_EMAIL=$2 \
  GIT_AUTHOR_DATE=$3 GIT_COMMITTER_DATE=$3 g commit -qam "$4"
}
g init -q
cat > guide.md <<'MD'
# Markly guide

Markly is a small Markdown viewer.

## Install

Download the installer and run it.
MD
g add guide.md
commit "Yosef Megrel" yosef@example.com 2026-09-14T09:12:00+03:00 "Add the guide"

cat > guide.md <<'MD'
# Markly guide

Markly is a small Markdown viewer.

## Install

Download the installer for your system and run it.
On Linux, install the .deb or .rpm package, or run the AppImage.

## Open files

Double-click a .md file, or drop it on the window.
MD
commit "Yosef Megrel" yosef@example.com 2026-09-20T16:40:00+03:00 "Expand install steps, add Open files"

mkdir -p "docs/Guides ü"
g mv guide.md "docs/Guides ü/User guide.md"
commit "Dana Levi" dana@example.com 2026-09-28T11:05:00+03:00 "Move the guide into docs/"

f="docs/Guides ü/User guide.md"
cat > "$f" <<'MD'
# Markly guide

Markly is a fast, quiet Markdown viewer for Windows, macOS and Linux.

## Install

Download the installer for your system and run it.
On Linux, install the .deb or .rpm package, or start the AppImage.

## Open files

Double-click a .md file, drag it onto the window, or press Ctrl+O.
MD
commit "Dana Levi" dana@example.com 2026-10-05T14:22:00+03:00 "Clarify wording"

cat >> "$f" <<'MD'

## Shortcuts

| Keys | Action |
|---|---|
| Ctrl+F | Find |
| Ctrl+Shift+E | Folder browser |
| Ctrl+Shift+H | File history |
MD
commit "Yosef Megrel" yosef@example.com 2026-10-10T10:30:00+03:00 "Add a shortcuts table"

if [[ ${2:-} == --dirty ]]; then
  sed -i 's/a fast, quiet Markdown viewer/a fast, quiet and private Markdown viewer/' "$f"
fi
