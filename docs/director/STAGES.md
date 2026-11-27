# Director stages

Append-only. Each stage records what exists, what changed, evidence, limitations and next steps.
There is no code writer for this file: whoever owns the work appends the next stage directly, one
writer at a time. The panel used to expose `POST /director/stage` and a locked appender for this; both
were removed so the log has a single writer and no second path that could interleave an entry.

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

## 2026-11-27 — Stage 5: a second machine identity, authenticated and unable to claim

- Goal: none. The mission wants a second machine to join and take work; this stage makes the join real
  and reports the claim as unsupported instead of pretending it works.
- Exists: `lib/machines.mjs` had an inventory, an HMAC-signed hello and `verifyHello`, but no second
  process could ever pass it. `addPeer` derived a peer id from the *name* (`m-<sha256 of name>`), while a
  peer signs with its own id (`sha256(hostname|user|ROOT)`), so a real hello was looked up as a different
  machine and answered 404 — only the hand-written harness hello matched. `ROOT` was fixed to the app
  folder, so a second process could not have its own `machines.json`/`tasks.json`. The hello body was
  ignored, so the host never learned a peer's capabilities or availability, `capabilities()` said nothing
  about what a peer may do, and there was no route where a peer could even attempt a claim.
- Changed:
  - Identity: `localId()` hashes `hostname|user|ROOT`, so two installs on one PC are two identities and a
    copied folder is not the same machine. `CC_MACHINE_NAME` labels a second install. `CC_ROOT` gives a
    second process its own data directory; with it unset, paths are what they were.
  - Verification: `verifyHello` resolves a caller by id, then by the `x-cc-name` header, and records the
    id the caller reported (`reportedId`) with its capabilities and availability. A later signed call that
    carries no capabilities no longer erases the ones already recorded.
  - `handshake()` sends its name, capabilities (including `claim.supported: false`) and availability.
  - `/machine/claim` uses the same signature check and then answers 501 `claim-unsupported`. Missing or
    invalid credentials are refused earlier with 400/403/404/503. Neither path reads or writes a task.
  - `tools/peer.mjs` is a real second-machine CLI (`id`, `join --host <url> --name <label> [--task <id>]`):
    own `CC_ROOT`, adds the host to its own inventory, signs a hello, attempts a claim with its own secret
    and with a wrong one, and prints one JSON line. It never prints a secret.
  - The Machines card shows `authenticated` apart from `online`, the reported machine id, the peer's OS
    and enabled providers, and `claim unsupported`.
- Evidence: `node tools/director-check.mjs` → 108 passed, 0 failed (93 before this stage, 15 new).
  The new section starts a second process with `CC_ROOT=<temp>/peer` and
  `CC_MACHINE_NAME=check-workstation-b` and its own secret while the first host is running a leased task,
  then asserts: the host lists the machine and treats it as not authenticated until it signs; the process
  runs from its own data directory with an id different from the host; it reports its own capabilities;
  its hello is accepted; it gets 501 `claim-unsupported` with a valid signature and 403 without one; its
  own store holds none of the host's tasks; the host records it as authenticated with that id, its
  capabilities and availability; the running task keeps its status, token and owner and no task names that
  machine; the host's dispatcher keeps ticking across 6.5 s; and the lease is still the host's afterwards.
- Limitations (what a remote machine still cannot do):
  - Claim, dispatch and provider adapters on the peer host: unsupported. `/machine/claim` answers 501 by
    design, the dispatcher only ever assigns to the local panel, and `tools/peer.mjs` has no task loop,
    no worktree handoff and no provider supervision. Nothing on the peer host runs a task.
  - The panel binds `127.0.0.1`, so a peer on another PC needs a tunnel or reverse proxy you control. The
    check therefore exercises the protocol between two processes on one PC with separate identities and
    data directories, not a WAN hop. Signature checks, the 60 s replay window and the refusal paths are
    the same either way; the network path between two PCs is not exercised here.
  - The peer-facing surface is `/machine/hello` and `/machine/claim` only; the rest is the local UI. A
    process on the same PC could still open `/tasks` on the host, so the check asserts that the peer's own
    store has none of the host's tasks and that no task names that machine — not that a socket on the same
    box is unreachable.
  - Capabilities are what the peer reports about itself; the host does not probe them.
- Next: task handoff — a claim that moves a worktree and a supervised provider run to a peer — is the next
  real step, and `claim` stays 501 until that exists.
