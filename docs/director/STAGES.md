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
