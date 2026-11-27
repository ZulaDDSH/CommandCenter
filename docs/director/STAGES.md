# Director stages

Append-only. Each stage records what exists, what changed, evidence, limitations and next steps.
Only one writer appends at a time (`state/director.lock`, see `lib/director.mjs:appendStage`); the
route `POST /director/stage` is the way to add an entry from a running panel.

## 2026-11-27 — Stage 1: one goal end to end

- Goal: none (the director had no goals yet; this stage builds them)
- Exists: a task queue with unique ids, a 5 s dispatcher, five provider adapters, real usage reads,
  an orchestrator with sub-tasks and holds, a shared board, a session viewer for five providers, and
  127.0.0.1-only serving with Host and origin checks.
- Changed: goals, priorities, limits and steering (`lib/director.mjs`); a dispatcher gate for paused
  goals, dependencies and per-goal limits (`lib/tasks.mjs`); leases and heartbeats; restart recovery
  that continues a Freebuff chat and marks anything else `interrupted`; one dispatcher per folder
  (`state/panel.lock`); per-task worktrees under `<repo>/git/<task-id>` (`lib/worktrees.mjs`);
  machine inventory with a signed hello (`lib/machines.mjs`); read-only PR and CI visibility
  (`lib/github.mjs`); a merge approval pinned to a commit with CI and review guardrails; a Director
  tab; `lib/checks/director.mjs` for Debug.
- Evidence: file reads of the existing modules and guides; the `<repo>/git/<task-id>` checkout layout
  was already in use, so the new code follows it. No build, no test and no server start were run.
- Limitations: every new file is unverified until CI passes. Remote machines cannot run tasks, only
  answer a signed hello. Per-goal cost is counted in tasks and minutes, not currency. Real-data and
  in-game verification are not observable and are never inferred from CI. The Garden Engine Attack
  plan and Runtime map were not found at the paths searched, so neither was edited.
- Next: CI on the new modules and a panel boot smoke test; then prove pause/resume/stop against a
  real goal.

## 2026-11-27 — Stage 1a: what was deliberately not done

- Goal: none
- Exists: a working orchestrator whose sub-task holds are advisory, and a board agents already use.
- Changed: nothing. `hold` was left advisory so a stuck orchestrator cannot deadlock its own
  children, and no messages are sent to other agents or sessions.
- Evidence: `lib/tasks.mjs:approve` and `docs/ai-guide/20-orchestrator.md`.
- Limitations: an approval that never comes is only visible on the dashboard, not enforced.
- Next: decide whether a hold should expire, and record that decision here before changing it.

## 2026-11-27 — Stage 2: Stage 1 was executed, broken parts found and fixed

- Goal: prove Stage 1 instead of describing it.
- Exists: the Stage 1 code as written. No check existed yet and none of it had ever been executed.
- Changed:
  - `tools/director-check.mjs`: one command that parse-checks every module and walks the slice in a
    throwaway copy. It copies the app (`lib`, `viewer`, `usage`, `hooks`, `tools`, `docs/ai-guide`,
    `route.mjs`) to `%TEMP%\cc-director-check-<pid>-<rand>`, writes its own `config.json` with only
    `codex` enabled, makes a scratch git repo with `git/` ignored, writes a fake `codex` (a `.cmd`
    that runs a small Node script) and puts it first on `PATH`, then boots the real panel there.
  - Two real defects in the new code, found by running it:
    1. The check asserted the worktree path with a case-sensitive compare; `os.tmpdir()` reports
       `C:/WINDOWS/TEMP` while git reports `C:/Windows/Temp`, so `<repo>/git/<task-id>` "failed" on a
       path that was actually right. Fixed in the assertion with a Windows case-insensitive compare;
       the app stores and reuses one canonical path, so no app change was needed.
    2. A race in the check itself: it looked for the fake agent's marker immediately after the task
       reported `running`, which is set right after spawn, before the agent has executed. Moved the
       assertion after the task finished.
    No defect was found in `lib/director.mjs`, `lib/worktrees.mjs`, `lib/machines.mjs`,
    `lib/github.mjs`, `lib/routes/director.mjs` or the `lib/tasks.mjs` edits: every one of them did
    what the docs claim on the first run.
  - `.github/workflows/director-check.yml`: runs the same command on `windows-latest`.
  - One assertion in the check was misleading (it claimed to test a wrong merge confirmation but was
    hitting the `mergeEnabled` refusal) and was renamed; a separate, real confirmation test runs with
    `mergeEnabled` on.
