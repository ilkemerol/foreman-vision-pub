#!/usr/bin/env bash
# Starts and stops the foreman-vision server of this folder (the plugin or a clone), without foreman.
# The plugin puts bin/ on the Bash tool's PATH; /foreman-vision runs this. The port comes from
# foreman-vision.conf (port=N), default 4780 - the same lookup the server does.
#
#   status   "stopped" (exit 1) | "running <url>" (exit 0)
#   url      print the URL; inside a Claude Code session it opens that session's floor
#   start    start `node src/cli.ts serve` detached unless running; print the URL
#   stop     end the process listening on the port (with its child processes)

root=$(cd "$(dirname "$0")/.." && pwd -P)
cfg="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
log="$cfg/foreman-vision/server.log"
port=$(sed -n 's/^[[:space:]]*port[[:space:]]*=[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$cfg/foreman-vision.conf" 2>/dev/null | tail -n1)
port=${port:-4780}
sid=$(printf '%s' "${CLAUDE_CODE_SESSION_ID:-}" | tr -cd 'a-zA-Z0-9-')
url="http://127.0.0.1:$port/${sid:+?session=$sid}"

up() { curl -s --max-time 1 "http://127.0.0.1:$port/" 2>/dev/null | grep -q 'foreman-vision'; }
listener() { # pid of the process listening on the port
  if command -v lsof >/dev/null; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -n1
  else # Windows netstat; the State column is localized, a 0.0.0.0:0 / [::]:0 peer means listening
    netstat -ano -p TCP 2>/dev/null | tr -d '\r' | awk -v p=":$port" \
      '$1 == "TCP" && substr($2, length($2) - length(p) + 1) == p && $3 ~ /:0$/ { print $5; exit }'
  fi
}

case "${1:-status}" in
  status) if up; then echo "running $url"; else echo stopped; exit 1; fi ;;
  url) echo "$url" ;;
  start)
    if up; then echo "$url"; exit 0; fi
    [ -f "$root/web/dist/index.html" ] || { echo "foreman-vision: UI not built - run npm run build in $root" >&2; exit 1; }
    mkdir -p "${log%/*}"
    (cd "$root" && node src/cli.ts serve --port "$port" </dev/null >"$log" 2>&1 &)
    for _ in $(seq 1 40); do up && { echo "$url"; exit 0; }; sleep 0.25; done
    echo "foreman-vision: did not start on port $port; log $log:" >&2; tail -n5 "$log" >&2; exit 1
    ;;
  stop)
    up || { echo "foreman-vision: not running"; exit 0; }
    pid=$(listener)
    [ -n "$pid" ] || { echo "foreman-vision: running but its process was not found - stop it by hand" >&2; exit 1; }
    if command -v taskkill >/dev/null; then taskkill //PID "$pid" //T //F >/dev/null
    else pkill -P "$pid" 2>/dev/null; kill "$pid"; fi
    for _ in $(seq 1 20); do up || { echo "foreman-vision: stopped"; exit 0; }; sleep 0.25; done
    echo "foreman-vision: pid $pid did not stop" >&2; exit 1
    ;;
  *) echo "usage: fv-server.sh status|url|start|stop" >&2; exit 2 ;;
esac
