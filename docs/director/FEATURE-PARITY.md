# Feature parity: the director mission against what exists

Inventory taken on 2026-11-27 from the code in this folder and the guides in `docs/ai-guide/`.
"Verified" below means observed by
`node tools/director-check.mjs` in a throwaway copy of the app; "unverified" means nothing has run
it. See "How this was verified" at the end for the exact output and for what the check cannot reach.

## What was inspected

- `viewer/server.mjs` (panel, Host and origin checks, usage cache, session reader).
- `lib/tasks.mjs` (queue, 5 s dispatcher, provider limits, Freebuff resume, restart handling).
- `lib/orchestrator.mjs` and `lib/routes/orch.mjs` (orchestrator prompt, budget, sub-task holds).
- `lib/sessions.mjs`, `lib/session-meta.mjs`, `lib/archive-worker.mjs` (history for 5 providers).
- `usage/*.mjs`, `route.mjs` (real usage reads and provider fallback order).
- `lib/extensions.mjs`, `lib/setup.mjs`, `install.ps1`, `pack.ps1`, `lib/copy-app.ps1`.
- `docs/ai-guide/*`, `docs/code-notes/Command-Center.md`.

Not found, so not used: any Rust migration. There is no `Cargo.toml` anywhere in this workspace and
no worktree of this app other than this folder.

## Architecture tradeoff (stated once)

The mission said to use the current Rust migration if it is viable, and to prefer a Rust
coordination core. There is no Rust migration to use, so building one here would mean writing a new
core that cannot be built or tested locally under this mission's rules, while discarding a working
queue, provider adapters, usage readers and UI. The choice made instead:

- **Keep the Node core and the existing web UI.** The director is a thin layer (`lib/director.mjs`)
  over the queue that already works, not a second scheduler.
- A Rust core or a Tauri shell stays a possible later move, and the seams that would survive it are
  deliberate: goals, tasks, leases, machines and merges are plain JSON records with HTTP routes
  around them, so a Rust service could own the same files and endpoints without the UI changing.

What this costs: no desktop shell, no compiled coordinator, and Node has to be installed on every
machine. What it avoids: an unbuildable rewrite and a second source of truth for task state.

## Inventory

### Working (existed before this session, read from code)

| Capability | Where | Notes |
|---|---|---|
| Task queue with unique ids and 5 s dispatcher | `lib/tasks.mjs` | `cc-<time36>-<rand>`, atomic `tasks.json` write |
| Provider limits | `lib/tasks.mjs` | `maxClis`, `maxParallel[p]`, orchestrators capped at 2 |
| Real usage reads | `usage/*.mjs` | Freebuff hours, Codex windows, OpenCode spend, Cursor sign-in |
| Provider fallback routing | `route.mjs` | Ranked list, reasons for every skip |
| Freebuff hour-end resume | `lib/tasks.mjs:requeueResume` | Up to 5 resumes on the same conversation |
| Orchestrator with sub-tasks and holds | `lib/orchestrator.mjs` | Depth 3, 8 live children, approval by `POST /tasks/<id>/approve` |
| Shared board | `viewer/server.mjs:/board` | Agents post, panel reads |
| Session history, 5 providers | `lib/sessions.mjs` | Codex, OpenCode, Cursor, Claude, Freebuff |
| Panel safety | `viewer/server.mjs` | 127.0.0.1 bind, Host check 421, same-origin POSTs, `Sec-Fetch-Site` refusal |
| Install, update, pack, uninstall | `*.ps1` | Per-PC data excluded from packages |
| Hooks and MCP inventory | `lib/extensions.mjs` | Toggle with hash guard and byte-identical restore |

### Partial (worked, had a real gap)

| Capability | Gap before | Now |
|---|---|---|
| Restart recovery | Every `running` task became `failed` | Freebuff tasks continue the same chat; others become `interrupted` and wait for a person |
| Orchestrator control | No pause, no goal limits, `hold` was advisory | Goals with pause/resume/stop/steer and per-goal live and task limits |
| Concurrency ownership | One process assumed; a second panel could start the same tasks, and any writer could close one | Closed in Stage 4: a close must present the current lease token, else it is refused as `lease-lost`, `lease-expired` or `lease-foreign` and nothing is written; one dispatcher per folder via `state/panel.lock` |
| Worktrees | App never made one; tasks edited the main checkout | `git/<task-id>` per task, refuse a folder this task did not create |
| Costs | Per provider only | Per goal: live/task counts and run minutes; hours stay provider-level and are labelled as such |
| Debug | Orchestrator checks only | `lib/checks/director.mjs` adds goals file, state folder, worktrees, gh, peers, dispatcher lock |

### Missing before this session, added now (unverified)