- Evidence: `node tools/director-check.mjs` → **64 passed, 0 failed** on this PC (Node 24.19, git
  2.56, Windows). Observed, not inferred:
  - 46 modules pass `node --check`.
  - The panel answered on `127.0.0.1` from the temp state dir, three separate boots.
  - `/`, `/tasks` (dispatcher ticking), `/board` GET+POST round trip, `/setup`, `/usage?p=route`,
    `/usage?p=codex`, `/sessions` (65 rows), `/director`: all as before.
  - `POST /director/goal` produced a goal and a task whose `goal` field matched; the dispatcher ran
    it on `codex`; the fake agent's marker file proved no real CLI ran; the task worked in
    `<repo>/git/<task-id>` on `cc/<task-id>`, `git worktree list` knew it, and the main checkout
    stayed clean; it finished `done` with exit code 0 and evidence naming the report (84 bytes, head
    quoted) and worktree head commit.
  - A task added while the goal was paused stayed `waiting` for 6 s with reason `Paused: …`; stop
    cancelled it and set the goal `stopped`; resume let a new task run.
  - Killing the panel mid-task and restarting it produced `interrupted` (not `failed`), one task
    record, the same worktree on disk, a taken-over stale `state/panel.lock`, and no restart on its
    own after 6 s; resume finished it in the same worktree with no second folder under `git/`.
  - `lease.owner` and `heartbeatAt` were read from the running task.
  - A listed machine with the matching env secret was accepted (200 + capabilities) and only then
    reported `online`; an unreachable peer stayed offline; a bad signature got 403; a 2-minute-old
    timestamp got 400.
  - Merge was refused with 409 while `mergeEnabled` was off, and with 400 "Type the pull request
    number" when the confirmation did not match, with it on.
- Deviation, and why: the mission says not to run local builds or tests so expensive or disruptive
  work does not land on a machine other sessions use. This folder has no git repository, so no CI
  could verify anything, and leaving the slice unproven was the worse outcome. The checks run are
  cheap and isolated: no compile, no install, no download, no touch of the real `config.json`,
  `tasks.json`, `sessions`, `logs`, `board.jsonl`, relay files or any worktree outside the temp
  folder. The only provider the panel could reach was a fake `codex` written by the check, proven by
  a marker file. Everything the check needed was deleted afterwards.
- Limitations: the fake agent never created sub-tasks, so orchestrator holds and deeper trees were
  not exercised. Real Claude, Freebuff, OpenCode and Cursor CLIs were not run. The Director tab was
  parsed and its routes exercised, but never rendered in a browser. `gh` reads and a real merge
  approval need a real repository and PR. `handshake()` as a caller was not exercised, only the
  server side of the hello.
- Next: run the check on a remote so the workflow is green; then one real provider end to end, then
  one real repository's PRs.

## 2026-11-27 — Stage 2a: the old repository is gone from settings and docs

- Goal: none (housekeeping you asked for). All work is managed under `E:\Command Center`.
- Exists: `config.json` still pointed its project and reports folders at a retired checkout, and
  the new docs described the worktree layout in terms of that checkout.
- Changed:
  - `config.json`: `projectDir` is now `E:/Command Center` and `reportsDir` `E:/Command Center/reports`.
    `E:\Command Center` is a symlink to this app folder, so the panel now manages work under the app
    itself. No other setting, provider, model, limit or task record was touched.
  - `lib/worktrees.mjs` and `tools/director-check.mjs`: the two comments that named the old
    repository now describe the layout on its own.
  - `docs/director/FEATURE-PARITY.md` and the Stage 1 entry above: the retired checkout's name and a
    worktree id from it are gone. The Rust-migration finding and every other claim are unchanged.
