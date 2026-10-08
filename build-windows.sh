#!/usr/bin/env bash
# Cross-compiles Markly for Windows x64 from Linux and collects deliverables in dist/.
# Requirements: rustup target x86_64-pc-windows-msvc, cargo-xwin, tauri-cli v2, nsis, lld, llvm, clang (clang-cl), node.
set -euo pipefail
cd "$(dirname "$0")"
npm install --no-audit --no-fund
(cd src-tauri && cargo tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc)
REL=src-tauri/target/x86_64-pc-windows-msvc/release
VER=$(node -p "require('./src-tauri/tauri.conf.json').version")
mkdir -p dist
cp "$REL/bundle/nsis/Markly_${VER}_x64-setup.exe" dist/
cp "$REL/Markly.exe" "dist/Markly_${VER}_x64_portable.exe"
cp samples/showcase.md samples/other.md dist/
mkdir -p dist/images && cp samples/images/* dist/images/
node tools/screenshot.mjs /samples/showcase.md dist
ls -la dist
