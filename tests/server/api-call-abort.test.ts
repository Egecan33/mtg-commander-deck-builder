import { afterEach, describe, expect, it, vi } from 'vitest';
import { getBoxes } from '@/app/lib/api';

afterEach(() => vi.unstubAllGlobals());

describe('client api call on abort', () => {
  it('rejects with the abort instead of resolving null when the body read is cut off', async () => {
    const ctrl = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          ctrl.abort();
          throw new DOMException('The operation was aborted.', 'AbortError');
        },
      })),
    );
    await expect(getBoxes(ctrl.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('still reports an empty body through the status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } })),
    );
    await expect(getBoxes()).rejects.toMatchObject({ status: 502 });
  });
});
