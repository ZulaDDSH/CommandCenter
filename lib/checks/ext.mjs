import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { envCtx, listAll } from '../extensions.mjs';

export default async () => {
  const g = 'Hooks, MCP and plugins', out = [];
  let l;
  try { l = listAll(envCtx()); } catch (e) { return [{ group: g, name: 'Read hooks and MCP', ok: false, detail: e.message, fix: 'Open the Hooks & MCP tab and report this message.' }]; }
  for (const f of l.files) out.push({ group: g, name: `Config file ${f.pretty}`, ok: f.exists ? f.ok : null, detail: !f.exists ? 'Not on this PC (fine).' : f.ok ? 'Parses.' : f.error, fix: f.ok === false ? 'Open the file and fix the broken JSON. A CLI may refuse to start with it.' : '' });
  out.push({ group: g, name: 'Saved (turned off) extensions file', ok: l.stash.ok ? true : false, detail: l.stash.ok ? `${l.stash.entries.length} saved entries.` : l.stash.error, fix: l.stash.ok ? '' : 'Fix or delete disabled-extensions.json in the Command Center folder.' });
  out.push({ group: g, name: 'Hooks found', ok: null, detail: String(l.counts.hooks) });
  out.push({ group: g, name: 'MCP servers found', ok: null, detail: String(l.counts.mcp) });
  out.push({ group: g, name: 'Plugins found', ok: null, detail: String(l.counts.plugins) });
  const dir = path.join(process.env.CC_EXT_HOME || os.homedir(), '.claude/projects');
  try { out.push({ group: g, name: 'Claude sessions folder', ok: true, detail: `${fs.readdirSync(dir).length} project folders.` }); } catch (e) { out.push({ group: g, name: 'Claude sessions folder', ok: null, detail: 'Not readable (Claude Code has not run on this PC yet).', fix: '' }); }
  return out;
};
