export function taskModel(t, provider) {
  return t.modelId || (t.model ? t.model.replace(/ \((low|medium|high|xhigh|max)\)$/, '') : t.provider === provider ? t.modelPref : '') || '';
}
export function modelCounts(tasks, provider) {
  const counts = new Map();
  for (const t of tasks) {
    if (!['starting', 'running'].includes(t.status) || t.ranOn !== provider || t.role === 'orchestrator') continue;
    const model = taskModel(t, provider);
    counts.set(model, (counts.get(model) || 0) + 1);
  }
  return [...counts].map(([model, count]) => ({ model, count }));
}
export function modelSlots(tasks, provider, model) {
  return modelCounts(tasks, provider).reduce((n, row) => n + (!row.model || row.model === model ? row.count : 0), 0);
}
