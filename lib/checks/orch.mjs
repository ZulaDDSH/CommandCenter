import fs from 'node:fs';
import { config } from '../config.mjs';
import { findBin, isInstalled } from '../../usage/exec.mjs';
import { listModels } from '../models.mjs';
import * as tasks from '../tasks.mjs';

const PROVIDERS = ['freebuff', 'codex', 'cursor', 'opencode', 'claude'];

export default async () => {
  const c = config(), o = { mode: 'orchestrated', ...c.orchestrator }, out = [];
  const add = (name, ok, detail, fix) => out.push({ group: 'Orchestrator', name, ok, detail, fix });
  add('Mode', true, o.mode === 'orchestrated' ? (o.provider ? `Orchestrated: ${o.provider} ${o.model || '(provider default)'}` : 'Orchestrated: the first provider that is on (Claude, Codex, OpenCode, Cursor, Freebuff)') : 'Simple (the panel picks a provider)', 'Change it in the Orchestrator tab.');
  if (o.mode === 'orchestrated' && o.provider) {
    add('Orchestrator provider usable', !!c.providers[o.provider] && isInstalled(o.provider), `${o.provider}: ${c.providers[o.provider] ? (isInstalled(o.provider) ? 'on and installed' : 'not installed') : 'turned off'}`, 'Turn it on in Setup or pick another provider in the Orchestrator tab.');
  }
  for (const p of PROVIDERS.filter(x => x !== 'freebuff' && c.providers[x])) {
    const bin = p === 'cursor' ? findBin('cursor-agent') : findBin(p);
    add(`${p} command resolves`, !!bin || (p === 'cursor' && isInstalled('cursor')), bin ?? (isInstalled(p) ? 'found in its own install folder' : 'not found on PATH'), `Install ${p} and make sure it is on PATH. npm installs make a .cmd file, which is handled.`);
  }
  try {
    const m = await listModels({});
    for (const [p, rows] of Object.entries(m)) {
      if (p === 'freebuff') continue;
      const live = rows.length && !rows.every(r => /not read live/.test(r.note ?? ''));
      add(`${p} models listed`, live ? true : false, live ? `${rows.length} models` : rows[0]?.note ?? 'none', `Check that ${p} runs and is signed in, then reload the Orchestrator tab.`);
    }
  } catch (e) { add('Model lists', false, e.message, 'Check the provider commands above.'); }
  const live = tasks.list().filter(t => ['waiting', 'starting', 'running'].includes(t.status)).length;
  add('Live tasks', live < 60, `${live} of 60 allowed`, 'Cancel tasks you no longer need.');
  let w = true;
  try { fs.mkdirSync(c.reportsDir, { recursive: true }); fs.accessSync(c.reportsDir, fs.constants.W_OK); } catch { w = false; }
  add('Workers can write reports', w, c.reportsDir, 'Pick a writable reports folder in Setup.');
  return out;
};
