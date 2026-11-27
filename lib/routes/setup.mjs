import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { saveConfig, ROOT } from '../config.mjs';
import * as setup from '../setup.mjs';

const slash = x => String(x).replace(/\\/g, '/');
const MODEL_ID = /^\w[\w.:/@-]{0,79}$/;
const PROVIDER_KEYS = Object.keys(setup.PROVIDERS);
const PARALLEL_KEYS = ['codex', 'cursor', 'opencode', 'claude', 'antigravity'];
const MODEL_KEYS = ['codex', 'codexEffort', 'cursor', 'opencode', 'claude', 'antigravity'];
const REGISTER = ['claude', 'codex', 'opencode', 'cursor'];
const bad = msg => Object.assign(new Error(msg), { bad: true });
const obj = (v, name) => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad(`${name} must be an object.`); return v; };
const int = (v, lo, hi, name) => { if (!Number.isInteger(v) || v < lo || v > hi) throw bad(`${name} must be a whole number from ${lo} to ${hi}.`); return v; };

function folder(v, name, { make = false, blank = false } = {}) {
  if (typeof v !== 'string' || v.length > 400 || v.includes('\0')) throw bad(`${name} must be a folder path.`);
  if (v === '') { if (blank) return ''; throw bad(`${name} cannot be empty.`); }
  if (!path.isAbsolute(v)) throw bad(`${name} must be a full path, like C:/Projects/app.`);
  if (/^[\\/]{2}/.test(v)) throw bad(`${name} must be on this PC, not a network share.`);
  const p = path.resolve(v);
  if (fs.existsSync(p)) { if (!fs.statSync(p).isDirectory()) throw bad(`${slash(p)} is a file, not a folder.`); }
  else if (make) { if (!fs.existsSync(path.dirname(p))) throw bad(`The folder ${slash(path.dirname(p))} does not exist.`); }
  else throw bad(`The folder ${slash(p)} does not exist.`);
  return slash(p);
}

function ignoreReports(dir) {
  const ex = path.join(path.dirname(dir), '.git', 'info', 'exclude');
  try {
    if (!fs.existsSync(path.dirname(ex))) return;
    const t = fs.existsSync(ex) ? fs.readFileSync(ex, 'utf8') : '';
    if (!/^\/?\.cc-reports\/?\s*$/m.test(t)) fs.appendFileSync(ex, (t && !t.endsWith('\n') ? '\n' : '') + '.cc-reports/\n');
  } catch {}
}

export function validate(body) {
  const b = obj(body, 'The request'), out = {};
  if ('setupDone' in b) { if (typeof b.setupDone !== 'boolean') throw bad('setupDone must be true or false.'); out.setupDone = b.setupDone; }
  if ('providers' in b) {
    out.providers = {};
    for (const [k, v] of Object.entries(obj(b.providers, 'providers'))) {
      if (!PROVIDER_KEYS.includes(k)) continue;
      if (typeof v !== 'boolean') throw bad(`providers.${k} must be true or false.`);
      out.providers[k] = v;
    }
  }
  if ('projectDir' in b) out.projectDir = folder(b.projectDir, 'The project folder', { blank: true });
  if ('reportsDir' in b) out.reportsDir = folder(b.reportsDir, 'The reports folder', { make: true });
  if ('runtimeDir' in b) out.runtimeDir = folder(b.runtimeDir, 'The relay runtime folder', { blank: true });
  if ('maxClis' in b) out.maxClis = int(b.maxClis, 1, 10, 'Freebuff CLIs at most');
  if ('stuckAfterMin' in b) out.stuckAfterMin = int(b.stuckAfterMin, 1, 1440, 'Stuck after (minutes)');
  if ('maxParallel' in b) {
    out.maxParallel = {};
    for (const [k, v] of Object.entries(obj(b.maxParallel, 'maxParallel'))) if (PARALLEL_KEYS.includes(k)) out.maxParallel[k] = int(v, 0, k === 'antigravity' ? 1 : 10, `Tasks at once for ${k}`);
  }
  if ('models' in b) {
    out.models = {};
    for (const [k, v] of Object.entries(obj(b.models, 'models'))) {
      if (!MODEL_KEYS.includes(k)) continue;
      if (typeof v !== 'string' || !MODEL_ID.test(v)) throw bad(`The ${k} model name is not valid. Use letters, numbers and . : / @ - _ only.`);
      out.models[k] = v;
    }
  }
  return out;
}

