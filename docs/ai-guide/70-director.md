# Director: goals, machines, pull requests

The director sits on top of the task queue. A **goal** is what you want; tasks are how it gets done.
Nothing here starts work on its own: the same 5 s dispatcher does, and every task still obeys the
provider limits in Setup.

## Goals

| Method and path | What it does |
|---|---|
| `GET /director` | Goals with stage, counts, assigned agents, limits, blockers, "needs you", evidence, plus machines, open PRs and the dispatcher state. |
| `POST /director/goal` | Add a goal: `{title, text, priority, projectDir, limits:{maxLive, maxTasks, taskMinutes}}`. It creates the goal and its first task (the orchestrator task in Orchestrated mode). |
| `POST /director/goal/<id>/pause` | Stop dispatching the goal's waiting tasks. Running work is left alone. |
| `POST /director/goal/<id>/resume` | Let the goal dispatch again. |
| `POST /director/goal/<id>/stop` | Cancel the goal's live tasks, keep everything finished. |
| `POST /director/goal/<id>/steer` | `{text}` Save a note and add it as a task: a child of the live root task, or a fresh root task if the old one finished. |
| `POST /director/goal/<id>/done` | Mark the goal done without cancelling anything. |
| `POST /director/task/<id>/resume` | Restart a task left `interrupted` by a panel restart. |

A task belongs to a goal when it, or a parent above it, carries `goal`. Sub-tasks an orchestrator
adds by hand inherit the goal through their parent, so limits apply without the orchestrator knowing
about them.

`dependsOn: ["<task id>", ...]` on `POST /tasks` holds a task until each named task is `done`.

## What the statuses mean

- `waiting` — the dispatcher has not started it; `reason` says why.
- `starting`, `running` — a process exists that the panel owns, so it can be stopped.
- `done` — the report file appeared (Freebuff) or the CLI exited 0.
- `failed` — the run ended badly; `note` says how.
- `interrupted` — the panel restarted while it ran. Nothing restarts on its own; a person resumes it.

A session found on disk is **not** a running agent. `/director` lists those under `discovered` with
`controllable: false`; only a task with a process the panel started is shown as controllable.

## Evidence, not claims

For each finished task the director reports the report file (path, size, first lines), the process
exit code, and the task worktree's head commit and uncommitted file count. A passing CI check is not
counted as real-data or in-game verification; those stay unknown.

## Worktrees

With `taskWorktrees` on (the default) a task that runs inside a git repository gets its own worktree
at `<repo>/git/<task-id>` on branch `cc/<task-id>`. The folder is never reused if this task did not
create it, and nothing deletes another owner's worktree.

## Machines

| Method and path | What it does |
|---|---|
| `GET /director/machines` | This machine's real capabilities and every listed peer with its honest status. |
| `POST /director/machines/add` | `{name, url}` adds a peer. It also names the environment variable that must hold its secret. |
| `POST /director/machines/check` | `{id}` makes one signed `POST <url>/machine/hello`. Online only on a real answer. |
| `POST /director/machines/remove`, `/enable` | Change the local inventory only. |
| `POST /machine/hello` | The other half: verifies an HMAC signature with `CC_PEER_SECRET` over peer id and timestamp within 60 s, records the caller under the id it signed with (adding it as `learned` if it is not listed), then returns this machine's capabilities. |

Pairing is one rule: the same secret in `CC_PEER_SECRET` on both machines, then on the other machine
`node tools/peer.mjs join --host <this panel's url> --name <the label it has here>`. The secret never
appears in a file or a request body — it is only the HMAC key — and the host records the id the other
machine signed with, so no id is derived from a name and there is no variable per machine.
`machines.json` holds a label, the panel address and that reported id; a machine that signs in without
being listed is added with `learned: true` and no address. The panel still listens on 127.0.0.1 only, so
a peer reaches it through a tunnel you control.

## Pull requests

| Method and path | What it does |
|---|---|
| `GET /director/github` | Open PRs from `gh`: number, title, head branch and commit, review decision, per-check CI counts, link, updated time. `?fresh=1` skips the 60 s cache. |
| `POST /director/merge-approval` | `{number, repo, reason}` records your approval for **that head commit only**. It never merges. |
| `POST /director/merge` | `{number, repo, confirm:<the number>}` merges only when `mergeEnabled` is on, the approval matches the current head commit, CI is not failing or running, no review requested changes, it is not a draft, and GitHub says it is mergeable. |

## Safety rules that are not negotiable

1. Never merge without an approval recorded for that exact commit.
2. Never bypass a hook, a repository rule or a review bot.
3. Never delete or rewrite another session's worktree, task or notes.
4. Never post to another person or another agent's session.
5. Never create a second pull request for work that already has one.
6. Real-data validation belongs in the weekly suite, not in a quick check.

## Recording a stage

`docs/director/STAGES.md` is append-only and has no panel route: whoever owns the work appends the next
stage directly, one writer at a time. `POST /director/stage` and its locked appender were removed, so a
running panel cannot write the log and the call answers 404.
