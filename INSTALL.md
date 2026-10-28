# Installing foreman-vision

Steps for a coding agent (or a person) installing foreman-vision into Claude Code. Ask your agent: *"Install foreman-vision by following https://raw.githubusercontent.com/ilkemerol/foreman-vision-pub/main/INSTALL.md"*.

foreman-vision installs one of two ways:

- **Plugin (recommended)** - from this repo's own plugin marketplace. The hooks and the `/foreman-vision` command load with the plugin.
- **Repo clone** - `git clone` into a folder of your choice, then `node src/cli.ts install` merges the hook into `settings.json`.

Never both on one machine: both hooks run, and every event is spooled twice.

The browser UI is prebuilt in `web/dist`, so neither method needs `npm install`.

Paths below say `~/.claude`. When `CLAUDE_CONFIG_DIR` is set, Claude Code and foreman-vision use that folder instead, and so do the commands below (`c` in them).

## Rules for the agent

- Run the steps in order. Every step is safe to run again.
- On any error, stop and report it to the user with the command's output. Do not work around it.
- Change `settings.json` only through `node src/cli.ts install` and `node src/cli.ts uninstall`. They back it up first (`settings.json.fv-backup-<time>`), write nothing when it is not valid JSON, write it in place, and touch only foreman-vision's own hook entries.
- Ask the user before installing a plugin, before removing a foreman-vision install, before starting the server and before deleting any folder.
- Run every command in bash. On Windows that is Git Bash, the shell Claude Code runs hooks in.

## 1. Check the tools

```sh
for c in claude node bash jq curl; do command -v "$c" >/dev/null || echo "missing: $c"; done
node -e 'const [a, b] = process.versions.node.split(".").map(Number); if (a < 22 || (a === 22 && b < 18)) console.log("node " + process.versions.node + " is too old: needs 22.18 or newer")'
jq --version
```