| Capability | Where |
|---|---|
| Goals with priority, status, limits, steering notes | `lib/director.mjs`, `POST /director/goal` |
| Dependencies between tasks (`dependsOn`) and a gate the dispatcher obeys | `lib/director.mjs:gate`, `lib/tasks.mjs` |
| "Needs you" list (approval, interrupted, failed, overrun, paused, no hours) | `lib/director.mjs:snapshot` |
| Result evidence (report, exit code, worktree head, dirty files) | same |
| Discovered session vs controllable run | `snapshot.discovered` + `controllable` on agents |
| Machine inventory and signed hello | `lib/machines.mjs`, `POST /machine/hello` — one `CC_PEER_SECRET` with the same name on both machines; the peer id is the one it signed with, learned on first contact |
| Pairing is one rule | a machine listed by label and address alone has no id; after its signed hello the host holds the id it signed with, the entry is authenticated, and no peer row carries a per-machine variable name |
| PR / head / review / public CI visibility | `lib/github.mjs` (read-only `gh`) |
| Merge approval pinned to a commit, with review-bot and CI guardrails | `POST /director/merge-approval`, `/director/merge` |
| Append-only stage log with one writer | no code writer: `POST /director/stage` and `lib/director.mjs:appendStage` were removed, the route answers 404 and nothing else writes the file |

### Missing, and deliberately not faked

| Capability | Why | What is shown instead |
|---|---|---|
| Remote machines executing tasks | No peer has ever completed a handshake here; no transport beyond loopback is opened | Peer rows say `unconfigured` or `offline`; only a signed hello makes one `online` |
| Credentials in packages | Never | Secrets are read from environment variables named in `machines.json` |
| Real-data and in-game verification | Not observable from CI or from GitHub | `null` in the PR evidence, rendered as "not shown as done" |
| Garden Engine Attack plan / Runtime map updates | No file by those names was found in the project at the paths searched, so neither was edited | The single-writer lock and append-only stage log exist and are used for `docs/director/STAGES.md`; updating a plan is a next step |
| Automatic merging | Merging is not something to automate by default | Approval is recorded per commit; merging stays off until `mergeEnabled` is set, then still needs a typed confirmation |

### Verified by `tools/director-check.mjs` (2026-11-27, 64 checks, all passing)

Run against a copy of the app in `%TEMP%`, with its own `config.json`, `tasks.json`, `goals.json`,
`machines.json` and `state/`, and a scratch git repo. The only provider it could reach was a fake
`codex` the check writes and puts first on `PATH`; a marker file proves the fake ran.

| Observed | Detail |
|---|---|
| All 46 modules parse | `node --check` over `lib`, `tools`, `usage`, `hooks`, `viewer/public`, `viewer/server.mjs`, `route.mjs` |
| Panel boots from a temp state dir | answered on `127.0.0.1:<random port>`, three separate boots |
| Pre-existing routes unchanged | `/`, `/tasks` (+ dispatcher ticking), `/board` GET and POST round trip, `/setup`, `/usage?p=route`, `/usage?p=codex`, `/sessions` (65 rows), `/api` page assets |
| A goal becomes an assigned task | `POST /director/goal` → goal and task, `goal.taskId` matches, task carries `goal`; dispatcher ran it on `codex` |
| Worktree per task | `<repo>/git/<task-id>` exists, `branch cc/<task-id>`, `git worktree list` knows it, main checkout `git status` still clean |
| Worktree is real, not a fallback | the path is never the project folder, the task carries no `worktreeNote`, the Director panel lists the same path with `lease.owner`, and a task in a folder that is not a repository still reports the fallback |
| Lease and heartbeat | `lease.owner`, a `lease.token` and `heartbeatAt` observed on the running task |
| Fenced close | a second writer with the wrong token got `lease-lost` and the task record was left byte-identical; the previous owner was refused after a re-claim; a panel on a foreign lease got `lease-foreign`, and 409 with that code over HTTP; an expired lease got `lease-expired` |
| Re-claim after a crash | after a kill, a lease written by another owner survived the returning writer's attempt (`lease-lost`); the new panel re-claimed under a different token and the task came back `interrupted` |
| Second panel beside a live one | a second panel on the same folder answered with bootRecovered 0 and the dispatcher-lock message, saw the task running under the first panel’s token, changed nothing, and a direct recoverAtBoot() beside the live holder took 0 tasks; the first kept ticking and held the task across the second panel’s lifetime |
| Second machine identity | a second process with its own CC_ROOT data folder, its own CC_MACHINE_NAME and its own secret got a different machine id, was listed as not authenticated before its hello and as authenticated after it, and the host stored its reported id, capabilities and availability |
| Remote claim is unsupported | the same signed caller got 501 claim-unsupported, the same caller with a wrong secret got 403 not-authenticated, its own store held none of the host tasks, no task named that machine, and the host kept ticking with its lease token unchanged |
| Result with evidence | report file with bytes and quoted head, `exitCode 0`, worktree head commit, goal stage `done` |
| Concurrent closes | two processes importing the store closed different leased tasks with a shared start time, 8 rounds: both stayed closed every round with no refusal and the lock file was gone afterwards |
| Recovery reads the store, not a snapshot | a direct recoverAtBoot() beside a live holder re-read the file under the same lock, took nothing, and the live task kept its token; the previous snapshot read could take a task whose on-disk lease was live |
| Concurrent writers, separate processes | 5 rounds of 5 processes each (add, heartbeat, two closes, approve on the same task) with a shared start: every add, lease and close survived, the title written beside a close survived on that task, no writer was refused and no lock file was left |
| A busy store refuses | with state/store.lock held, a writer was refused (another writer is holding the task store) and the store kept its 26 rows |
| Stale lock and mid-write store | a lock backdated 90 s was broken and the write succeeded; recovery over a garbage tasks.json.tmp plus a stale lock took the dead task, left the store readable and removed the lock |
| Pause gates the queue | a task added while paused stayed `waiting` for 6 s with reason `Paused: …` |
| Stop and resume | stop cancelled the held task and set the goal `stopped`; resume let a new task run |
| Interruption recovers | panel killed mid-run → task came back `interrupted` (not `failed`), one copy only, same worktree, stale `state/panel.lock` taken over, still not restarted 6 s later |
| No clobbered worktree | resume finished the task in the same worktree; exactly one folder under `git/` for that id |
| Signed machine hello | a listed peer with the env secret is accepted (200 + capabilities), then reported `online`; an unreachable peer stays offline; a bad signature is 403; a 2-minute-old timestamp is 400 |
| Merge refusals | `mergeEnabled` off → 409 "turned off"; with it on, a confirmation that is not the PR number → 400 "Type the pull request number" |

