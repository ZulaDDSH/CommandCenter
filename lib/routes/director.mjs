import * as tasks from '../tasks.mjs';
import * as director from '../director.mjs';
import * as machines from '../machines.mjs';
import * as github from '../github.mjs';
import * as worktrees from '../worktrees.mjs';
import { config } from '../config.mjs';
import { lists as sessionLists } from '../sessions.mjs';
import { decorate } from '../session-meta.mjs';

const PROVIDERS = ['freebuff', 'codex', 'cursor', 'opencode', 'claude', 'antigravity'];

const body = async (readBody, req, max = 60000) => {
  const raw = (await readBody(req, max)).trim();
  if (!raw) return {};
  const b = JSON.parse(raw);
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error('The request body must be a JSON object.');
  return b;
};

const signed = async (readBody, req, pathname) => {
  const raw = await readBody(req, 8000);
  let b = {};
  try { b = raw.trim() ? JSON.parse(raw) : {}; } catch { return { v: { ok: false, code: 400, why: 'The request body must be JSON.' } }; }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { v: { ok: false, code: 400, why: 'The request body must be a JSON object.' } };
  return { v: machines.verifyHello(req.headers, b, pathname, raw) };
};

function discovered(loadSessions) {
  const out = [];
  const push = (rows, provider) => {
    for (const s of rows ?? []) {
      out.push({ provider, id: s.id ?? s.slug ?? '', title: s.title ?? s.id, cwd: s.cwd ?? null, mtime: s.mtime ?? 0, state: s.state ?? 'unknown', live: s.live ?? 'unknown', pid: s.pid ?? null });
    }
  };
  try {
    const live = decorate('freebuff', (loadSessions?.() ?? []).filter(s => !s.archived).map(s => ({
      provider: 'freebuff', id: s.slug, title: s.title ?? s.slug, cwd: null, mtime: s.mtime,
      state: !s.queued && Date.now() - s.mtime < 120000 ? 'working' : 'idle',
    })));
    push(live, 'freebuff');
  } catch {}
  for (const p of ['codex', 'claude']) {
    if (!config().providers[p]) continue;
    try { push(sessionLists[p]?.(12), p); } catch {}
  }
  return out.slice(0, 40);
}

