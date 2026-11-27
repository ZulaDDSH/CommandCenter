import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claude, opencode } from '../usage/providers.mjs';
import { budget } from '../lib/orchestrator.mjs';
import { childEnv } from '../usage/exec.mjs';

const originalFetch = globalThis.fetch;
const originalClaude = process.env.CLAUDE_CODE_OAUTH_TOKEN;
const originalOpenCode = process.env.OPENCODE_API_KEY;
const originalUsageKey = process.env.CC_OPENCODE_USAGE_KEY;
const originalHome = process.env.CC_EXT_HOME;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-usage-'));
try {
  process.env.CLAUDE_CODE_OAUTH_TOKEN = 'private-claude-fixture';
  process.env.OPENCODE_API_KEY = 'private-opencode-fixture';
  process.env.CC_OPENCODE_USAGE_KEY = 'private-usage-fixture';
  assert.equal(childEnv().CC_OPENCODE_USAGE_KEY, undefined);
  globalThis.fetch = async (url, options) => {
    assert.equal(options.redirect, 'error');
    if (url.includes('anthropic.com')) {
      assert.equal(options.headers['anthropic-beta'], 'oauth-2025-04-20');
      return { ok: true, json: async () => ({ five_hour: { utilization: 20, resets_at: '2099-01-01T00:00:00Z' }, seven_day_opus: { utilization: 75 } }) };
    }
    assert.equal(url, 'https://opencode.ai/zen/go/v1/usage');
    assert.equal(options.headers['x-opencode-session'], 'command-center-usage');
    assert.equal(options.headers.Authorization, 'Bearer private-usage-fixture');
    return { ok: true, json: async () => ({ usage: { rolling: { percent: 30 }, weekly: { percent: 80 } } }) };
  };
  const c = await claude(), o = await opencode();
  assert.deepEqual(c.windows.map(w => [w.name, w.usedPercent]), [['five_hour', 20], ['seven_day_opus', 75]]);
  assert.deepEqual(o.windows.map(w => [w.name, w.usedPercent]), [['rolling', 30], ['weekly', 80]]);
  const b = budget({ usage: name => name === 'claude' ? { windows: [{ label: 'Old window', usedPercent: 60, resetsAt: '2000-01-01T00:00:00Z' }] } : name === 'opencode' ? { windows: [{ name: 'rolling', usedPercent: 20, resetsAt: '2099-01-01T00:00:00Z' }] } : null });
  assert.equal(b.providers.claude.windows[0].stale, true);
  assert.equal(b.providers.opencode.windows[0].stale, false);
  globalThis.fetch = async () => ({ ok: false, status: 403 });
  const denied = JSON.stringify([await claude(), await opencode()]);
  assert.match(denied, /403/);
  assert.doesNotMatch(denied, /private-(claude|opencode|usage)-fixture/);
  process.env.CC_OPENCODE_USAGE_KEY = 'not a key';
  assert.match((await opencode()).limits, /malformed/);
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  process.env.CC_EXT_HOME = temp;
  assert.match((await claude()).error, /no Claude Code sign-in/);
  fs.mkdirSync(path.join(temp, '.claude'));
  fs.writeFileSync(path.join(temp, '.claude', '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'private-expired-fixture', expiresAt: 1000 } }));
  assert.match((await claude()).error, /expired/);
} finally {
  globalThis.fetch = originalFetch;
  if (originalClaude === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN; else process.env.CLAUDE_CODE_OAUTH_TOKEN = originalClaude;
  if (originalOpenCode === undefined) delete process.env.OPENCODE_API_KEY; else process.env.OPENCODE_API_KEY = originalOpenCode;
  if (originalUsageKey === undefined) delete process.env.CC_OPENCODE_USAGE_KEY; else process.env.CC_OPENCODE_USAGE_KEY = originalUsageKey;
  if (originalHome === undefined) delete process.env.CC_EXT_HOME; else process.env.CC_EXT_HOME = originalHome;
  fs.rmSync(temp, { recursive: true, force: true });
}
