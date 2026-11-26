# Deck page: Fix deck, "put it in instead of", clearer buttons, card quality in the rating

Date: 2026-11-26. Status: owner handed over the how ("stop asking, finish them all"); every decision below is the designer's call, listed so the owner can overrule it.

## Intent

The owner's words:
- "Put fix deck buttons; make the interface and buttons more user friendly." / "Fix deck solves the deck's problems."
- "If I want to add a card, suggest what I could put it in place of: when I click a card that is not in the deck, suggest those."
- "The scores of the auto decks you built from my commanders are not consistent with reality."
- "I will want to update my commander deck with the cards I own." (built-deck conflicts already ship; Fix deck must honour owned-only and free-copies-only.)

Evidence for the score complaint (2026-11-25): owned-only decks from "Best from collection" rate 85–99 while the app's own estimate says they play like Bracket 2. The deck rating (`src/engine/rating/rate.ts`) measures structure only (mana, role counts, synergy density, curve, interaction, win conditions, consistency, bracket fit). Card strength never enters it, and the auto-builder fills exactly those counts, so a deck of weak cards can reach a near-perfect rating.

## Goals

1. **Card quality in the rating.** A ninth sub-score, "Card quality", from the same per-card quality the card scorer already uses (EDHREC rank, power tier at Brackets 4–5). A deck of weak cards can no longer rate in the 90s.
2. **Fix deck.** One button that makes the deck legal and complete, then improves it toward the problems the rating lists, applies the changes, shows them, and offers one Undo. Every listed problem also gets its own "Fix" button.
3. **Put it in instead of.** Clicking a card that is not in the deck shows the 3–5 deck cards it could replace, best first, with the rating change and any "!" (held by a box or built deck); one click swaps.
4. **Clearer header.** Fewer, grouped buttons that say what they do.

## Non-goals

- Two-player (Brawl) tuning, Arena rules: the Arena Brawl project.
- New data sources. Quality comes from the data the scorer already uses (EDHREC rank in the synced card data; the opt-in EDHREC commander data when on).
- Changing what "owned" means, or any collection data.

## Anti-goals

- Fix deck making a deck worse: it never applies a change the engine itself objects to (`agrees === false`), and the result never rates below the start (if it would, nothing is applied and the panel says why).
- Fix deck ignoring the player's limits: owned-only, free-copies-only, max price, locked cards and the target bracket all hold, exactly as in Improve.
- Fix deck silently rewriting the deck: the panel lists every change and one Undo restores the deck exactly.
- An illegal deck reported legal (AGENTS rule 3).
- Card quality computed differently from the scorer (AGENTS rule 6: scoring and rating share numbers).
- A rating with no reasons: the new sub-score has fixes when low.

## Decisions (designer's calls)

### Card quality sub-score
- Per card: the scorer's own quality value (0–1) for this deck's bracket, through a function the scorer and the rating share (move or export it from `src/engine/scoring/scorer.ts`; do not copy it).
- Deck value: mean quality of nonland cards outside the command zone (basic lands and lands excluded), against a per-bracket expectation; value = clamp01(mean / expected[bracket]). Expectations are calibrated so the committed reference decks keep their test ranges (precon at target 2: 55–82; upgraded at target 3: ≥ 55; cEDH at target 5: ≥ 60) and an owned-only build of weak cards drops by at least 8 points against today.
- Weight 12. The others scale to make 100: mana 16, roles 14, synergy 14, curve 9, interaction 9, wincons 9, consistency 9, bracket 8.
- Fixes when low: "N of the deck's cards are weak for Bracket B (quality under X): Show cards", filter pointing the browser at the same roles with a quality floor; plus the three weakest card names.
- Everything that shows "the eight parts" says "the nine parts".

### Fix deck
- Engine function `fixDeck(deck, ctx, opts)` in `src/engine/builder/`:
  1. Legality and size first: cards that make the deck illegal (banned, off-identity, over the copy limit) are replaced (`replaceCard`, best agreeing proposal, else removed); over 100 cards: cut the weakest unlocked cards; under 100: `fillRest`.
  2. Then a directed `improveDeck` run whose goals come from the deck's current rating fixes: roles from fix filters → `emphasizeRoles`, theme axes → `emphasizeAxes`; max 15 swaps; same owned/price/free-copies options.
  3. Apply agreeing proposals in order; stop at the first that would lower the rating.
  4. Return `{ deck, changes: { out, in, reason }[], ratingBefore, ratingAfter }`. No change → empty list and a plain reason.
- Single-problem fix: the same with `only: <sub-score key>` (goals from that sub-score's fixes only; legality step always runs when the deck is illegal).
- API: `POST /api/build` mode `'fix'` with `options.only?`, response `{ deck, changes, ratingBefore, ratingAfter, heldBy, cards }`.

### Put it in instead of
- Engine `swapIn(deck, ctx, opts, inId, count = 5): SwapProposal[]` — mirror of `replaceCard`: candidates are deck cards (not commanders, not locked; basic lands only when the deck is over its land target), ranked by rating after the swap, same role first; `agrees`/`objection` as elsewhere. Deck under 100: first proposal is a plain add (`out: ''`).
- API: `POST /api/build` mode `'swapin'` with `options.in`.
- UI: card detail of a card not in the deck shows "Put it in instead of" with the proposals (card thumb, rating change, "!" with holder names) and a Swap button each; the browser's "+" on a full deck opens that detail instead of making the deck 101.

### Header
- Primary button **Fix deck** with the number of problems ("Fix deck · 3"), disabled with a title "Nothing to fix" when there are none.
- **Build ▾** menu: Auto-build (a new deck around the commander), Fill the rest (add cards up to 100), Reroll (another auto-build). One-line description under each item.
- **Improve** opens the Improve tab (Suggest swaps moves into that tab as its own button).
- **Export ▾** menu: Copy deck list, Copy for Arena.
- The owned-only and free-copies-only boxes stay next to the buttons and apply to Fix deck too.
- Every button has a `title` saying what it does. Existing `data-testid`s keep working (menu items carry the old ids).
- Fix result panel above the deck: "Fix deck made N changes (rating 63 → 74)", the list (out → in, reason, "!" when held), **Undo** (restores the deck exactly), and Dismiss. Per-problem **Fix** buttons sit beside each fix line in the rating panel.

## Testing
- Engine: card quality — a deck of the format's weakest cards rates lower than the same structure with strong cards; reference decks keep their ranges; nine weights sum to 100; scorer and rating quality agree for the same card. fixDeck — an illegal deck becomes legal; 101 → 100; 80 → 100; a deck short of ramp gains ramp; rating never drops; locked cards kept; owned-only builds use owned cards only. swapIn — proposals never include commanders or locked cards; under 100 the first is a plain add; sorted by rating after.
- UI on a copy of the data (never data/, never port 3210): Fix deck on Mr. Spock, Science Officer then Undo (deck JSON identical); a single-problem Fix; Put it in instead of from the browser; the header menus. Screenshots.

## Left to the builder
Exact calibration numbers, menu component, panel layout within the project's look, wording within AGENTS.md conventions.
