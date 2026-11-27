import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-task-errors-'));
process.env.CC_ROOT = root;
try {
  const { DEFAULTS } = await import('../lib/config.mjs');
  assert.equal(DEFAULTS.models.codex, 'gpt-6.1-terra');
  assert.equal(DEFAULTS.models.opencode, 'opencode/deepseek-v4.1-flash-free');
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ taskWorktrees: false, reportsDir: path.join(root, 'reports') }));
  const { failureDetail, display, freebuffExitNote, opencodeHasWork, opencodeAttemptMatch, canFallbackOpenCode, add, startForCheck, queueOpenCodeFallback, modelFor, cancel } = await import('../lib/tasks.mjs');
  const model = 'ERROR: {"message":"The model is not supported for this account.","code":"model_not_found"}';
  const warning = 'WARN MCP startup failed during shutdown';
  const result = failureDetail(`${model}\n${warning}`);
  assert.match(result.message, /model is not supported/);
  assert.equal(result.login, false);
  assert.match(failureDetail(`${model}\nERROR failed during shutdown`).message, /model is not supported/);
  const attempts = `[2026-11-27T09:00:00.000Z] codex exec\n${model}\n[2026-11-27T10:00:00.000Z] codex exec\nError: Invalid credential`;
  assert.match(failureDetail(attempts).message, /Invalid credential/);
  assert.equal(failureDetail(attempts).login, true);
  assert.equal(failureDetail('Error: Invalid credential').login, true);
  assert.equal(failureDetail('Error: Invalid credentials').login, true);
  assert.match(freebuffExitNote(7), /exit code 7/);
  assert.doesNotMatch(freebuffExitNote(undefined), /exit code/);

  const rejected = `ERROR: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The 'gpt-6.1-terra' model is not supported when using Codex with a ChatGPT account.","code":"model_not_found","subreason":"model_not_in_accessible_catalog"}}`;
  const detail = failureDetail(rejected, 'codex', 'gpt-6.1-terra');
  assert.equal(detail.modelUnavailable, true);
  assert.equal(detail.login, false);
  assert.match(detail.message, /verified in this signed-in Codex account/);
  assert.match(detail.message, /No fallback is being attempted/);
  assert.equal(failureDetail(rejected, 'opencode', 'gpt-6.1-terra').modelUnavailable, undefined);
  assert.equal(failureDetail('ERROR: model_not_found in a local fixture', 'codex', 'gpt-6.1-terra').modelUnavailable, undefined);
  assert.equal(failureDetail(`${rejected}\n[2026-11-27T10:00:00.000Z] codex exec\nError: Invalid credential`, 'codex', 'gpt-6.1-terra').modelUnavailable, undefined);

  const freeModel = DEFAULTS.models.opencode, paidModel = 'opencode-go/deepseek-v4.1-flash';
  for (const marker of ['FreeUsageLimitError', 'Free usage limit reached', 'Free usage exceeded', "You've used today's free messages", 'provider.free-limit']) {
    assert.equal(failureDetail(`ERROR: ${marker}`, 'opencode', freeModel).freeQuotaExhausted, true, marker);
  }
  assert.equal(failureDetail('ERROR: HTTP 429 rate limit exceeded', 'opencode', freeModel).freeQuotaExhausted, false);
  assert.equal(failureDetail('Error: Invalid credential', 'opencode', freeModel).freeQuotaExhausted, false);
  assert.equal(failureDetail('ERROR: Free usage limit reached', 'opencode', paidModel).freeQuotaExhausted, false);
  assert.equal(opencodeHasWork(null), null);
  assert.equal(opencodeHasWork({ steps: [{ k: 'user', text: 'prompt' }] }), false);
  assert.equal(opencodeHasWork({ steps: [{ k: 'text', text: 'assistant response' }] }), true);
  assert.equal(opencodeHasWork({ steps: [{ k: 'tool', name: 'edit' }] }), true);
  const attemptAt = new Date().toISOString(), attempt = { id: 'cc-check', title: 'Example task', cwd: root };
  const session = { id: 'ses_check', title: 'cc-check Example task', cwd: root, started: attemptAt };
  assert.equal(opencodeAttemptMatch([session], attempt, attemptAt)?.id, session.id);
  assert.equal(opencodeAttemptMatch([session, { ...session, id: 'ses_duplicate' }], attempt, attemptAt), null);
  assert.equal(opencodeAttemptMatch([{ ...session, cwd: path.join(root, 'other') }], attempt, attemptAt), null);
  const noWorkFailure = failureDetail('ERROR: Free usage limit reached', 'opencode', freeModel);
  const fallbackConfig = { models: { opencode: freeModel } };
  assert.equal(canFallbackOpenCode({ provider: 'opencode' }, freeModel, noWorkFailure, false, fallbackConfig), true);
  assert.equal(canFallbackOpenCode({}, freeModel, noWorkFailure, false, { models: { opencode: 'other-model' }, workerModels: { opencode: freeModel } }), true);
  assert.equal(canFallbackOpenCode({ modelPref: freeModel }, freeModel, noWorkFailure, false, fallbackConfig), false);
  assert.equal(canFallbackOpenCode({ opencodeFallbackAttempted: true }, freeModel, noWorkFailure, false, fallbackConfig), false);
  assert.equal(canFallbackOpenCode({ opencodeFallbackBlocked: true }, freeModel, noWorkFailure, false, fallbackConfig), false);
  assert.equal(canFallbackOpenCode({ resume: {} }, freeModel, noWorkFailure, false, fallbackConfig), false);
  assert.equal(canFallbackOpenCode({}, freeModel, noWorkFailure, null, fallbackConfig), false);
  assert.equal(canFallbackOpenCode({}, freeModel, noWorkFailure, true, fallbackConfig), false);
  assert.equal(canFallbackOpenCode({}, paidModel, noWorkFailure, false, fallbackConfig), false);

  const dispatchTask = add({ title: 'Fallback dispatch check', text: 'Read only test task.', provider: 'opencode', cwd: root, direct: true });
  try {
    const running = startForCheck(dispatchTask.id, 'opencode', () => ({ call: { cmd: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], opts: {} } }));
    assert.equal(running.status, 'running');
    const waiting = queueOpenCodeFallback(running);
    assert.equal(waiting.status, 'waiting');
    assert.equal(waiting.opencodeFallbackModel, paidModel);
    assert.equal(waiting.lease, undefined);
    assert.equal(waiting.heartbeatAt, undefined);
    assert.equal(waiting.pid, undefined);
    assert.equal(modelFor(waiting, 'opencode'), paidModel);
    assert.equal(modelFor({ ...waiting, modelPref: 'opencode/custom-choice' }, 'opencode'), 'opencode/custom-choice');
  } finally {
    cancel(dispatchTask.id, 'Isolated fallback dispatch check cleanup.');
  }

  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'logs', 'sample.log'), `${model}\n${warning}`);
  const row = { id: 'sample', status: 'failed', ranOn: 'codex', exitCode: 1, note: 'codex stopped with exit code 1. Last error: shutdown' };
  assert.match(display(row).note, /model is not supported/);
  assert.match(row.note, /shutdown/);
  fs.writeFileSync(path.join(root, 'logs', 'sample.log'), rejected);
  assert.match(display({ ...row, modelId: 'gpt-6.1-terra' }).note, /verified in this signed-in Codex account/);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
