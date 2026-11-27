import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-task-errors-'));
process.env.CC_ROOT = root;
try {
  const { failureDetail, display, freebuffExitNote } = await import('../lib/tasks.mjs');
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

  fs.mkdirSync(path.join(root, 'logs'));
  fs.writeFileSync(path.join(root, 'logs', 'sample.log'), `${model}\n${warning}`);
  const row = { id: 'sample', status: 'failed', ranOn: 'codex', exitCode: 1, note: 'codex stopped with exit code 1. Last error: shutdown' };
  assert.match(display(row).note, /model is not supported/);
  assert.match(row.note, /shutdown/);
  fs.writeFileSync(path.join(root, 'logs', 'sample.log'), rejected);
  assert.match(display({ ...row, modelId: 'gpt-6.1-terra' }).note, /verified in this signed-in Codex account/);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
