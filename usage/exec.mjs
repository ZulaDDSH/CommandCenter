import { execFile } from 'node:child_process';
import { which, cursorCmd, cursorPs1 } from '../lib/cli.mjs';

const win = process.platform === 'win32';
export const findBin = name => which(name);

export const binOf = p => p === 'antigravity' ? 'agy' : p;
export const isInstalled = p => p === 'freebuff' ? true : p === 'cursor' ? !!(findBin('cursor-agent') || cursorPs1()) : !!findBin(binOf(p));

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

const LOGIN_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'CURSOR_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_API_KEY', 'AGY_ADC_AUTH'];
export const childEnv = extra => Object.fromEntries(Object.entries({ ...process.env, ...extra }).filter(([k]) => !LOGIN_KEYS.includes(k.toUpperCase())));

export function runCall(call, timeout = 60000) {
  return new Promise(resolve => {
    let c;
    try { c = typeof call === 'function' ? call() : call; } catch (err) { return resolve({ err, out: '', errOut: '' }); }
    execFile(c.cmd, c.args, { timeout, windowsHide: true, maxBuffer: 8 << 20, ...c.opts, env: childEnv(c.opts?.env) }, (err, out, errOut) => resolve({ err, out: String(out ?? ''), errOut: String(errOut ?? '') }));
  });
}

export const runBin = (name, args, timeout) => runCall(() => binCall(name, args), timeout);
