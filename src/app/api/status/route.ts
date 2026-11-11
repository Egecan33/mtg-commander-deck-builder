import { poolIndex } from '@/server/cards';
import { handle, json } from '@/server/http';
import { getStatus } from '@/server/status';

export const dynamic = 'force-dynamic';

let warmed = false;

/**
 * The first status call (the app asks for it on load) also loads the card database into memory
 * right after answering, so the first analyze or browse does not pay the two seconds.
 */
function warmUp(): void {
  if (warmed) return;
  warmed = true;
  setTimeout(() => {
    try {
      poolIndex();
    } catch {
      warmed = false; // tried again with the next status call
    }
  }, 0);
}

export const GET = () =>
  handle(() => {
    const status = getStatus();
    if (status.ready) warmUp();
    return json(status);
  });
