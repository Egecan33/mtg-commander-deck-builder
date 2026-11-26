import { describe, expect, it } from 'vitest';
import { fmtRatingChange } from '@/app/lib/ui';

describe('fmtRatingChange', () => {
  it('shows whole numbers when they show the change', () => {
    expect(fmtRatingChange(77, 79)).toBe('77 → 79');
    expect(fmtRatingChange(77.4, 79.2)).toBe('77 → 79');
    expect(fmtRatingChange(80, 80)).toBe('80 → 80');
  });

  it('adds one decimal when whole numbers would hide the change', () => {
    expect(fmtRatingChange(77.2, 77.4)).toBe('77.2 → 77.4');
    expect(fmtRatingChange(79.6, 80.4)).toBe('79.6 → 80.4');
  });
});