export default async (ctx) => {
  const { req, res, u, q, send, readBody, json, cachedUsage, loadSessions } = ctx;
  const p = u.pathname;
  if (!p.startsWith('/director') && p !== '/machine/hello' && p !== '/machine/claim') return false;
  const post = req.method === 'POST';

  try {
    if (p === '/machine/hello' && post) {
      const { v } = await signed(readBody, req, p);
      if (!v.ok) return send(res, v.code ?? 403, { error: v.why, code: 'not-authenticated' }), true;
      return send(res, 200, { id: machines.selfId(), name: machines.localMachine().name, capabilities: machines.capabilities(), authenticated: true, at: new Date().toISOString() }), true;
    }

    if (p === '/machine/claim' && post) {
      const { v } = await signed(readBody, req, p);
      if (!v.ok) return send(res, v.code ?? 403, { error: v.why, code: 'not-authenticated' }), true;
      const claim = machines.capabilities().claim;
      return send(res, 501, { error: claim.why, code: 'claim-unsupported', supported: false }), true;
    }

    if (p === '/director' && !post) {
      const cwd = q('cwd') || config().projectDir || '';
      const gh = q('no-gh') ? null : github.list({ cwd, limit: 25 });
      const sessions = q('all') ? discovered(loadSessions) : discovered(loadSessions).filter(s => s.provider === 'freebuff');
      const snap = director.snapshot({
        tasks: tasks.list().map(tasks.display),
        reportsDir: config().reportsDir,
        worktrees: wt => worktrees.summary(wt),
        sessions,
        machines: machines.inventory(),
        github: gh,
        dispatcher: { ...tasks.state, at: new Date().toISOString() },
        usage: { freebuff: json(cachedUsage('freebuff')) },
      });
      snap.worktrees = cwd ? worktrees.list(cwd) : [];
      return send(res, 200, snap), true;
    }

    if (p === '/director/goal' && post) {
      const b = await body(readBody, req);
      const g = director.create(b);
      try {
        const t = tasks.add({ text: g.text, title: g.title, cwd: g.projectDir, goal: g.id, priority: g.priority });
        director.linkTask(g.id, t.id);
        tasks.tick();
        return send(res, 200, { goal: director.goal(g.id), task: t }), true;
      } catch (e) {
        director.drop(g.id);
        return send(res, 400, { error: `The goal was not created because its first task could not be added: ${e.message}` }), true;
      }
    }

    const act = /^\/director\/goal\/([\w-]+)\/(pause|resume|stop|steer|done)$/.exec(p);
    if (act && post) {
      const id = act[1], action = act[2];
      const g = director.goal(id);
      if (!g) return send(res, 404, { error: 'That goal does not exist.' }), true;
      if (action === 'pause') return send(res, 200, { goal: director.setStatus(id, 'paused', 'from the Director tab') }), true;
      if (action === 'resume') {
        const back = director.setStatus(id, 'active', 'resumed');
        tasks.tick();
        return send(res, 200, { goal: back }), true;
      }
      if (action === 'done') return send(res, 200, { goal: director.setStatus(id, 'done', 'marked done by you') }), true;
      if (action === 'stop') {
        let stopped = 0;
        for (const t of tasks.list()) {
          if (director.goalOf(t, tasks.list())?.id !== id) continue;
          if (['waiting', 'starting', 'running'].includes(t.status) && tasks.cancel(t.id, 'Stopped with its goal.').ok) stopped++;
        }
        return send(res, 200, { goal: director.setStatus(id, 'stopped', `${stopped} live task(s) cancelled`), cancelled: stopped }), true;
      }
      const b = await body(readBody, req);
      const note = String(b.text ?? '').trim();
      if (!note) return send(res, 400, { error: 'Write what should change.' }), true;
      if (note.length > 8000) return send(res, 400, { error: 'A steering note is at most 8000 characters.' }), true;
      if (g.status === 'stopped' || g.status === 'done') return send(res, 409, { error: `This goal is ${g.status}, so a reply would never run. Resume it first, or start a new goal.` }), true;
      const paused = g.status === 'paused';
      const root = g.taskId ? tasks.get(g.taskId) : null;
      let how = null, t = null, m = director.steerMode(root);
      if (m.mode === 'live') {
        const r = await tasks.sendToDirector(root.id, `New instruction from the person you work for, added while you work on this goal:\n\n${note}`);
        if (r.ok) how = { mode: 'sent', text: 'Typed into the running Freebuff director. It has not confirmed it yet: its next reply or report shows whether it acted on it.' };
        else m = { mode: 'handoff', why: r.why };
      }
      if (!how && m.mode === 'amend') {
        if (tasks.amend(root.id, `Update from the person you work for, added before you started:\n\n${note}`)) how = { mode: 'amended', text: 'The director has not started yet. Your note was added to the brief it reads when it starts.' };
        else m = { mode: 'handoff', why: 'The director started while you were typing and cannot take a reply while it runs.' };
      }
      if (!how) {
        const rootLive = !!root && ['waiting', 'starting', 'running'].includes(tasks.get(root.id)?.status);
        try {
          t = tasks.add({ text: director.handoffText(g, note, root, config().reportsDir), title: g.title, cwd: g.projectDir, goal: g.id, priority: g.priority, ...(rootLive ? { afterTask: root.id } : {}) });
        } catch (e) {
          director.steer(id, note, null, { mode: 'failed', text: `Not delivered: ${e.message}` });
          return send(res, 400, { error: `Your note was saved but it was not delivered: ${e.message}` }), true;
        }
        director.linkTask(id, t.id);
        how = rootLive
          ? { mode: 'queued', taskId: t.id, text: `${m.why} Your note is saved and a new director run (${t.id}) is queued to start after it ends, with the goal, your earlier notes and this one. The running director has NOT received this note and keeps its current plan; nothing it is doing has changed.` }
          : { mode: 'new-run', taskId: t.id, text: `The director had finished. A new director run (${t.id}) starts with the goal, your earlier notes, the last report and this note.` };
      }
      if (paused && t) how = { ...how, text: `${how.text} The goal is paused, so that run does not start until you resume the goal.` };
      director.steer(id, note, t?.id ?? null, how);
      tasks.tick();
      return send(res, 200, { goal: director.goal(id), task: t, delivery: how, note: how.text }), true;
    }

    const tr = /^\/director\/task\/([\w-]+)\/resume$/.exec(p);
    if (tr && post) {
      const b = await body(readBody, req, 2000);
      const t = tasks.resumeInterrupted(tr[1], { force: b.force === true });
      if (!t) return send(res, 400, { error: 'That task is not interrupted.' }), true;
      if (t.orphanAlive) return send(res, 409, { error: `The agent process ${t.orphanAlive} from before the restart is still running and may still be editing the folder. End it first, or resume anyway with force.`, orphanPid: t.orphanAlive }), true;
      tasks.tick();
      return send(res, 200, t), true;
    }

    if (p === '/director/machines' && !post) return send(res, 200, machines.inventory()), true;
    if (p === '/director/machines/add' && post) {
      const b = await body(readBody, req, 8000);
      const peer = machines.addPeer(b);
      return send(res, 200, { peer, note: 'Set CC_PEER_SECRET on both machines to the same secret. The panel never stores the secret and never derives an id from the name: the other machine signs with its own id.' }), true;
    }
    if (p === '/director/machines/remove' && post) {
      const b = await body(readBody, req, 8000);
      const gone = machines.removePeer(String(b.key ?? b.id ?? ''));
      return gone ? (send(res, 200, { removed: gone.id, note: 'Removed from this inventory. Nothing was deleted on the other machine.' }), true) : (send(res, 404, { error: 'That machine is not in the list.' }), true);
    }
    if (p === '/director/machines/enable' && post) {
      const b = await body(readBody, req, 8000);
      const peer = machines.setPeerEnabled(String(b.key ?? b.id ?? ''), b.on !== false);
      return peer ? (send(res, 200, peer), true) : (send(res, 404, { error: 'That machine is not in the list.' }), true);
    }
    if (p === '/director/machines/check' && post) {
      const b = await body(readBody, req, 8000);
      return send(res, 200, await machines.handshake(String(b.key ?? b.id ?? ''))), true;
    }

    if (p === '/director/github' && !post) {
      const cwd = q('cwd') || config().projectDir || '';
      return send(res, 200, github.list({ cwd, repo: q('repo') || undefined, fresh: u.searchParams.has('fresh'), state: q('state') || 'open' })), true;
    }

    if (p === '/director/merge-approval' && post) {
      const b = await body(readBody, req, 8000);
      const repo = String(b.repo ?? '');
      const cur = github.one({ cwd: b.cwd || config().projectDir, repo, number: b.number });
      if (!cur.ok) return send(res, 400, { error: cur.why }), true;
      const pr = cur.pr;
      const blockers = github.mergeBlockers(pr);
      const rec = director.approveMerge({ repo, number: pr.number, sha: pr.headShaFull, reason: b.reason });
      return send(res, 200, {
        approval: rec,
        blockers,
        note: blockers.length
          ? `Approval recorded for ${rec.sha.slice(0, 12)}, but a merge is refused while: ${blockers.join(' ')}`
          : `Approval recorded for ${rec.sha.slice(0, 12)} only. Nothing was merged.`,
      }), true;
    }

    if (p === '/director/merge' && post) {
      if (!config().mergeEnabled) {
        return send(res, 409, { error: 'Merging from the panel is turned off. Turn it on in the Director tab first; even then every merge needs your approval for that exact commit.' }), true;
      }
      const b = await body(readBody, req, 8000);
      const repo = String(b.repo ?? '');
      if (String(b.confirm ?? '') !== String(b.number ?? '')) return send(res, 400, { error: 'Type the pull request number in the confirm field. Nothing was merged.' }), true;
      const cur = github.one({ cwd: b.cwd || config().projectDir, repo, number: b.number });
      if (!cur.ok) return send(res, 400, { error: cur.why }), true;
      const pr = cur.pr;
      const blockers = github.mergeBlockers(pr);
      if (blockers.length) return send(res, 409, { error: `Not merged: ${blockers.join(' ')}` }), true;
      const approval = director.mergeApproval({ repo, number: pr.number, sha: pr.headShaFull });
      if (!approval) return send(res, 409, { error: `Not merged: there is no approval for commit ${String(pr.headShaFull).slice(0, 12)}. Approve this pull request first, after reading it.` }), true;
      const out = github.merge({ cwd: b.cwd || config().projectDir, repo, number: pr.number, sha: pr.headShaFull, method: b.method });
      return send(res, out.ok ? 200 : 400, out), true;
    }

    return send(res, 404, { error: 'Unknown director route.' }), true;
  } catch (e) {
    if (!res.headersSent) send(res, 400, { error: machines.redact(e?.message ?? String(e)) });
    return true;
  }
};