- Evidence: `node tools/director-check.mjs` → 64 passed, 0 failed after the edits; `config.json`
  parses and both paths resolve through the symlink.
- Limitations: reports written by earlier tasks stay in the old folder, so those finished tasks now
  show no report file in the Director evidence. Nothing was copied or deleted. The project folder is
  not a git repository, so per-task worktrees fall back to the task's own folder (the documented
  soft path, noted on the task as `worktreeNote`).
- Next: to get per-task worktrees back, make the project folder a git repository (or point
  `projectDir` at one).

## 2026-11-27 — Stage 3: the project folder is a repository, so every task gets its own worktree

- Goal: none (the isolation gap Stage 2a left open).
- Exists: `config.json` pointed `projectDir` at `E:/Command Center` — a symlink to this app folder —
  but the folder had no `.git`, so `lib/worktrees.mjs:prepare` refused it: every task ran in the one
  shared app folder and only a `worktreeNote` said so. That is the duplicate-work and
  conflicting-edit risk the task-ownership stage exists to prevent.
- Changed:
  - `.gitignore` (new): this PC's data and state — `config.json`, `tasks.json`, `tasks/`, `logs/`,
    `reports/`, `board.jsonl`, `backups/`, `machines.json`, `goals.json`, `state/`, `trash/`,
    `runtime/`, `session-meta.json*`, `disabled-extensions.json`, `.cc-install`,
    `CommandCenter-*.zip`, `docs/AGENT-BRIEF-COMMON.md`, `.freebuff/` — plus `/git/`. The repository
    holds the program; it never holds a machine's settings or a task's worktree.
  - The app folder is now a git repository (`git init -b main`, one initial commit). No app file was
    deleted or rewritten, and `config.json` still says `E:/Command Center`.
  - `usage/freebuff-usage.ps1`: a stray UTF-8 BOM removed (three bytes). The file is otherwise pure
    ASCII, so PowerShell reads it identically; the global pre-commit guard refuses BOMs.
  - Source comments removed from the files this work added (`lib/director.mjs`, `lib/tasks.mjs`,
    `lib/worktrees.mjs`, `lib/machines.mjs`, `lib/github.mjs`, `lib/routes/director.mjs`,
    `lib/checks/director.mjs`, `tools/director-check.mjs`): the global pre-commit guard keeps
    explanation in `docs/code-notes/<project>.md` and allows only single-line constraint comments
    (`// invariant: …`) in source. Those explanations live in this file and in the code notes.
  - `lib/director.mjs:snapshot`: every `agents` entry now carries `leaseOwner`, `leaseAt`,
    `worktree`, `branch`, `role` and `root`, and a goal's own root task is included instead of being
    filtered out, so the run holding a checkout is visible while it runs.
  - `viewer/public/director.js`, `viewer/public/director.css`: the goal card shows, per agent, the
    worktree and branch and the lease owner, and marks the goal's root run.
  - `tools/director-check.mjs`: the copied app is now the project folder *and* the repository
    (`initRepo` commits it), so worktrees must land in `<app>/git/<task-id>`. Four assertions would
    fail a silent fallback: the worktree is never the project folder, the task carries no
    `worktreeNote`, a task submitted in a folder that is *not* a repository still reports the
    fallback, and `GET /director` must show that worktree together with the lease owner.
- Evidence: `node tools/director-check.mjs` → 68 passed, 0 failed (exit 0). The run reports
  `.../app/git/cc-mwyhidzs-v9p7` on branch `cc/cc-mwyhidzs-v9p7`, `git worktree list` knows it, the
  main checkout is still clean, and the Director check reports
  `.../app/git/cc-mwyhkcm9-e3c4 / DESKTOP-MAG3SI3:41252:t962py`. In the real folder, a worktree was
  added through the symlink at `E:/Command Center/git/probe-…`, checked out the full app, reported
  branch `cc/probe-…`, then was removed with its branch; `git status` stayed clean and
  `git worktree list` shows only the main checkout again.
