# Command Center

One local web page to see and run all your AI coding work: Freebuff, Codex, Cursor, OpenCode, and Claude through the relay.

## Install on a PC

1. Unzip the package (`CommandCenter-<date>.zip`) anywhere and double-click `Install.cmd`.
2. It checks Node.js (22.13 or newer) and git, and offers to install them with winget if they are missing. It asks where to install (default `%LOCALAPPDATA%\CommandCenter`), copies the program, installs the relay program, and makes Start-menu and desktop shortcuts called "Command Center". It can also start the panel when you sign in.
3. The panel opens at http://127.0.0.1:4021 on the Setup tab. It is one page: a card for each AI tool (switch, status, one button for the next step, links to the tool's site and docs), a Relay card (install, patches, register with Claude, the one-CLI hook), a Tools card, and Folders and limits (drop-downs and a Choose folder button). Everything saves when you change it.
4. Open the Debug tab. Every line should be green. Each red line says how to fix it.

Options for scripts: `install.ps1 -Target <folder> -Yes -NoShortcuts -NoRuntime -NoStart -StartAtLogin`. Installing over an existing install updates the program and keeps your settings.

The installer refuses drive roots, your home folder, Temp, Desktop, Documents and any folder that contains them. If the folder you pick already holds other files, it installs into a `CommandCenter` subfolder instead and never touches your files. It writes a `.cc-install` marker file in the install folder. Updating stops the old panel, replaces the program folders (`lib`, `viewer`, `hooks`, `relay`, `tools`, `usage`, `docs/ai-guide`, so files removed upstream disappear), keeps your settings and data, and starts the panel again unless `-NoStart` is given.

To remove it, run `uninstall.ps1` from the installed folder (`-Target <folder>` for another one; `-Yes` skips the question). It only works on a folder with the `.cc-install` marker, and it shows the file count and size first. It stops the panel, removes the hook in `~/.claude/settings.json` (backup in `~/.claude/backups`; if that fails, nothing is deleted), runs `tools/register.mjs <cli> --remove` for Claude, Codex, OpenCode and Cursor (failures are only warnings), removes the Command Center shortcuts, and deletes the folder with all its settings, tasks, logs and reports. It does not remove the relay (`agent-interop-runtime`); it prints `claude mcp remove agent-interop-runtime -s user` for that. It leaves the OpenCode server on 4096 running.

## Moving to a new PC

Do not copy this folder. It holds data that belongs to one PC. Build a package instead:

1. In this folder run `powershell -ExecutionPolicy Bypass -File pack.ps1`. It writes `CommandCenter-<date>.zip` and prints what it left out.
2. Copy the zip to the new PC, unzip it and run `Install.cmd`.
3. Log in to each tool again and pick your folders in Setup. Sign-ins and paths do not travel.

What `install.ps1` and `pack.ps1` leave out, because it is per PC and can hold secrets copied from your own config files: `config.json`, `tasks.json`, `tasks/`, `logs/`, `reports/`, `board.jsonl`, `runtime/`, `backups/`, `disabled-extensions.json`, `docs/AGENT-BRIEF-COMMON.md`, `docs/code-notes/` (developer notes), `.freebuff/`, `.git/` and earlier `CommandCenter-*.zip` files. `config.example.json` shows the settings with no personal data; Setup creates `config.json` itself.

## Running from a folder (no installer)

Run `powershell -ExecutionPolicy Bypass -File start.ps1` in the folder. It starts the panel on 4021 and, when OpenCode is on, the OpenCode server on 4096, then opens the page. `-NoOpen` skips the browser.

The Guide tab explains every part. Part 1 is for people. Part 2 is for AI agents and is also served as plain text at `http://127.0.0.1:4021/ai-guide`.

## Director (goals, machines, pull requests)

The Director tab turns a goal into work. You write what done looks like; the existing dispatcher picks an agent and runs it, and the goal is shown with its stage, assigned agents, limits, blockers and the evidence its tasks left behind (report file, exit code, worktree head). You can pause, resume, steer and stop a goal, and set how many tasks may run at once.

