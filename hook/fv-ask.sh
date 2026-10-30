#!/usr/bin/env bash
# foreman-vision answer hook (PermissionRequest, matcher AskUserQuestion): hands the question to the local server
# (127.0.0.1 only) and prints the decision it returns once the pop-up answers. No port file, no server, no jq, an
# error or no answer (204): prints nothing and exits 0, so the terminal's own dialog decides.
# Usage: fv-ask.sh <port file>   (`node src/cli.ts install` writes the command, `serve` writes the file)
#        fv-ask.sh               (the plugin): <config>/foreman-vision/port, where `serve` writes it
command -v jq >/dev/null 2>&1 || exit 0
port=$(tr -cd '0-9' 2>/dev/null < "${1:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/foreman-vision/port}")
[ -n "$port" ] || exit 0
# --max-time: on Windows a killed hook leaves curl running; it lets go by the hook's own timeout (3600 s)
# --noproxy: an http_proxy / all_proxy must never carry the question off this machine
# jq: whatever listens on the port, only an allow with the answered input goes out, never updatedPermissions or the like
curl -sf --noproxy '*' --connect-timeout 2 --max-time 3600 -H 'X-Foreman-Vision: 1' -H 'content-type: application/json' \
  --data-binary @- "http://127.0.0.1:$port/api/ask" 2>/dev/null \
  | jq -c '.hookSpecificOutput.decision | select(.behavior == "allow" and (.updatedInput | type) == "object")
      | { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow", updatedInput } } }' 2>/dev/null
exit 0
