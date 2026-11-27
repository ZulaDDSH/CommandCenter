import { Worker } from 'node:worker_threads';
import { decorate, decorateOne } from '../session-meta.mjs';

let rows = null, at = 0, running = null;
const refresh = () => running ??= new Promise(done => {
  const w = new Worker(new URL('../archive-worker.mjs', import.meta.url));
  let over = false;
  const end = r => { if (over) return; over = true; if (r) { rows = r; at = Date.now(); } else at = Date.now() - 540000; running = null; done(); };
  w.once('message', end);
  w.once('error', e => { console.error(`archive worker: ${e.message}`); end(null); });
  w.once('exit', () => end(null));
});

async function archived(loadSessions) {
  if (Date.now() - at > 600000) { const p = refresh(); if (!rows) await p; }
  const out = decorate('freebuff', loadSessions().filter(s => s.archived).map(s => ({ provider: 'freebuff', id: s.slug, title: s.title ?? s.slug, mtime: s.mtime || 0, report: s.report ?? null, tools: (s.steps || []).filter(x => x.k === 'tool').length })));
  const cached = Object.values(Object.groupBy(rows ?? [], r => r.provider)).flatMap(g => decorate(g[0].provider, g));
  return JSON.stringify(out.concat(cached).sort((a, b) => b.mtime - a.mtime));
}

export default async ({ res, u, q, send, loadSessions, worktree }) => {
  if (u.pathname === '/archive/sessions') return send(res, 200, await archived(loadSessions)), true;
  if (u.pathname !== '/session' || q('p') !== 'freebuff') return false;
  const id = q('id');
  if (!/^[\w-]+$/.test(id)) return send(res, 400, { error: 'bad id' }), true;
  const s = loadSessions().find(x => x.slug === id);
  if (!s) return send(res, 404, { error: 'session not found' }), true;
  const steps = s.report ? [...s.steps, { k: 'text', text: '**Report**\n' + s.report }] : s.steps;
  const state = s.archived ? 'done' : !s.queued && Date.now() - s.mtime < 120000 ? 'working' : 'idle';
  const d = decorateOne('freebuff', { provider: 'freebuff', id, title: s.title ?? id, cwd: worktree(id), mtime: s.mtime, state, steps });
  if (!d) return send(res, 404, { error: 'session not found' }), true;
  send(res, 200, d);
  return true;
};
