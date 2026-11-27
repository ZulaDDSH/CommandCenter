#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApi } from './cc-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const NAME = 'command-center';
const MCP = path.join(ROOT, 'tools', 'mcp.mjs');
const HOME = os.homedir();
const FILES = {
  claude: path.join(HOME, '.claude.json'),
  codex: path.join(HOME, '.codex/config.toml'),
  opencode: path.join(HOME, '.config/opencode/opencode.json'),
  cursor: path.join(HOME, '.cursor/mcp.json'),
};
export const CLIS = Object.keys(FILES);

export function registered(p) {
  let s; try { s = fs.readFileSync(FILES[p], 'utf8'); } catch { return false; }
  if (p === 'codex') return new RegExp(`^\\[mcp_servers\\.${NAME}\\]`, 'm').test(s);
  try { const j = JSON.parse(s); return Object.hasOwn(j[p === 'cursor' ? 'mcpServers' : 'mcp'] ?? {}, NAME) || (p === 'claude' && Object.hasOwn(j.mcpServers ?? {}, NAME)); } catch { return false; }
}

function backup(file) {
  const dir = process.env.CC_BACKUP_DIR || path.join(ROOT, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const to = path.join(dir, `${path.basename(file)}.${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.copyFileSync(file, to);
  return to;
}

function editJson(file, key, entry, remove, dry, say) {
  const exists = fs.existsSync(file);
  let j = {};
  if (exists) { try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error(`${file} is not plain JSON (comments?), so I will not rewrite it. Add the "${NAME}" entry by hand.`); } }
  const had = Object.hasOwn(j[key] ?? {}, NAME);
  if (remove && !had) return say(`${NAME} was not in ${file}; nothing to remove.`);
  if (remove) delete j[key][NAME]; else j[key] = { ...j[key], [NAME]: entry };
  if (dry) return say(`Would ${remove ? 'remove' : 'write'} "${NAME}" ${remove ? 'from' : 'in'} ${file}.`);
  const saved = exists ? backup(file) : null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.cc-tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(j, null, 2));
    JSON.parse(fs.readFileSync(tmp, 'utf8'));
    fs.renameSync(tmp, file);
  } finally { fs.rmSync(tmp, { force: true }); }
  JSON.parse(fs.readFileSync(file, 'utf8'));
  say(`${remove ? 'Removed' : 'Added'} "${NAME}" ${remove ? 'from' : 'to'} ${file}.${saved ? ` Backup: ${saved}` : ''}`);
}

export function register(p, { remove = false, dry = false, say = console.log } = {}) {
  if (!CLIS.includes(p)) throw new Error(`Unknown CLI "${p}". Use one of: ${CLIS.join(', ')}.`);
  const node = process.execPath;
  if (p === 'opencode') return editJson(FILES.opencode, 'mcp', { type: 'local', enabled: true, command: [node, MCP] }, remove, dry, say);
  if (p === 'cursor') return editJson(FILES.cursor, 'mcpServers', { command: node, args: [MCP] }, remove, dry, say);
  const rm = p === 'claude' ? ['mcp', 'remove', '--scope', 'user', NAME] : ['mcp', 'remove', NAME];
  const add = p === 'claude' ? ['mcp', 'add', '--scope', 'user', NAME, '--', node, MCP] : ['mcp', 'add', NAME, '--', node, MCP];
  const plan = remove ? [rm] : [rm, add];
  if (dry) return say(`Would run: ${plan.map(a => `${p} ${a.join(' ')}`).join('  then  ')}`);
  const has = registered(p);
  if (remove && !has) return say(`${NAME} was not in ${p}; nothing to remove.`);
  if (fs.existsSync(FILES[p])) say(`Backup: ${backup(FILES[p])}`);
  const { run } = createApi();
  if (has) { const r = run(p, rm); if (remove) return say(r.code === 0 ? `Removed "${NAME}" from ${p}.` : `${p} says: ${(r.stderr || r.stdout).trim()}`); }
  const r = run(p, add);
  if (r.code !== 0) throw new Error(`${p} failed: ${(r.stderr || r.stdout).trim()}`);
  say(`Added "${NAME}" to ${p}. Restart ${p} to see the run_script tool.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [p, ...f] = process.argv.slice(2);
  try {
    if (p === 'status') for (const c of CLIS) console.log(`${c}: ${registered(c) ? 'registered' : 'not registered'}`);
    else register(p, { remove: f.includes('--remove'), dry: f.includes('--dry-run') });
  } catch (e) { console.error(`Error: ${e.message}`); process.exitCode = 1; }
}
