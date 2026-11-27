import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.mjs';

const FILE = path.join(ROOT, 'session-meta.json');
export const TRASH = path.join(ROOT, 'trash');
const key = (p, id) => `${p}:${id}`;
const read = () => {
  let t; try { t = fs.readFileSync(FILE, 'utf8'); } catch { return {}; }
  try { const m = JSON.parse(t); if (m && typeof m === 'object' && !Array.isArray(m)) return m; } catch {}
  try { fs.renameSync(FILE, `${FILE}.bad-${Date.now()}`); } catch {}
  return {};
};

export function setMeta(p, id, patch) {
  const m = read(), k = key(p, id), v = { ...m[k], ...patch };
  for (const f of ['name', 'archived', 'deleted']) if (!v[f]) delete v[f];
  if (Object.keys(v).length) m[k] = v; else delete m[k];
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(m, null, 1));
  fs.renameSync(FILE + '.tmp', FILE);
}

export const metaFor = () => { const m = read(); return (p, id) => m[key(p, id)] ?? {}; };

export const cleanName = s => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 140);

export const pidAlive = pid => { try { process.kill(Number(pid), 0); return true; } catch (e) { return e.code === 'EPERM'; } };
export const freebuffEnded = (session, task) => task ? task.status === 'done' : !!session.report;
export const freebuffBusy = (session, task, now = Date.now()) => task ? ['waiting', 'starting', 'running'].includes(task.status) : !session.queued && !session.archived && now - session.mtime < 120000;
export function liveOf(r, now = Date.now(), isAlive = pidAlive) {
  const recent = r.mtime > 0 && now - r.mtime < 120000;
  if (r.taskStatus === 'done' || r.ended) return { live: 'finished', liveWhy: r.taskStatus === 'done' ? 'Its Command Center task finished.' : 'The transcript shows this run completed.' };
  if (['failed', 'cancelled', 'interrupted'].includes(r.taskStatus)) return { live: 'stopped', liveWhy: `Its Command Center task ended with status ${r.taskStatus}.` };
  if (r.pid && isAlive(r.pid) && (recent || ['running', 'starting'].includes(r.taskStatus))) return { live: 'running', liveWhy: 'Its process is alive and active.' };
  if (['running', 'starting'].includes(r.taskStatus)) return { live: 'reported', liveWhy: 'Command Center reports this task is currently active.' };
  if (recent && r.turnStatus === 'inProgress') return { live: 'reported', liveWhy: 'Codex reports an in-progress turn with recent activity. The panel cannot confirm the process.' };
  if (recent) return { live: 'recent', liveWhy: 'It wrote in the last 2 minutes. The panel cannot confirm a process is running it.' };
  return { live: 'idle', liveWhy: 'No recent activity; session is idle or closed.' };
}

export const capRows = (p, rows, limit) => rows.length > limit ? [...rows.slice(0, limit), { provider: p, id: '', note: true, title: `Showing the latest ${limit} ${p} sessions. Older ones are not listed here.`, state: 'done', mtime: 0 }] : rows;

export function decorate(p, rows) {
  const m = read();
  return rows.filter(r => !m[key(p, r.id)]?.deleted).map(r => {
    const v = m[key(p, r.id)], x = r.id ? { ...r, ...liveOf(r) } : r;
    return v ? { ...x, ...(v.name ? { title: v.name, renamed: true } : {}), ...(v.archived ? { archived: true } : {}) } : x;
  });
}

const GENERIC_TITLE = /^(New Agent|Read and do the task in the file at:)/i;
export function enrichSession(provider, row, task, fbCli = null) {
  const rawTitle = String(row.title ?? '').trim();
  const useTaskTitle = task?.title && (!rawTitle || rawTitle === row.id || rawTitle === task.id || GENERIC_TITLE.test(rawTitle));
  const title = useTaskTitle ? task.title : (rawTitle || row.id);
  const cwd = row.cwd || task?.worktree?.path || task?.cwd || '';
  const model = row.model || task?.model || '';
  const taskId = task?.id ?? row.taskId ?? null;
  const taskStatus = task?.status ?? null;
  const ended = Boolean(row.ended || taskStatus === 'done');
  const active = !ended && !['failed', 'cancelled', 'interrupted'].includes(taskStatus);
  const pid = row.pid || (['running', 'starting'].includes(taskStatus) ? task.pid : null);
  const out = { ...row, title, cwd, model, taskId, taskStatus, ended, pid };
  if (provider === 'freebuff') {
    if (!active) {
      out.expiresAt = null;
      out.minsLeft = null;
      out.hourOver = false;
      out.cliId = null;
      out.cliReusable = false;
    } else {
      const activeExp = fbCli?.expiresAt && fbCli.expiresAt > Date.now() ? fbCli.expiresAt : (row.expiresAt && row.expiresAt > Date.now() ? row.expiresAt : null);
      out.expiresAt = activeExp;
      out.minsLeft = activeExp ? Math.max(0, Math.round((activeExp - Date.now()) / 60000)) : null;
      out.hourOver = !activeExp && Boolean(row.hourOver || (fbCli?.hadHour && !fbCli?.liveNow));
      out.cliId = fbCli?.id ?? task?.cli ?? null;
      out.cliReusable = Boolean(fbCli && !fbCli.exited && !fbCli.taskId && activeExp);
    }
  }
  return out;
}

export const decorateOne = (p, s) => (s ? decorate(p, [s])[0] ?? null : null);

export function moveToTrash(p, root, src) {
  const rel = path.relative(root, src);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('refusing to move a file outside the tool folder');
  let dest = path.join(TRASH, p, rel);
  if (fs.existsSync(dest)) dest += `.${Date.now()}`;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try { fs.renameSync(src, dest); } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.cpSync(src, dest, { recursive: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
}