The repo-clone method also needs `git`. Missing or old `node`: install the current LTS from [nodejs.org](https://nodejs.org/) (Windows: `winget install OpenJS.NodeJS.LTS`, macOS: `brew install node`). Missing `jq`: `winget install jqlang.jq` (Windows), `brew install jq` (macOS), `sudo apt-get install -y jq` (Debian/Ubuntu). Then open a new shell and check again. Missing `bash`, `curl` or `git` on Windows: install [Git for Windows](https://git-scm.com/download/win). Missing `claude`: install [Claude Code](https://docs.anthropic.com/en/docs/claude-code) first.

Without `jq` in the hook's shell, the hook writes nothing and foreman-vision shows no sessions.

## 2. Choose the method

Look for a foreman-vision that is already installed:

```sh
c="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"; s="$c/settings.json"
claude plugin list --json | jq -r '.[] | select(.id | startswith("foreman-vision@")) | "found: plugin \(.id)"'
[ -f "$s" ] && jq -r '.hooks // {} | [.. | .command? // empty | strings | select(test("^bash \"[^\"]*/fv-(spike-)?hook\\.sh\" \""))]
  | map(capture("^bash \"(?<p>[^\"]*)/hook/fv-hook\\.sh\"").p // "unknown folder") | unique[] | "found: repo clone hooks in settings.json, clone \(.)"' "$s"
[ -f "$c/foreman-vision/plugin-root" ] && echo "found: plugin marker $c/foreman-vision/plugin-root -> $(cat "$c/foreman-vision/plugin-root")"
```

- `found: plugin` - the plugin is installed.
- `found: repo clone hooks` - a clone was installed with `node src/cli.ts install`; the line names the clone folder.
- `found: plugin marker` alone, with no plugin line - a leftover of an earlier plugin install. Remove it with `rm -f "$c/foreman-vision/plugin-root"`.

Ask the user which method they want, plugin or repo clone; recommend the plugin. If foreman-vision is already installed one way, suggest keeping that way. Then run step 3 for the plugin or step 4 for the repo clone. If the other method was found, step 5 removes it, after the user agrees.

## 3. Plugin: add the marketplace and install

This repo is its own plugin marketplace, named `foreman-vision`, with one plugin, also named `foreman-vision`:

```sh
m=$(claude plugin marketplace list --json)
if printf '%s' "$m" | jq -e '.[] | select(.name == "foreman-vision" and .repo == "ilkemerol/foreman-vision-pub")' >/dev/null; then
  claude plugin marketplace update foreman-vision
elif printf '%s' "$m" | jq -e '.[] | select(.name == "foreman-vision")' >/dev/null; then
  echo "STOP: a marketplace named foreman-vision exists with another source"
else
  claude plugin marketplace add ilkemerol/foreman-vision-pub
fi
```

On `STOP`, show the user `claude plugin marketplace list --json` and ask what to do. Do not remove their marketplace, and do not go on. Otherwise install the plugin, or update it if it is already there:

```sh
if claude plugin list --json | jq -e '.[] | select(.id == "foreman-vision@foreman-vision")' >/dev/null; then
  claude plugin update foreman-vision@foreman-vision
else
  claude plugin install foreman-vision@foreman-vision
fi
```

The hooks come with the plugin and load with it. Nothing goes into `settings.json` for them. At every session start the plugin also writes its folder to `~/.claude/foreman-vision/plugin-root`, which is how foreman finds it. Go to step 5.

## 4. Repo clone: clone and install the hook

Ask the user where the clone should go; `~/foreman-vision-pub` is a good default. Never put it under `~/.claude/skills/`: Claude Code loads a folder there as a plugin too, and its hooks would run next to the ones `install` writes.

```sh
d="$HOME/foreman-vision-pub"   # the folder the user chose
case "$d" in "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/"*) echo "STOP: $d is under the skills folder" ;;
  *) if [ -d "$d/.git" ]; then git -C "$d" pull --ff-only
     elif [ -e "$d" ]; then echo "STOP: $d exists but is not a git clone"
     else git clone https://github.com/ilkemerol/foreman-vision-pub.git "$d"
     fi ;;
esac
```

On `STOP`, ask the user for another folder. Do not delete anything. Then merge the hook into `settings.json`:

```sh
d="$HOME/foreman-vision-pub"   # the same folder
node "$d/src/cli.ts" install
```

It prints `written, backup: <file>`, `written` (no `settings.json` existed) or `no change`. It registers `hook/fv-hook.sh` for eleven hook events with absolute paths, replacing entries that point at an older clone. If the folder moves later, or `spool-dir` changes, run it again.

## 5. Remove the other method (ask first)

Only when step 2 found the method the user did not choose. Tell the user what was found and ask before removing it.

**Chose the plugin, repo clone hooks were found.** On yes, remove the clone's hook entries with the plugin's own copy of the command. It takes a backup first and leaves every other hook:

```sh
p=$(claude plugin list --json | jq -r 'first(.[] | select(.id == "foreman-vision@foreman-vision") | .installPath)' | tr -d '\r')
node "$p/src/cli.ts" uninstall
```

The clone folder stays. It may hold the user's own changes; tell them where it is (step 2 named it) and that they can delete it once they have kept what they need.

**Chose the repo clone, the plugin was found.** On yes:

```sh
claude plugin uninstall foreman-vision@foreman-vision
rm -f "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/foreman-vision/plugin-root"
```

The user may also remove the marketplace with `claude plugin marketplace remove foreman-vision`; ask first.

The spool folder `~/.claude/foreman-vision/` and `~/.claude/foreman-vision.conf` are shared by both methods and stay.

## 6. Verify

The plugin must be in the plugin list and enabled; a repo clone must not be there:

```sh
claude plugin list --json | jq -r '.[] | select(.id | startswith("foreman-vision@")) | "\(.id) enabled=\(.enabled)"'
```

For the plugin, exactly one line must show: `foreman-vision@foreman-vision enabled=true`. Disabled: run `claude plugin enable foreman-vision@foreman-vision`. For a repo clone, no line must show; a line means both methods are installed, so go back to step 5.

Then run the doctor from the folder that was installed. Plugin:

```sh
p=$(claude plugin list --json | jq -r 'first(.[] | select(.id == "foreman-vision@foreman-vision") | .installPath)' | tr -d '\r')
node "$p/src/cli.ts" doctor
```

Repo clone:

```sh
d="$HOME/foreman-vision-pub"   # the clone folder from step 4
node "$d/src/cli.ts" doctor
```

- The `jq` line must show a version, not `MISSING`.
- Plugin: `plugin: foreman-vision@foreman-vision enabled, ...` and `hook entries: none in ...; the plugin brings its own`. Until the first new session starts, the plugin line says `folder not recorded yet`; that is fine.
- Repo clone: `plugin: not installed` and `hook entries: 11/11 events`.
- A `WARNING` line means both methods are active: go back to step 5.

Ask the user whether to start the view now. On yes, for the plugin:

```sh
p=$(claude plugin list --json | jq -r 'first(.[] | select(.id == "foreman-vision@foreman-vision") | .installPath)' | tr -d '\r')
bash "$p/bin/fv-server.sh" start
```

For a repo clone:

```sh
d="$HOME/foreman-vision-pub"   # the clone folder from step 4
bash "$d/bin/fv-server.sh" start
```

It prints the URL, by default `http://127.0.0.1:4780/`, and keeps running in the background. If it says it did not start, show the user the log lines it prints. A port taken by another program is changed with `port=<N>` in `~/.claude/foreman-vision.conf`.

## 7. foreman (optional)

foreman-vision works on its own: every Claude Code session shows up. [foreman](https://github.com/ilkemerol/foreman), the orchestrator skill, adds job names and stages to its floors, and `/foreman on` offers to start foreman-vision. foreman finds a repo clone through its hook entry in `settings.json`, and the plugin through `~/.claude/foreman-vision/plugin-root`. foreman versions that do not read `plugin-root` yet find only a repo clone; the plugin's `/foreman-vision start` works either way.

## 8. Hand over

Tell the user:

- Restart Claude Code. Sessions that were already running send no events until they restart. For the plugin, `/reload-plugins` also loads it in a running session.
- Plugin: `/foreman-vision start`, `stop`, `status` or `url` runs the server. If another skill named `foreman-vision` takes `/foreman-vision`, the plugin answers to `/foreman-vision:foreman-vision`. Repo clone: `bash bin/fv-server.sh start|stop|status|url` from the clone, or `node src/cli.ts serve` in a terminal.
- Open the URL and start (or restart) a Claude Code session; its floor appears with the first hook event.
- Update later. Plugin: `claude plugin update foreman-vision@foreman-vision`, then `/reload-plugins` or a restart. Third-party marketplaces do not update on their own by default; the user can turn that on under `/plugin` > Marketplaces. Repo clone: `git -C <clone> pull --ff-only`. A running server keeps the old code until it is stopped and started again.
- Server settings (port, spool folder, abandon time) go in `~/.claude/foreman-vision.conf`; the README lists them.

## Uninstall

Stop the server first, while its folder is still there.

Plugin:

```sh
p=$(claude plugin list --json | jq -r 'first(.[] | select(.id == "foreman-vision@foreman-vision") | .installPath)' | tr -d '\r')
bash "$p/bin/fv-server.sh" stop
claude plugin uninstall foreman-vision@foreman-vision
claude plugin marketplace remove foreman-vision
rm -f "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/foreman-vision/plugin-root"
```

Repo clone:

```sh
d="$HOME/foreman-vision-pub"   # the clone folder
bash "$d/bin/fv-server.sh" stop
node "$d/src/cli.ts" uninstall
```

The clone may hold the user's own changes; ask before deleting it.

Both methods leave the spool folder and the server log in `~/.claude/foreman-vision/`, `~/.claude/foreman-vision.conf` if the user created it, and the `settings.json.fv-backup-<time>` files. Ask the user before deleting them:

```sh
c="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
rm -rf "$c/foreman-vision"
rm -f "$c/foreman-vision.conf"
```

`~/.claude/foreman/` belongs to foreman; leave it.