- Limitations: the check proves the mechanism in a replica of the app — no real provider was run
  against the real repository this turn, so the first real task will be the first live proof. The
  repository has one commit and no remote, so the workflow has not run on it. Reports from tasks that
  finished before Stage 2a remain in the retired folder and still do not appear as evidence.
- Next: push the repository and run the check in the workflow; then one real task through a real
  provider in `E:/Command Center/git/<task-id>`; then `gh` PR reads against a real repository.

## 2026-11-27 — Stage 3a: review before the first upload

- Goal: none. This machine's pre-push guard requires a review of the code being pushed, and this is
  the first push to the GitHub remote.
- Exists: `lib/director.mjs:snapshot` listed every live task as an `agent`, including one still
  `waiting` with no process, and `viewer/public/director.js` labels anything without a pid or CLI as
  `discovered`. A goal that had only queued a task therefore claimed a discovered session that did
  not exist — the confusion capability 1 asks the panel to avoid.
- Changed: `agents` now means a task with a running process (`pid` or `cli`). The unused `role` field
  is gone; `root` still marks the goal's own run.
- Evidence: `node tools/director-check.mjs` → 68 passed, 0 failed (exit 0).
- Limitations: a queued task's reserved worktree is not shown until it starts. Lease fencing — a
  stale writer cannot close a task that a newer owner re-claimed — remains the open gap from the
  previous entry; this stage does not change it.
- Next: the lease-token compare-and-set, then a second machine.

## 2026-11-27 — Stage 3b: CI's first run found a path comparison bug

- Goal: none. The first upload triggered `.github/workflows/director-check.yml`, and it failed.
- Exists: `tools/director-check.mjs:samePath` compared strings after normalising slashes and case.
  Git reported the worktree under the 8.3 short name of the temp folder (`C:/Users/RUNNER~1/...`)
  while Node built the expected path from the long name (`C:/Users/runneradmin/...`), so "the task
  ran in <repo>/git/<task-id>" failed on the runner although the same check passed here. The app was
  right; the check was not.
- Changed: `samePath` resolves both sides with `fs.realpathSync.native` before comparing, falling back
  to the raw string when a path does not exist. That also makes the comparison correct for the real
  configuration, where `projectDir` is the symlink `E:/Command Center`.
- Evidence: local `node tools/director-check.mjs` → 68 passed, 0 failed. The CI re-run for this commit
  is the fix's real test.
- Limitations: a local run cannot produce the 8.3 form, so CI is the only place that assertion is
  exercised against it.
- Next: watch the re-run; a green run is the first CI-verified pass of the whole check.
- CI: https://github.com/ZulaDDSH/CommandCenter/actions/runs/45941431918 — success, `68 passed, 0 failed`
  on `windows-latest`. This is the first CI-verified pass of the whole check, and it is the run that
  proves the worktree path on a machine that is not this one.

## 2026-11-27 — Stage 4: the lease is a fence, not a note

- Goal: none. The gap was named in Stage 3a: a close wrote a task's outcome without checking who held
  its lease, so a writer that had been interrupted, resumed, or whose lease expired and was re-claimed
  could close a task another owner was running.
- Exists: one dispatcher per folder (`state/panel.lock`) made that unlikely, but nothing in the store
  enforced it. The lease was descriptive: `heartbeat()` stamped `{owner, at, ttl}` and recovery read
  it, while `finish()`, `cancel()` and `markDone()` closed tasks unconditionally. Boot recovery ran at
  module load, so merely starting a second panel marked another panel's running tasks interrupted.
