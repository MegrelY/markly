#!/usr/bin/env bash
# Builds Markly for Linux x64 (.deb, .rpm, .AppImage) and collects them in dist/.
# Requirements: Rust, tauri-cli v2, node, and the WebKitGTK build deps:
#   sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev patchelf file dpkg-dev
set -euo pipefail
cd "$(dirname "$0")"
npm install --no-audit --no-fund
# APPIMAGE_EXTRACT_AND_RUN lets linuxdeploy run without FUSE (containers, CI).
(cd src-tauri && APPIMAGE_EXTRACT_AND_RUN=1 cargo tauri build)
B=src-tauri/target/release/bundle
VER=$(node -p "require('./src-tauri/tauri.conf.json').version")
mkdir -p dist
cp "$B/deb/Markly_${VER}_amd64.deb" "$B/rpm/Markly-${VER}-1.x86_64.rpm" "$B/appimage/Markly_${VER}_amd64.AppImage" dist/
ls -la dist
