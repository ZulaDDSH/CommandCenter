import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = process.env.CC_ROOT ? path.resolve(process.env.CC_ROOT) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'config.json');

export const DEFAULTS = {
  setupDone: false,
  providers: { freebuff: true, codex: true, cursor: true, opencode: true, claude: false, antigravity: false },
  projectDir: '',
  reportsDir: path.join(ROOT, 'reports'),
  runtimeDir: '',
  maxClis: 3,
  maxParallel: { codex: 2, cursor: 1, opencode: 2, claude: 1, antigravity: 1 },
  stuckAfterMin: 90,
  taskWorktrees: true,
  mergeEnabled: false,
  team: [],
  models: { codex: 'gpt-6.1-terra', codexEffort: 'high', cursor: 'composer-2.5', opencode: 'opencode/deepseek-v4.1-flash-free', claude: 'sonnet', antigravity: 'gemini-3.8-flash-medium' },
};

let cached = null;
export function config() {
  if (cached) return cached;
  let saved = {}, readError = null;
  try { const raw = fs.readFileSync(FILE, 'utf8'); saved = JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw); } catch (e) { if (e.code !== 'ENOENT') readError = e.message; }
  cached = { ...DEFAULTS, ...saved, providers: { ...DEFAULTS.providers, ...saved.providers }, maxParallel: { ...DEFAULTS.maxParallel, ...saved.maxParallel }, models: { ...DEFAULTS.models, ...saved.models } };
  delete cached.billingUrl;
  cached.exists = fs.existsSync(FILE);
  cached.readError = readError;
  return cached;
}

export function saveConfig(patch) {
  const { exists, readError, ...cur } = config();
  if (readError) fs.copyFileSync(FILE, `${FILE}.unreadable-${Date.now()}`);
  const next = { ...cur, ...patch };
  delete next.billingUrl;
  for (const k of ['providers', 'maxParallel', 'models']) next[k] = { ...cur[k], ...patch[k] };
  fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(next, null, 2));
  fs.renameSync(`${FILE}.tmp`, FILE);
  cached = null;
  return config();
}
