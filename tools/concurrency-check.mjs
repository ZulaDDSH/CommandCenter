import assert from 'node:assert/strict';
import { modelSlots, modelCounts } from '../lib/concurrency.mjs';
import { budgetSummary } from '../lib/orchestrator.mjs';
import { validate } from '../lib/routes/setup.mjs';

const rows = [
  ...Array.from({ length: 10 }, (_, i) => ({ status: i ? 'running' : 'starting', ranOn: 'codex', modelId: 'model-a' })),
  { status: 'running', ranOn: 'codex', model: 'model-b (high)' },
  { status: 'waiting', ranOn: 'codex', modelId: 'model-a' },
  { status: 'running', ranOn: 'codex', modelId: 'model-a', role: 'orchestrator' },
  { status: 'running', ranOn: 'claude', modelId: 'model-a' },
];
assert.equal(modelSlots(rows, 'codex', 'model-a'), 10);
assert.equal(modelSlots(rows, 'codex', 'model-b'), 1);
assert.deepEqual(modelCounts(rows, 'codex'), [{ model: 'model-a', count: 10 }, { model: 'model-b', count: 1 }]);
const summary = budgetSummary({ providers: { codex: { enabled: true, installed: true, running: 11, max: 10, modelCounts: modelCounts(rows, 'codex'), windows: [], note: '' } } });
assert.match(summary, /model-a 10, model-b 1/);
assert.equal(modelSlots([...rows, { status: 'running', ranOn: 'codex' }], 'codex', 'model-b'), 2);
assert.equal(validate({ maxParallel: { codex: 10, claude: 10 }, maxClis: 10 }).maxParallel.codex, 10);
assert.throws(() => validate({ maxParallel: { codex: 11 } }));
assert.throws(() => validate({ maxClis: 11 }));
assert.throws(() => validate({ maxParallel: { antigravity: 2 } }));
