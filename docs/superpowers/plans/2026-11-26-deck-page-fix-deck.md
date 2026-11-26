# Deck page: Fix deck, put it in instead of, clearer buttons, card quality — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-click Fix deck, swap suggestions for a card not in the deck, a grouped header, and a ninth rating part for card quality.

**Architecture:** Engine first (pure, tested on fixture cards): a `quality` sub-score that reuses the scorer's per-card quality part, `swapIn` (mirror of `replaceCard`) and `fixDeck` (legality, then a goal-directed improve built from the rating's own fixes). The server exposes them as two new `POST /api/build` modes; the deck page gets the header, the Fix panel and the card-detail suggestions.

**Tech Stack:** TypeScript strict, Vitest, Next.js 16 route handlers, React 19 + Tailwind.

**Spec:** `docs/superpowers/specs/2026-11-26-deck-page-fix-deck-design.md`

## Global Constraints

- `src/engine` stays pure; `src/engine/types.ts` additive only.
- Scoring and rating share numbers: card quality in the rating is the scorer's own `quality` part for that card (`CardScore.parts` key `'quality'`, points / max), never a re-implementation.
- Never report an illegal deck as legal; every sub-score has reasons and fixes when low; Brackets 1 and 5 are never assigned automatically.
- The app works with EDHREC off; no new network calls.
- Owned-only, free-copies-only (`freeOnly`), max price, locked cards and the target bracket hold for every new build mode exactly as for `improve`.
- `src/app/lib/api.ts` documents every endpoint and mode in its header.
- UI: plain English, sentence case, says what a control does; desktop layout; cards are images first. Keep existing `data-testid`s working.
- UI checks only on the scratch copy: `COMMANDER_FORGE_DATA=/Users/egecanaktan/github_repositories/commander-forge/.superpowers/sdd/2026-11-25-physical-collection-boxes/uidata pnpm exec next dev --webpack -p 3211`; never data/, never port 3210; net-zero; revert any AGENTS.md rewrite by `next dev`.
- Small commits on main, one concern each, imperative subject, no attribution lines.

## Review Focus

1. **Fix deck on a deck it cannot improve** (already strong, or owned-only with nothing better owned): returns no changes and a plain reason; the deck is untouched. (Task 3 test `fixDeck leaves a deck it cannot improve untouched`.)
2. **Fix deck on an illegal deck whose only legal replacements are not owned** with owned-only on: illegal cards are removed and the deck is filled from owned cards; the result is legal or the response says what still blocks it. (Task 3 test `owned-only fix removes an illegal card it cannot replace`.)
3. **Locked cards**: Fix deck and swapIn never cut a locked card or a commander. (Tasks 2–3 tests.)
4. **Rating stability**: rating tests' reference ranges still hold after the new part; no NaN on empty or partial decks. (Task 1 tests.)
5. **Undo after Fix deck** restores the exact previous deck (same entries, locks, roleTargets, built flag). (Task 5 UI check with deck JSON compared byte for byte.)

---

### Task 1: Card quality in the rating

**Files:** Modify `src/engine/rating/rate.ts` (weights, labels, ORDER, new part), `src/engine/rating/index.ts` if exports change; any UI text that says "eight" (`grep -rn "eight" src/app`); Test: `tests/engine/rating.test.ts` (+ new cases).

**Interfaces:**
- Produces: `RATING_WEIGHTS` = `{ mana: 16, roles: 14, synergy: 14, curve: 9, interaction: 9, wincons: 9, consistency: 9, bracket: 8, quality: 12 }` (sum 100); sub-score key `'quality'`, label `'Card quality'`, placed after `synergy` in ORDER.
- Card quality per card = the scorer's `'quality'` part points / max for that card in this deck (create the scorer once per rating; reuse it if `rateDeck` already has scores available). Deck value = clamp01(mean over nonland cards outside the command zone / `QUALITY_EXPECTED[bracket - 1]`), `QUALITY_EXPECTED` per bracket calibrated (start around [0.45, 0.5, 0.58, 0.66, 0.75] and tune).
- Fixes when below 0.85: one fix naming how many cards are under the bracket's expectation and the three weakest by name (`filter: null` is acceptable; better a role filter when most weak cards share a role).

