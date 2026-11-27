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
export function liveOf(r, now = Date.now(), isAlive = pidAlive) {
  const recent = r.mtime > 0 && now - r.mtime < 120000;
  if (r.ended) return { live: 'finished', liveWhy: 'The transcript shows this run completed.' };
  if (r.pid && isAlive(r.pid) && recent) return { live: 'running', liveWhy: 'Its process is alive and it wrote in the last 2 minutes.' };
  if (recent) return { live: 'recent', liveWhy: 'It wrote in the last 2 minutes. The panel cannot confirm a process is running it.' };
  return { live: 'unknown', liveWhy: 'No recent writes and no completion mark. It may be running, paused or closed.' };
}

export const capRows = (p, rows, limit) => rows.length > limit ? [...rows.slice(0, limit), { provider: p, id: '', note: true, title: `Showing the latest ${limit} ${p} sessions. Older ones are not listed here.`, state: 'done', mtime: 0 }] : rows;

export function decorate(p, rows) {
  const m = read();
  return rows.filter(r => !m[key(p, r.id)]?.deleted).map(r => {
    const v = m[key(p, r.id)], x = r.id ? { ...r, ...liveOf(r) } : r;
    return v ? { ...x, ...(v.name ? { title: v.name, renamed: true } : {}), ...(v.archived ? { archived: true } : {}) } : x;
  });
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
