import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'config.json');

export const DEFAULTS = {
  setupDone: false,
  providers: { freebuff: true, codex: true, cursor: true, opencode: true, claude: false },
  projectDir: '',
  reportsDir: path.join(ROOT, 'reports'),
  runtimeDir: '',
  maxClis: 3,
  maxParallel: { codex: 2, cursor: 1, opencode: 2, claude: 1 },
  stuckAfterMin: 90,
  taskWorktrees: true,
  mergeEnabled: false,
  models: { codex: 'gpt-6.1-terra', codexEffort: 'high', cursor: 'composer-2.5', opencode: 'opencode-go/deepseek-v4.1-flash', claude: 'sonnet' },
};

let cached = null;
export function config() {
  if (cached) return cached;
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
  cached = { ...DEFAULTS, ...saved, providers: { ...DEFAULTS.providers, ...saved.providers }, maxParallel: { ...DEFAULTS.maxParallel, ...saved.maxParallel }, models: { ...DEFAULTS.models, ...saved.models } };
  delete cached.billingUrl;
  cached.exists = fs.existsSync(FILE);
  return cached;
}

export function saveConfig(patch) {
  const { exists, ...cur } = config();
  const next = { ...cur, ...patch };
  delete next.billingUrl;
  for (const k of ['providers', 'maxParallel', 'models']) next[k] = { ...cur[k], ...patch[k] };
  fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(next, null, 2));
  fs.renameSync(`${FILE}.tmp`, FILE);
  cached = null;
  return config();
}
