import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

describe('better-sqlite3 native binding', () => {
  it('opens an in-memory database', () => {
    const db = new Database(':memory:');
    db.exec('create table t (a integer); insert into t values (41), (1)');
    const row = db.prepare('select sum(a) as s from t').get() as { s: number };
    expect(row.s).toBe(42);
    db.close();
  });
});
