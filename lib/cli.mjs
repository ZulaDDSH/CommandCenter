import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const found = new Map(), missing = new Map();
let registryCache = { at: 0, path: '' };
export function findOnPath(name, searchPath, extensions = ['.COM', '.EXE', '.BAT', '.CMD']) {
  if (!/^[\w.-]+$/.test(name)) return null;
  const names = path.extname(name) ? [name] : extensions.map(ext => name + ext);
  for (const dir of String(searchPath || '').split(';').map(x => x.trim().replace(/^"|"$/g, '')).filter(Boolean)) {
    for (const file of names) {
      const candidate = path.join(dir, file);
      try { if (fs.statSync(candidate).isFile()) return candidate; } catch {}
    }
  }
  return null;
}
export function registryPathFromOutput(outputs, environment) {
  const env = new Map(Object.entries(environment).map(([k, v]) => [k.toUpperCase(), v]));
  return outputs.map(out => /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.+)$/im.exec(out)?.[1] || '').join(';')
    .replace(/%([^%]+)%/g, (whole, key) => env.get(key.toUpperCase()) || whole);
}
function windowsRegistryPath() {
  if (Date.now() - registryCache.at < 5000) return registryCache.path;
  const reg = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
  const values = ['HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment', 'HKCU\\Environment'].map(key => {
    const r = spawnSync(reg, ['query', key, '/v', 'Path'], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
    return r.status === 0 ? r.stdout : '';
  });
  registryCache = { at: Date.now(), path: registryPathFromOutput(values, process.env) };
  return registryCache.path;
}
const versionParts = name => (/_(\d+(?:\.\d+)*)/.exec(name)?.[1] || '').split('.').map(n => Number(n) || 0);
const compareDesc = (a, b) => {
  const va = versionParts(a), vb = versionParts(b), len = Math.max(va.length, vb.length);
  for (let i = 0; i < len; i++) if ((vb[i] || 0) !== (va[i] || 0)) return (vb[i] || 0) - (va[i] || 0);
  return b.localeCompare(a);
};
export function windowsCodexApp(programFiles = process.env.ProgramFiles || 'C:\\Program Files', regOutput) {
  const apps = path.join(programFiles, 'WindowsApps');
  let entries = [];
  try { entries = fs.readdirSync(apps); } catch {}
  if (!entries.length) {
    let out = regOutput;
    if (out === undefined && process.platform === 'win32') {
      const reg = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
      const r = spawnSync(reg, ['query', 'HKCU\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\Repository\\Packages', '/f', 'OpenAI.Codex_', '/k'], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
      out = r.status === 0 ? r.stdout : '';
    }
    entries = String(out || '').split(/\r?\n/).map(line => line.trim().split('\\').pop()).filter(Boolean);
  }
  for (const dir of entries.filter(d => /^OpenAI\.Codex_/i.test(d)).sort(compareDesc)) {
    const candidate = path.join(apps, dir, 'app', 'resources', 'codex.exe');
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch {}
  }
  return null;
}
export function which(name) {
  const cached = found.get(name);
  if (cached && fs.existsSync(cached)) return cached;
  found.delete(name);
  if (Date.now() - (missing.get(name) ?? -Infinity) < 5000) return null;
  const win = process.platform === 'win32';
  const codexApp = win && /^codex(?:\.exe)?$/i.test(name) ? windowsCodexApp() : null;
  if (codexApp) { found.set(name, codexApp); missing.delete(name); return codexApp; }
  const command = win ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'where.exe') : 'which';
  const r = spawnSync(command, [name], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
  const hits = r.status === 0 ? r.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean) : [];
  const hit = (win ? hits.find(h => /\.(exe|cmd|bat|com)$/i.test(h)) || findOnPath(name, process.env.Path || process.env.PATH) || findOnPath(name, windowsRegistryPath()) : hits[0]) ?? null;
  if (hit) { found.set(name, hit); missing.delete(name); } else missing.set(name, Date.now());
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
