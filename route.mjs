import { freebuff, codex, cursor } from './usage/providers.mjs';
import { config } from './lib/config.mjs';
import { isInstalled } from './usage/exec.mjs';
import { pathToFileURL } from 'node:url';

const fresh = w => w && (!w.resetsAt || Date.parse(w.resetsAt) > Date.now());

export async function pick() {
  const c = config(), on = c.providers, m = c.models;
  const [fb, cx, cu] = await Promise.all([on.freebuff ? freebuff() : null, on.codex ? codex() : null, on.cursor ? cursor() : null]);
  const ranked = [], skipped = [];
  if (!on.freebuff) skipped.push('freebuff: turned off');
  else if (fb.error) ranked.push({ provider: 'freebuff', model: 'DeepSeek V4.1 Flash', why: `freebuff usage unreadable, not proof it ran out: ${fb.error.slice(0, 120)}` });
  else if (fb.today?.flashHours > 0) ranked.push({ provider: 'freebuff', model: 'DeepSeek V4.1 Flash', why: `${fb.today.flashHours} hours of DeepSeek V4.1 Flash left` });
  else skipped.push('freebuff: no DeepSeek V4.1 Flash hours left today');
  if (!on.codex) skipped.push('codex: turned off');
  else if (!isInstalled('codex')) skipped.push('codex: not installed');
  else {
    const wins = [cx.primary, cx.secondary].filter(Boolean), cur = wins.filter(fresh);
    const used = Math.max(0, ...cur.map(w => w.usedPercent ?? 0));
    const unknown = !!cx.error || !cur.length;
    if (!unknown && (used >= 100 || (cx.reached && cur.length))) skipped.push(`codex: ${used}% used`);
    else ranked.push({ provider: 'codex', model: m.codex, effort: m.codexEffort, why: unknown ? 'codex has no current limit data, assumed usable' : `codex ${used}% used` });
  }
  if (!on.cursor) skipped.push('cursor: turned off');
  else if (!isInstalled('cursor')) skipped.push('cursor: not installed');
  else if (cu.loggedIn) ranked.push({ provider: 'cursor', model: m.cursor, why: 'cursor signed in' });
  else skipped.push('cursor: not signed in');
  if (!on.opencode) skipped.push('opencode: turned off');
  else if (!isInstalled('opencode')) skipped.push('opencode: not installed');
  else ranked.push({ provider: 'opencode', model: m.opencode, variant: 'high', why: 'opencode is the last fallback' });
  const first = ranked[0] ?? { provider: 'none', model: '', why: 'every provider is off or out of use' };
  return { ...first, why: [...skipped, first.why].join('; '), ranked };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await pick(), null, 2));
