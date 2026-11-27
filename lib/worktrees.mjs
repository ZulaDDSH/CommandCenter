import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { config } from './config.mjs';

const gitRun = (cwd, args, timeout = 45000) => {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 8 << 20 });
  return {
    ok: r.status === 0,
    code: r.status,
    out: String(r.stdout ?? '').trim(),
    err: String(r.stderr ?? '').trim(),
    missing: r.error?.code === 'ENOENT',
    why: String(r.error?.message ?? '').slice(0, 200),
  };
};

export const repoOf = dir => {
  if (!dir || !fs.existsSync(dir)) return null;
  const r = gitRun(dir, ['rev-parse', '--show-toplevel'], 15000);
  return r.ok && r.out ? r.out.replace(/\\/g, '/') : null;
};

const inside = (child, parent) => {
  const a = path.resolve(child).toLowerCase(), b = path.resolve(parent).toLowerCase();
  return a === b || a.startsWith(b + path.sep);
};

export function prepare(task, opts = {}) {
  const c = config();
  if (c.taskWorktrees === false || !task) return null;
  if (!task.id) return { ok: false, soft: true, why: 'The task has no id, so no worktree can be named after it.' };
  if (task.worktree?.path) {
    if (fs.existsSync(task.worktree.path)) return { ok: true, path: task.worktree.path, branch: task.worktree.branch ?? null, reused: true };
    delete task.worktree;
  }
  const cwd = task.cwd;
  if (!cwd || !fs.existsSync(cwd)) return { ok: false, soft: true, why: 'The task folder does not exist, so no worktree was made.' };
  const repo = repoOf(cwd);
  if (!repo) return { ok: false, soft: true, why: 'Not inside a git repository, so the task runs in its own folder.' };
  const dir = path.join(repo, 'git');
  const target = path.join(dir, task.id);
  if (inside(repo, target)) return { ok: false, soft: true, why: 'The worktree folder would contain the repository; refusing.' };
  if (fs.existsSync(target)) return { ok: false, why: `The folder ${target.replace(/\\/g, '/')} already exists and this task did not create it, so another session probably owns it. It was left alone.` };
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); }
    catch (e) { return { ok: false, soft: true, why: `Could not make ${dir.replace(/\\/g, '/')}: ${e.message}` }; }
  }
  const branch = opts.branch ?? `cc/${task.id}`;
  let r = gitRun(repo, ['worktree', 'add', target, '-b', branch]);
  if (!r.ok && /already exists/i.test(r.err)) r = gitRun(repo, ['worktree', 'add', target, branch]);
  if (!r.ok) {
    try { if (fs.existsSync(target) && !fs.readdirSync(target).length) fs.rmdirSync(target); } catch {}
    return { ok: false, why: `git worktree add failed: ${(r.err || r.out || r.why || 'unknown error').split('\n')[0].slice(0, 200)}` };
  }
  return { ok: true, path: target.replace(/\\/g, '/'), branch, created: true };
}

export function summary(wtPath) {
  if (!wtPath || !fs.existsSync(wtPath)) return null;
  const head = gitRun(wtPath, ['rev-parse', '--short', 'HEAD'], 15000);
  const st = gitRun(wtPath, ['status', '--porcelain'], 15000);
  const log = gitRun(wtPath, ['log', '--oneline', '-3'], 15000);
  const count = gitRun(wtPath, ['rev-list', '--count', 'HEAD'], 15000);
  const dirty = st.ok ? st.out.split('\n').map(s => s.trim()).filter(Boolean) : [];
  return {
    path: wtPath.replace(/\\/g, '/'),
    head: head.ok ? head.out : null,
    commits: log.ok ? log.out.split('\n').filter(Boolean) : [],
    commitCount: count.ok ? Number(count.out) || null : null,
    dirty: dirty.length,
    files: dirty.slice(0, 20).map(l => l.replace(/^\S+\s+/, '')),
  };
}

export function list(repo) {
  const root = repo || config().projectDir;
  if (!root) return [];
  const r = gitRun(root, ['worktree', 'list', '--porcelain'], 15000);
  if (!r.ok) return [];
  const out = [];
  let cur = null;
  for (const line of r.out.split('\n')) {
    if (line.startsWith('worktree ')) { cur = { path: line.slice(9).replace(/\\/g, '/'), branch: null, head: null, bare: false }; out.push(cur); }
    else if (cur && line.startsWith('HEAD ')) cur.head = line.slice(5).trim();
    else if (cur && line.startsWith('branch ')) cur.branch = line.slice(7).replace('refs/heads/', '');
    else if (cur && line === 'bare') cur.bare = true;
  }
  const base = path.join(root, 'git').replace(/\\/g, '/').toLowerCase();
  return out.map(w => ({ ...w, taskId: path.dirname(w.path).replace(/\\/g, '/').toLowerCase() === base ? path.basename(w.path) : null }));
}
