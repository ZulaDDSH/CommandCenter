# Archive tab

The Archive tab lists finished sessions from every provider, with sub-tabs (All, Freebuff, Codex, Cursor, OpenCode, Claude), a 14-day chart per sub-tab, a title search, and collapsed rows.

What counts as archived
- Freebuff: segments with a saved report.
- Other providers: sessions in state `done`, or idle for more than 24 hours. Cursor never reports `done`, so its sessions show after 24 hours idle. Only providers turned on in Setup are read.
- Up to 500 sessions per provider. The list is cached for 10 minutes (building it reads every session file). OpenCode sub-agent sessions are left out.

Read it yourself
- `curl.exe -s http://127.0.0.1:4021/archive/sessions` returns the whole archive, newest first: `[{provider, id, title, cwd, mtime, report, tools}]`. `report` is only set for Freebuff; `tools` (tool-call count) is only set for Freebuff.
- `curl.exe -s "http://127.0.0.1:4021/session?p=<provider>&id=<id>"` returns one session in the overlay shape (`provider, id, title, cwd, mtime, state, steps`).
  - Freebuff is served by `lib/routes/archive.mjs`: the saved report is added as a last text step, `id` must match `^[\w-]+$` (else 400), unknown id gives 404.
  - Other providers are served by the panel's session reader.

Rules
- Read only. The tab never deletes or edits sessions.
- The chosen sub-tab is kept in the browser (`cc-archive-sub`). The page skips its 60-second refresh while you type in the search box.
- Files: `viewer/public/archive.js`, `archive.css`, `lib/routes/archive.mjs`.
