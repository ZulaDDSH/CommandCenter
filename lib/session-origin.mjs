import fs from 'node:fs';

export function sessionOrigin(tasks, logFile) {
  const ids = new Set();
  const codex = new Set();
  for (const task of tasks) {
    if (!task.id) continue;
    ids.add(task.id);
    try {
      const fd = fs.openSync(logFile(task.id), 'r');
      try {
        const size = Math.min(fs.fstatSync(fd).size, 65536), buffer = Buffer.alloc(size);
        fs.readSync(fd, buffer, 0, size, 0);
        for (const match of buffer.toString('utf8').matchAll(/^session id:\s*([0-9a-f-]{36})\s*$/gim)) codex.add(match[1].toLowerCase());
      } finally { fs.closeSync(fd); }
    } catch {}
  }
  return (provider, row) => {
    if (provider === 'freebuff') return ids.has(row.slug ?? row.id);
    if (provider === 'codex') return codex.has(String(row.id).toLowerCase());
    if (row.sub) return false;
    if (provider === 'opencode') return [...ids].some(id => String(row.title ?? '').startsWith(`${id} `));
    return ids.has(row.taskId);
  };
}