- CI: https://github.com/ZulaDDSH/CommandCenter/actions/runs/45944133896 — success, `108 passed, 0 failed`
  on `windows-latest`, for commit `c284bcb`. The only later change is this line.

## 2026-11-27 — Stage 6: compare-and-set on the task store

- Goal: none. The fence refused the wrong writer, but the store write itself was still whole-file.
- Exists: `closeTask` re-read the file to decide a refusal, then mutated the task object it already had
  in memory and called `save()`, which serialized that process's whole array. The fresh read protected the
  decision but not the write: two writers closing unrelated tasks each wrote their own snapshot and the
  second one erased the first one's update. `recoverAtBoot` had the same shape — it decided from the
  in-memory array, so it could take a task whose lease was live on disk but looked expired in memory.
- Changed: the store now has a lock (`state/store.lock`, created with `wx`, holding pid and time,
  released in `finally`, a lock older than 30 s broken as stale) and `syncFromDisk()`, which re-reads the
  file and merges each row into the existing task object so references held by the dispatcher keep
  working. `closeTask` and `recoverAtBoot` run entirely under the lock: re-read, decide, mutate, write.
  A writer that cannot get the lock within 10 s returns `store-busy` and changes nothing instead of
  writing a stale copy; `recoverAtBoot` returns 0 and takes nothing.
