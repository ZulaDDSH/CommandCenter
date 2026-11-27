import { parentPort } from 'node:worker_threads';
import { rawLists as lists } from './sessions.mjs';
import { config } from './config.mjs';
import * as tasks from './tasks.mjs';
import { sessionOrigin } from './session-origin.mjs';

const now = Date.now(), out = [];
const belongs = sessionOrigin(tasks.list(), tasks.logFile);
for (const [p, fn] of Object.entries(lists)) {
  if (!config().providers[p] && p !== 'claude') continue;
  try { for (const s of fn(1000)) if (s.id && belongs(p, s) && (s.state === 'done' || now - s.mtime > 864e5)) out.push({ provider: p, id: s.id, title: s.title ?? s.id, cwd: s.cwd, mtime: s.mtime || 0, report: null, tools: null }); }
  catch (e) { console.error(`archive: ${p}: ${e.message}`); }
}
parentPort.postMessage(out);
