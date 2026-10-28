#!/usr/bin/env bash
# Plugin-only SessionStart hook (wired in hook/hooks.json; `node src/cli.ts install` never runs it).
# Writes the plugin's folder, one line, to <config>/foreman-vision/plugin-root, only when it changed:
# the folder moves with every plugin update, and foreman finds foreman-vision through this file.
# Never prints, always exits 0.
root=$(cd "$(dirname "$0")/.." 2>/dev/null && { pwd -W 2>/dev/null || pwd -P; }) || exit 0 # -W: Git Bash's C:/x form
f="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/foreman-vision/plugin-root"
[ "$(cat "$f" 2>/dev/null)" = "$root" ] ||
  { mkdir -p "${f%/*}" && printf '%s' "$root" > "$f.tmp.$$" && mv -f "$f.tmp.$$" "$f"; } >/dev/null 2>&1
exit 0
