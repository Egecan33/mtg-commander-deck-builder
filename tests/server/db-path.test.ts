import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATA_DIR, DEFAULT_DB_PATH } from '@/server/db';

describe('database location', () => {
  it('defaults to data/forge.db, as the spec states', () => {
    expect(DEFAULT_DB_PATH).toBe(path.join(DATA_DIR, 'forge.db'));
  });
});
