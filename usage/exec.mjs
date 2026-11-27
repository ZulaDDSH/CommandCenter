import { spawnSync, execFile } from 'node:child_process';
import { cursorCmd, cursorPs1 } from '../lib/cli.mjs';

const win = process.platform === 'win32';
const found = new Map();

const missing = new Map();

export function findBin(name) {
  if (found.has(name)) return found.get(name);
  if (Date.now() - (missing.get(name) ?? -Infinity) < 60000) return null;
  const r = spawnSync(win ? 'where.exe' : 'which', [name], { encoding: 'utf8', windowsHide: true });
  const hits = r.status === 0 ? r.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean) : [];
  const hit = (win ? hits.find(h => /\.(exe|cmd|bat|com)$/i.test(h)) : hits[0]) ?? null;
  if (hit) found.set(name, hit); else missing.set(name, Date.now());
  return hit;
}

export const isInstalled = p => p === 'freebuff' ? true : p === 'cursor' ? !!(findBin('cursor-agent') || cursorPs1()) : !!findBin(p);

const unsafe = a => /["%\r\n\0]/.test(a) || a.endsWith('\\');

export function binCall(name, args) {
  const hit = findBin(name);
  if (!hit) throw new Error(`${name} is not installed or not on PATH.`);
  if (win && /\.(cmd|bat)$/i.test(hit)) {
    const bad = args.find(unsafe);
    if (bad !== undefined) throw new Error(`An argument for ${name} has a quote, percent sign, line break or trailing backslash, which cannot be passed safely: ${String(bad).slice(0, 60)}`);
    return { cmd: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${[hit, ...args].map(a => `"${a}"`).join(' ')}"`], opts: { windowsVerbatimArguments: true } };
  }
  return { cmd: hit, args, opts: {} };
}

export const cursorCall = args => { const [c, a] = cursorCmd(args); return binCall(c, a); };

export function runCall(call, timeout = 60000) {
  return new Promise(resolve => {
    let c;
    try { c = typeof call === 'function' ? call() : call; } catch (err) { return resolve({ err, out: '', errOut: '' }); }
    execFile(c.cmd, c.args, { timeout, windowsHide: true, maxBuffer: 8 << 20, ...c.opts }, (err, out, errOut) => resolve({ err, out: String(out ?? ''), errOut: String(errOut ?? '') }));
  });
}

export const runBin = (name, args, timeout) => runCall(() => binCall(name, args), timeout);