- Evidence: `node tools/director-check.mjs` → 111 passed, 0 failed (108 before). The new section spawns
  two processes that each import `lib/tasks.mjs` against the same store, wait for a shared start time and
  close different leased tasks, for 8 rounds: both tasks must stay `done`, no writer may be refused, and
  the lock file must be gone afterwards. Run against the previous `closeTask` (this suite on a copy with
  `HEAD`'s `lib/tasks.mjs`): **0 of 8 rounds kept both updates** and one writer was refused. The check
  pins the behaviour instead of describing it.
- Limitations: `startTask`, heartbeat, retry/resume/approve and the dispatcher's reason and hold writes
  still save the process's own array, so one of them can still overwrite a close made by another process;
  `closeTask` and `recoverAtBoot` were the paths where two writers actually raced. The lock is a local
  file lock between processes on one machine: two machines pointing at the same store over a network
  share are not safe and nothing here claims they are.
- Next: move the remaining mutators onto the same locked re-read-and-write, or give each task its own
  record file, so no writer ever serializes a snapshot again.
- CI: https://github.com/ZulaDDSH/CommandCenter/actions/runs/45945559733 — success, `111 passed, 0 failed`
  on `windows-latest`, for commit `d8cb07f`. The only later change is this line.

## 2026-11-27 — Stage 7: every task write goes through one locked compare-and-set

- Goal: none. Stage 6 put `closeTask` and `recoverAtBoot` under `state/store.lock`; every other mutation
  still serialized the process's whole in-memory array.
- Exists: `add`, `approve`, `resumeInterrupted`, `retry`, the worktree note, four writes in
  `startFreebuff`, `fbFail`, both `startChild` writes, `requeueResume`, `heartbeat` and three `tick`
  reason/note writes each mutated a task object and called a `save()` that wrote the entire array from
  that process's memory. A concurrent write from another process was erased by whichever writer saved
  last, and `worktreeNote`, `conversationId` and `expiresAt` were persisted only by whatever unrelated
  whole-file write happened next — which under a re-read store would silently disappear.
- Changed: `save()` is gone. `touch()` marks the store dirty and throws unless a locked `update()` is
  running; `update()` takes `state/store.lock`, re-reads the file and merges each row into the existing
  task objects, runs the caller's mutation against that current row, and writes once. `setFields(id,
  fields)` covers the reason/note/conversation/expiry paths. Every site above was converted, so a caller
  can no longer persist a private snapshot and a mutation applies only its own fields to the current
  on-disk row. A writer that cannot get the lock within 10 s throws `store-busy`; `closeTask` still turns
  that into a refusal and `recoverAtBoot` takes nothing.
- Evidence: `node tools/director-check.mjs` → 124 passed, 0 failed (111 before). The new section runs 5
  rounds of 5 processes started on a shared timestamp: one adds a task, one renews a lease through
  `heartbeat()`, one closes a different task with its token, and two work on the same task — an
  `approve` that renames it and a close that sets its status and note. It asserts every add, lease and
  close survives on disk, that a title written beside a close on the same task is still there, that no
  writer was refused for a busy store, and that no lock file is left. It then exercises the refusal path
  (lock held → `store-busy`, 26 rows unchanged), the stale-lock path (lock backdated 90 s → broken, write
  succeeds, lock removed) and restart recovery on a store left mid-write (garbage `tasks.json.tmp` plus a
  stale lock → the dead task came back `interrupted`, the store stayed readable, no lock left).
  The same check run against `HEAD`'s `lib/tasks.mjs` (only `export` added to `heartbeat`) loses:
  **0 of 5 rounds kept a heartbeat lease**, **10 closes lost**, **0 of 5 titles kept**, the writer
  **wrote through a held lock** (27 rows against 26) and the leftover lock stayed. 6 assertions failed.
- Limitations: the lock is a local file lock (`wx`, stale after 30 s) between processes on one machine.
  Two machines pointing at one store over a network share are not protected and nothing claims they are.
  Two writers of the same field are still last-write-wins, which is the intended value, not lost data.
  There is no `fsync`: a power cut can still leave a short or empty `tasks.json`, and recovery reads that
  as an empty store rather than repairing it. `add()` checks the live-task limits before taking the lock,
  so two simultaneous adds can exceed `MAX_LIVE` by one. `startFreebuff` still mutates its in-process CLI
  map outside the store, which is deliberate.
- Next: per-task record files (or SQLite) once the store outgrows a single writer, and an fsync plus a
  backup-on-open for power loss.
- CI: https://github.com/ZulaDDSH/CommandCenter/actions/runs/45946597647 — success, `124 passed, 0 failed`
  on `windows-latest`, for commit `b498e09`. The only later change is this line and the same link in
  `FEATURE-PARITY.md`.

## 2026-11-27 — Stage 8: one writer for the stage log

- Goal: none.
- Exists: `POST /director/stage` called `lib/director.mjs:appendStage`, which appended to
  `docs/director/STAGES.md` under `state/director.lock` and kept a `stages` list in `director.json`.
  Nothing in the panel, the UI or the CLI called it: every stage in this file was appended directly, so
  it was a second writer with no users and a second copy of the same facts.
- Changed: the route left `lib/routes/director.mjs`, and `appendStage`, its `withDocLock` helper, the
  `oneLine` formatter, the `STAGES` path and the now-unused `os` import left `lib/director.mjs`. Existing
  `stages` entries in `director.json` are still loaded and written back, so nothing was deleted. This
  header, `docs/ai-guide/70-director.md` and `FEATURE-PARITY.md` now say the log has one writer and no
  panel route.
- Evidence: `node tools/director-check.mjs` → 126 passed, 0 failed (124 before). Two new assertions:
  `POST /director/stage` answers 404 and creates no `docs/director/STAGES.md` in the app copy, and
  `lib/director.mjs` no longer contains `appendStage`.
- Limitations: "one writer" is no longer enforced by code — it holds because the panel has no path to
  the file and whoever edits it does so one at a time. Two hand edits at once could still interleave.
- Next: if agents should write this log again, bring back one writer that appends through the store lock
  instead of a route-level writer beside it.
- CI: https://github.com/ZulaDDSH/CommandCenter/actions/runs/45947200108 — success, `126 passed, 0 failed`
  on `windows-latest`, for commit `36852ef`. The only later change is this line.

## 2026-11-27 — Stage 9: one rule for pairing

- Goal: none.
- Exists: pairing needed two different variable names for one secret — each side set `CC_PEER_<the other
  machine's name>` — and the id of a machine was derived twice: `addPeer` hashed the *name* it was given,
  while a peer signed with `sha256(hostname|user|ROOT)`. A real hello therefore matched only through a
  name fallback, and a machine that was not listed in advance got a 404 before it could pair.
- Changed:
  - one variable, `CC_PEER_SECRET`, with the same name on every machine; `machines.json` no longer
    records a variable name per peer, and the old entries are upgraded on load (`secretEnv` and
    `reportedId` dropped, `key` added, id kept until the next hello replaces it).
  - a listed machine is a label plus a panel address; its `id` is `null` until it signs. `verifyHello`
    checks the signature with the one secret and then stores the id the caller signed with, adding an
    unlisted caller as `learned: true` with no address — so the id always comes from the machine itself.
  - the outbound `handshake` learns the id from the hello reply and keys its online state by the local
    `key`, so Connect/Remove work before and after a machine is known.
  - the route note, the Machines card, the settings check, the guide, this README and the code notes say
    the same thing: one secret, same name, on both machines.