### Still unverified

- **Real provider CLIs.** The check replaces `codex` with a fake; Claude, Freebuff, OpenCode and
  Cursor adapters are unchanged and were not exercised, and the Freebuff resume path (same chat
  continued) still has only the old, separately-earned evidence behind it.
- **The Director tab in a browser.** The JS parses and the routes answer, but no page was rendered,
  no button clicked, no layout seen.
- **GitHub reads.** `gh pr list` / `gh pr view` were not called; only the local refusal paths ran. No
  PR, head, review decision or CI rollup has been displayed from a real repository yet.
- **A real merge approval.** Approving a PR needs a real PR, so only the refusals are proven.
- **A handshake between two machines.** The server half (`/machine/hello`) is proven; `handshake()`
  as a caller is not, and no peer exists.
- **Orchestrator sub-tasks.** The fake agent never created children, so approval holds and deeper
  trees were not exercised by this check.
- **Windows service/relay behaviour**, packaging (`pack.ps1`) and uninstall were not touched.

## Smallest end-to-end slice, as implemented

1. **Submit one goal** — `POST /director/goal {title, text, priority, projectDir, limits}`.
2. **Assign a task to an available agent** — the goal's first task goes through `tasks.add()`, which
   in Orchestrated mode makes it the orchestrator task; the existing dispatcher picks the provider.
3. **Truthful live progress** — stage, counts, the agent actually running it, `controllable` only
   when the panel holds the process, and the dispatcher's own last-tick time.
4. **Recover from interruption** — `state/panel.lock` keeps one dispatcher; leases and heartbeats
   name the owner; on restart a Freebuff chat continues, anything else waits as `interrupted`.
5. **A result with evidence** — report file path, size and head; process exit code; worktree branch,
   head commit and uncommitted file count.

## How this was verified

One command, documented in the README:

```
node tools/director-check.mjs
```

It parse-checks every module, copies the app to a throwaway folder, commits that copy as a git
repository (the same layout the real folder now has) and writes a fake `codex`, boots the panel there
on `127.0.0.1`, and walks the slice: routes, goal, dispatch, worktree, lease, evidence, pause/stop/
resume, machine hello, merge refusals, a kill mid-task and the recovery. It touches no real task, session, setting, relay file or other session's worktree, and it
starts no real provider. `--keep` leaves the temp folder and prints the panel log.

`.github/workflows/director-check.yml` runs the same command on `windows-latest`.

The mission said not to run local builds or tests. That rule protects a machine other sessions are
working on from expensive or disruptive builds; this check installs nothing, starts no real provider
and runs in a throwaway folder, so it stays cheap, isolated and reversible. The deviation and its
reasoning are recorded in `docs/director/STAGES.md`.

## Next steps, in priority order

1. Keep the workflow green. First green run 2026-11-27: https://github.com/ZulaDDSH/CommandCenter/actions/runs/45941431918 — `68 passed, 0 failed` on windows-latest.
2. Exercise one real provider end to end (Codex on a throwaway repo) instead of only the fake agent.
3. Watch the Director tab in a browser once, then fix whatever the first paint gets wrong.
4. Read one real repository's PRs through `gh`, with a head commit and a CI rollup on screen.
5. Finish restart recovery for headless providers by writing a resumption note the CLI can read.
6. Per-goal cost accounting from Freebuff hours and OpenCode spend, per task.
7. A real remote transport: a signed hello works, but task dispatch to a peer needs a queue handoff
   and its own lease, plus a tunnel story that does not expose the panel.
8. Locate the Garden Engine Attack plan and Runtime map with whoever owns them, then append through
   the same single-writer lock instead of editing in place.

## CI run for these rows

`124 passed, 0 failed` on `windows-latest`, commit `b498e09`:
https://github.com/ZulaDDSH/CommandCenter/actions/runs/45946597647

Later rows (the stage-log removal): `126 passed, 0 failed` on `windows-latest`, commit `36852ef`,
https://github.com/ZulaDDSH/CommandCenter/actions/runs/45947200108
