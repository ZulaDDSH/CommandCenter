# Command Center code notes

## relay/reapply.mjs:main
Restores the local agent-interop-runtime patches after an `npm install` in the agent-interop folder undoes them. It only copies `pty.js.patched` over `dist/src/pty.js` when the installed file is the known 1.1.0 original (hash match), so a newer runtime is never overwritten blind; port the patch by hand then. Override the runtime path with `AGENT_INTEROP_RUNTIME`. Restart the relay MCP server afterwards.

## relay/pty.js.patched:CliPtyManager.start
One freebuff CLI at a time: `start` throws `FREEBUFF_ONE_CLI_AT_A_TIME` when a freebuff.exe already runs (Nomad, 2026-11-17). The PTY probe timeout is 10 s (`FREEBUFF_PTY_PROBE_TIMEOUT_MS`) because ConPTY spawn under load overran the stock 1.5 s.

## relay/pty.js.patched:CliPtyManager.writePrompt
A text starting with `/new` resets the conversation id. Before a follow-up on a reused CLI, if the newest chat's `run-state.json` `contextTokenCount` is over `FREEBUFF_COMPACT_AT` (default 150000 of a 400k window), it types `/compact` first. `contextTokens` reads the newest chat on disk, which is this CLI's chat only while one CLI runs.

## usage/freebuff-usage.ps1:HM
Real numbers from `GET https://www.codebuff.com/api/v1/freebuff/session`. The desktop "Daily hours" equals (daily remaining + unused part of each open hour) / 5 freebucks, shown h:mm. DeepSeek V4 Flash costs `prices['deepseek/deepseek-v4-flash']` (15) freebucks per hour.

## viewer/server.mjs:providerUsage
Usage per provider, all read from real sources, never estimated:
- Freebuff: `usage/freebuff-usage.ps1 -json` (open hours with minutes left per running hour).
- Codex: the newest `~/.codex/sessions/**/rollout-*.jsonl` line with `rate_limits` (used percent, window, `resets_at`, plan).
- OpenCode: `opencode stats --days N --models` (cost and tokens). OpenCode Go plan limits are not exposed locally, so none are shown.
- Cursor: `cursor-agent about` for sign-in state; no usage source while logged out.
Each source refreshes in the background and the page shows when it was read.

## viewer/server.mjs:loadSessions
A freebuff chat is named from the `fb-briefs/<slug>.md` path in its first user message. A chat whose report exists in `fb-reports/<slug>.md` is finished and goes to the Archive box.

## route.mjs:pick
Fallback order when freebuff runs out (Nomad, 2026-11-17): freebuff DeepSeek while at least one DeepSeek hour is left; then Codex `gpt-6.1-terra` (newest terra) effort high, or `gpt-6-luna` for small tasks, while the weekly limit is under 100%; then Cursor `composer-2.5` or `grok-4.7` once signed in (model ids UNVERIFIED until `cursor-agent models` lists them); then OpenCode `opencode-go/deepseek-v4.1-flash` ("DeepSeek V4.1 Flash 1017") at reasoning variant high. The relay's OpenCode provider needs `opencode serve` running.

## viewer/server.mjs:liveExpiry

A chat's CLI pid is the `pid` field on the first line of its `log.jsonl`. The CLI writes `~/.config/manicode/freebuff-live-<pid>.json` with `expiresAt`, which equals the `endsAt` of the open hour it holds (checked 2026-11-17: pid 22524 expiresAt 02:30:08Z = open hour end). The panel shows minutes left on a session only while that pid is alive; a finished CLI shows nothing rather than a guess.

## route.mjs:pick (usage errors)

A failed freebuff usage read keeps the task on freebuff: only a real read showing zero DeepSeek hours moves work to Codex. On 2026-11-17 the usage script crashed when no hour was open (`usage/freebuff-usage.ps1:openHours` was `@($null)`), and the router had wrongly moved work to Codex.

## relay/adapters.js.patched:JsonRpcProcess.request

The 1.1.0 runtime gave every JSON-RPC call 2.5 s. A cold `cursor-agent acp` takes about 1.4 s to answer `initialize` and 4.5 s to reach `session/new` (measured 2026-11-17), and Codex `thread/list` also timed out, so both showed as unavailable in `list_providers`. The patch raises the default to 30 s, overridable with `AGENT_INTEROP_RPC_TIMEOUT_MS`. `relay/reapply.mjs:main` now reapplies both `pty.js` and `adapters.js`.

## viewer/server.mjs:REFRESH

Usage reads are cached per provider (Nomad, 2026-11-17: no polling every minute). Freebuff 5 min, Codex 60 s (a local file read, no API call), OpenCode 10 min, Cursor 30 min, route 5 min. `/usage?p=X&fresh=1` and the "Refresh usage" button force one read. The old "loading" cards came from every page load and every server restart starting a fresh read; the cache now serves the last value.

## viewer/server.mjs:splitChat

One freebuff CLI runs several queued tasks in one chat. A segment starts at each user message naming `fb-briefs/<slug>.md`; user messages in a row are queued tasks. An AI message moves to a later segment when its JSON names that segment's brief. Before this, queued tasks were folded into the chat's first task, so a finished task (lod-host-tidy) looked unused while the next one (lod-determinism-test) showed as opened.

## viewer/server.mjs:tokenRate

Freebuff chat files have no per-step token counts (only `output_tokens` on summaries in `log.jsonl`). TPS is an estimate: output characters (text blocks plus tool input JSON) / 4, rate over a 2-minute window. The panel labels it with "~".

## viewer/server.mjs:LOGOUT

Login commands come from `lib/setup.mjs:PROVIDERS` (`setup.command(p,'login')`); logout commands are the fixed `LOGOUT` map. Both run in a new console via `cmd /c start ... cmd /k`; the query only picks a key, never the command text. Freebuff has no logout command; `/logout` inside freebuff does it.

## usage/freebuff-usage.ps1:flashHours

