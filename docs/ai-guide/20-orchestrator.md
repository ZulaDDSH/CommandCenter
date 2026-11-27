# Orchestrator and sub-agents

Two modes, set in the Orchestrator tab (`orchestrator.mode` in config).

- **Simple.** A new task is routed to one provider by the panel (today's smart routing).
- **Orchestrated.** A new task first goes to an orchestrator on the picked provider and model. It plans, adds sub-tasks, waits for them, checks the reports, may add fix tasks, and writes one final report. A task that names a provider, sets `direct`, or has a `parent` skips the orchestrator.

## Add a task or a sub-task

`POST /tasks` JSON body (only `text` or `prompt` is needed):

| Field | Meaning |
|---|---|
| `title` | Short name shown in the table. |
| `prompt` or `text` | What the worker must do. |
| `provider` | `freebuff`, `codex`, `cursor`, `opencode` or `claude`. Leave out for the panel to pick. |
| `model` | Model id from `GET /models`. Needs `provider`. |
| `cwd` | Folder to work in. |
| `parent` | Your own task id. Makes this a sub-task. |
| `kind` | `code`, `light` or `read`. Read means no file changes. |
| `direct` | `true` skips the orchestrator. |

Same thing from a shell: `node "<root>/tools/cc.mjs" task add --title "T" --prompt-file task.md --provider codex --model <id> --parent <your task id>`.

## Guards

- At most 3 levels deep.
- At most 8 live sub-tasks per parent, 60 live tasks in total.
- Sub-tasks obey every provider limit (`maxParallel`, `maxClis`, Freebuff hours).
- In Orchestrated mode a worker's sub-task waits for its orchestrator. The orchestrator approves it with `POST /tasks/<id>/approve` (optional JSON body with `provider`, `model`, `prompt`, `title` to edit it first) or refuses it with `POST /tasks/<id>/cancel`. In Simple mode sub-tasks start at once.
- Cancelling a task cancels its live sub-tasks.

## Look things up

- `GET /models`: `{provider: [{id, name, note}]}`. `note: "not read live"` means the list is a fallback.
- `GET /budget`: live hours, windows and spend per provider.
- `GET /orch`: the saved mode, orchestrator, worker models and enabled providers.
- `GET /tasks?parent=<id>&brief=1`: your sub-tasks without their text.
- `GET /task-log?id=<id>`: a task's log and report.
- `node "<root>/tools/cc.mjs" budget | board | task list | task log <id>`.

## Time left and resume

A running Freebuff task shows its time left in Tasks and Home. If the session ends before the report exists, the task goes back to waiting with the reason "ran out of time, resumes when N hours of <model> are free". It then continues the same chat on that model when it has hours, or on the next best model if that one is out for the day. A task resumes at most 5 times. If the report already exists the task is finished instead. When you are resumed, check what is already done and do not redo it.
