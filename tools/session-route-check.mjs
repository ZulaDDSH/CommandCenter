import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-session-route-'));
process.env.CC_ROOT = root;
const { default: sessionAction } = await import('../lib/routes/sessions.mjs');
const { default: archive } = await import('../lib/routes/archive.mjs');
const { discovered } = await import('../lib/routes/director.mjs');
const id = 'chat-2026-11-27T10-07-13.427Z';
const session = { slug: id, title: 'Example', mtime: 1, queued: false, archived: false, steps: [] };
const loadSessions = () => [session];
let status, body;
const send = (_res, code, value) => { status = code; body = value; };
const request = async (action, sessionId = id) => {
  status = 0;
  await sessionAction({ req: { method: 'POST', headers: {} }, res: {}, u: { pathname: '/session/meta' }, q: k => ({ p: 'freebuff', id: sessionId, a: action })[k], send, loadSessions, clearSessions() {} });
  return status;
};
try {
  assert.equal(await request('archive'), 200);
  assert.equal(await request('unarchive'), 200);
  assert.equal(await request('delete', 'missing'), 404);
  await archive({ res: {}, u: { pathname: '/session' }, q: k => ({ p: 'freebuff', id })[k], send, loadSessions, worktree: () => '' });
  assert.equal(status, 200);
  assert.equal(body.id, id);
  session.report = 'Completed work'; session.archived = true; session.mtime = Date.now();
  await archive({ res: {}, u: { pathname: '/session' }, q: k => ({ p: 'freebuff', id })[k], send, loadSessions, worktree: () => '' });
  assert.equal(body.live, 'finished');
  assert.equal(discovered(loadSessions).find(x => x.id === id)?.live, 'finished');
  session.report = null; session.archived = false; session.mtime = 1;
  assert.equal(await request('delete'), 200);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