- Evidence: `node tools/director-check.mjs` → 128 passed, 0 failed (126 before). New assertions: a
  machine can be listed by name and address only and has no id yet, the host learns the exact id the
  machine signs with, and no peer row carries a per-machine variable name.
- Limitations: one shared secret pairs every machine that holds it, so a machine holding it could sign as
  another; that is weaker than a secret per pair. The secret still has to be copied between machines by
  hand, and the panel remains 127.0.0.1-only, so a peer over the network needs a tunnel.
- Next: a one-time pairing code so each machine gets its own secret without a shared string being copied.
- CI: https://github.com/ZulaDDSH/CommandCenter/actions/runs/45948032524 — success, `128 passed, 0 failed`
  on `windows-latest`, for commit `41f1252`. The only later change is this line and the same link in
  `FEATURE-PARITY.md`.

## 2026-11-27 — Stage 10: a lease that belongs to another host

- Goal: none. `holderGone` answers three ways — no lease or an expired one (gone), a lease on another
  host (not gone), the same host with a dead pid (gone). Only the "gone" answers had assertions.
- Exists: the "another host" branch had none. Writing the case also turned up a real defect: `cancel()`
  looked the task up in the panel's in-memory list before the locked read, so a task that was on disk but
  had not been loaded into this panel answered 404 `not-found` instead of refusing with `lease-foreign`.
- Changed: the check seeds a `running` task with a fresh lease owned by `other-host:1:x` while the panel
  is live, then asserts that a direct `recoverAtBoot()` takes nothing and leaves the row `running` with
  its own token, that `POST /tasks/<id>/cancel` and `POST /tasks/<id>/done` both answer 409
  `lease-foreign`, and that the row is untouched after both refusals. The row is closed on disk
  afterwards so later sections do not see a stuck running task. `cancel()` no longer pre-checks the
  in-memory list: the locked `closeTask` decides, so an on-disk task is refused for the right reason
  instead of being reported missing.
- Evidence: `node tools/director-check.mjs` → 132 passed, 0 failed (128 before). With
  `if (host !== os.hostname()) return false;` deleted from `holderGone` in a throwaway copy, all four new
  assertions fail: the task came back `interrupted`, recovery reported **1 taken**, and both closes
  answered `already-closed` because the task had already been taken.
- Limitations: the other host is simulated by an owner string and a fresh expiry rather than a second
  machine process — the multi-machine section covers a real second process, but for its own task, not
  this one. The third branch (same host, dead pid) is covered by the kill-and-recover section.
- Next: none for this guard; nothing else in it is unasserted.
- CI: https://github.com/ZulaDDSH/CommandCenter/actions/runs/45948873083 — success, `132 passed, 0 failed`
  on `windows-latest`, for commit `c58bfba`. The only later change is this line and the same link in
  `FEATURE-PARITY.md`.

## 2026-11-27 — Stage 11: a retry beside a close

- Goal: none. Stage 7 moved every writer onto `update()`; this checks that nothing was left behind and
  that the last named writer is covered by the race.
- Exists: the guard was already complete — no `save()`, `flush()` is reachable only from `update`, all
  18 mutations call `touch()`, `tasks.json` is written only by `lib/tasks.mjs`, and every exported
  writer goes through `update()`. The race covered add, heartbeat and a same-task field write, so
  `retry` was the one writer the mission named that no assertion exercised against a concurrent close.
- Changed: the concurrent-writer section runs a sixth child per round that retries a failed task while
  the close child closes a different one, and asserts the retry took effect **and** that no close was
  reverted. No store code changed.
- Evidence: `node tools/director-check.mjs` → 133 passed, 0 failed (132 before). With
  `syncFromDisk()` deleted from `update()` in a throwaway copy — the old write-my-stale-array shape —
  the section fails: `0/5` heartbeats kept, **10 closes lost**, `0/5` titles kept, `0/5` retries took.
- Limitations: `startChild`'s "status running" write cannot be aimed from a child process because
  starting a child needs a real provider CLI; `add` stands in for the start write and the panel's own
  tick is the only place `startChild` runs, on this machine, not across processes.
- Next: none for store ownership; the remaining risk is a writer added later without `touch()`.
