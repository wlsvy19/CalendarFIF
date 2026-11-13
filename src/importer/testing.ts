// 테스트 전용. DesktopCal과 같은 모양의 calendar.db를 지어낸 자료로 만든다.
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SourceRow } from './convert';

export function makeSourceDb(dir: string, rows: SourceRow[]): string {
  const dbPath = join(dir, 'calendar.db');
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('create table item_table(it_id integer primary key, it_unique_id text, it_content text, it_bgcolor text, it_stime integer)');
    const insert = db.prepare('insert into item_table(it_unique_id, it_content, it_bgcolor, it_stime) values (?, ?, ?, ?)');
    for (const row of rows) insert.run(row.key, row.content, row.bgcolor, row.stime);
  } finally {
    db.close();
  }
  return dbPath;
}