- [ ] Step 1: failing tests — `returns the nine sub-scores with the plan weights` (replace the eight-weights test), `weak cards lower card quality and the rating` (swap 15 of the precon's nonland cards for the fixture's lowest-quality cards of the same roles → quality sub-score and rating both drop), `rating quality agrees with the scorer` (for one card, the deck value with a one-card deck equals that card's scorer quality / expectation, clamped), `no NaN on empty, commander-only and partial decks`.
- [ ] Step 2: run `pnpm vitest run tests/engine/rating.test.ts` → FAIL.
- [ ] Step 3: implement; calibrate `QUALITY_EXPECTED` so every existing reference-range test in rating.test.ts still passes; additionally check on the scratch copy (read-only: open it with `openDb` in a tsx one-off, no writes) that the "(from my collection)" decks drop by ≥ 8 points against today and "Mr. Spock, Science Officer" stays within 10 points of today (report the before/after table).
- [ ] Step 4: `pnpm vitest run tests/engine && pnpm typecheck` → PASS.
- [ ] Step 5: commit `feat(rating): card quality as a ninth part, from the scorer's own quality`.

### Task 2: swapIn — put a card in instead of a deck card

**Files:** Modify `src/engine/builder/goals.ts` (next to `replaceCard`), `src/engine/builder/index.ts`, `src/server/build.ts` (mode `'swapin'`), `src/app/lib/api.ts` (`BuildMode`, `BuildRequestOptions.in`, header doc); Test: `tests/engine/replace.test.ts` (or a new `tests/engine/swapin.test.ts`), `tests/server/api.test.ts` (one route case).

**Interfaces:**
- Produces: `swapIn(deck: Deck, ctx: EngineContext, opts: BuildOptions, inId: string, count = 5): SwapProposal[]` — candidates: deck main cards except locked ones and except commanders/companion; basic lands only when the deck has more lands than its land target; a full 100-card deck proposes `{ out, in: inId }`; a deck under 100 returns a plain add `{ out: '', in }` first. Sorted by `ratingAfter` descending; same-role cuts preferred on ties; `agrees`/`objection` as `replaceCard` does; an illegal or gated `inId` → `[]`. Server: mode `'swapin'` requires `options.in` (400 otherwise), `count` 1–10, response `BuildProposalsResponse` with `heldBy`.

- [ ] Step 1: failing tests — `never proposes cutting a commander or a locked card`, `a deck under 100 gets a plain add first`, `proposals are sorted by rating after the swap`, `an off-identity card gets no proposals`, route `mode swapin without options.in is a 400`.
- [ ] Step 2: run → FAIL. Step 3: implement. Step 4: `pnpm vitest run tests/engine tests/server/api.test.ts && pnpm typecheck` → PASS.
- [ ] Step 5: commit `feat(builder): suggest which deck card a new card could replace`.

### Task 3: fixDeck — legal, complete, then improved toward the rating's own fixes

**Files:** Create `src/engine/builder/fix.ts`; modify `src/engine/builder/index.ts`, `src/engine/types.ts` (additive `FixResult`), `src/server/build.ts` (mode `'fix'`), `src/app/lib/api.ts`; Test: `tests/engine/fix.test.ts`, `tests/server/api.test.ts` (one route case).

**Interfaces:**
- Consumes: `rateDeck`, `replaceCard`, `fillRest`, `improveDeck` (with `goals`), `swapIn` not needed.
- Produces: `interface FixResult { deck: Deck; changes: { out: string; in: string; reason: string }[]; ratingBefore: number; ratingAfter: number; note: string | null }` and `fixDeck(deck: Deck, ctx: EngineContext, opts: BuildOptions, only?: string | null): FixResult`:
  1. Legality/size: for each violation's cards (not commanders): best agreeing `replaceCard` proposal, else remove; over 100: cut the lowest-scoring unlocked main cards; under 100: `fillRest`. (Record each as a change; adds have `out: ''`, cuts `in: ''`.)
  2. Goals from the current rating's fixes (all sub-scores, or only the sub-score `only`): role filters → `emphasizeRoles`, axis filters → `emphasizeAxes`; `maxSwaps: 15`; then `improveDeck` with those goals.
  3. Apply proposals in order, skipping `agrees === false`, stopping before one that lowers the rating.
  4. If the final rating is below `ratingBefore`, return the input deck unchanged with `note` explaining.
  `note` also explains an empty result ("Nothing to fix with the cards allowed").
- Server: mode `'fix'`, `options.only?` must be a rating sub-score key (400 otherwise), response `{ deck, changes, ratingBefore, ratingAfter, note, heldBy, cards }` (add `FixResponse` to api.ts and to `BuildResponse`).

- [ ] Step 1: failing tests — `an illegal deck becomes legal`, `101 cards become 100 and the weakest unlocked card goes`, `an 80-card deck is filled to 100`, `a deck short of ramp gains ramp and the rating does not drop`, `fixDeck leaves a deck it cannot improve untouched`, `locked cards and commanders are never cut`, `owned-only fix uses owned cards only`, `owned-only fix removes an illegal card it cannot replace`, `only='wincons' adds win conditions and nothing for other parts` (beyond the legality step), route `mode fix with an unknown only is a 400`.
- [ ] Step 2: run → FAIL. Step 3: implement. Step 4: `pnpm vitest run tests/engine tests/server && pnpm typecheck` → PASS.
- [ ] Step 5: commit `feat(builder): fix a deck in one go: legal, complete, then the rating's own fixes`.

### Task 4: Header — Fix deck button, Build and Export menus

**Files:** Modify `src/app/deck/[id]/Builder.tsx`; create `src/app/components/Menu.tsx` (small accessible dropdown: button with `aria-haspopup="menu"`, items `role="menuitem"`, Escape and outside click close it).

**Interfaces:**
- Consumes: `buildDeck(deck, 'fix', options)` (Task 3), the analysis' sub-score fixes count.
- Produces (UI): primary `Fix deck · N` (`data-testid="fix-deck"`, N = number of fixes across sub-scores plus violations; disabled with title "Nothing to fix" at 0); `Build ▾` (`data-testid="menu-build"`) with Auto-build / Fill the rest / Reroll keeping their old testids and a one-line description each; `Improve` (opens the Improve tab; Suggest swaps becomes a button inside the tab, keeping its testid); `Export ▾` (`data-testid="menu-export"`) with Copy deck list / Copy for Arena keeping their old testids. Owned-only and free-copies boxes unchanged and passed to Fix deck. `title` on every control.
- Fix result panel (`data-testid="fix-panel"`) above the deck: "Fix deck made N changes (rating A → B)" or the `note`; list of changes (out → in thumbs/names, reason, "!" when `heldBy` names holders); **Undo** (`fix-undo`) restores the exact previous deck through the normal save; Dismiss.

- [ ] Step 1: implement. Step 2: verify on the scratch copy (rules in Global Constraints): Fix deck on "Mr. Spock, Science Officer", screenshot of the panel, Undo, compare deck JSON before/after (identical). Open both menus; screenshot. Step 3: `pnpm typecheck`. Step 4: commit `feat(deck): Fix deck button and grouped Build and Export menus`.

### Task 5: Per-problem Fix and "Put it in instead of"

**Files:** Modify `src/app/deck/[id]/Panels.tsx` (rating panel fix lines), `src/app/deck/[id]/Builder.tsx` (card detail actions, browser "+" on a full deck), `src/app/components/CardDetail.tsx` if it needs a slot.

**Interfaces:**
- Consumes: `buildDeck(deck, 'fix', { ...options, only: key })`, `buildDeck(deck, 'swapin', { ...options, in: id })`.
- Produces (UI): a small **Fix** button (`data-testid="fix-part"`, `data-part=<key>`) beside each sub-score that has fixes; it runs the same panel/Undo flow as Fix deck. Card detail of a card not in the deck: section "Put it in instead of" (`data-testid="swapin"`) listing up to 5 proposals (thumb, name, rating change with sign, objection text when `agrees === false`, "!" with holder names), each with **Swap** (`data-testid="swapin-apply"`), plus "Add without cutting" when the deck is under 100. The browser's "+" on a 100-card deck opens this detail instead of adding.

- [ ] Step 1: implement. Step 2: verify on the scratch copy: a per-part Fix then Undo; click a browser card on a full deck → the suggestions show → Swap → the deck has the new card and lost the chosen one → undo it by swapping back (net zero, deck JSON identical). Screenshots. Step 3: `pnpm typecheck && pnpm test`. Step 4: commit `feat(deck): fix one problem at a time, and suggest what a new card replaces`.

### Task 1b: Best from collection rates with the same EDHREC data the deck page uses

**Files:** Modify `src/server/discover.ts` (`context()` and the job/cache key), `src/app/lib/api.ts` (`DiscoverEntry.basis`), `src/app/discover/page.tsx` (show the basis); Test: `tests/server/discover.test.ts` or a new server test.

**Interfaces:**
- Consumes: `peekEdhrec(commanders, bracket)` from `src/server/edhrec.ts` (cache only, never a request).
- Produces: each commander in a Discover run is built and rated with `ctx.edhrec` = the cached EDHREC data for that commander and bracket when EDHREC is enabled and cached, else null — exactly what `engineContext(deck)` would give the saved deck. `DiscoverEntry.basis: 'edhrec' | 'text'`. The job cache key changes when the set of commanders with cached EDHREC data changes (e.g. include a short hash of which commanders had data). The discover page shows "Scored with EDHREC data" / "Scored from card text" per entry (small, under the rating).
- Why: the deck page and home tiles rate with cached EDHREC data, Discover never did, so the same deck showed scores up to 15 points apart.

- [ ] Step 1: failing test — with EDHREC enabled and data cached for one commander (seed the `edhrec_cache` table the way tests/server tests do, or stub through the store), the Discover tier rating for that commander equals `analyzeResponse(tier.deck).rating.rating`, and its `basis` is `'edhrec'`; a commander without cached data has `basis: 'text'` and also equals the deck page's rating.
- [ ] Step 2: run → FAIL. Step 3: implement (no network on any path). Step 4: `pnpm vitest run tests/server && pnpm typecheck` → PASS.
- [ ] Step 5: commit `fix(discover): rate with the same cached EDHREC data the deck page uses`.

### Task 4a: The shared kit (runs before Task 4; Tasks 4–5 use it)

**Spec:** `docs/superpowers/specs/2026-11-26-app-map-and-shared-design.md` ("Shared components", "Shared filters", "Page skeleton", "Visual system", "Words").

**Files:** Create in `src/app/components/`: `CardTile.tsx`, `CardGrid.tsx`, `Section.tsx`, `JumpRail.tsx`, `FilterBar.tsx`, `ResultPanel.tsx`, `Menu.tsx`, `OddsBar.tsx`, `EmptyState.tsx`; create `src/app/lib/filters.ts` (the shared filter store); create `src/engine/odds.ts` (pure hypergeometric) with `tests/engine/odds.test.ts`. Modify `src/app/deck/[id]/DeckView.tsx` and `src/app/deck/[id]/Browser.tsx` to render through CardTile / CardGrid / Section / JumpRail.

**Interfaces:**
- `odds(deckSize: number, hits: number, seen: number): number` — P(at least one of `hits` in the first `seen` cards); tests: (99, 8, 7) ≈ 0.456, (99, 8, 14) ≈ 0.719 (±0.001), (99, 0, 7) = 0, (99, 99, 1) = 1.
- `CardTile` props: `{ card: ClientCard; size?: 'S' | 'M' | 'L'; score?: number | null; stats?: { label: string; value: string; title?: string }[]; heldBy?: string[]; marks?: ('weakest' | 'locked' | 'illegal')[]; onOpen?: () => void; actions?: ReactNode }` — caption row under the image (score chip in band colour, owned dot, "!" with holders in its title, stats); nothing over the card name or mana cost; keyboard focusable.
- `Section` props: `{ id: string; title: string; count?: number; actions?: ReactNode; cap?: number; children }` — display-serif heading, muted count, "Show all N" when capped; registers itself with the nearest `JumpRail`.
- `JumpRail`: sticky list of the page's sections (label + count), highlights the section in view (IntersectionObserver), back-to-top.
- `filters.ts`: `useFilters(): { bracket, budget, ownedOnly, freeOnly, size, view, groupBy, sort, set(patch) }` persisted in localStorage (`cf-bracket`, `cf-budget`, existing `cf-owned-only`, `cf-free-only`, `cf-view-*`); `FilterBar` renders any subset of them.
- `ResultPanel` props: `{ title: string; before?: number; after?: number; changes: { out: string; in: string; reason: string }[]; lookup: CardLookup; heldBy?: HeldBy; note?: string | null; onUndo?: () => void; onDismiss: () => void }` — groups changes by reason ("Added 22 cards to reach 100"), shows out → in thumbs.
- `Menu` props: `{ label: string; items: { label: string; description?: string; onSelect: () => void; testId?: string; disabled?: boolean }[]; testId?: string }` — `aria-haspopup="menu"`, `role="menuitem"`, Escape / outside click close.

- [ ] Step 1: odds tests (fail) → `src/engine/odds.ts` → pass.
- [ ] Step 2: build the components; move the deck view's sections and the browser's results onto them, keeping every existing `data-testid` working and removing the old overlay badges (the "!" and score move into the caption row).
- [ ] Step 3: verify on the scratch copy (Global Constraints rules): the deck page of "Mr. Spock, Science Officer" with the JumpRail, sections with counts, caption rows; the browser grid; screenshots at 1440×900; check keyboard focus on a tile.
- [ ] Step 4: `pnpm typecheck && pnpm test`.
- [ ] Step 5: commit `feat(ui): shared card tile, sections, jump rail, filter bar, result panel`.
