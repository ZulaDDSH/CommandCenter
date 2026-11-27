import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, config } from './config.mjs';
import { redact } from './machines.mjs';
import { pidAlive } from './session-meta.mjs';

const FILE = path.join(ROOT, 'goals.json');
const LIVE = ['waiting', 'starting', 'running'];
const RUNNING = ['starting', 'running'];
const ACTIVE = ['active', 'paused', 'stopped', 'done'];
const MAX_GOALS = 40;
const now = () => new Date().toISOString();
const newId = () => `g-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;

let store = null;

function load() {
  if (store) return store;
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
  store = { version: 1, goals: Array.isArray(raw.goals) ? raw.goals : [], merges: Array.isArray(raw.merges) ? raw.merges : [], stages: Array.isArray(raw.stages) ? raw.stages : [] };
  return store;
}

function save() {
  const s = load();
  fs.mkdirSync(ROOT, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, FILE);
}

export const goals = () => load().goals;
export const goal = id => load().goals.find(g => g.id === id) ?? null;
export const merges = () => load().merges;

const clamp = (v, lo, hi, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n * 100) / 100)) : dflt; };

export function create(input = {}) {
  const s = load();
  const title = String(input.title ?? input.goal ?? '').trim().slice(0, 120);
  const text = String(input.text ?? input.prompt ?? input.title ?? '').trim();
  if (!title) throw new Error('The goal needs a short name.');
  if (!text) throw new Error('The goal needs a description of what done looks like.');
  if (text.length > 50000) throw new Error('The goal text is over 50000 characters.');
  if (s.goals.filter(g => LIVE.includes(g.status)).length >= MAX_GOALS) throw new Error(`There are already ${MAX_GOALS} live goals. Stop one first.`);
  const projectDir = String(input.projectDir ?? '').trim() || config().projectDir || ROOT;
  if (!fs.existsSync(projectDir)) throw new Error(`The folder ${projectDir} does not exist.`);
  const l = input.limits ?? {};
  const g = {
    id: newId(),
    title,
    text,
    priority: clamp(input.priority ?? 3, 1, 5, 3),
    status: 'active',
    projectDir,
    createdAt: now(),
    updatedAt: now(),
    taskId: null,
    limits: {
      maxLive: clamp(l.maxLive ?? 10, 1, 60, 10),
      maxTasks: clamp(l.maxTasks ?? 60, 1, 200, 60),
      taskMinutes: clamp(l.taskMinutes ?? 120, 5, 1440, 120),
    },
    steer: [],
    history: [{ at: now(), what: 'created' }],
  };
  s.goals.push(g);
  save();
  return g;
}

export function drop(id) {
  const s = load();
  const i = s.goals.findIndex(g => g.id === id);
  if (i < 0) return null;
  const [g] = s.goals.splice(i, 1);
  save();
  return g;
}

export function linkTask(id, taskId) {
  const g = goal(id);
  if (!g) return null;
  Object.assign(g, { taskId, updatedAt: now() });
  g.history.push({ at: now(), what: `task ${taskId} created` });
  save();
  return g;
}

export function steer(id, text, taskId = null, delivery = null) {
  const g = goal(id);
  if (!g) throw new Error('That goal does not exist.');
  const note = String(text ?? '').trim();
  if (!note) throw new Error('Write what should change.');
  if (note.length > 8000) throw new Error('A steering note is at most 8000 characters.');
  g.steer.push({ at: now(), text: note, taskId, ...(delivery ? { delivery } : {}) });
  g.updatedAt = now();
  save();
  return g;
}

export function setMaxLive(id, value) {
  const g = goal(id);
  if (!g) return null;
  if (!Number.isInteger(value) || value < 1 || value > 60) throw new Error('Live task limit must be a whole number from 1 to 60.');
  g.limits = { ...g.limits, maxLive: value };
  g.updatedAt = now();
  g.history.push({ at: now(), what: `live task limit set to ${value}` });
  save();
  return g;
}

export function setStatus(id, status, why) {
  const g = goal(id);
  if (!g) return null;
  if (!ACTIVE.includes(status)) throw new Error(`Unknown goal status ${status}.`);
  Object.assign(g, { status, updatedAt: now() });
  g.history.push({ at: now(), what: `${status}${why ? `: ${why}` : ''}` });
  save();
  return g;
}

export function steerMode(root) {
  if (!root) return { mode: 'new-run', why: 'There is no director run yet.' };
  if (root.status === 'waiting') return { mode: 'amend', why: 'The director has not started. A reply is added to its brief.' };
  if (RUNNING.includes(root.status)) {
    if (root.status === 'running' && root.ranOn === 'freebuff' && root.cli) return { mode: 'live', why: 'The director is a live Freebuff chat. A reply is typed into it.' };
    return { mode: 'handoff', why: root.status === 'starting' ? 'The director is still starting, so a reply typed now could arrive before its task or be lost.' : `The director is a one-shot ${root.ranOn ?? root.provider ?? 'agent'} run. It read its instructions when it started and cannot take a reply while it runs.` };
  }
  return { mode: 'new-run', why: 'The director has finished. A reply starts a new run.' };
}

export function handoffText(g, note, root, reportsDir = '') {
  const earlier = (g.steer ?? []).slice(-10).map((x, i) => `${i + 1}. ${x.text}`);
  return [
    `The goal "${g.title}" continues. You are the director for it.`,
    '', 'The goal as the person first wrote it:', g.text,
    ...(earlier.length ? ['', 'Their earlier notes, oldest first:', ...earlier] : []),
    '', 'Their newest instruction:', note,
    ...(root ? ['', `The earlier director run is task ${root.id} (${root.status}). Its report, if it wrote one, is ${path.join(reportsDir, `${root.id}.md`)}. Read it, and check the repository (git status, open worktrees) before you repeat any work.`] : []),
  ].join('\n');
}

export function gate(t, list) {
  if (!t) return null;
  const g = goalOf(t, list);
  if (!g) return null;
  if (g.status === 'paused') return `Paused: the goal "${g.title}" is paused. Resume it to keep this task moving.`;
  if (g.status === 'stopped') return `Stopped: the goal "${g.title}" was stopped.`;
  if (g.status === 'done') return `The goal "${g.title}" is already done.`;
  if (t.afterTask) {
    const a = (list ?? []).find(x => x.id === t.afterTask);
    if (a && (LIVE.includes(a.status) || (a.status === 'interrupted' && a.orphanPid && pidAlive(a.orphanPid)))) return `Waiting for the running director ${a.id} to end. It has not seen your latest note and keeps its current plan.`;
  }
  if (Array.isArray(t.dependsOn) && t.dependsOn.length) {
    const behind = t.dependsOn
      .map(id => (list ?? []).find(x => x.id === id))
      .filter(Boolean)
      .filter(d => d.status !== 'done');
    if (behind.length) return `Waiting for ${behind.map(d => `${d.id} (${d.status})`).join(', ')} to finish.`;
  }
  const own = (list ?? []).filter(x => goalOf(x, list)?.id === g.id);
  const workers = own.filter(x => x.role !== 'orchestrator' && x.id !== g.taskId);
  const others = workers.filter(x => x.id !== t.id);
  const running = others.filter(x => RUNNING.includes(x.status));
  const maxLive = Number(g.limits?.maxLive ?? 4);
  if (t.role !== 'orchestrator' && running.length >= maxLive) return `This goal already has ${running.length} of ${maxLive} tasks running. Raise the goal limit or wait.`;
  const maxTasks = Number(g.limits?.maxTasks ?? 24);
  const used = others.filter(x => x.startedAt).length;
  if (t.id !== g.taskId && used >= maxTasks) return `This goal reached its limit of ${maxTasks} started tasks.`;
  return null;
}

export function goalOf(t, list) {
  if (!t) return null;
  let x = t;
  for (let n = 0; x && n < 12; n++) {
    if (x.goal) { const g = goal(x.goal); if (g) return g; }
    if (!x.parent) return null;
    x = (list ?? []).find(y => y.id === x.parent) ?? null;
  }
  return null;
}

const ms = iso => { const n = Date.parse(iso ?? ''); return Number.isFinite(n) ? n : 0; };
const minutes = (a, b) => (a && b ? Math.max(0, Math.round((b - a) / 60000)) : 0);
const short = s => String(s ?? '').replace(/\s+/g, ' ').trim();


export function approveMerge({ repo, number, sha, reason }) {
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) throw new Error('Name the pull request number.');
  if (!sha) throw new Error('The pull request head commit is unknown, so approval cannot be pinned to one commit.');
  const s = load();
  const rec = { repo: String(repo ?? ''), number: n, sha: String(sha), at: now(), reason: short(reason).slice(0, 300) };
  s.merges = s.merges.filter(m => !(m.repo === rec.repo && m.number === rec.number)).concat(rec);
  save();
  return rec;
}

export function mergeApproval({ repo, number, sha }) {
  return load().merges.find(m => m.repo === String(repo ?? '') && m.number === Number(number) && m.sha === String(sha)) ?? null;
}


const head = (file, n = 400) => {
  try { const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(n); const k = fs.readSync(fd, b, 0, n, 0); fs.closeSync(fd); return b.toString('utf8', 0, k); }
  catch { return null; }
};

const wtMemo = new Map();
function memoWorktree(fn, p) {
  if (!fn || !p) return null;
  const hit = wtMemo.get(p);
  if (hit && Date.now() - hit.at < 60000) return hit.v;
  let v = null;
  try { v = fn(p); } catch { v = null; }
  wtMemo.set(p, { at: Date.now(), v });
  return v;
}

const STAGE_LABEL = { planned: 'Planning', waiting: 'Waiting for a free agent', working: 'Working', blocked: 'Blocked', done: 'Done', finished: 'Finished', paused: 'Paused', stopped: 'Stopped' };

function stageOf(g, own) {
  if (g.status === 'paused') return 'paused';
  if (g.status === 'stopped') return 'stopped';
  if (g.status === 'done') return 'done';
  if (!own.length) return 'planned';
  const failed = own.some(t => t.status === 'failed' || t.status === 'interrupted');
  if (failed) return 'blocked';
  if (own.some(t => t.status === 'running' || t.status === 'starting')) return 'working';
  if (own.some(t => t.status === 'waiting')) return 'waiting';
  const root = own.find(t => t.id === g.taskId);
  if (root && root.status === 'done') return 'done';
  if (root && !LIVE.includes(root.status)) return 'finished';
  return 'waiting';
}

const bodyOf = f => { try { return fs.readFileSync(f, 'utf8').slice(0, 6000); } catch { return ''; } };
const threadOf = (g, own, reportsDir) => [
  { who: 'you', at: g.createdAt, text: g.text },
  ...(g.steer ?? []).slice(-40).map(x => ({ who: 'you', at: x.at, text: x.text, delivery: x.delivery?.text ?? null })),
  ...own.filter(t => t.role === 'orchestrator').map(t => ({
    who: 'director', at: t.endedAt ?? t.startedAt ?? t.createdAt, taskId: t.id, status: t.status,
    text: t.status === 'done' ? bodyOf(path.join(reportsDir, `${t.id}.md`)) || t.note || '' : ['failed', 'cancelled', 'interrupted'].includes(t.status) ? t.note ?? '' : '',
  })).map(m => ({ ...m, text: redact(m.text) })),
].sort((a, b) => ms(a.at) - ms(b.at));

export function snapshot({ tasks: list = [], reportsDir = '', worktrees = null, sessions = [], machines = null, github = null, dispatcher = null, usage = null } = {}) {
  const c = config();
  const at = now();
  const out = [];
  for (const g of load().goals.slice().sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || a.priority - b.priority || ms(b.updatedAt) - ms(a.updatedAt))) {
    const own = list.filter(t => goalOf(t, list)?.id === g.id);
    const counts = { running: 0, waiting: 0, done: 0, failed: 0, cancelled: 0, interrupted: 0, starting: 0 };
    for (const t of own) { if (counts[t.status] != null) counts[t.status] += 1; else counts[t.status] = 1; }
    const stage = stageOf(g, own);
    const live = own.filter(t => LIVE.includes(t.status) && (t.pid || t.cli));
    const agents = live.map(t => ({
      taskId: t.id,
      root: t.id === g.taskId,
      provider: t.ranOn ?? (t.provider !== 'auto' ? t.provider : null),
      model: t.model ?? t.modelPref ?? null,
      machine: 'local',
      status: t.status,
      controllable: !!(t.pid || t.cli),
      stop: !!(t.pid || t.cli),
      leaseOwner: t.lease?.owner ?? null,
      leaseAt: t.lease?.at ?? null,
      worktree: t.worktree?.path ?? null,
      branch: t.worktree?.branch ?? null,
    }));
    const blockers = [];
    const needsYou = [];
    for (const t of own) {
      if (t.status === 'waiting' && t.hold) {
        blockers.push({ kind: 'approval', taskId: t.id, title: t.title, detail: `Waiting for its orchestrator (${t.hold}) to approve it.` });
        needsYou.push({ kind: 'approve', taskId: t.id, detail: `Approve or refuse the sub-task "${short(t.title).slice(0, 60)}".` });
      }
      if (t.status === 'interrupted') {
        blockers.push({ kind: 'interrupted', taskId: t.id, title: t.title, detail: t.note ?? 'Interrupted by a restart.' });
        needsYou.push({ kind: 'resume', taskId: t.id, detail: `"${short(t.title).slice(0, 60)}" was interrupted. Check the folder, then resume it.` });
      }
      if (t.status === 'failed') {
        blockers.push({ kind: 'failed', taskId: t.id, title: t.title, detail: t.note ?? 'Failed.' });
        needsYou.push(t.needsLogin
          ? { kind: 'login', provider: t.needsLogin, taskId: t.id, detail: `Log in to ${t.needsLogin}, then retry "${short(t.title).slice(0, 60)}".` }
          : { kind: 'retry', taskId: t.id, detail: `"${short(t.title).slice(0, 60)}" failed: ${short(t.note ?? '').slice(0, 120)}` });
      }
      if ((t.status === 'running' || t.status === 'starting') && t.startedAt) {
        const ran = minutes(ms(t.startedAt), Date.now());
        const cap = Number(g.limits?.taskMinutes ?? 120);
        if (ran > cap) needsYou.push({ kind: 'overrun', taskId: t.id, detail: `"${short(t.title).slice(0, 60)}" has run ${ran} min, past the ${cap} min goal limit.` });
      }
    }
    if (g.status === 'paused') needsYou.push({ kind: 'paused', detail: 'This goal is paused.' });
    const fb = usage?.freebuff ?? null;
    if (g.status === 'active' && fb && !fb.error && fb.hoursLeft && /^0:0/.test(String(fb.hoursLeft)) && own.some(t => t.status === 'waiting')) {
      needsYou.push({ kind: 'budget', detail: 'Freebuff hours are used up, so waiting Freebuff tasks cannot start.' });
    }
    const evidence = own
      .filter(t => t.status === 'done' || t.status === 'failed')
      .sort((a, b) => ms(b.endedAt) - ms(a.endedAt))
      .slice(0, 8)
      .map((t, i) => {
        const file = reportsDir ? path.join(reportsDir, `${t.id}.md`) : null;
        let rep = null;
        if (file) {
          try {
            const st = fs.statSync(file);
            rep = { path: file.replace(/\\/g, '/'), bytes: st.size, at: new Date(st.mtimeMs).toISOString(), head: head(file, 400) };
          } catch {}
        }
        const wt = t.worktree?.path ? (i < 3 ? memoWorktree(worktrees, t.worktree.path) : { path: t.worktree.path }) : null;
        return {
          taskId: t.id, title: t.title, status: t.status, endedAt: t.endedAt ?? null,
          provider: t.ranOn ?? null, model: t.model ?? null, exitCode: t.exitCode ?? null,
          report: rep, worktree: wt, note: t.note ?? null,
        };
      });
    out.push({
      id: g.id, title: g.title, priority: g.priority, status: g.status, stage, stageLabel: STAGE_LABEL[stage] ?? stage,
      createdAt: g.createdAt, updatedAt: g.updatedAt, taskId: g.taskId, projectDir: g.projectDir,
      counts, agents,
      controls: { canPause: g.status === 'active', canResume: g.status === 'paused' || g.status === 'stopped', canStop: g.status === 'active' || g.status === 'paused', canSteer: g.status === 'active' || g.status === 'paused' },
      steering: steerMode(own.find(t => t.id === g.taskId) ?? null),
      blockers, needsYou, evidence,
      budget: {
        maxLive: g.limits?.maxLive ?? 4, usedLive: own.filter(t => t.id !== g.taskId && t.role !== 'orchestrator' && RUNNING.includes(t.status)).length,
        maxTasks: g.limits?.maxTasks ?? 24, usedTasks: own.filter(t => t.id !== g.taskId && t.role !== 'orchestrator' && t.startedAt).length,
        taskMinutes: g.limits?.taskMinutes ?? 120,
        oldestRunMin: Math.max(0, ...own.filter(t => t.startedAt && LIVE.includes(t.status)).map(t => minutes(ms(t.startedAt), Date.now()))),
      },
      tasks: own.slice().sort((a, b) => (LIVE.includes(b.status) ? 1 : 0) - (LIVE.includes(a.status) ? 1 : 0) || ms(b.createdAt) - ms(a.createdAt)).slice(0, 30).map(t => ({
        id: t.id, title: short(t.title).slice(0, 80), director: t.id === g.taskId, status: t.status,
        provider: t.ranOn ?? (t.provider !== 'auto' ? t.provider : null), model: t.model ?? t.modelPref ?? null, login: t.needsLogin ?? null,
        note: short(t.status === 'waiting' ? t.reason : t.note ?? t.reason).slice(0, 200), endedAt: t.endedAt ?? null,
      })),
      steer: (g.steer ?? []).slice(-5),
      thread: threadOf(g, own, reportsDir),
      history: (g.history ?? []).slice(-6),
    });
  }
  const byId = new Map(list.map(t => [t.id, t]));
  const discovered = sessions.map(s => ({
    provider: s.provider, id: s.id, title: short(s.title ?? s.id).slice(0, 110),
    cwd: s.cwd ?? null, mtime: s.mtime ?? null, state: s.state ?? 'unknown', live: s.live ?? 'unknown',
    controllable: false,
    why: 'A session found on disk. The panel did not start it and cannot pause or stop it.',
    claimedBy: [...byId.values()].filter(t => (t.cli && String(t.cli).includes(String(s.id))) || (t.pid && s.pid && t.pid === s.pid)).map(t => t.id).slice(0, 3),
  }));
  return {
    at,
    config: { orchestrated: (config().orchestrator?.mode ?? 'orchestrated') === 'orchestrated', projectDir: c.projectDir ?? '', taskWorktrees: c.taskWorktrees !== false, mergeEnabled: !!c.mergeEnabled, readError: c.readError ?? null },
    goals: out,
    needsYou: out.flatMap(g => g.needsYou.map(n => ({ goalId: g.id, goal: g.title, priority: g.priority, ...n }))).slice(0, 40),
    discovered,
    machines,
    github,
    dispatcher,
    merges: load().merges.slice(-20),
  };
}
