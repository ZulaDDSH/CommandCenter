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
  const getCodex = () => {
    if (codex) return codex;
    codex = new Map();
    for (const task of codexTasks) {
      try {
        const fd = fs.openSync(logFile(task.id), 'r');
        try {
          const size = Math.min(fs.fstatSync(fd).size, 65536), buffer = Buffer.alloc(size);
          fs.readSync(fd, buffer, 0, size, 0);
          for (const match of buffer.toString('utf8').matchAll(/^session id:\s*([0-9a-f-]{36})\s*$/gim)) codex.set(match[1].toLowerCase(), task);
        } finally { fs.closeSync(fd); }
      } catch {}
    }
    return codex;
  };
  return (provider, row) => {
    if (!row) return null;
    if (provider === 'freebuff') return byId.get(row.slug ?? row.id) ?? null;
    if (provider === 'codex') return getCodex().get(String(row.id ?? '').toLowerCase()) ?? null;
    if (row.sub) return null;
    if (provider === 'opencode') {
      const title = String(row.title ?? '');
      const match = opencodeIds.find(id => title.startsWith(`${id} `));
      return match ? byId.get(match) ?? null : null;
    }
    return row.taskId ? byId.get(row.taskId) ?? null : null;
  };
}

export function sessionOrigin(tasks, logFile) {
  const resolve = sessionTaskResolver(tasks, logFile);
  return (provider, row) => !!resolve(provider, row);
}
