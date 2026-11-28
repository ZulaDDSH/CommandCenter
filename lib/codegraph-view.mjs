import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const kinds = "'function','method','class','struct','interface'";

export function graph(project, { query = '', id = '' } = {}) {
  if (!project) throw new Error('Choose a project folder in Setup first.');
  const file = path.join(project, '.codegraph', 'codegraph.db');
  if (!fs.existsSync(file)) throw new Error('This project has no CodeGraph index. Initialize it in the project folder first.');
  if (query.length > 200 || id.length > 500) throw new Error('Search or symbol is too long.');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    if (query) {
      const rows = db.prepare(`SELECT id, name, kind, file_path AS file, start_line AS line FROM nodes WHERE kind IN (${kinds}) AND instr(lower(name), lower(?)) > 0 ORDER BY length(name), name LIMIT 30`).all(query);
      return { project, results: rows };
    }
    const center = id ? db.prepare('SELECT id, name, kind, file_path AS file, start_line AS line FROM nodes WHERE id = ?').get(id)
      : db.prepare(`SELECT n.id, n.name, n.kind, n.file_path AS file, n.start_line AS line FROM nodes n WHERE n.kind IN (${kinds}) AND EXISTS (SELECT 1 FROM edges e WHERE e.source = n.id AND e.kind = 'calls') LIMIT 1`).get();
    if (!center) throw new Error(id ? 'That symbol is no longer in this index.' : 'No callable symbols were found in this index.');
    const links = (side, join) => db.prepare(`SELECT n.id, n.name, n.kind, n.file_path AS file, n.start_line AS line, count(*) AS calls FROM edges e JOIN nodes n ON n.id = e.${join} WHERE e.${side} = ? AND e.kind = 'calls' AND n.id != ? GROUP BY n.id ORDER BY calls DESC, n.name LIMIT 13`).all(center.id, center.id);
    const callers = links('target', 'source'), callees = links('source', 'target');
    return { project, center, callers: callers.slice(0, 12), callees: callees.slice(0, 12), callersTruncated: callers.length > 12, calleesTruncated: callees.length > 12 };
  } finally { db.close(); }
}
