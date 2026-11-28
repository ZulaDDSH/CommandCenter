import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';

function overview(project, scope, file) {
  const db = new DatabaseSync(path.join(project, '.codegraph', 'codegraph.db'), { readOnly: true });
  try {
    const groups = new Map(), links = new Map(), prefix = scope ? scope.replace(/\/$/, '') + '/' : '';
    const inside = p => file ? p === file : !scope || p.startsWith(prefix);
    const group = (p, id) => {
      if (file && p === file) return `symbol:${id}`;
      if (file || (scope && !p.startsWith(prefix))) return `outside:${p}`;
      const tail = p.slice(prefix.length), i = tail.indexOf('/');
      return (i < 0 ? 'file:' + p : 'folder:' + prefix + tail.slice(0, i));
    };
    const ensure = (key, p, name, kind) => {
      if (!groups.has(key)) groups.set(key, { id: key, path: p, name, kind, symbols: 0, internal: 0 });
      return groups.get(key);
    };
    const escapeLike = s => s.replace(/[\\%_]/g, x => '\\' + x);
    const like = escapeLike(prefix) + '%';
    const nodeSql = file ? 'SELECT id,name,kind,file_path FROM nodes WHERE file_path = ?' : scope ? "SELECT id,name,kind,file_path FROM nodes WHERE file_path LIKE ? ESCAPE '\\'" : 'SELECT id,name,kind,file_path FROM nodes';
    const args = file ? [file] : scope ? [like] : [];
    for (const n of db.prepare(nodeSql).iterate(...args)) {
      if (!inside(n.file_path)) continue;
      const key = group(n.file_path, n.id), type = key.slice(0, key.indexOf(':'));
      const label = type === 'symbol' ? n.name : key.slice(key.indexOf(':') + 1).split('/').at(-1);
      ensure(key, type === 'symbol' ? n.id : key.slice(key.indexOf(':') + 1), label, type).symbols++;
    }
    if (!file) {
      const fileSql = scope ? "SELECT path FROM files WHERE path LIKE ? ESCAPE '\\'" : 'SELECT path FROM files';
      for (const row of db.prepare(fileSql).iterate(...(scope ? [like] : []))) {
        if (!inside(row.path)) continue;
        const key = group(row.path, ''), type = key.slice(0, key.indexOf(':')), p = key.slice(key.indexOf(':') + 1);
        ensure(key, p, p.split('/').at(-1), type);
      }
    }
    const base = 'SELECT a.id AS a_id,a.file_path AS a_path,a.name AS a_name,b.id AS b_id,b.file_path AS b_path,b.name AS b_name,e.kind FROM edges e JOIN nodes a ON a.id=e.source JOIN nodes b ON b.id=e.target';
    const edgeSql = file ? `${base} WHERE a.file_path = ? UNION ALL ${base} WHERE b.file_path = ? AND a.file_path != ?` : scope ? `${base} WHERE a.file_path LIKE ? ESCAPE '\\' UNION ALL ${base} WHERE b.file_path LIKE ? ESCAPE '\\' AND a.file_path NOT LIKE ? ESCAPE '\\'` : base;
    const edgeArgs = file ? [file,file,file] : scope ? [like,like,like] : [];
    for (const e of db.prepare(edgeSql).iterate(...edgeArgs)) {
      if (!inside(e.a_path) && !inside(e.b_path)) continue;
      const a = group(e.a_path, e.a_id), b = group(e.b_path, e.b_id);
      for (const [key, p, name] of [[a,e.a_path,e.a_name],[b,e.b_path,e.b_name]]) {
        const type = key.slice(0, key.indexOf(':'));
        ensure(key, type === 'symbol' ? key.slice(7) : key.slice(key.indexOf(':') + 1), type === 'symbol' ? name : p.split('/').at(-1), type);
      }
      if (a === b) groups.get(a).internal++;
      else {
        const key = JSON.stringify([a,b,e.kind]);
        const link = links.get(key) || { source: a, target: b, kind: e.kind, count: 0 };
        link.count++; links.set(key, link);
      }
    }
    return { project, scope, file, nodes: [...groups.values()], links: [...links.values()] };
  } finally { db.close(); }
}

try { parentPort.postMessage({ data: overview(workerData.project, workerData.scope, workerData.file) }); }
catch (e) { parentPort.postMessage({ error: e.message }); }
