#!/usr/bin/env bash
# Measures idle memory of a Linux Markly binary with a document open (under Xvfb).
# Usage: tools/linux-rss.sh <binary> <doc.md> [runs=3] [screenshot.png]
# Prints per-run: main process RSS/PSS and total (main + WebKit web/network processes) RSS/PSS in MB.
set -euo pipefail
BIN=$1; DOC=$2; RUNS=${3:-3}; SHOT=${4:-}
DISP=:93
Xvfb $DISP -screen 0 1400x950x24 >/dev/null 2>&1 & XPID=$!
sleep 1
mem() { # pid -> "rssKB pssKB"
  awk '/^Rss:/{r=$2}/^Pss:/{p=$2}END{print r+0, p+0}' /proc/$1/smaps_rollup 2>/dev/null || echo "0 0"
}
for i in $(seq 1 "$RUNS"); do
  TMP=$(mktemp -d)
  mkdir -p "$TMP/run" && chmod 700 "$TMP/run"
  XDG_RUNTIME_DIR=$TMP/run XDG_DATA_HOME=$TMP/data XDG_CONFIG_HOME=$TMP/config XDG_CACHE_HOME=$TMP/cache DISPLAY=$DISP \
    "$BIN" "$DOC" >/dev/null 2>&1 & APID=$!
  sleep 10
  read MR MP < <(mem $APID)
  TR=$MR; TP=$MP
  # WebKit helper processes are children of the app process
  for c in $(ps -o pid= --ppid $APID); do read R P < <(mem $c); TR=$((TR+R)); TP=$((TP+P)); done
  echo "run $i: main RSS $((MR/1024)) MB PSS $((MP/1024)) MB | total RSS $((TR/1024)) MB PSS $((TP/1024)) MB"
  if [ -n "$SHOT" ] && [ "$i" = 1 ]; then DISPLAY=$DISP import -window root "$SHOT"; fi
  kill $APID 2>/dev/null; wait $APID 2>/dev/null || true
  sleep 0.5
  for m in "$TMP"/run/doc "$TMP"/cache/doc; do fusermount3 -u "$m" 2>/dev/null || true; done
  rm -rf "$TMP" 2>/dev/null || true
done
kill $XPID 2>/dev/null || true