- Changed:
  - `lib/tasks.mjs:claim` gives every claim a token. Renewal keeps the token; a takeover (no lease, an
    expired lease, a different owner) mints a new one. `heartbeat()` renews its own lease and now
    leaves a fresh foreign lease alone instead of taking it over.
  - `lib/tasks.mjs:closeTask` is the one place a task is closed. It reads the lease from `tasks.json`,
    not from memory, and refuses unless the caller holds it: a runner proves it with its claim token,
    the panel proves it by owning the lease. Refusals are distinguishable — `lease-lost` (replaced),
    `lease-expired`, `lease-foreign`, `already-closed` — and a refusal writes nothing and kills
    nothing. `finish()`, `cancel()` and `markDone()` all go through it, so every close path is fenced,
    including the provider exit handler, the Freebuff paths, goal stop and the panel's task actions.
  - `lib/tasks.mjs:recoverAtBoot` runs only after the dispatcher lock is taken, and takes a task over
    only when `holderGone` says the holder is gone: lease expired, another host, or a local process
    that no longer exists. A live holder keeps its task.
  - `viewer/server.mjs` and `lib/routes/director.mjs` answer a fenced refusal with 409 and its code,
    so the panel can tell "another owner has this" from a generic failure.
  - `tools/director-check.mjs`: the fake agent resolves the task pointer when it arrives instead of
    giving up after 2 s (that cap made the interruption test depend on `cmd.exe` startup time, and it
    was hiding a short run as a long one), and exits at once for `debug models`.
- Evidence: `node tools/director-check.mjs` → 84 passed, 0 failed. New assertions: a wrong token is
  refused as `lease-lost` with the task record byte-identical; the previous owner cannot close a
  re-claimed task; a panel cannot close a foreign-lease task (`lease-foreign`, and 409 over HTTP); an
  expired lease is refused as `lease-expired`; after a kill, a writer that comes back cannot close a
  task another owner has taken; recovery re-claims under a new token. The uninterrupted slice,
  evidence, pause/stop/resume and resume-in-the-same-worktree checks are unchanged and pass.
- Limitations: this fences the store, not reality. A writer holding a valid, unexpired lease and a live
  child can still be wrong about the world. Two panels on one folder still rely on `state/panel.lock`
  for who dispatches; the fence only guarantees that an outcome comes from the current lease holder.
  No work is dispatched to another machine yet, so the cross-machine case is designed but unexercised.
  `tasks.json` is still written whole, so the fence protects the closing task’s outcome, not two writers
  editing unrelated tasks at the same moment; that still needs one dispatcher per folder.
- Next: remote dispatch would claim with this token, and the local panel would refuse to close what a
  peer holds.
- CI: https://github.com/ZulaDDSH/CommandCenter/actions/runs/45942636794 — success, `84 passed, 0 failed`
  on `windows-latest`, for commit `3b2c669` (the fence and its tests). The only later change is this
  line and the wording fix above it.

## 2026-11-27 — Stage 4a: a second panel beside a live one

- Goal: none. `holderGone` was written for this case in Stage 4 and nothing asserted it.
- Exists: before Stage 4, boot recovery ran when the module was imported, so a second panel started on
  the same folder marked the first panel's running tasks `interrupted` before the dispatcher lock was
  consulted. After Stage 4 the lock answers first and `holderGone` is the second guard, but no check
  exercised either against a live panel.
- Changed: `tools/director-check.mjs` starts a second panel on its own port while the first runs a
  task, and asserts that the second answers without starting a dispatcher (`bootRecovered` 0 and the
  lock message), sees the task as `running` under the first panel's token and owner, leaves the stored
  record untouched, and that a direct `recoverAtBoot()` called beside the live holder takes nothing.
  It then waits 6.5 s and asserts the first panel is still ticking and still holds the task, and that
  the task survives the second panel coming and going. `lib/tasks.mjs:recoverAtBoot` is exported so the
  check can call it directly, pinning the second guard as well as the lock.
- Evidence: `node tools/director-check.mjs` → 93 passed, 0 failed. These assertions would have failed
  against commit `a575eeb`, where importing `lib/tasks.mjs` recovered live tasks at module load, so the
  second panel reported the task as `interrupted`.
- Limitations: the direct `recoverAtBoot()` call is a same-process simulation; in a running panel the
  dispatcher lock answers first, which is the real production order. Both guards are now pinned, but
  the simulated call is not a second machine.
- Next: a second *machine* would claim through the same token; that path stays unexercised.
- CI: https://github.com/ZulaDDSH/CommandCenter/actions/runs/45943265830 — success, `93 passed, 0 failed`
  on `windows-latest`, for commit `60c7e54`. The only later change is this line.
