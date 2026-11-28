import { config } from '../config.mjs';
import { graph } from '../codegraph-view.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

function projectPath(value) {
  const project = value || config().projectDir;
  if (!project || !path.isAbsolute(project) || /^[\\/]{2}/.test(project)) throw new Error('Choose an indexed local project folder.');
  const resolved = fs.realpathSync(project);
  if (!fs.existsSync(path.join(resolved, '.codegraph', 'codegraph.db'))) throw new Error('No CodeGraph index in this folder. Choose the indexed project folder.');
  return resolved;
}

let busy = false;
function overview(project, scope, file) {
  if (busy) throw new Error('A graph is already loading. Please wait.');
  busy = true;
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../codegraph-overview-worker.mjs', import.meta.url), { workerData: { project, scope, file } });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('The graph took too long to load.')); }, 60000);
    worker.once('message', m => { clearTimeout(timer); if (m.error) reject(new Error(m.error)); else resolve(m.data); });
    worker.once('error', e => { clearTimeout(timer); reject(e); });
    worker.once('exit', code => { if (code) { clearTimeout(timer); reject(new Error('The graph worker stopped.')); } });
  }).finally(() => { busy = false; });
}

export default async ({ req, res, u, q, send }) => {
  if (!['/codegraph', '/codegraph/overview'].includes(u.pathname) || req.method !== 'GET') return false;
  try {
    const project = projectPath(q('project'));
    if (u.pathname === '/codegraph/overview') {
      const scope = q('scope') || '', file = q('file') || '';
      if (scope.length > 1000 || file.length > 1000 || scope.includes('..') || file.includes('..')) throw new Error('Invalid graph path.');
      send(res, 200, await overview(project, scope, file));
    } else send(res, 200, graph(project, { query: q('query') || '', id: q('id') || '', offset: Number(q('offset') || 0) }));
  }
  catch (e) { send(res, 400, { error: e.message }); }
  return true;
};
