#!/usr/bin/env bash
# foreman-vision hook: turns one Claude Code hook payload (stdin) into one short
# JSON line appended to <spool dir>/<session id>.jsonl. Always exits 0 and never
# writes to stdout: some hooks' stdout reaches Claude's context.
# Usage: fv-hook.sh <spool dir>   (`node src/cli.ts install` writes the command)
#        fv-hook.sh               (the plugin): spool-dir from foreman-vision.conf, as the server reads it
cfg="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
dir="$1"
[ -n "$dir" ] || dir=$(sed -n 's/^[[:space:]]*spool-dir[[:space:]]*=[[:space:]]*\(.*[^[:space:]]\)[[:space:]]*$/\1/p' "$cfg/foreman-vision.conf" 2>/dev/null | tail -n1 | tr '\\' '/')
dir="${dir:-$cfg/foreman-vision/spool}"
command -v jq >/dev/null 2>&1 || exit 0
# Keep only what the server reads and cut long text, so a line stays far below
# 4KB and parallel appends do not interleave.
out=$(jq -r '
  def cut(n): if type == "string" and length > n then .[0:n] + "…" else . end;
  (.tool_input // null) as $in
  | {
      ts: (now * 1000 | floor),
      event: .hook_event_name,
      payload: ({
        session_id, cwd, agent_id, agent_type, tool_name, tool_use_id,
        notification_type, source, reason, transcript_path,
        message: (.message | if type == "string" then cut(200) else null end),
        label: ($in | if type == "object" then (.command // .description // .file_path // .pattern // .url // .skill // .prompt) else null end | if type == "string" then cut(120) else null end),
        subagent_type: ($in | if type == "object" then .subagent_type else null end),
        background: ($in | if type == "object" then .run_in_background else null end),
        response_agent_id: (.tool_response | if type == "object" then .agentId else null end)
      } | with_entries(select(.value != null)))
    }
  | "\(.payload.session_id // "")\t\(tojson)"
' 2>/dev/null | tr -d '\r')
sid=$(printf '%s' "${out%%$'\t'*}" | tr -cd 'a-zA-Z0-9-')
[ -n "$sid" ] || exit 0
mkdir -p "$dir" 2>/dev/null && printf '%s\n' "${out#*$'\t'}" >> "$dir/$sid.jsonl" 2>/dev/null
exit 0
