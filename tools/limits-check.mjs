#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-limits-check-'));
process.env.CC_ROOT = tmp;
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
const D = await import(pathToFileURL(path.join(repo, 'lib', 'director.mjs')).href);

let failed = 0;
const must = (name, cond, detail = '') => { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : detail ? ` — ${detail}` : ''}`); if (!cond) failed++; };

const mk = limits => D.create({ title: 'limits', text: 'limits check', projectDir: tmp, limits });
const dir = (g, extra = {}) => ({ id: `dir-${g.id}`, status: 'running', role: 'orchestrator', goal: g.id, startedAt: '2026-01-01T00:00:00Z', ...extra });
let n = 0;
const worker = (g, d, status, extra = {}) => ({ id: `w${++n}`, status, goal: g.id, parent: d.id, ...(status === 'waiting' ? {} : { startedAt: '2026-01-01T00:00:01Z' }), ...extra });
const setup = limits => { const g = mk(limits), d = dir(g); D.linkTask(g.id, d.id); return { g, d, list: [d] }; };

{
  const g = mk({ maxLive: 4 });
  must('goal limit can be raised to 10', D.setMaxLive(g.id, 10).limits.maxLive === 10);
  let refused = false; try { D.setMaxLive(g.id, 61); } catch { refused = true; }
  must('goal limit rejects values above 60', refused && D.goal(g.id).limits.maxLive === 10);
}


{
  const { g, d, list } = setup({ maxLive: 1, maxTasks: 24 });
  const a = worker(g, d, 'waiting'); list.push(a);
  must('maxLive 1: the only waiting worker may start', D.gate(a, list) === null, D.gate(a, list));
  const b = worker(g, d, 'waiting'); list.push(b);
  must('maxLive 1: two queued workers do not block each other', D.gate(a, list) === null && D.gate(b, list) === null);
  a.status = 'running'; a.startedAt = '2026-01-01T00:00:02Z';
  must('maxLive 1: a second worker waits while one runs', /1 of 1/.test(D.gate(b, list) ?? ''), String(D.gate(b, list)));
  must('maxLive 1: the running worker is not blocked by itself', D.gate(a, list) === null);
  a.status = 'done';
  must('maxLive 1: the queued worker may start once the first is done', D.gate(b, list) === null, D.gate(b, list));
  must('maxLive 1: the director itself is never held by maxLive', D.gate(d, list) === null);
}
{
  const { g, d, list } = setup({ maxLive: 4, maxTasks: 24 });
  const ws = [1, 2, 3, 4].map(() => worker(g, d, 'running')); list.push(...ws);
  const q = worker(g, d, 'waiting'); list.push(q);
  must('maxLive 4: a fifth worker waits while four run', /4 of 4/.test(D.gate(q, list) ?? ''), String(D.gate(q, list)));
  ws[0].status = 'done';
  must('maxLive 4: it may start when one of the four finishes', D.gate(q, list) === null, D.gate(q, list));
  const q2 = worker(g, d, 'waiting'); list.push(q2);
  must('maxLive 4: queued workers are not counted as live', D.gate(q2, list) === null && D.gate(q, list) === null);
  const s5 = worker(g, d, 'starting'); list.push(s5);
  must('maxLive 4: a starting worker holds a slot (3 running + 1 starting)', /4 of 4/.test(D.gate(q, list) ?? ''), String(D.gate(q, list)));
}
{
  const { g, d, list } = setup({ maxLive: 4, maxTasks: 3 });
  const done = [1, 2].map(() => worker(g, d, 'done')); list.push(...done);
  const many = Array.from({ length: 10 }, () => worker(g, d, 'waiting')); list.push(...many);
  must('maxTasks 3: ten queued tasks do not use the budget', many.every(x => D.gate(x, list) === null), String(D.gate(many[0], list)));
  const q = many[0];
  q.status = 'done'; q.startedAt = '2026-01-01T00:00:03Z';
  must('maxTasks 3: the next task is refused after three started', /limit of 3/.test(D.gate(many[1], list) ?? ''), String(D.gate(many[1], list)));
  must('maxTasks 3: the director is exempt', D.gate(d, list) === null);
}
{
  const { g, d, list } = setup({ maxLive: 1, maxTasks: 1 });
  const a = worker(g, d, 'waiting'); list.push(a);
  must('maxTasks 1: the first task may start', D.gate(a, list) === null, D.gate(a, list));
  a.status = 'done'; a.startedAt = '2026-01-01T00:00:02Z';
  const b = worker(g, d, 'waiting'); list.push(b);
  must('maxTasks 1: the second task is refused after one completed', /limit of 1/.test(D.gate(b, list) ?? ''), String(D.gate(b, list)));
}
{
  const { g, d, list } = setup({ maxLive: 2, maxTasks: 5 });
  list.push(worker(g, d, 'running'), worker(g, d, 'waiting'), worker(g, d, 'done'));
  const v = D.snapshot({ tasks: list }).goals.find(x => x.id === g.id)?.budget;
  must('budget: one running worker holds a slot, two started count against the limit (the queued one counts for neither)', v && v.usedLive === 1 && v.usedTasks === 2, JSON.stringify(v));
}

{
  const m = r => D.steerMode(r).mode;
  must('steer: no director yet starts a new run', m(null) === 'new-run');
  must('steer: a queued director takes the text into its brief', m({ status: 'waiting' }) === 'amend');
  must('steer: a live Freebuff chat takes the text', m({ status: 'running', ranOn: 'freebuff', cli: 'cc-fb-1' }) === 'live');
  must('steer: a Freebuff director that is still starting is a hand-off, not live', m({ status: 'starting', ranOn: 'freebuff', cli: 'cc-fb-1' }) === 'handoff');
  must('steer: a Freebuff run with no CLI id is not claimed as live', m({ status: 'running', ranOn: 'freebuff' }) === 'handoff');
  for (const p of ['codex', 'claude', 'cursor', 'opencode', 'antigravity']) must(`steer: a running ${p} director is a hand-off`, m({ status: 'running', ranOn: p }) === 'handoff' && D.steerMode({ status: 'running', ranOn: p }).why.includes(p));
  for (const s of ['done', 'failed', 'cancelled', 'interrupted']) must(`steer: a ${s} director starts a new run`, m({ status: s }) === 'new-run');

  const { g, d, list } = setup({ maxLive: 2, maxTasks: 5 });
  D.steer(g.id, 'first note', null, { mode: 'sent', text: 'sent' });
  D.steer(g.id, 'second note', null, { mode: 'queued', text: 'queued' });
  const h = D.handoffText(D.goal(g.id), 'newest note', { id: d.id, status: 'running' }, 'C:/reports');
  must('hand-off: keeps the original goal text', h.includes('limits check'));
  must('hand-off: keeps earlier notes in order', h.indexOf('first note') > 0 && h.indexOf('first note') < h.indexOf('second note'));
  must('hand-off: ends with the newest note and names the earlier run and its report', h.includes('newest note') && h.includes(d.id) && h.includes('.md'));
  const thread = D.snapshot({ tasks: list }).goals.find(x => x.id === g.id).thread;
  must('thread: each reply carries its delivery text', thread.filter(x => x.delivery).map(x => x.delivery).join('|') === 'sent|queued', JSON.stringify(thread.map(x => x.delivery)));
  must('snapshot: reports the steering mode', D.snapshot({ tasks: list }).goals.find(x => x.id === g.id).steering?.mode === 'handoff');

  const next = { id: 'handoff-1', status: 'waiting', goal: g.id, afterTask: d.id, role: 'orchestrator' };
  list.push(next);
  must('afterTask: waits while the earlier director runs', /Waiting for the running director/.test(D.gate(next, list) ?? ''), String(D.gate(next, list)));
  for (const s of ['done', 'failed', 'cancelled']) { d.status = s; must(`afterTask: starts once the earlier director is ${s}`, D.gate(next, list) === null, String(D.gate(next, list))); }
  d.status = 'interrupted'; d.orphanPid = process.pid;
  must('afterTask: waits while an interrupted director still has a live process', /Waiting for the running director/.test(D.gate(next, list) ?? ''), String(D.gate(next, list)));
  d.orphanPid = 2147483000;
  must('afterTask: starts once the interrupted director process is gone', D.gate(next, list) === null, String(D.gate(next, list)));
  d.status = 'running';
  next.afterTask = 'gone';
  must('afterTask: a missing earlier task does not block', D.gate(next, list) === null);
}

{
  const M = await import(pathToFileURL(path.join(repo, 'lib', 'session-meta.mjs')).href);
  must('Freebuff report marks an untracked session done', M.freebuffEnded({ report: 'report' }, null));
  must('a completed task is done without a report', M.freebuffEnded({}, { status: 'done' }));
  must('a stale report cannot complete a running retry', !M.freebuffEnded({ report: 'old report' }, { status: 'running' }));
  must('a running retry remains protected from deletion despite an older report', M.freebuffBusy({ archived: true }, { status: 'running' }));
  must('a report does not turn a failed task into a success', !M.freebuffEnded({ report: 'report' }, { status: 'failed' }));
  const now = 1e12, alive = () => true, dead = () => false;
  const v = (r, isAlive = alive) => M.liveOf({ mtime: now - 1000, ...r }, now, isAlive).live;
  must('status: a live process with a fresh write is running', v({ pid: 42 }) === 'running');
  must('status: a fresh write with no process id is only recent activity', v({}) === 'recent');
  must('status: a dead process id is only recent activity', v({ pid: 42 }, dead) === 'recent');
  must('status: a live process with no recent write is idle, not running', v({ pid: 42, mtime: now - 3e5 }) === 'idle');
  must('status: an old session is idle, never finished or unknown', v({ mtime: now - 864e5 }) === 'idle');
  must('status: a missing time is idle, never unknown', v({ mtime: 0 }) === 'idle');
  must('status: a completed transcript is finished', v({ ended: true, mtime: now - 864e5 }) === 'finished' && v({ ended: true }) === 'finished');
  const many = Array.from({ length: 21 }, (_, i) => ({ id: `s${i}` }));
  const capped = M.capRows('codex', many, 15);
  must('limit: more than 15 rows are cut to 15 plus one visible note', capped.length === 16 && capped[15].note && /latest 15 codex/.test(capped[15].title) && !capped[15].id);
  must('limit: 15 or fewer rows get no note', M.capRows('codex', many.slice(0, 15), 15).length === 15);
  const rows = M.decorate('codex', [{ id: 'a', mtime: Date.now() - 1000 }, { id: '', note: true, title: 'note', mtime: 0 }]);
  must('status: decorate adds live and why to sessions only', rows[0].live === 'recent' && rows[0].liveWhy && rows[1].live === undefined, JSON.stringify(rows));
  const doneRows = M.decorate('codex', [{ id: 'done-1', ended: true, mtime: Date.now() }]);
  must('status: finished sessions are auto-archived', doneRows[0].live === 'finished' && doneRows[0].archived === true && doneRows[0].autoArchived === true, JSON.stringify(doneRows));
}

console.log(failed ? `\n${failed} limits check(s) failed.` : '\nAll limits checks passed.');
process.exit(failed ? 1 : 0);
