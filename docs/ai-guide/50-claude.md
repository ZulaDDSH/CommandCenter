# Claude state (AI guide)

There is no Claude tab any more; Claude sessions appear in the Sessions tab with the other agents. `GET /claude/state` still reports Claude Code on this PC: whether it is installed, whether it is signed in, a link to the usage page, and its newest sessions. It does not start Claude. Claude is turned on for tasks in Setup or the Director tab.

## Endpoints

- `GET /claude/state` returns `{ installed, path, signedIn, plan, enabled, sessions, error, usageUrl }`. `signedIn` only says the sign-in file exists; nothing is sent over the network and no token or email is returned. `enabled` is `config().providers.claude`. `sessions` is the newest 40, always shown, because reading history is harmless.
- `GET /session?p=claude&id=<session id>` returns one session: `{ provider, id, title, cwd, started, mtime, state, model, steps }`. `steps` are `user`, `text` and `tool` (name, short input, short output). Helper agent steps are collapsed inside the tool step that started them.
- `GET /sessions` lists Claude sessions only while Claude is turned on in Setup.

```
curl.exe -s http://127.0.0.1:4021/claude/state
curl.exe -s "http://127.0.0.1:4021/session?p=claude&id=<id>"
```

## How sessions are read

Claude Code writes one file per session at `~/.claude/projects/<folder>/<id>.jsonl`. They can be hundreds of MB, so the panel reads only the first 1 MB for the title, folder and start time, and the last 16 MB for the detail view (it says so at the top when it cut). Title is the first real user message. State is by age: working under 2 minutes, waiting for you under 6 hours, finished after that.

Open any row to see the session in the overlay. Esc, the dark backdrop or the close button closes it.

## Rules

- Read-only. The panel never changes Claude session files.
- Do not print or copy session text into reports beyond what is needed; sessions can contain private notes.
