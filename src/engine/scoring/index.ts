import type { createScorer } from './scorer';

export { STAPLE_FLOOR, STAPLE_QUALITY, WEIGHTS_EDHREC, WEIGHTS_PLAIN, createScorer } from './scorer';
export type Scorer = ReturnType<typeof createScorer>;
