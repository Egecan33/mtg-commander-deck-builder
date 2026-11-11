import { describe, expect, it } from 'vitest';
import type { Bracket } from '@/engine/types';

describe('smoke', () => {
  it('runs the test harness and resolves the @ alias', () => {
    const bracket: Bracket = 2;
    expect(1 + 1).toBe(bracket);
  });
});
