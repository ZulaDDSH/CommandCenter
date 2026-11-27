import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.mjs';
import { which } from '../cli.mjs';
import { lists } from '../sessions.mjs';

let cache = { at: 0, body: null };
const jsonOr = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

function state() {
  const home = process.env.CC_EXT_HOME || os.homedir();
  const bin = which('claude');
  const cred = jsonOr(path.join(home, '.claude/.credentials.json'));
  const acct = jsonOr(path.join(home, '.claude.json'))?.oauthAccount;
  const tier = String(acct?.organizationRateLimitTier ?? '');
  const plan = /max_20x/.test(tier) ? 'Max 20x' : /max_5x/.test(tier) ? 'Max 5x' : /max/.test(tier) ? 'Max' : /pro/.test(tier) ? 'Pro' : tier ? tier.replace(/^default_claude_|_/g, ' ').trim() : '';
  let sessions = [], error = '';
  try { sessions = lists.claude(40); } catch (e) { error = e.message; }
  return { installed: !!bin, path: bin ?? '', signedIn: !!cred?.claudeAiOauth?.accessToken, plan, enabled: !!config().providers.claude, sessions, error, usageUrl: 'https://claude.ai/settings/usage', at: Date.now() };
}

export default async ({ u, res, send }) => {
  if (u.pathname !== '/claude/state') return false;
  if (!cache.body || Date.now() - cache.at > 15000 || u.searchParams.has('fresh')) cache = { at: Date.now(), body: state() };
  send(res, 200, cache.body);
  return true;
};
