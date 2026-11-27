import fs from 'node:fs';

export function sessionTaskResolver(tasks, logFile) {
  const byId = new Map();
  const codexTasks = [];
  const opencodeIds = [];
  for (const task of tasks) {
    if (!task.id) continue;
    byId.set(task.id, task);
    opencodeIds.push(task.id);
    if (!task.ranOn || task.ranOn === 'codex') codexTasks.push(task);
  }
  let codex = null;
  let currentCodex = null;
  const loadCodex = () => {
    if (codex) return;
    codex = new Map();
    currentCodex = new Map();
    for (const task of codexTasks) {
      try {
        const fd = fs.openSync(logFile(task.id), 'r');
        try {
          const totalSize = fs.fstatSync(fd).size;
          const size = Math.min(totalSize, 65536), buffer = Buffer.alloc(size);
          fs.readSync(fd, buffer, 0, size, 0);
          for (const match of buffer.toString('utf8').matchAll(/^session id:\s*([0-9a-f-]{36})\s*$/gim)) {
            codex.set(match[1].toLowerCase(), task);
          }
          const tailSize = Math.min(totalSize, 65536), tail = Buffer.alloc(tailSize);
          fs.readSync(fd, tail, 0, tailSize, Math.max(0, totalSize - tailSize));
          const text = tail.toString('utf8'), headers = [...text.matchAll(/^\[\d{4}-\d\d-\d\dT[^\]\r\n]+Z\] /gm)];
          if (task.ranOn === 'codex' && headers.length) {
            const matches = [...text.slice(headers.at(-1).index).matchAll(/^session id:\s*([0-9a-f-]{36})\s*$/gim)];
            const id = matches.at(-1)?.[1].toLowerCase();
            if (id) currentCodex.set(id, currentCodex.has(id) && currentCodex.get(id) !== task.id ? null : task.id);
          }
        } finally { fs.closeSync(fd); }
      } catch {}
    }
  };
  const resolve = (provider, row) => {
    if (!row) return null;
    if (provider === 'freebuff') return byId.get(row.slug ?? row.id) ?? null;
    if (provider === 'codex') { loadCodex(); return codex.get(String(row.id ?? '').toLowerCase()) ?? null; }
    if (row.sub) return null;
    if (provider === 'opencode') {
      const title = String(row.title ?? '');
      const match = opencodeIds.find(id => title.startsWith(`${id} `));
      return match ? byId.get(match) ?? null : null;
    }
    return row.taskId ? byId.get(row.taskId) ?? null : null;
  };
  resolve.codexTaskId = row => { loadCodex(); return currentCodex.get(String(row?.id ?? '').toLowerCase()); };
  return resolve;
}

export function sessionOrigin(tasks, logFile) {
  const resolve = sessionTaskResolver(tasks, logFile);
  const belongs = (provider, row) => !!resolve(provider, row);
  belongs.task = (provider, row) => provider === 'codex' ? resolve.codexTaskId(row) : undefined;
  return belongs;
}
