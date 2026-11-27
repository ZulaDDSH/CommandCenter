import fs from 'node:fs';

export function sessionOrigin(tasks, logFile) {
  const ids = new Set();
  const codex = new Map();
  const currentCodex = new Map();
  for (const task of tasks) {
    if (!task.id) continue;
    ids.add(task.id);
    try {
      const fd = fs.openSync(logFile(task.id), 'r');
      try {
        const size = Math.min(fs.fstatSync(fd).size, 65536), buffer = Buffer.alloc(size);
        fs.readSync(fd, buffer, 0, size, 0);
        for (const match of buffer.toString('utf8').matchAll(/^session id:\s*([0-9a-f-]{36})\s*$/gim)) {
          const id = match[1].toLowerCase();
          codex.set(id, codex.has(id) && codex.get(id) !== task.id ? null : task.id);
        }
        const tailSize = Math.min(fs.fstatSync(fd).size, 65536), tail = Buffer.alloc(tailSize);
        fs.readSync(fd, tail, 0, tailSize, Math.max(0, fs.fstatSync(fd).size - tailSize));
        const text = tail.toString('utf8'), headers = [...text.matchAll(/^\[\d{4}-\d\d-\d\dT[^\]\r\n]+Z\] /gm)];
        if (task.ranOn === 'codex' && headers.length) {
          const ids = [...text.slice(headers.at(-1).index).matchAll(/^session id:\s*([0-9a-f-]{36})\s*$/gim)];
          const id = ids.at(-1)?.[1].toLowerCase();
          if (id) currentCodex.set(id, currentCodex.has(id) && currentCodex.get(id) !== task.id ? null : task.id);
        }
      } finally { fs.closeSync(fd); }
    } catch {}
  }
  const belongs = (provider, row) => {
    if (provider === 'freebuff') return ids.has(row.slug ?? row.id);
    if (provider === 'codex') return codex.has(String(row.id).toLowerCase());
    if (row.sub) return false;
    if (provider === 'opencode') return [...ids].some(id => String(row.title ?? '').startsWith(`${id} `));
    return ids.has(row.taskId);
  };
  belongs.task = (provider, row) => provider === 'codex' ? currentCodex.get(String(row.id).toLowerCase()) : undefined;
  return belongs;
}
