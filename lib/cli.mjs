import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const found = new Map();
export function which(name) {
  if (found.has(name)) return found.get(name);
  const r = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [name], { encoding: 'utf8', windowsHide: true });
  const hit = r.status === 0 ? r.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0] ?? null : null;
  if (hit) found.set(name, hit);
  return hit;
}

export function cursorPs1() {
  const cmd = which('cursor-agent');
  const near = cmd && cmd.replace(/\.(cmd|exe)$/i, '.ps1');
  if (near && fs.existsSync(near)) return near;
  const def = path.join(os.homedir(), 'AppData/Local/cursor-agent/cursor-agent.ps1');
  return fs.existsSync(def) ? def : null;
}

export function cursorCmd(args) {
  const ps1 = cursorPs1();
  if (ps1) return ['powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, ...args]];
  return ['cursor-agent', args];
}
