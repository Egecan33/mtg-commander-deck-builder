/** The price limits of the shared Budget filter. Pure: the server reads them too. */
export type Budget = 'any' | 'under-5' | 'under-1';

export const BUDGETS: { id: Budget; label: string; maxUsd: number | null }[] = [
  { id: 'any', label: 'Any price', maxUsd: null },
  { id: 'under-5', label: 'Under $5', maxUsd: 5 },
  { id: 'under-1', label: 'Under $1', maxUsd: 1 },
];
/** Highest price per card the budget allows, or null for any price. */
export const budgetMax = (b: Budget): number | null => BUDGETS.find((x) => x.id === b)?.maxUsd ?? null;
