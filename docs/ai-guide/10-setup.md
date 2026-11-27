# Setup and install: what an agent needs to know

Setup is a human page (the Setup tab). You normally never change it. You may read it and you may help a person with the steps.

## Read the state

`curl.exe -s http://127.0.0.1:4021/setup` returns JSON:

- `config`: saved settings (`providers`, `projectDir`, `reportsDir`, `runtimeDir`, `maxClis`, `maxParallel`, `stuckAfterMin`, `models`).
- `providers.<tool>`: `{enabled, installed, signedIn, install, login, docs, site}`. `signedIn` can be `null` when it cannot be read.
- `prereqs`: Node (needs 22.13 or newer), git, Claude Code, and the relay (`runtime.ok`, `runtime.registered`).
- `hook`: `{installed, state}` for the one-CLI hook in the Claude settings file (`state` is `ok`, `other` or `none`).
- `tools.register`: whether `tools/register.mjs` exists.

`curl.exe -s http://127.0.0.1:4021/debug` runs every health check. Fix every red row; each row has a `fix` line.

## Change settings (only when your task says so)

`POST /setup` with a small JSON patch. Send only the keys you change. The panel checks every value and answers 400 with an `error` when one is wrong:

| Key | Allowed |
|---|---|
| `providers.<tool>` | `true` or `false` for freebuff, codex, cursor, opencode, claude |
| `projectDir`, `runtimeDir` | an existing folder, full path (`runtimeDir` may be empty for the default) |
| `reportsDir` | a full path; it is created when missing |
| `maxClis` | whole number 1 to 6 |
| `maxParallel.<tool>` | whole number 0 to 4 (codex, cursor, opencode, claude) |
| `stuckAfterMin` | whole number 1 to 1440 |
| `models.<key>` | text of 1 to 80 characters from `A-Z a-z 0-9 _ . : / @ -` (keys: codex, codexEffort, cursor, opencode, claude) |

Unknown keys are ignored. Never invent a billing or account setting; there is none.

## Other setup endpoints (people use these through buttons)

| Endpoint | What it does |
|---|---|
| `POST /setup/hook` | Adds the one-CLI hook to `~/.claude/settings.json`. Makes a backup in `<root>/backups` first, refuses when that file is not valid JSON, and does nothing when the hook is already there. |
| `POST /setup/pick-folder?what=project\|reports\|runtime` | Opens a folder window on the PC and returns `{path}` (`null` if cancelled). Do not call this: it needs a person. |
| `POST /setup/register?t=claude\|codex\|opencode\|cursor` | Opens a terminal that runs `tools/register.mjs <tool>`. Needs a person to follow it. |
| `POST /setup/patch` | Opens a terminal that reapplies the relay patches. |
| `POST /setup/run?p=<tool>&a=install\|login` and `p=runtime&a=install\|mcp` | Opens a terminal with that command. |
| `GET /setup/folders` | Git repos found near the project folder and in the user's Projects or source folders. |

Never call the terminal-opening endpoints from an agent: they open real windows on the person's screen.

## Install and move

- Install on a PC: unzip the package, double-click `Install.cmd` (it runs `install.ps1`). Options for scripts: `-Target <folder> -Yes -NoShortcuts -NoRuntime -NoStart -StartAtLogin`.
- Build a package: `pack.ps1` writes `CommandCenter-<date>.zip` and lists what it leaves out (settings, tasks, logs, reports, board, runtime, backups). Never copy the folder by hand; it carries per-PC data.
- Install refuses roots, the home folder, Temp, Desktop and Documents, and installs into a `CommandCenter` subfolder when the chosen folder already has other files. It writes `.cc-install` in the install folder. Updating stops that folder's panel, replaces the program folders (`lib`, `viewer`, `hooks`, `relay`, `tools`, `usage`, `docs/ai-guide`), keeps settings and data, and restarts the panel unless `-NoStart`.
- Remove: `uninstall.ps1` (people run it; it asks first). It needs the `.cc-install` marker, shows file count and size, stops the panel, removes the hook in `~/.claude/settings.json` (backup in `~/.claude/backups`; if that fails nothing is deleted), runs `tools/register.mjs <cli> --remove` for claude, codex, opencode and cursor (warnings only), removes the shortcuts and deletes the folder with all its data. It prints `claude mcp remove agent-interop-runtime -s user` for the relay and leaves the OpenCode server alone.
- Print a command the panel would run: `node "<root>/lib/setup.mjs" command <tool|runtime> <install|login|mcp|patch>`.
