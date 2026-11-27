import { removal, trashSession } from '../sessions.mjs';
import { setMeta, cleanName } from '../session-meta.mjs';

const ACTIONS = ['rename', 'archive', 'unarchive', 'delete'];

export default async ({ req, res, u, q, send, readBody, loadSessions, clearSessions }) => {
  if (u.pathname !== '/session/meta' || req.method !== 'POST') return false;
  const p = q('p'), id = q('id'), a = q('a');
  if (!ACTIONS.includes(a)) return send(res, 400, { error: 'Unknown action.' }), true;
  let info = null;
  try {
    if (p === 'freebuff') {
      const s = /^[\w-]+$/.test(id) ? loadSessions().find(x => x.slug === id) : null;
      info = s && { state: !s.queued && !s.archived && Date.now() - s.mtime < 120000 ? 'working' : 'idle' };
    } else if (Object.hasOwn(removal, p)) info = removal[p](id);
    else return send(res, 400, { error: 'Unknown provider.' }), true;
  } catch (e) { return send(res, 500, { error: e.message }), true; }
  if (!info) return send(res, 404, { error: 'Session not found. It may have been removed already.' }), true;
  try {
    if (a === 'rename') {
      if (Number(req.headers['content-length']) > 2000) return send(res, 400, { error: 'The new name is too long. Keep it under 140 characters.' }), true;
      let b = {};
      try { b = JSON.parse(await readBody(req, 2000)); } catch { return send(res, 400, { error: 'The new name could not be read. Keep it under 140 characters.' }), true; }
      if (!b || typeof b !== 'object') return send(res, 400, { error: 'The new name could not be read.' }), true;
      setMeta(p, id, { name: cleanName(b?.name) });
    } else if (a === 'archive' || a === 'unarchive') setMeta(p, id, { archived: a === 'archive' });
    else {
      if (info.state === 'working') return send(res, 409, { error: 'This session is working right now. Wait until it stops, then delete it.' }), true;
      if (info.trash) { trashSession(p, info.trash); setMeta(p, id, { name: '', archived: false, deleted: true }); } else setMeta(p, id, { deleted: true });
    }
  } catch (e) { return send(res, 500, { error: `Could not do that: ${e.message}` }), true; }
  clearSessions();
  send(res, 200, { ok: true, how: a === 'delete' ? (info.trash ? 'trash' : 'hidden') : a });
  return true;
};