Hours of plain DeepSeek V4.1 Flash left = (daily remaining + unused part of open hours) / price of `fbc/deepseek-flash`. Picker "hrs" = price / 5. Mapping by matching the picker (Nomad's screenshot 2026-11-17): `fbc/deepseek-flash` 10 = Flash 2 hrs, `deepseek/deepseek-v4-flash` 15 = Flash Fast 3 hrs. UNVERIFIED beyond that price match. Nomad: use plain Flash, not Fast.

## usage/providers.mjs:codex

Codex session titles: `~/.codex/session_index.jsonl` `thread_name` by id; for subagent rollouts (no index entry) `agent_nickname: last part of agent_path` plus the parent thread's name from `source.subagent.thread_spawn.parent_thread_id`; else the first user message.

## viewer/public/app.js:GROK

The Cursor CLI reports no usage. The Cursor tab links to a billing page from `config.billingUrl.cursor` (set in Setup; Nomad's account bills through Grok). Empty means no button.

## viewer/server.mjs:fbModels

Freebuff model picker (Nomad, 2026-11-17: expose every freebuff model, DeepSeek mostly). The list comes from `GET /api/v1/freebuff/models` (`usage/freebuff-usage.ps1 -models`, cached 30 min): `rows[].key` (e.g. `m-8db1ccbba6` = DeepSeek V4.1 Flash, `m-096e75164d` = Flash Fast), `displayName`, `tagline`, `taglineTooltip`, plus `recommendedKey`. `POST /fb-model?key=` only accepts a key in that list and merges `freebuffModelKey` into `~/.config/manicode/settings.json`, the same key the CLI's `/model` writes. The CLI reads that file fresh on every access, so the write is safe while a CLI runs; a running CLI keeps the model it started with. With no key saved the CLI used `recommendedKey`, which was Flash Fast; that is why CLIs ran Fast. The models API tooltip confirms plain Flash costs two hours per session. The picker is one themed native `<select>` (DeepSeek and Other models groups, each option with its hour cost); Nomad rejected the expanded row list on 2026-11-17.

## usage/freebuff-usage.ps1:endpoint

Responses are decoded as UTF-8 from the raw stream. `Invoke-RestMethod` read them as Latin-1 and turned "·" into "Â·".

## usage/providers.mjs:modelDigest

The models API rows carry no model id or price. Each row's `legacyDigests` holds the CLI's digest of the model id (two 32-bit FNV-style hashes of `freebuff-legacy-model:<id>`, read from the freebuff 0.2.36 CLI). `fbmodels` hashes every id in the session API's `freebucks.prices` and matches it to a row, so each row gets `modelId` and `hours` = price / 5. Checked 2026-11-17: all 13 rows matched, and the costs equal the CLI picker (Flash Fast 3, Flash 2, Flash Slow 1, GPT-6 Luna 4, Muse Spark 3, Muse Ember 6, Beam free). This replaces the earlier price-match guess in `usage/freebuff-usage.ps1:flashHours`, which it confirms.

## viewer/server.mjs:spawnDecision

Decides whether the next freebuff task gets a new CLI (Nomad, 2026-11-17: spawn smartly instead of one CLI only). Live CLIs are the `~/.config/manicode/freebuff-live-<pid>.json` files whose pid is alive; each chat belongs to the CLI whose pid is on line 1 of its `log.jsonl`. Rules in order: no CLI → spawn; an idle CLI → send there; `FREEBUFF_MAX_CLIS` (default 3) reached → queue on the CLI with fewest queued; hours unknown → queue; fewer than 2 hours of use of the selected model left after the running CLIs' remaining minutes → queue; otherwise spawn. Known limits: committed time uses the selected model's cost, not each CLI's own; queued tasks are not moved to a new CLI; two spawns at the same moment can both pass, the cap bounds it. `GET /spawn-check` returns the decision; the panel's "Next freebuff task" card (`spawnInfo`) shows it every 15 s.

## hooks/freebuff-one-cli.mjs:check

The PreToolUse hook allows a new freebuff CLI when `/spawn-check` says `spawn`, and otherwise blocks with its `why` and the running CLIs. If the panel on 4021 does not answer within 8 s the hook falls back to one CLI.

## relay/pty.js.patched:start

The relay's own gate asks `/spawn-check` the same way before spawning a second CLI and throws `FREEBUFF_SPAWN_BLOCKED` when told no. `contextTokens(pid)` now counts only chats whose `log.jsonl` line-1 pid is this CLI's pid, so two CLIs do not add each other's context. `relay/reapply.mjs` accepts an older patched pty.js when its `.orig` backup matches the known original; the runtime loads the change on its next MCP restart.

## viewer/server.mjs:shown

Archived chats have their own Archive tab (Nomad, 2026-11-17: archive is not part of the Freebuff list). `shown()` filters `data` by tab: the Freebuff tab lists live chats, the Archive tab lists chats with a report. The Archive tab reuses the session list and feed but hides the hours, model and spawn cards. When the selected chat is not in the current tab, the first one in that tab is selected. The old fold under the Freebuff list and its `archOpen` state are gone.

## viewer/server.mjs:ROLES

Model roles (Nomad, 2026-11-17): DeepSeek is the main coder while hours last; Beam 1.0 (free) takes smaller, well-scoped coding DeepSeek should not spend hours on, and all coding once DeepSeek has under 2 hours of use left; Solar Pro 4 (free) does read-only work (exploring a repo, summaries, reviews). A task picks its role with a leading `[code]`, `[light]` or `[read]` tag in the message text; no tag means `[code]`. The `code` model is the panel's dropdown pick; Beam and Solar are found by name in the models list, so a key change upstream does not break them. `spawnDecision(kind)` only reuses or queues on CLIs already running the role's model (the model is read from each CLI's `freebuff-live-<pid>.json`); committed hours now use each CLI's own model cost. Free models skip the hours rule. At the CLI cap with no CLI on that model, the task queues on the least-busy CLI of any model. `/spawn-check?kind=` returns `modelKey` for the relay. Hours: the card's big number is freebuff hours left (e.g. 43); DeepSeek V4.1 Flash costs 2 of them per hour of work, so the "h of DeepSeek work" figure is about half.

## viewer/server.mjs:board

Team board so the agents can talk to each other (Nomad, 2026-11-17: all models work together and talk to each other). `GET /board` returns the last 100 notes as plain text for agents (`curl.exe -s http://127.0.0.1:4021/board`), `?json=1` returns them for the panel's Board tab, `POST /board?from=<name>` appends the request body (max 8000 chars) to `board.jsonl` in the Command Center root. The relay adds the board instructions to every freebuff task, so DeepSeek, Beam and Solar CLIs read each other's notes and post findings; Claude sessions and other providers can use the same two calls. The panel shows the board read-only on the Orchestrator tab; only agents post.

## relay/pty.js.patched:roleModel

`writePrompt` strips the `[code]`/`[light]`/`[read]` tag, adds the board footer (plus a read-only rule for `[read]`) to non-slash messages, and passes the role to `start`. `start` always asks `/spawn-check?kind=`; when it spawns and the answer has a `modelKey`, it writes that key to `~/.config/manicode/settings.json` before spawning and restores the previous key once the CLI is ready. This works because the CLI reads `freebuffModelKey` only at startup into its model store (freebuff 0.2.36 binary: `CM=wE(...selectedModel:rt(wxA...))` with `wxA=iLH()` at module init); a running CLI keeps its model, and the CLI has no `--model` flag. A CLI that resumes an hour a crashed CLI left open uses that hour's model instead. A fresh CLI shows its input before it accepts Enter, so the first prompt waits 2.5 s after startup; on 2026-11-17 the first paste sat unsent in the box without it.

## relay/pty.js.patched:lockStart

`lockStart()` chains freebuff starts so only one runs the window from `/spawn-check` through the settings write, spawn, readiness wait and `restoreSettings()` (in a `finally`). Without it two starts could each save the other's model key as the "original" and leave settings.json on the wrong model, and two checks could both get `spawn: true` for the last slot (Sonnet review 2026-11-17).

## viewer/server.mjs:boardPost

`POST /board` refuses any request whose `Origin` is not the panel itself (curl sends none, the panel form sends `http://localhost:4021`), so a web page in the user's browser cannot plant notes that agents read first. Bodies are read as UTF-8; over 8000 chars is 413. Unknown CLI models count at the code model's hour cost; when no CLI runs the asked model, a queued task runs on the target CLI's own model and `why` says so.

## lib/config.mjs:config

All per-PC paths and limits live in `config.json` next to the code (made by the Setup tab). Defaults keep the panel usable before setup; `setupDone:false` makes the page open on Setup. Nested objects merge key by key so an old config gains new keys.

## lib/tasks.mjs:tick

The dispatcher runs every 5 s. For each waiting task, in creation order, it tries providers in order: an explicit provider, else for `code` the `route.mjs:pick` ranked list plus Freebuff last, else (light/read) Freebuff first then the rest. Freebuff: reuse a panel-owned idle CLI on the same model (`/new` then the prompt), else start one only if no other start is in flight, under `maxClis`, and 2+ hours of that model are left (or it is free). Others: at most `maxParallel[p]` running. A task that cannot start keeps a plain `reason`. Done = report file newer than the start (Freebuff) or exit code 0 (headless CLIs; the log tail becomes the report if none was written). A panel restart marks running tasks failed, since child processes and PTYs die with it.

## lib/tasks.mjs:spawnApproval

The patched relay `pty.js` start asks `/spawn-check` before any new Freebuff CLI. When the panel itself starts one, it sets a 60 s approval for that kind so `/spawn-check` returns `spawn:true` for its own start; `server.mjs` returns `tasks.spawnApproval(kind) ?? spawnDecision(kind)`.

## lib/tasks.mjs:startChild

Headless runs: `codex exec --cd -m -c model_reasoning_effort= -s read-only|workspace-write --skip-git-repo-check -` (prompt on stdin), `opencode run --dir -m --variant high --title`, Cursor via its .ps1 with `-p --trust --workspace [--force] --model --output-format text`. `cursor-agent.cmd` mangles quoted args, so the .ps1 is called directly (`lib/cli.mjs:cursorCmd`). Read tasks drop `--force` and use Codex read-only sandbox.

## lib/sessions.mjs:codexParse

Codex: rollout jsonl under `~/.codex/sessions`; steps from `response_item` (message, agent_message for subagent traffic, function_call/custom_tool_call with outputs by call_id). State: done after `task_complete`, working if written in the last 2 min. OpenCode: `opencode.db` opened read-only with `node:sqlite`. Cursor: `~/.cursor/chats/*/*/store.db` blobs plus hex meta.

## lib/setup.mjs:debug

Each check returns ok true/false/null (null = turned off or still loading) with a one-line fix. Patch checks compare sha256 of the runtime's `dist/src/{pty,adapters}.js` with `relay/*.patched`.

## relay/adapters.js.patched:withBoard

Adds the team board lines to every prompt sent to OpenCode and native-protocol agents (Codex, Claude, Cursor), so all providers share notes. Skipped for slash commands and prompts that already mention `127.0.0.1:4021/board` (panel task files already carry it).

## route.mjs:pick

Returns the first usable provider plus `ranked`, the whole usable order, so the task queue can spill to the next provider when the first is at its limit. Turned-off providers are skipped with a reason.

## viewer/server.mjs:allSessions

`/sessions` merges Freebuff segments with the Codex, OpenCode and Cursor lists, cached 15 s because the Cursor and OpenCode readers open databases. `/session?p=&id=` returns one session's steps for the viewer.

## viewer/server.mjs:sameOrigin

Every POST must come from the panel's own origin (or have no Origin, like curl), so another web page cannot add tasks, change settings or open terminals.

## lib/tasks.mjs:startFreebuff

Claims the CLI slot (the `clis` entry, task status, `fbStarting`, the spawn approval) before its first `await`. The dispatcher tick and a POST can both call `tick()`; if the claim came after an await, two calls could each see a free slot and start two CLIs.

## lib/extensions.mjs:listAll
Reads every hook, MCP server and plugin switch that exists on this PC: Claude settings (`~/.claude/settings*.json` and the project's `.claude/settings*.json`), Claude MCP (`~/.claude.json` top level and `projects[path]`, project `.mcp.json`), Codex `[mcp_servers.*]` in `config.toml`, OpenCode `mcp.<name>.enabled`, Cursor `mcp.json`, `enabledPlugins`. Plugin hooks and plugin MCP servers come only from `installed_plugins.json` `installPath` (the cache also holds old versions) and are read-only. Secrets are never put in a row: `lib/extensions.mjs:safe` shows only the program's file name plus the script file name (no args, no `KEY=value`), `lib/extensions.mjs:safeUrl` shows only scheme and host. Redacting by pattern leaked (`Bearer x`, `TOKEN=x cmd`, url paths), so it shows less instead. Odd entries (`null` hook, non-array `hooks`) are skipped, never a 500. `CC_EXT_HOME` moves the home dir, the stash, the backups and the project dir into a scratch folder for tests.

## lib/extensions.mjs:toggle
Every row carries `rev`, the sha1 of its source file when the page read it. A toggle is refused when the file's hash differs (a running CLI rewrites `~/.claude.json` often). Hooks and Claude/Cursor MCP servers have no off flag, so the entry moves to `<root>/disabled-extensions.json` with its position (event, group, index) and goes back at the same place; this makes off then on byte-identical. Codex and OpenCode use their own `enabled` flag; when the key did not exist we insert it and the stash records that, so turning on removes it again. JSON files are written with the detected indent and line ending; if re-serialising the untouched file would not give the same bytes (hand-formatted arrays) the toggle needs `reformat: true`. Codex TOML is edited as text, only the `enabled` line directly in the `[mcp_servers.NAME]` table. Order: stash first then file when turning off, file first then stash when turning on; backup, temp file, rename, re-read and parse, restore the backup if the parse fails. Backups are `<root>/backups/<dir>-<file>-<6 hex of sha1(full path)>.<iso time>`, newest 10 per source file; the hash keeps the user and project `.claude/settings.json` apart. Turning a Codex server on removes an `enabled` line only when the stash says we added it and the line is still exactly `enabled = false` (a hand-edited line with a comment is set to `true` instead).

## lib/routes/ext.mjs:default
`GET /ext/list` returns rows and file health; `POST /ext/toggle` takes `{id, on, rev, reformat}` only and finds the row server-side, never a path from the client. A body that is not a JSON object is a 400.

## lib/sessions.mjs:claudeSession
Claude Code sessions are `~/.claude/projects/<folder>/<id>.jsonl`, up to 650 MB, so reads are bounded: the first 1 MB gives title, folder and start; detail reads the last 16 MB (whole file when smaller) and says so when it cut. Listing never recurses (`subagents/` and `tool-results/` are skipped). Subagent transcripts are `<id>/subagents/agent-*.jsonl`; `*.meta.json` `toolUseId` joins each to its Agent tool step, shown inside that collapsed step (the 200 helpers with the newest file times). `lib/sessions.mjs:claudeHead` results are cached by path+mtime+size, cleared above 1000 entries so the archive worker's 500-row list stays cached. State is by age: working under 2 minutes, waiting for you under 6 hours, finished after (Claude logs no finish marker). Title is the first real user message (not system reminders, command echo or meta lines).

## lib/routes/claude.mjs:default
`GET /claude/state`: whether `claude` is installed, signed in (credentials file exists; contents and email are never sent), plan tier, and the newest sessions. `/sessions` skips Claude while `providers.claude` is false, so the Claude tab uses this route; viewing history is harmless.

## lib/checks/ext.mjs:default
Debug rows: each settings file parses, stash parses, counts of hooks, MCP servers and plugins, Claude sessions folder readable.

## lib/routes/setup.mjs:validate

`POST /setup` builds a clean patch from known keys only (`lib/config.mjs:DEFAULTS` keys), so a stray key such as the old `billingUrl` can never reach `config.json` through the Setup page (other routes, such as the orchestrator one, call `saveConfig` with their own validated keys, so `saveConfig` itself accepts any key and only drops `billingUrl`). Only keys present are checked, so the Setup page can auto-save one field at a time and a saved value outside a dropdown range (older config) is never re-posted and rejected. Ranges: maxClis 1-6, maxParallel 0-4, stuckAfterMin 1-1440. Paths must exist; `reportsDir` is created when missing. Model ids must match `^[\w.:/@-]{1,80}$`; the model dropdowns come from `GET /models` but the server does not require membership, because that list can change faster than a saved choice.

## lib/routes/setup.mjs:pickFolder

The folder picker runs a PowerShell `FolderBrowserDialog` in a child process started with `-STA` (WinForms needs it). It is async on purpose: a blocking call would freeze the whole panel, dispatcher included, while the dialog is open. The start path and prompt pass through environment variables, never through the script text. A cancel returns `{ path: null }`. The child is killed after 5 minutes.

## lib/routes/setup.mjs:installHook

The one-CLI hook is merged into `~/.claude/settings.json` by `lib/setup.mjs:installHook`: refuse when the file does not parse, do nothing when exactly one `freebuff-one-cli.mjs` entry is there with the right command and matcher, read a file with a BOM or an empty file as `{}`, back up to `<root>/backups/settings.json.<timestamp>`, write to a temp file, rename over, re-read and parse. `removeHook` is the reverse and is what `uninstall.ps1` calls (backup goes to `~/.claude/backups` there, since the app folder is about to be deleted).

## lib/setup.mjs:command

`setup.command(p, a)` is reached from query strings, so it checks `Object.hasOwn(PROVIDERS, p)` (a key like `constructor` must not resolve) and allows only `install` and `login` for providers. The Node floor is 22.13 because `node:sqlite` (used by session readers) needs it.

## lib/setup.mjs:debug

Debug also imports every `lib/checks/*.mjs` (default export `async ctx => rows`). A module that throws, hangs past 15 s or returns a non-array becomes one red row; it never breaks the page. Modules are imported once per process, so a changed check needs a panel restart.

## lib/copy-app.ps1:Copy-App

One exclusion list for `install.ps1` and `pack.ps1`, anchored at the app root (a nested `tasks` or `config.json` in a subfolder is kept). It leaves out per-PC data (config, tasks, logs, reports, board, runtime, backups, disabled-extensions), `docs/AGENT-BRIEF-COMMON.md`, `.freebuff/` (a project id), `.git` and earlier `CommandCenter-*.zip` files. Installing over an existing install never deletes those per-PC files, so it doubles as an update.

## uninstall.ps1:main

Stops only the node process whose command line names `<folder>\viewer\server.mjs`, never "whatever listens on 4021". It leaves the OpenCode server alone (it may serve other work). It removes the hook from `~/.claude/settings.json` so Claude Code is not left pointing at a deleted file. It moves out of the folder before deleting it.

## viewer/public/pages.js:mdToHtml

The Guide renders `GET /ai-guide` with a small renderer: every line is escaped first, links only if `http(s)://`, attributes are double-quoted (`esc` does not escape `'`), and inline code spans are cut out before links and bold run so nothing inside them is interpreted.

## viewer/public/pages.js:PAGES.setup

Auto-save sends only the changed field. Each card is painted through `put()` which skips identical HTML, so the 60-second repaint never closes an open dropdown. A select always lists the saved value, even if it is outside the usual choices, so a repaint can never silently change a setting.

## tools/run-script.mjs:runScript

Scripts run in a worker thread and are stopped with `terminate()` on timeout. `terminate()` cannot interrupt a worker blocked inside `spawnSync`, so the `run` and `git` helpers clamp their own timeouts to the script timeout. Any timeout that is not a finite number above 0 falls back to the default (NaN would make `setTimeout` fire at once). Values above 2^31-1 ms are not clamped and overflow the same way; nobody passes them.

## tools/cc.mjs:parseFlags

`run` only knows `--timeout`, `--cwd` and `--dry-run`, found anywhere on the line; every other word after the script goes to the script's args as is. A trailing `--dry-run` must never be passed through as an arg, because the script would then run live. So a script cannot receive those three words as args. `task add` sends `cwd` (made absolute) only when `--cwd` is given.

## tools/cc-lib.mjs:shimArgs

Windows `.cmd` shims go through `cmd.exe /d /s /c`. Arguments are quoted for that, and any argument with `"`, `%` or a newline is refused because cmd cannot pass them safely. A quoted argument ending in `\` is refused too: the backslash would escape the closing quote. `tools/cc-lib.mjs:resolveWin` lookups are cached and run with `cwd` set to the temp folder, so a `git.cmd` planted in the working folder cannot win. `tools/cc-lib.mjs:grep` rebuilds a given RegExp without `g`/`y`, whose `lastIndex` would skip matches. `tools/cc-lib.mjs:edit` writes CRLF when the file uses CRLF.

## tools/cc-lib.mjs:createApi

Every POST sends `Origin: http://127.0.0.1:4021`, because the panel's same-origin check only accepts that origin (even on a test port). `fetchJson` only allows plain `http://127.0.0.1:<panel port>` URLs.

## tools/worker.mjs

`console` inside a script (log, info, debug, trace, warn, error) is captured into the result instead of printed, so the MCP server's stdout carries only JSON-RPC. An Error prints its stack. In `tools/mcp.mjs` a line that is valid JSON but not an object (`null`, `[]`, `5`) gets JSON-RPC -32600.

## tools/register.mjs:register

Claude and Codex are registered with their own `mcp add/remove`. OpenCode (`~/.config/opencode/opencode.json`) and Cursor (`~/.cursor/mcp.json`) are edited directly: backup to `<root>/backups`, atomic write, re-read. A file that is not plain JSON (has comments) is refused, not rewritten. `tools/register.mjs:register` makes a backup only when something will change (a remove of nothing and a dry run write no backup; an add always rewrites and backs up), and `tools/register.mjs:editJson` removes its temp file in a `finally`.

## viewer/server.mjs:ROUTES

Every `lib/routes/*.mjs` is imported at start in name order; each default export gets `ctx` and returns true when it handled the request. They run after the Host and Origin checks and before the built-in routes.

## viewer/server.mjs:staticFile

Any `/<name>.js|css` that exists in `viewer/public` is served, so new pages need no server edit. The name pattern allows only word characters and `-`, so no path escapes `public`.

## viewer/server.mjs:Host check

Requests whose Host is not `127.0.0.1:<port>` or `localhost:<port>` get 421. This blocks DNS-rebinding pages from reading the panel.

## usage/exec.mjs:binCall

Windows npm installs give `codex.cmd`, `opencode.cmd` and so on, which `spawn('codex')` cannot start. `findBin` runs `where.exe` and keeps only hits that end in .exe/.cmd/.bat/.com, because `where freebuff` lists the extensionless sh shim first and that cannot run on Windows. A .cmd or .bat is started as `cmd.exe /d /s /c "<quoted line>"` with `windowsVerbatimArguments`. Inside double quotes cmd only reads `"`, `%` and line breaks, and the shim's own argument parser treats a trailing backslash before a quote as an escape, so an argument with any of those is refused with a plain error instead of being passed on. Prompt text never goes on the command line: Codex and Claude read it from stdin, and the other CLIs get a one-line pointer to the task file.

## lib/models.mjs:listModels

Model discovery, checked against the installed CLIs on 2026-11-17. Codex: `~/.codex/models_cache.json` (the CLI's own catalog, only `visibility: list` rows), else `codex debug models`. Cursor: `cursor-agent --list-models` (lines `id - Name`). OpenCode: `opencode models` (lines `provider/model`). Claude: the quoted aliases in the `--model` paragraph of `claude --help`, plus haiku; the CLI has no model list command and accepts any full id. Freebuff: the `fbModels` rows the server already reads. A source that cannot be read returns the configured model with `note: 'not read live'`. Results are cached 10 minutes. A model that is not in the list (for example a Codex catalog that was cached before an upgrade) is never refused, only shown without a note.

## lib/orchestrator.mjs:buildPrompt

Orchestrated mode (Nomad, 2026-11-17: pick the orchestrator from any provider's models). A new user task becomes the orchestrator task itself: same row, `role: 'orchestrator'`, run on `config.orchestrator.provider/model`. Its task file is built here: goal, the live budget table (`budget()` from the usage readers, the models list and the running counts), the worker rules, and the task API with `tools/cc.mjs` equivalents. Children it creates carry `parent`. Workers that add children of their own are held for approval (`hold` = the orchestrator task id) and the orchestrator approves or edits them with `POST /tasks/<id>/approve`. Orchestrator tasks do not count against `maxParallel` (they mostly wait; otherwise a provider limited to 1 task would block its own workers) but at most 2 run at once.

## lib/tasks.mjs:add

Guards for sub-tasks: the parent must exist and still be live, depth at most 3, at most 8 live children per parent, at most 60 live tasks in total. `model` is a per-task choice; its characters are checked (it ends up on a command line) but it is not checked against the live list. An explicit provider wins over orchestration, so a task with a provider chosen in the form or API goes straight to that provider.

## lib/tasks.mjs:requeueResume

A Freebuff hour ends (the CLI deletes `freebuff-live-<pid>.json` the moment its session is no longer active, and writes it again on rejoin; checked in the freebuff 0.2.36 binary: function `y(c)` calls `PCA` when the status is active, else `BDH`). A task whose CLI had an hour and has been without one for 60 s, or whose CLI exited, with no report, goes back to `waiting` with `resume` {cliId, conversationId, modelKey}. It restarts when the same model has hours again (else the usual order, so the next best model or provider). A CLI that is still alive gets a "continue" message on the same chat; a dead one is started with `--continue <conversation id>`. The CLI holds queued messages until it rejoins and may carry on by itself, so the task is also finished if its report appears while it waits, and the continue message says to do nothing when the report already exists. At most 5 resumes per task.

## viewer/server.mjs:chatPid

Why time left vanished after a resume (lod-capi-features, 2026-11-17): the panel took the CLI pid from the first line of the chat's `log.jsonl`, but the live file is named by the pid of the CLI that holds the hour now. A later CLI (pid 30080) appended to the same log, and the chat's first-line pid (38316) pointed at a stale owner. A new CLI also writes two start-up lines (`Removed stale renderer library copies`, `Enhanced CLI fingerprint`) into the newest chat's log before it makes its own, so the newest pid is not always the owner. The owner is now the pid of the newest work line (`Start agent`, `End agent`, `[send-message]`, `[message-queue]`, `Main prompt finished`) in the last 128 KB, else the first-line pid. A chat whose CLI is alive but has no live file is shown as "between hours".

## viewer/server.mjs:spawnDecision

Counts panel CLIs started in the last 90 s that have no live file yet (`tasks.pendingClis`) as running CLIs and as committed hours (one hour of their model), so a start in flight cannot let a second one pass the cap. They are never offered as idle or as a queue target. `loadSessions` is cached 4 s for this path, so a tick does one read, not one per waiting task. The `FREEBUFF_MAX_CLIS` environment override is gone; the cap is `config.maxClis`. `spawnDecision(kind, modelKey)` uses the asked model when it is in the models list.

## lib/tasks.mjs:spawnApproval

The approval is scoped to the CLI id being started: `/spawn-check?cli=<id>` only matches that CLI. A relay that does not send `cli` (the installed 1.1.0 patch) still matches by kind, as before. The panel never types a model tag into the CLI; the explicit model rides in the approval's `modelKey`, which the installed `pty.js` already writes to settings before the spawn. The patched `pty.js` also reads `[model:<key>]` for callers that go through the MCP tools.

## route.mjs:pick (codex)

Codex limit data comes from the newest session log. A window whose `resetsAt` has passed is stale (the percent used no longer applies), and no data at all means Codex was never used here. Both count as usable with a note, because treating them as full meant Codex was never picked automatically. Providers that are not installed are skipped with a reason.

## relay/pty.js.patched:boardFooter

`writePrompt` reads an optional `[model:<key>]` tag after the kind tag and `start(id, cwd, continueId, kind, modelKey)` asks `/spawn-check?kind=&model=&cli=`. Kind tags stay as aliases for the role models. The footer now names the explicit model.

## viewer/server.mjs:baseOf

The diff base fell back to `origin/nomad/dev`, a branch of one repo. It now uses the worktree's upstream, then `origin/HEAD`, then `origin/main` or `origin/master`.

## lib/routes/archive.mjs:archived

`GET /archive/sessions` builds the whole archive server side (up to 500 per provider) because `/sessions` only carries the 15 newest per provider and `/api` sends every Freebuff step. Freebuff rows keep only the report and a tool-call count and are rebuilt per request. Other providers are read in `lib/archive-worker.mjs` on a worker thread, because the session readers use sync fs/sqlite and a cold build with Claude takes ~7 s; the main thread stays free (measured `/tasks` 4 ms during a build). Results are kept 10 min; a stale cache is served while one refresh runs (`running` guard); a failed build is retried after 1 min. Claude is always read here, even when it is off as a task provider, because this is history, not dispatch.

## viewer/public/archive.js:PAGES.archive

The 60-second tab refresh is skipped while the search box has focus, and the list is redrawn only when the archive's count or newest time changed, so typing and open rows are not disturbed. Chart days are bucketed by local calendar date, so DST days do not shift bars.

## viewer/public/app.js:hours

The Freebuff sidebar shows only the headline per card (hours left, DeepSeek hours and reset; model cost; where the next task goes). Everything else sits in a closed `details.more`. `viewer/public/app.js:isOpen` carries the open state across the periodic repaint so a refresh never folds a box the user opened.

## viewer/server.mjs:spawnDecision (unknown hours)

Before the Freebuff usage read finishes, `fb.today.left` is missing. It used to parse as `0:00` and the card said "Only -1 h of DeepSeek left, so Beam codes". Missing now parses as unknown (`NaN`), so `leftFor` returns null and the decision says "Hours not read yet" and queues. Found by a GET check on a fresh server start.

## lib/checks/orch.mjs:default

Setup checks for the orchestrator: mode, orchestrator provider usable, each enabled provider's resolved command (`findBin`), model lists readable (`listModels`), live task count against the cap, and a writable reports folder. Read-only: nothing is written and no provider task is started (listing models runs the provider's own list command).

## lib/copy-app.ps1:Get-CcUnsafeReason

install.ps1 accepted any folder and uninstall.ps1 deleted it recursively, so typing a folder like Documents at the prompt and uninstalling later would have wiped it. Get-CcUnsafeReason is the one shared guard: it refuses a drive root, and any folder equal to or containing USERPROFILE, TEMP, LOCALAPPDATA, APPDATA, ProgramFiles, windir, Desktop or Documents. Descendants (the default %LOCALAPPDATA%\CommandCenter, or a Documents\Tools\CC folder) are fine. Both install.ps1 and uninstall.ps1 call it, so the two cannot drift apart.

## install.ps1:.cc-install marker

install.ps1 writes `.cc-install` in the target and uninstall.ps1 refuses a folder without it, so a development folder or any stray folder that merely contains viewer\server.mjs and lib\setup.mjs is never deleted (this also stops `uninstall.ps1 -Yes` run from a dev folder, whose $Target defaults to $PSScriptRoot). A non-empty folder with no marker that is not already a Command Center (older installs have viewer\server.mjs and lib\setup.mjs but no marker, so they count as updates and get the marker) gets a `CommandCenter` subfolder instead of being mixed with the user's files; if that is also non-empty and unmarked the install stops. The marker is excluded from the package (lib/copy-app.ps1:CcExcluded) so pack.ps1 run in an installed folder does not carry it to another PC.

## uninstall.ps1:hook removal order

The hook is removed from ~/.claude/settings.json before the panel is stopped and before anything is deleted, and a non-zero exit from `lib/setup.mjs hook remove` (settings.json unreadable or not JSON) stops the script with the folder intact; otherwise settings.json would keep pointing at a deleted hook file. The backup goes to ~/.claude/backups (setup.mjs:removeHook writes it only when something changes) because the in-folder backups folder dies with the install. Registered MCP entries are removed with `tools/register.mjs <cli> --remove` for claude, codex, opencode and cursor; failures are warnings, since a CLI that is not installed has nothing to remove. The relay (agent-interop-runtime) is shared with other tools, so uninstall only prints the `claude mcp remove` line. A folder that contains a reparse point is refused because Remove-Item -Recurse in Windows PowerShell 5.1 can follow a junction out of the folder.

## install.ps1:update restart

start.ps1 skips starting when port 4021 answers, so an update used to leave the old panel running old code. install.ps1 now calls lib/copy-app.ps1:Stop-CcPanel, which stops only node processes whose command line contains `<Target>\viewer\server.mjs` (uninstall uses the same function), then deletes the program folders in lib/copy-app.ps1:CcAppDirs (lib, viewer, hooks, relay, tools, usage, docs\ai-guide) before copying, so routes and checks removed upstream no longer auto-load from lib/routes and lib/checks. Per-PC data is never in that list. Side effect: a hand-added file inside lib\routes or lib\checks of an installed copy is deleted by an update. The panel is started again by the existing start step unless -NoStart; with -NoStart the installer says the old panel was stopped.

## install.ps1:runtimeDir

install.ps1 looked for the relay only under Target\runtime. It now reads runtimeDir from the target's config.json (same meaning as lib/setup.mjs:runtimeDir, the agent-interop-runtime package folder) and falls back to the default; an unreadable config.json falls back with a message.

## lib/setup.mjs:stripHook

A group with no hooks before the strip (`"hooks": []`, someone else's placeholder) is kept; only a group that this strip emptied is dropped.

## lib/setup.mjs:debug (home folder)

Every debug row's `detail` and `fix` has the home folder replaced with `~` (both slash styles), so a "Copy all as text" paste never carries the user's account name.

## lib/routes/setup.mjs:folder

UNC paths (`//server/share`, two leading slashes of either kind) are refused here and for the folder picker's start path. A `reportsDir` that does not exist yet passes when its parent exists; the POST `/setup` handler in `lib/routes/setup.mjs:default` makes it only after the whole patch validates, so a rejected patch never leaves a folder behind. Model names must start with a letter, digit or `_`, so none can look like a CLI flag.

## lib/routes/setup.mjs:ignoreReports

When the reports folder is named `.cc-reports` and its parent has `.git/info`, `.cc-reports/` is appended to `.git/info/exclude` once, so reports never show as untracked files. A plain folder or a missing `.git` is left alone.

## viewer/server.mjs:sameOrigin (port)

The allowed origins follow `PORT`, so a test panel on another port accepts its own page's POSTs.

## viewer/public/pages.js:PAGES.debug

The checks run once when the page is first built and then only on the button. The 60 s page refresh no longer re-runs them.

## lib/extensions.mjs:hookName

A hook whose command is itself a URL shows only the scheme and host (`lib/extensions.mjs:safeUrl`), in both the name and `lib/extensions.mjs:safe`. Stash entries without an object `hook` (for hooks) or a string `file` are skipped in `lib/extensions.mjs:listAll`, so a hand-broken stash cannot take down `/ext/list`.

## usage/exec.mjs:findBin

A program that is not found is remembered as missing for 60 s, so the dispatcher's `isInstalled` checks on every 5 s tick do not each run a 130 ms `where.exe`. A program installed while the panel runs is seen within a minute.

## lib/tasks.mjs:writeTaskFile

The install folder may contain spaces, and `.cmd` shims refuse double quotes, so the pointer says "the file at: <path>" and that the whole rest of the line is the path. The resume prompt in `lib/tasks.mjs:startFreebuff` puts the path in single quotes.

## lib/tasks.mjs:approve

Every edit is checked into a scratch object first and copied onto the task only when all pass, so a rejected approve leaves the task and its `hold` untouched.

## lib/tasks.mjs:startFreebuff (resume)

A resume continues the old conversation (`--continue`) unless the CLI it ran on is still alive in `clis`; a CLI that died while the task waited no longer forces a fresh chat. If writing the task file fails while the task is still waiting, `lib/tasks.mjs:fbFail` marks it failed with the reason instead of retrying every tick.

## lib/tasks.mjs:approve (hold limits)

`hold` is advisory: any local caller may approve a held sub-task, and a worker that omits `parent` and names a provider is not held. Held tasks have no timeout and count toward the live cap. When an orchestrator ends, only its held children are cancelled; children already running finish on their own.

## viewer/server.mjs:Host check (fetch site)

Any request a browser marks `Sec-Fetch-Site: cross-site` or `same-site` is refused, so another web page cannot trigger `/models?fresh` or `/usage?fresh` (which start provider CLIs) through an image or link. The panel's own page sends `same-origin`; curl sends no such header.

## lib/models.mjs:MODEL_RE

A model name cannot start with `-` or other punctuation that would read as a CLI flag.

## install.ps1:Target redirect
When the chosen folder is not empty, the installer moves to `<folder>\CommandCenter`. The source, inside-source and unsafe-folder checks run again on that new folder before anything is removed. An unzipped package is itself named `CommandCenter`, so picking its parent would otherwise point the installer at its own files and delete them. A folder that has the app's files but no `.cc-install` marker is only replaced after the user types yes; with `-Yes` it is refused, because uninstall later deletes any marked folder whole.

## uninstall.ps1:Remove folder
`Set-Location` only moves PowerShell's location, not the process's working folder. When the user runs uninstall from inside the install folder, Windows keeps that folder locked, so `[Environment]::CurrentDirectory` is moved to TEMP as well.

## lib/copy-app.ps1:Get-CcUnsafeReason (short names)
An existing path is expanded with `Get-Item` first, so an 8.3 short name such as `RICKY~1` is compared in its long form.

## tools/register.mjs:backup
Backups go to `CC_BACKUP_DIR` when set. uninstall.ps1 sets it to `~/.claude/backups`, because the default `<install>/backups` is deleted with the install folder.

## lib/setup.mjs:sameCmd
On Windows, the hook command is compared ignoring case and slash direction. A folder typed differently at uninstall time still matches the installed hook, so the hook is not left behind.

## lib/setup.mjs:debug (home folder mask)
The home folder is masked with one regex that accepts either slash, ignores case on Windows and only matches a whole folder name. A home of 3 characters or fewer (such as `/`) is not masked, since that would rewrite every path.

## lib/session-meta.mjs:setMeta

Rename, archive and delete-by-hiding live only in `session-meta.json` in the Command Center folder, keyed `provider:id` with `{name, archived, deleted}`; the tools' own session stores are never edited. The file is written to `session-meta.json.tmp` and renamed over the old one, so a crash cannot leave half a file. Empty fields are dropped, and a key with no fields is removed. The file and the `trash` folder are per-PC data: both are in `lib/copy-app.ps1:CcExcluded`, so pack and install neither ship nor overwrite them (uninstall removes the whole folder, as for `config.json`).

## lib/session-meta.mjs:decorate

`lib/sessions.mjs` wraps every entry of `lists` and `details` with this, so every caller (the `/sessions` list, `/session`, `/claude/state`, the archive worker) sees the custom name and the archived flag, and never sees a deleted session. The list readers take the newest N first and are filtered after, so hidden sessions use up some of the N.

## lib/sessions.mjs:removal

Delete finds the files only through the readers' own lookups (`newestFiles` for codex, `claudeFiles`, `cursorDbs`), after the same id regex the readers use, so a client can never name a path. Each entry returns the session state so the route can refuse `working`. Codex moves its rollout file, claude moves `<id>/` first and the `.jsonl` last (a half-failed move leaves the session still listed, and a retry skips the part already moved), cursor moves the whole chat folder. OpenCode (SQLite) has no files to move and is hidden through the meta file instead.

## lib/session-meta.mjs:moveToTrash

The file keeps its path relative to the tool's session root under `trash/<provider>/`, so putting the folder back into the tool's root restores it. A name already in the trash gets a timestamp suffix. A rename across drives (EXDEV) falls back to copy then remove. Paths outside the tool root are refused. A file the tool still has open fails on Windows and the error is shown to the user.

## lib/routes/sessions.mjs:default

One POST route, `/session/meta?p=&id=&a=rename|archive|unarchive|delete`, behind the server's same-origin check. Freebuff sessions are matched by slug against `loadSessions`, and delete only hides them. Every success clears the `/sessions` cache through `clearSessions`.

## viewer/public/sessions.js:sessTable

`sessTable` is the one table for the Sessions tab (`PAGES.sessions`), which lists every provider's sessions from `/sessions`, working first, then idle, then finished. Archived rows are left out unless "Show N archived" is on. A Freebuff row opens the Freebuff live view (hash = slug); every other row opens the `#view` modal. Row buttons show on hover. The per-provider tabs and `claude.js` were removed; `GET /claude/state` stays for agents. `window.sessReload` is set by whichever list rendered last, so the `#view` modal can refresh the list behind it. The Freebuff sidebar in `viewer/public/app.js` uses its own markup; `/api` adds `label` and `hidden` there so the existing `archived` (report written) keeps its meaning.

## viewer/public/director.js:build

The Orchestrator tab was folded into the Director tab (user, 2026-11-27: the director and the orchestrator are the same thing; the director makes goals, sends sessions to models, everything reports to it and it keeps the person updated). One tab now holds, top to bottom: the chat (thread, composer, status line counting what was handed out), what was handed out, Needs you, then collapsible boxes: the full task tree (`window.TASKS(tasksEl)` from tasks.js, rendered into a persistent element `tasksEl` that `draw` re-attaches after each redraw so the open logs and scroll are not lost), the team board (last 20 notes from `/board?json=1`), the budget cards, and Advanced. The director and its model checkboxes sit in a Settings box together with the default model for each provider (the old Orchestrator worker-model form). The old simple/orchestrated mode switch has no control any more: choosing a director writes mode `orchestrated` (`saveDirector`), while saving the team or the default models keeps the saved mode (`saveOrch`). Antigravity cannot be the director (`lib/routes/orch.mjs`, `lib/tasks.mjs:orch`, the picker): its limit is one task, and a director on it would hold the only slot so every task handed to it would wait forever. The open task logs keep their scroll offsets across a redraw (`keep`/`restore`; browsers reset scrollTop on a re-attached element). A saved `cc-tab` of `tasks`, `board` or `orch` is mapped to `director` in app.js. `viewer/public/orch.js` and `orch.css` are deleted.

## viewer/public/tasks.js:row

The user no longer approves sub-tasks or marks tasks done: the orchestrator agent does that through `tools/cc.mjs`. The only controls left are Stop (cancel, a safety switch), Retry for a failed or cancelled top-level task, View, and Open session. The goal form posts only `{text, cwd}`, so the task gets provider `auto` and becomes an orchestrator task in orchestrated mode.

## lib/tasks.mjs:orch

Orchestrated mode is now the default when `config.orchestrator.mode` is unset; only an explicit `simple` turns it off. With no provider saved, or a saved provider that is turned off in Setup, the first enabled provider in the order claude, codex, opencode, cursor, freebuff runs the orchestrator, and the saved model is dropped because it belongs to the other provider. `lib/routes/orch.mjs` accepts an empty provider for this ("First one that is on"), and `lib/checks/orch.mjs` reports it.

## lib/routes/sessions.mjs:rename body

A rename body that cannot be read (over 2000 bytes, so `readBody` drops the socket, or bad JSON) returns 400 and leaves the saved name alone. Before, the catch fell through to `cleanName(undefined)` and wiped the name (Sonnet review, 2026-11-16).

## lib/routes/archive.mjs:archived (decorate cached rows)

The worker's rows are cached for 10 minutes, so names, archive flags and deletes are applied on every request with `decorate`, grouped per provider. Without that a renamed or deleted session kept its old title in the Archive tab until the cache ran out.

## lib/sessions.mjs:codexSession / removal.codex

Codex ids are the 36-character UUID at the end of the rollout file name; the lookup matches `-<id>.jsonl` exactly. An 8-character prefix used to match some rollout and write an orphan meta key. `removal.claude` moves the `.jsonl` before the `<id>` folder, so a locked transcript fails before anything is moved.

## lib/session-meta.mjs:read

A `session-meta.json` that does not parse is renamed to `session-meta.json.bad-<time>` before the next write, so names and hidden sessions are kept for a hand fix instead of being overwritten with `{}`.

## lib/tasks.mjs:orch (installed check)

The fallback and a saved provider must be turned on and installed (Freebuff counts as installed through the relay). On a fresh PC with only Freebuff, the default config has Codex on but not installed; picking it would leave the orchestrator task waiting for ever. If nothing qualifies, orch() returns null and the task runs in simple mode. With no provider picked, the saved orchestrator model is cleared, and the page hides the model picker.

## lib/routes/sessions.mjs:delete (deleted flag)

A delete that moves files to the trash also writes `deleted: true`, so `decorate` hides the session from the cached Archive rows at once. A session put back from the trash by hand stays hidden until its `provider:id` entry is removed from `session-meta.json`. A rename whose Content-Length is over 2000 is refused with 400 before the body is read, because `readBody` drops the socket on oversize bodies and the client would get no answer.

## relay/pty.js.patched:CliPtyManager.start
The final conversation-id lookup after the readiness check read `startedAt`, a const declared inside the earlier try block, so every new Freebuff CLI start failed with "startedAt is not defined". It now reads `state.startedAt`. The installed dist copy was fixed the same way (2026-11-17). Running panels load the driver once, so the panel must be restarted for it to take effect.

## config.json:orchestrator
Orchestrator default changed from opus to sonnet on 2026-11-17 by Nomad's instruction, saved through POST /orch/config so the running panel picks it up. Opus only when a run truly needs it. lib/tasks.mjs:claude call passes no effort flag, so the CLI default applies (not above high); UNVERIFIED that no effort is forced higher.

## lib/tasks.mjs:freebuffPlan
`freebuffPlan` reused an idle CLI only when its `modelKey` equalled the pinned model, so after the pin moved from Flash to Fast the idle Flash CLIs were never given a task and new tasks queued behind a busy Fast CLI while hours ran. It now prefers an idle CLI of the pinned model and otherwise takes any idle live CLI; the model match still decides which model a newly spawned CLI uses. Fault found 2026-11-17 by the overnight run; the running panel needs a restart to load it.

## lib/director.mjs:gate

The dispatcher asks this once per waiting task, before anything else in the tick. It returns null (go ahead) or the sentence the task shows as its `reason`. Order: goal paused/stopped/done, then `dependsOn` tasks that are not `done`, then the goal's `maxLive` (orchestrator tasks are exempt so a limit of 1 cannot deadlock its own root), then `maxTasks`. The goal is found by walking `parent` up to 12 levels, so sub-tasks an orchestrator adds by hand inherit the goal without knowing about it. `director.mjs` imports nothing from `tasks.mjs`; that keeps the import one-way (tasks -> director) and avoids a cycle at startup.

## lib/director.mjs:snapshot

One read per dashboard paint, shaped for the Director tab. Stage is derived, never stored: paused/stopped/done from the goal, otherwise blocked if any task failed or is interrupted, working if any is running, waiting if any is waiting, done when the root task is done. `controllable` is true only for a live task with `pid` or `cli`, because only those have a process the panel can stop; `discovered` sessions are always `controllable: false`. Worktree git reads are memoised for 60 s and only the newest three results per goal pay for one, since the tab repaints every 12 s.

## lib/worktrees.mjs:prepare

Creates `<repo>/git/<task-id>` on branch `cc/<task-id>`. `soft: true` means the task simply runs where it was told (not a git repo, folder missing, worktrees off); without it the caller fails the task. A folder that exists and is not this task's recorded worktree is refused, never reused, so another session's checkout is not overwritten. `git worktree add` is retried without `-b` when the branch already exists from a deleted worktree. Nothing in this module deletes anything.

## lib/tasks.mjs:boot recovery

Replaced "every running task becomes failed". A `running`/`starting` record on load either continues (`ranOn === 'freebuff'` with a `conversationId`, resumes left) by going back to `waiting` with a `resume`, or becomes `interrupted`. `interrupted` is not live: it never starts by itself and only `resumeInterrupted` (POST /director/task/<id>/resume) or `retry` moves it. Leases and `heartbeatAt` are dropped on load because the process that held them is gone.

## lib/tasks.mjs:heartbeat and holdPanelLock

`heartbeat()` runs at the top of every tick and stamps `lease {owner, at, ttl}` plus `heartbeatAt` on starting/running tasks every 30 s at most, so a task's owner is visible in tasks.json. `holdPanelLock()` writes `state/panel.lock` and refuses to start the dispatcher when a live process already holds it; that panel still serves the page, and the reason appears in `state.error` and on the Director tab. The stale-lock case checks the pid with `process.kill(pid, 0)` before taking over.

## lib/machines.mjs:handshake / verifyHello

Two halves of one protocol. The caller signs `hmac(sha256, secret, "<peer id>.<ms>.<nonce>.<path>.<name>.<sha256 of body>")` (see `lib/machines.mjs:signRequest`, which replaced the older id-and-time-only form) and sends it with its own id; the receiver looks the peer up in `machines.json`, checks the timestamp is within 60 s and that the nonce was not used before, recomputes the signature with `CC_PEER_SECRET` — one variable name on every machine, see `lib/machines.mjs:verifyHello` — and compares with `timingSafeEqual`. The verified id is what the row is keyed by: an unlisted caller is added with `learned: true` and no address, and a row's id is never derived from its name. A peer is `online` in the UI only after a successful answer; a missing secret is `unconfigured` and nothing is sent. `machines.json` never holds the secret. The panel still binds 127.0.0.1, so a peer needs a tunnel the user controls.

## lib/github.mjs:mergeBlockers

Every reason a merge must not happen, gathered in one place so the approval route and the merge route cannot disagree: draft, not open, changes requested, any failing check, any check still running, no checks at all, mergeability not MERGEABLE. `list()`/`one()` are read-only `gh` calls cached 60 s; `merge()` adds `--match-head-commit` so the approved commit is the merged one.

## lib/routes/director.mjs

Loaded like every other route (name order, `ctx` object, returns true when handled). Everything is behind the panel's Host and origin checks; `/machine/hello` is the only route meant for another machine, and it still needs `127.0.0.1`/`localhost` as Host, so reachability is the user's tunnel. `POST /director/merge` refuses with 409 unless `mergeEnabled`, the typed confirmation equals the number, the stored approval matches the current head commit, and `mergeBlockers` is empty.

## .gitignore:repo-root

The app folder is its own repository root, which is what lets `config.json` keep `projectDir` at `E:/Command Center` (a symlink to the folder) while `lib/worktrees.mjs:prepare` gets a real repository for each task: worktrees land in `git/<task-id>` and are ignored, so the main checkout stays clean. Everything per-PC is ignored for the reason `lib/copy-app.ps1:CcExcluded` excludes it from a package — settings, task records, logs, reports, session notes and machine inventory belong to one computer. `lib/tasks.mjs:worktreeFor` still reports the non-repository fallback for a task pointed at a folder outside it, and `tools/director-check.mjs` asserts that path too.

## lib/director.mjs:snapshot (agents)

Each `agents` entry carries the checkout and the lease of a live run: `worktree`, `branch`, `leaseOwner`, `leaseAt`, plus `root`. It lists only a task with a running process (`pid` or `cli`), because the card labels anything without one as `discovered` and a queued task is not a discovered session. A goal's own root task is included (it was filtered out before), because that task is the one that can hold a checkout while the card showed no agent at all. `viewer/public/director.js:goalCard` renders the path, the branch and the owner.

## lib/tasks.mjs:closeTask

The only place a task is closed, and the fence itself. It reads the lease from `tasks.json` rather than from memory, then requires proof: a runner passes the `token` it was given by `claim` (renewal keeps the token, a takeover mints a new one) and the panel passes `panel: true` and must own the lease. A mismatch is refused with `lease-lost`, `lease-expired`, `lease-foreign` or `already-closed`, and a refusal writes nothing and kills nothing. `finish`, `cancel` and `markDone` all route through it, so a new close path cannot forget the check. `recoverAtBoot` claims a task only when `holderGone` says the previous holder is gone.

## lib/tasks.mjs:startForCheck

The one seam between the start path and its provider. `lib/tasks.mjs:startChild` builds the real call with
`binCall` (which throws when the CLI is absent) and spawns it; `startForCheck(id, provider, override)`
runs the same `startChild` with an optional `override()` that supplies `{ call, stdin }` instead, so a check
child can perform the real locked status-to-running write on a machine with no provider CLI. Production
never passes it: `tick` calls `startChild(t, p)` and the override stays null, so the resolved binary and
`spawn` are used unchanged. The lease is claimed **inside** that same `update`: `claim(t)` used to run
before the lock, and the locked `syncFromDisk` drops keys the disk row lacks, so the start write persisted
`running` with no lease until the next heartbeat re-claimed it. Every claim site now sits inside its
`update`, which is what the race asserts.

## lib/config.mjs:config (unreadable file)

Found by running the panel on a scratch folder: a `config.json` saved with a UTF-8 byte-order mark (Windows PowerShell 5.1 `Set-Content -Encoding utf8` writes one) failed `JSON.parse`, and the catch fell back to the defaults without a word. The panel then ran with every provider switched back on, an empty `projectDir`, and the next `saveConfig` would have overwritten the real file. `config` now strips the mark, records any other parse error in `readError` (a missing file is not an error), and `saveConfig` copies an unreadable file to `config.json.unreadable-<time>` before it writes, so settings are never lost to a bad byte. `lib/director.mjs:snapshot` passes `readError` to the Director tab, which shows it.

## lib/tasks.mjs:recoverAtBoot (orphaned agent)

A killed panel does not kill the provider CLI it started: `spawn` children are not tied to the parent on Windows. `recoverAtBoot` used to mark such a task `interrupted` looking only at the dead panel's pid, so Resume would start a second agent in the same worktree beside the first, the thing the worktree rule forbids. When a task that cannot continue (anything but a Freebuff chat) is marked `interrupted`, it now checks `pidAlive(t.pid)`; if the old process still answers `process.kill(pid, 0)` the task keeps `orphanPid` and its note names the pid. `lib/tasks.mjs:resumeInterrupted` returns `{ orphanAlive }` while that process lives, and `lib/routes/director.mjs` answers 409 with the pid. A pid can be recycled by an unrelated program, so `force: true` on the resume request clears the guard once the person has checked. Nothing is killed automatically: ending a process that might hold unsaved work is the person's call.

## lib/tasks.mjs:failCause

On a non-zero exit the task note names the last error-looking line of the log, redacted with `lib/machines.mjs:redact`, instead of only "exit code 1, open the log". The live run showed Codex rejecting the configured model, and the dashboard said nothing about why. Only the last 4000 characters of the log are read and 240 characters kept.

## lib/tasks.mjs:tick (no automatic provider)

`candidates` leaves Claude out of automatic routing on purpose (Claude runs as the director or when a task names it). With only Claude enabled and no director the waiting reason read "usage still loading", which was false. When `candidates` is empty the reason now says that no provider can take the task by automatic routing and how to fix it.

## lib/director.mjs:snapshot (task rows)

Each goal carries `tasks`: one row per task (the director's own task is flagged `director`) with status, provider, model and a short note (the wait reason for a waiting task, the result note otherwise), live tasks first, capped at 30. `config.readError` is passed along so the tab can warn about an unreadable `config.json`. `viewer/public/director.js:goalCard` renders the rows in plain words.

## viewer/public/director.js:build (simple Director tab)

The tab is a director picker, one message box and a feed. The picker saves the existing orchestrator setting through `POST /orch/config` (mode `orchestrated`, the chosen provider, and any model id typed or picked, since the director may be any model the provider accepts). The message box posts one goal to `POST /director/goal` with provider `auto`, which `lib/tasks.mjs:add` turns into the director's own task; the director then creates the worker tasks through its prompt (`lib/orchestrator.mjs:buildPrompt`). Folder, limits, machines, pull requests and discovered sessions sit in a collapsed Advanced section. `load` re-renders every 12 seconds, so `keep` and `restore` copy form values, focus, selection and the open state of Advanced across the redraw; before this the typed message was wiped while the person was typing.

## lib/github.mjs:mergeBlockers (review bot)

The guard only refused on bad signals, so a pull request with no review-bot check at all passed it. It now also refuses unless the rollup holds a successful status named `reviewBotContext` (default `pr-review/ready-to-merge`) for the head GitHub reports. The bot's findings live in its own UI behind a GitHub sign-in and cannot be read here, so a pass is necessary and not sufficient: the person's approval for that commit (`lib/routes/director.mjs` merge route) is still required, and merging from the panel is still off until `mergeEnabled` is set.

## lib/config.mjs:DEFAULTS (team)

`team` is the list of models the person ticked in the Director tab: `[{ provider, model, effort }]`. Empty means the director may pick any model. `orchestrator.effort` is the director's own reasoning level. Both are saved by `POST /orch/config` (`lib/routes/orch.mjs`), which validates provider, model name (`MODEL_RE`) and effort against `lib/models.mjs:EFFORTS`.

## lib/models.mjs:EFFORTS

Reasoning levels per provider, as each CLI takes them: Claude `--effort` (low, medium, high, xhigh, max), Codex `model_reasoning_effort` (low, medium, high, xhigh), OpenCode `--variant` (low, medium, high, max). Cursor and Freebuff expose no level, so the menu shows none for them and nothing is passed. A level the model itself rejects shows up in the task log and the failure note.

## lib/tasks.mjs:effortFor

The level a task runs at: the director's own task uses `orchestrator.effort`; a worker uses the level of its team entry (same provider and model); otherwise Codex falls back to `models.codexEffort` and OpenCode to `high` (what it was before). The director cannot override a level: the person's menu is the authority. `childCall` turns it into the CLI flag.

## lib/tasks.mjs:teamCheck

When a team is ticked and the task is a child of an orchestrator, `add` and `approve` refuse a provider and model that are not on the team, and refuse a task with no provider and model, with a message that lists the team so the director can correct itself. The steer route in `lib/routes/director.mjs` hands its note to the first team entry for the same reason.

## lib/tasks.mjs:childEnv (login only)

Everything signs in through each provider's own login (Claude and Codex through the browser, Cursor, OpenCode and Freebuff through theirs). A key left in the environment would override that login silently and bill a different account, so `childEnv` removes `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `OPENAI_API_KEY`, `CODEX_API_KEY` and `CURSOR_API_KEY` from what a started agent sees. The panel never reads, stores or asks for a key.

## lib/tasks.mjs:authFailure

A failed run whose last error line looks like a sign-in problem (expired OAuth session, 401, not logged in) sets `needsLogin` on the task and says so in its note. `lib/director.mjs:snapshot` turns that into a "log in" item and `viewer/public/director.js` offers a Log in button that opens the provider's own login in a terminal (`POST /auth`). The panel cannot see whether a login has expired before a run uses it: `lib/setup.mjs` only checks that the credentials file exists, so "signed in" in the menu means "has a login file".

## lib/tasks.mjs:retry (orphan)

Retry used to restart an interrupted task whose old agent process was still alive, which is the case `resumeInterrupted` refuses. It now answers `{ orphanAlive }` the same way unless forced, and drops `orphanPid` when it does restart.

## lib/director.mjs:snapshot (thread)

Each goal carries `thread`: the conversation in order. The person's side is the goal text and every steering note; the director's side is one entry per director task, its final report (first 6000 characters) when it finished, its failure note when it failed, an empty "working" entry while it runs. A goal is one chat: while the director is still working a new message becomes a helper task under it (a running director cannot be messaged), and once the director has finished it starts a new director task on the same goal (`lib/routes/director.mjs` steer route). The chat picker lists goals; "New chat" starts a new goal.

## viewer/public/director.js:chat

The Director tab is a conversation: bubbles from `thread`, a task strip under the latest director bubble, a composer that sends on Enter, the director picker (provider, model, level) and the team menu (a checkbox, level select and sign-in state per model of each enabled provider). `keep` and `restore` keep typed text, focus and scroll across the 12 second redraw.

## Deferred

Not built: a single writer for the Garden Engine board files, a positive review-bot requirement and head-commit pinning in the merge guard, a provider capability table, and remote task claim. They were set aside when the requirement became "pick a director model, tell it what you want". `docs/director/STAGES.md` records them as deferred.

## lib/tasks.mjs:childCall (antigravity)

Antigravity is run only as `agy -p <prompt> --model <slug> --output-format text`, started by the panel as a direct child process. Google's terms (https://antigravity.google/terms section 6, FAQ) bar third-party software from using the login and say wrapping `agy` in other apps is not supported on consumer plans, so the panel never touches the login, never rotates accounts, never uses a key, never passes `--dangerously-skip-permissions`, and runs one task at a time. It is off by default.

## lib/tasks.mjs:OPT_IN

Providers that automatic routing never picks (`candidates`): Claude, and Antigravity because of its terms. They run only when a task or the director's team names them.

## usage/exec.mjs:binOf

Maps a provider id to the program it runs: Antigravity's program is `agy`; `antigravity` alone would find the editor launcher, not the CLI.

## lib/models.mjs:antigravity

Reads `agy models`, which prints one `slug<TAB>name` per line after a "Fetching available models..." line. The reasoning level is part of the slug, so `EFFORTS` has no entry for Antigravity and the route refuses a level for it.

## lib/tasks.mjs:AUTH_RE

Matches only login-specific phrases (an OAuth session or token, an expired session, not logged in, log in again, unauthorized, authentication required, invalid credentials). The first version matched bare words such as "login" and "expired", which labelled ordinary failures as login problems.

## lib/tasks.mjs:effortFor

Uses a saved level only when it is in `EFFORTS` for the provider that actually runs; the director's own level counts only when the director's saved provider is that provider (it can fall back to another one when the saved one is not installed).

## lib/routes/orch.mjs:/orch/config

The older Orchestrator form does not send `team` or `effort`; the route keeps the saved values when those fields are absent, so that form cannot clear the person's choices.

## viewer/public/app.css:root

All colours, fonts and radii live in the `:root` tokens. The old names (`--bg`, `--panel`, `--panel2`, `--line`, `--fg`, `--dim`, `--accent`, `--green`, `--amber`, `--violet`, `--red`) are kept so every other stylesheet and the generated markup keep working; new names are `--ink`, `--raise`, `--line2`, `--paper`, `--live`, `--font`, `--mono`, `--r1`..`--r3` and one `--c-<provider>` per provider. No other stylesheet holds a hex colour. The font is Bahnschrift (ships with Windows 10 and later) with Segoe UI as the fallback; nothing is loaded from the network because the panel is local and private.

## viewer/public/app.css:nav

Tabs are grouped (work, archive and system) with `.sep` spacers that are not `<a>`, because `app.js:setTab` toggles `.on` on `#tabs a` only. There are no per-provider tabs: `app.js` maps a saved `freebuff`, `codex`, `cursor`, `opencode` or `claude` tab to `sessions`. A provider's `--c-<provider>` colour shows only on its `.tk-badge.p-<provider>` badge in `tasks.css`.

## viewer/public/app.css:button.pill

The primary action is paper-white on ink (`.tk-act .pill`, `.pill.primary`); ordinary buttons are outlined. Labels above fields are sentence case, not tracked capitals.

## lib/director.mjs:gate

The goal limits count slots, not queue length. `maxLive` is compared with the OTHER workers of the goal that are `starting` or `running`; a `waiting` task holds no slot, and the task asking to start is never counted against itself. The old rule counted every live worker including the asker and the queue, so with `maxLive=1` the first worker saw itself and could wait for ever. `maxTasks` counts the other workers that already started (`startedAt` set), so tasks that are only queued do not use the budget. The orchestrator is exempt from `maxLive` and from `maxTasks`. `snapshot` reports the same numbers (`usedLive`, `usedTasks`) so the panel and the gate agree. `tools/limits-check.mjs` pins the boundaries for limits of 1 and 4 and runs in CI.

## lib/director.mjs:steerMode

Decides what a reply in the Director chat can really do, from the root director task alone. `live`: the director is a running Freebuff chat, so the text can be typed into it. `amend`: it is queued and has not read its brief yet, so the text is added to the brief. `handoff`: it is a running one-shot run (`codex exec`, `claude -p`, `opencode run`, `cursor -p`, `agy -p`); those read their prompt once at start and have stdin closed, so nothing can reach them. `new-run`: the director ended, so a new director run starts. The route re-checks `live` against the real CLI table before it sends, and falls back to `handoff` when the chat has exited. The snapshot reports the same value as `steering` so the composer can say beforehand what a reply will do.

## lib/director.mjs:handoffText

The brief for a director run that replaces or follows an earlier one: the goal's original text, the earlier steering notes, the id and report path of the earlier director, and the new note. A reply therefore never replaces the goal with only the latest sentence.

## lib/director.mjs:gate

A task with `afterTask` stays waiting while that task is live (`waiting`, `starting`, `running`). It is how a queued hand-off director run avoids editing the same folder as the director it follows. It starts when the earlier task ends in any state, so a failed or cancelled director does not block it for ever.

## lib/routes/director.mjs:/director/goal/:id/steer

The reply is recorded with what happened to it (`delivery`): `sent` (typed into a live Freebuff director, not confirmed), `amended` (added to a director that had not started), `queued` (a new run starts after the running one-shot director ends; the running director has not seen the note), `new-run` (the director had finished) or `failed`. The message to the person says only that. It never says a running worker stopped or changed course, because nothing confirms that. The old route started a separate child task of the running director with only the note, so the original goal was missing and the reply claimed the new task carried it.

## lib/tasks.mjs:sendToDirector

Types text into the live Freebuff CLI that runs the task, using the same `send` the dispatcher uses to start a task. Returns `{ ok: false, why }` when the task is not a live Freebuff chat. A sent line is not a confirmation: the CLI may be mid-turn.

## lib/tasks.mjs:amend

Appends text to a task that is still `waiting`, so the brief it reads at start includes it. Refuses once the task has started.

## lib/tasks.mjs:childCall

A `read` task must not change files, so each provider gets the strongest read-only control its CLI has: Codex `-s read-only` (a sandbox), Claude `--permission-mode plan` with no edit tools allowed, Cursor with no `--force` (changes are not applied), OpenCode `--agent plan`, Antigravity `--mode plan`. Antigravity was started with no mode at all, so it ran with whatever permissions the person had saved. Probe on 2026-11-27 in an empty throwaway git folder: `agy -p ... --mode plan`, told to create a file and then told to run `echo hello > probe2.txt`, wrote nothing either time and answered with a plan artifact to approve. That is the CLI's own mode, not an operating-system sandbox, and a read-only Antigravity task may therefore come back as a plan instead of an answer. Freebuff has no such control: it only gets a `[read]` tag and a sentence in the brief.

## lib/tasks.mjs:READ_ENFORCED

The providers whose own CLI enforces read-only. A `read` task is never routed to Freebuff automatically, and a read task given to Freebuff by name is refused in `add` and failed in `tick`, with the reason, rather than run on a promise in the prompt.

## lib/session-meta.mjs:liveOf

The Sessions screen used to call a session "working" when its file changed in the last 2 minutes. That is recent activity, not a running process. `liveOf` returns one of four values: `running` (the panel found a live process id for the session AND it wrote in the last 2 minutes), `recent` (written in the last 2 minutes, process not checked), `finished` (the transcript itself shows the run completed), `unknown` (no recent write and no completion mark; it may be running, paused, or closed). Only Freebuff chats carry a process id today (found from the CLI's log); Codex, Claude, Cursor and OpenCode history is read from files, so those can never be `running`. The older `state` field stays for the delete guard and the archive worker, which are deliberately cautious about anything recently written.

## lib/session-meta.mjs:decorate

Adds `live` and `liveWhy` to every session row. A history row is read-only: the panel did not start it, so it cannot stop, pause or send to it, and the Sessions screen says so.

## viewer/server.mjs:allSessions

Fetches one more row than it shows per provider. When there are more than 15, the list ends with a note row saying older sessions are not listed, so the limit is visible instead of silent.

## lib/machines.mjs:signRequest

The old signature covered only `<peer id>.<timestamp>`. Anyone who captured one signed hello could replay it for 60 seconds against any route, and the body (the capabilities a machine reports) was not covered at all. The signature now covers the peer id, timestamp, a one-use nonce, the request path and a SHA-256 of the exact body text, so a signed hello cannot be reused on `/machine/claim`, cannot carry a changed body, and cannot be sent twice. This is a prerequisite for remote execution, not remote execution: `/machine/claim` still answers 501.

## lib/machines.mjs:verifyHello

Checks the signed request and remembers each nonce for 2 minutes (kept in memory, so a panel restart forgets them; the 60 second timestamp window still bounds a replay across a restart to one minute).

## lib/director.mjs:steerMode (starting)

A Freebuff director that is still `starting` is treated as a hand-off, not `live`: the CLI exists but the task text may not have been delivered yet, so a typed reply could arrive first or be lost. `lib/tasks.mjs:sendToDirector` also only accepts `running`.

## lib/director.mjs:gate (interrupted earlier director)

An `interrupted` director whose orphan process id is still alive may still be editing the folder, so a queued hand-off keeps waiting for it, the same rule `lib/tasks.mjs:resumeInterrupted` uses.

## lib/routes/director.mjs:/director/goal/:id/steer (goal state)

The gate holds every task of a paused goal and refuses stopped or done ones, so a reply to a stopped or done goal is refused with 409 instead of promising a run, and a reply to a paused goal says the run starts when the goal is resumed.

## lib/session-meta.mjs:capRows

Cuts a provider's list to the limit and appends the one visible note row. The list is fetched with a few spare rows because deleted sessions are dropped after fetching.

## lib/machines.mjs:signRequest (name)

The `x-cc-name` header is part of the signature, because verifyHello uses it to match or learn a listed peer by name.

## tools/director-check.mjs:sign

The signed-request cases build the HMAC string by hand with their own `sign()` instead of calling `lib/machines.mjs:signRequest`, so a change to `signRequest` that no longer matches the documented wire format (`peerId.ts.nonce.path.name.sha256(body)`) fails the check instead of passing against itself.

## tools/limits-check.mjs:gate

The limits check is a pure unit run on a throwaway `CC_ROOT`. Its sections cover `maxLive` 1 and 4, the `maxTasks` boundary (only tasks with a `startedAt` use the budget), the budget view, `steerMode`, `handoffText`, the `afterTask` hold (a queued hand-off waits while the earlier director is live and starts once it ends in any state), and the session status rules (`liveOf`: running only with a live process, recent activity is not a running state; `capRows`).


`lib/concurrency.mjs:modelSlots`, `lib/routes/setup.mjs:validate`, and `lib/director.mjs:setMaxLive`: Codex, Cursor, OpenCode, and Claude limits now apply per model, including existing saved provider limits. Freebuff retains a shared CLI limit and Antigravity retains its single-task limit. Existing goals keep their current live-task limits until changed in Director; the global task guard remains 60.


`lib/session-meta.mjs:freebuffEnded` treats a tracked task status as authoritative for its Freebuff session. An untracked session uses its report as completion evidence; a running retry or failed task is not marked done merely because an older report exists. The list, session detail, and Director discovery apply the same rule. `lib/session-meta.mjs:freebuffBusy` protects a running retry from deletion even when an older report exists.