- A goal's waiting tasks are held by the dispatcher while the goal is paused or stopped, and by its own live-task and task-count limits.
- A task left `interrupted` by a restart waits for you: Freebuff tasks continue the same chat on their own, everything else needs a click. Nothing restarts silently.
- A task that runs in a git repository works in its own worktree under `<repo>/git/<task-id>` (turn `taskWorktrees` off in `config.json` to share the checkout). A folder this task did not create is never touched.
- Only one panel per folder dispatches tasks (`state/panel.lock`). A second panel shows the work and starts nothing.
- Machines: this PC reports what it really has. Another machine is shown online only after a signed `POST /machine/hello`; nothing is copied between machines. The panel still listens on 127.0.0.1 only.
- Pull requests come from `gh` (read-only). Your approval is recorded for one head commit; merging from the panel is off unless `mergeEnabled` is set, and even then it needs the number typed again and refuses a draft, a failing or running check, a changes-requested review, or an approval recorded for a different commit.
- `docs/director/FEATURE-PARITY.md` is the inventory (working, partial, missing, unverified) and `docs/director/STAGES.md` is the append-only stage log.

To check it, with no effect on your real install:

```
node tools/director-check.mjs
```

It parse-checks every module, copies the app to a temp folder, makes a scratch git repo and a fake `codex`, boots the panel there on 127.0.0.1, and proves the slice: routes, one goal assigned and finished, the worktree, the lease, the evidence, pause/stop/resume, the signed machine hello, the merge refusals, and recovery from a kill mid-task. It starts no real provider and changes nothing outside the temp folder. `--keep` leaves the folder and prints the panel log. The same command is what `.github/workflows/director-check.yml` runs.

## Files

| Path | What |
|---|---|
| `viewer/server.mjs` | The web panel and its API. |
| `viewer/public/` | The page: `app.*` (Freebuff and provider tabs), `orch.*` (Orchestrator: goal box, board, budget, settings), `tasks.*` (Home and the Orchestrator task tree), `sessions.*` (session viewer), `pages.*` (Guide, Debug, Setup), and one file pair per extra tab. |
| `lib/config.mjs` | Settings, saved in `config.json` by Setup. |
| `lib/tasks.mjs` | The task queue and dispatcher (`tasks.json`, `tasks/`, `logs/`). |
| `lib/sessions.mjs` | Reads Codex, OpenCode and Cursor session history for the session viewer. |
| `lib/setup.mjs` | Setup status, the one-CLI hook installer, and the Debug checks (also loads every `lib/checks/*.mjs`). `node lib/setup.mjs` has small commands for scripts. |
| `lib/routes/` | HTTP routes added to the panel, one file each. `setup.mjs` has the Setup routes and `/ai-guide`. |
| `lib/checks/` | Extra Debug checks, one file each. |
| `docs/ai-guide/` | Plain how-to files for AI agents, shown in the Guide tab and served at `/ai-guide`. |
| `usage/providers.mjs` | Usage readers per provider. |
| `route.mjs` | Which provider the next task goes to. `node route.mjs` prints it. |
| `lib/director.mjs` | Goals on top of the queue: priority, limits, pause/resume/stop/steer, "needs you", result evidence, merge approvals, and the single-writer stage log (`docs/director/STAGES.md`). |
| `lib/worktrees.mjs` | One worktree per task at `<repo>/git/<task-id>` on branch `cc/<task-id>`; never reuses a folder another owner created. |
| `lib/machines.mjs` | This machine's real capabilities, listed peers, and the HMAC-signed handshake. A peer is online only after a signed hello. Secrets live in `CC_PEER_<NAME>` environment variables, never in a file. |
| `lib/github.mjs` | Pull requests, heads, review decisions and public CI from the `gh` CLI, read-only. Merge guardrails live here too. |
| `lib/routes/director.mjs` | `/director`, goals, machines, GitHub, merge approval and the stage log. |
| `tools/director-check.mjs` | The one command that proves the director stage in a throwaway folder (see the Director section). |
| `.github/workflows/director-check.yml` | Runs that command on `windows-latest` once the project has a remote. |
| `hooks/freebuff-one-cli.mjs` | Claude Code hook: a new Freebuff CLI only when the panel allows it. |
| `relay/` | Patched agent-interop-runtime files. Setup has an Apply patches button; or run `node relay/reapply.mjs`, then restart the relay MCP server. |
| `start.ps1` | Starts the panel and `opencode serve` on 4096, skipping whichever already runs. |
| `Install.cmd`, `install.ps1`, `uninstall.ps1`, `pack.ps1`, `lib/copy-app.ps1` | Install, remove and package the Command Center. |
| `config.example.json` | The settings with their defaults and no personal data. |