export const PICK_PS = `Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = $env:CC_PICK_TITLE
$d.ShowNewFolderButton = $true
if ($env:CC_PICK_START -and (Test-Path -LiteralPath $env:CC_PICK_START)) { $d.SelectedPath = $env:CC_PICK_START }
if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }
`;
const TITLES = { project: 'Choose your project folder', reports: 'Choose the folder for agent reports', runtime: 'Choose the relay runtime folder' };
let picking = false;

function pickFolder(what, start) {
  return new Promise(ok => {
    const env = { ...process.env, CC_PICK_TITLE: TITLES[what], CC_PICK_START: start };
    const c = spawn('powershell.exe', ['-NoProfile', '-STA', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(PICK_PS, 'utf16le').toString('base64')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => c.kill(), 300000);
    c.stdout.on('data', d => { out += d; });
    c.stderr.on('data', d => { err += d; });
    c.on('error', e => { clearTimeout(timer); ok({ error: e.message }); });
    c.on('close', () => { clearTimeout(timer); ok(out.trim() ? { path: slash(out.trim()) } : err.trim() ? { error: err.trim().slice(0, 200) } : { path: null }); });
  });
}

const guideText = () => {
  const dir = path.join(ROOT, 'docs/ai-guide');
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort(); } catch {}
  return files.map(f => fs.readFileSync(path.join(dir, f), 'utf8').trim()).join('\n\n---\n\n') || 'No AI guide files yet.';
};

export default async ctx => {
  const { req, res, u, q, send } = ctx, p = u.pathname, post = req.method === 'POST';
  const state = () => setup.status(ctx.json(ctx.cachedUsage('cursor')));
  if (p === '/ai-guide' && !post) return send(res, 200, guideText(), 'text/plain; charset=utf-8'), true;
  if (p === '/setup/folders' && !post) return send(res, 200, { repos: setup.repos() }), true;
  if (!post || !p.startsWith('/setup')) return false;

  if (p === '/setup') {
    let patch;
    try { patch = validate(JSON.parse(await ctx.readBody(req, 20000))); }
    catch (e) { send(res, 400, { error: e.bad ? e.message : `Bad request: ${e.message}` }); return true; }
    if (patch.reportsDir) {
      try { fs.mkdirSync(patch.reportsDir, { recursive: true }); } catch (e) { send(res, 400, { error: `Cannot make the folder ${patch.reportsDir}: ${e.message}` }); return true; }
      if (path.basename(patch.reportsDir) === '.cc-reports') ignoreReports(patch.reportsDir);
    }
    saveConfig(patch);
    ctx.clearSessions();
    ctx.cachedUsage('route', true);
    send(res, 200, state());
    return true;
  }
  if (p === '/setup/pick-folder') {
    if (process.platform !== 'win32') return send(res, 501, { error: 'The folder window only works on Windows. Pick from the list instead.' }), true;
    if (picking) return send(res, 409, { error: 'A folder window is already open. Close it first.' }), true;
    const what = Object.hasOwn(TITLES, q('what')) ? q('what') : 'project', s = q('start');
    const start = s && path.isAbsolute(s) && !/^[\\/]{2}/.test(s) && fs.existsSync(s) ? path.resolve(s) : '';
    picking = true;
    const r = await pickFolder(what, start);
    picking = false;
    return send(res, r.error ? 500 : 200, r), true;
  }
  if (p === '/setup/hook') {
    try { setup.installHook(); send(res, 200, state()); }
    catch (e) { send(res, 400, { error: e.message }); }
    return true;
  }
  if (p === '/setup/register') {
    const t = q('t');
    if (!REGISTER.includes(t)) return send(res, 400, { error: 'Unknown tool.' }), true;
    const script = path.join(ROOT, 'tools/register.mjs');
    if (!fs.existsSync(script)) return send(res, 400, { error: 'tools/register.mjs is not in this copy of the Command Center.' }), true;
    ctx.openTerminal(`register ${t}`, `node "${slash(script)}" ${t}`);
    return send(res, 200, 'opened', 'text/plain'), true;
  }
  if (p === '/setup/patch') {
    ctx.openTerminal('relay patch', setup.command('runtime', 'patch'));
    return send(res, 200, 'opened', 'text/plain'), true;
  }
  return false;
};
