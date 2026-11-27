import { envCtx, listAll, toggle, publicRow } from '../extensions.mjs';

export default async ({ req, res, u, send, readBody }) => {
  if (u.pathname === '/ext/list' && req.method === 'GET') {
    const c = envCtx(), l = listAll(c);
    send(res, 200, { rows: l.rows.map(publicRow), files: l.files.filter(f => f.exists).map(({ pretty, ok, error }) => ({ file: pretty, ok, error })), stash: { ok: l.stash.ok, error: l.stash.error ?? '', count: l.stash.entries.length }, counts: l.counts, at: Date.now() });
    return true;
  }
  if (u.pathname === '/ext/toggle' && req.method === 'POST') {
    let b;
    try { b = JSON.parse(await readBody(req, 4000)); } catch {}
    if (!b || typeof b !== 'object' || Array.isArray(b)) { send(res, 400, { error: 'Bad request.' }); return true; }
    try { send(res, 200, toggle(envCtx(), { id: b.id, on: b.on, rev: b.rev, reformat: b.reformat === true })); } catch (e) { send(res, e.status ?? 500, { error: e.message, confirm: e.status === 422 }); }
    return true;
  }
  return false;
};
