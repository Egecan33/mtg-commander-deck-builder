import { describe, expect, it } from 'vitest';
import { packageNote } from '@/app/lib/ui';

const plan = [{ id: 'ramp', count: 8 }, { id: 'draw', count: 6 }, { id: 'theme:tokens', count: 9 }];

describe('packageNote', () => {
  it('names the package count when it differs from the heading', () => {
    expect(packageNote('Ramp', 6, plan)).toBe('8 in the package');
  });
  it('says nothing when the numbers agree, or the heading is not a core package', () => {
    expect(packageNote('Card draw', 6, plan)).toBeUndefined();
    expect(packageNote('Lands', 36, plan)).toBeUndefined();
    expect(packageNote('Tutors', 2, plan)).toBeUndefined();
  });
  it('says nothing without a plan', () => {
    expect(packageNote('Ramp', 6, null)).toBeUndefined();
    expect(packageNote('Ramp', 6, [])).toBeUndefined();
  });
});
