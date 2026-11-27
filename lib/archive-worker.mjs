import { parentPort } from 'node:worker_threads';
import { lists } from './sessions.mjs';
import { config } from './config.mjs';

const now = Date.now(), out = [];
for (const [p, fn] of Object.entries(lists)) {
  if (!config().providers[p] && p !== 'claude') continue;
  try { for (const s of fn(500)) if (s.id && !s.sub && (s.state === 'done' || now - s.mtime > 864e5)) out.push({ provider: p, id: s.id, title: s.title ?? s.id, cwd: s.cwd, mtime: s.mtime || 0, report: null, tools: null }); }
  catch (e) { console.error(`archive: ${p}: ${e.message}`); }
}
parentPort.postMessage(out);
