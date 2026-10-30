# Changelog

All notable changes to foreman-vision. The plugin has no version number, so entries are dated.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 2026-10-30

### Added

- **Side-by-side agent pop-up.** Click an agent: its details, a card for its last tool call (status, time, a one-line result, a link that shows the call in the terminal) and its last five calls with ✓/✗ and their time sit on the left; its live terminal sits on the right.
- **A terminal that reads like the CLI.** Each tool call is paired with its result, and long results collapse to their first lines with `… +N lines (open)`. Read, Edit, Write, Grep and Glob show a summary (`140 lines read`, `+2 −1`, `3 results`), and a click opens an Edit, MultiEdit or Write as a red/green diff.
- **Answer the main agent's question from its pop-up.** In a foreman session, when the main agent asks you something (AskUserQuestion), its pop-up lists the options, lets you pick one or several or type your own answer, and sends it. The terminal's own dialog stays open until one of them answers. The pop-up's terminal also lists any unanswered question with its options. Nothing else is ever sent to an agent.
- The new answer hook, `hook/fv-ask.sh`, runs on `PermissionRequest` for `AskUserQuestion`. It talks only to the local server on 127.0.0.1, needs `curl` in the hook's shell, and does nothing when the server is not running.
- `node src/cli.ts doctor` reports `curl` and whether the answer hook is installed or comes with the plugin.
- `node src/cli.ts simulate --scenario ask` plays a demo in which you can answer questions from the pop-up.
- Turkish UI strings for all of the above.

### Changed

- **Update steps.** Plugin: run `claude plugin update foreman-vision@foreman-vision`, then `/reload-plugins` or restart Claude Code. Clone: pull, then run `node src/cli.ts install` again to add the answer hook. Then restart every Claude Code session that was already running, because a running session does not pick up new hooks.
- `node src/cli.ts install` now writes two hooks and reminds you to restart open sessions. `uninstall` removes both.
- `node src/cli.ts serve` writes its port to `~/.claude/foreman-vision/port` for the answer hook and removes the file on exit.
- The terminal now gets up to 400 lines and 20,000 characters of a tool result (it was 15 lines and 4,000 characters), plus the last line of a result that was cut.
- Scrollbars are thin and follow the theme colors.
- The README images and GIFs show the current UI, including the side-by-side pop-up answering the main agent's question.

### Fixed

- The agent pop-up's top corners are round again. The header no longer paints over them.
- The answer form fits two questions with their descriptions without scrolling. The last Other box no longer sits half under Send.

## 2026-10-29

First public release: the live pixel-art office view of your Claude Code sessions, installed as a Claude Code plugin or from a repo clone.

### Fixed

- `fv-server.sh start` returns when its output is piped.
