# Standard Brawl: good 60-card decks for MTG Arena

Date: 2026-11-26. Owner: "if you can suggest good Standard Brawl decks too, that would be nice — do it, no need to bring it forward." The owner then said to finish everything without asking, so every call below is the designer's; each is marked so it can be vetoed. Builds on `2026-11-25-arena-brawl-mode-design.md` (Arena collection = Brawl mode, wildcards, craft-only, Copy for Arena) and is governed by `2026-11-26-app-map-and-shared-design.md`.

## What Standard Brawl is (MTG Arena)
- 60 cards including the commander (59 + 1), singleton except basic lands, colour identity as in Brawl.
- Card pool: cards legal in Standard Brawl. Source of truth: Scryfall `legalities.standardbrawl` from the bulk file the `cards` sync already downloads. No set lists in code (AGENTS: no stale hardcoded lists); rotation arrives with the next sync.
- Commander: as in the app's Brawl rules (legendary creature or planeswalker, `canLead`). One commander, no companion, partners off — same as ruling R3 for Brawl.
- One-on-one, 25 life, so four-player Commander tuning does not fit.

## Goals
1. An Arena deck can be **Brawl (100)** or **Standard Brawl (60)**; the app checks legality, builds, fixes and rates it under that format.
2. Suggestions use only the owner's Arena cards plus what the wildcard budget can craft, exactly as Brawl does today.
3. Tuning that fits a 60-card one-on-one game, with reasons the owner can read.

## Format model (designer's call)
- `Format` becomes `'commander' | 'brawl' | 'standardbrawl'` (additive).
- `Card.standardBrawlLegality?: 'legal' | 'banned' | 'not_legal'` from `legalities.standardbrawl` in the `cards` sync (additive; old data reads as not_legal, so Standard Brawl simply offers nothing until a sync).
- A deck in an Arena collection carries `arenaFormat?: 'brawl' | 'standardbrawl'` (additive; missing = `brawl`, so existing Arena decks are unchanged). `deckFormat(deck)` = `commander` for Physical, else `deck.arenaFormat ?? 'brawl'`.
- `formatCardDb(..., 'standardbrawl')` = Arena cards whose Standard Brawl legality is `legal` (built once, cached like Brawl's view).

## Tuning for 60 cards, one-on-one (designer's calls, each with reason text in the UI)
- **Deck size** 60 everywhere the engine assumes 100/99 (legality, builder fill, Fix deck, rating, packages, odds). Find every hardcoded 99/100 in `src/engine` and route it through the format.
- **Lands**: target = round(22 + 0.8 × average mana value of the nonland cards), clamped 22–26 (≈24 for an average curve of 3). Reason: "60-card Brawl decks have no fast mana and need to hit land drops on a 1v1 clock."
- **Roles**: each 99-card role target × 59/99, rounded; then one-on-one shifts: removal ×1.2 (single-target answers matter more against one opponent), board wipes 0–1, protection ×0.8.
- **Packages** (8×8 rules): the four core packages stay mandatory; the per-package minimum scales to 5 (8 × 59/99, rounded); optional packages need at least 5.
- **Bracket**: Standard Brawl has no brackets or Game Changer limits. The rating's bracket part is not applicable; its weight is spread over the other parts proportionally, and the rating says so. The bracket selector is hidden for Standard Brawl decks.
- **EDHREC**: none for Standard Brawl (EDHREC has no such data); every Standard Brawl path works with EDHREC off. Discover and Best from collection follow what Brawl does today.

## UI
- Arena mode's "Brawl" label next to the collection switcher becomes a two-item `Menu`: **Brawl (100)** / **Standard Brawl (60)**. It sets the default format for new builds and for the Commanders list (localStorage `cf-arena-format`, in the shared filters store).
- Deck page header: "MTG Arena · Standard Brawl" and an action **Switch to Brawl** / **Switch to Standard Brawl** (changes only `arenaFormat`; the deck is then re-checked, and may become illegal, shown as usual). Results say where they went: "Switched to Standard Brawl — 41 cards over the limit; Fix deck can cut them."
- Commanders list and commander pages in Standard Brawl show only commanders legal there.
- Copy for Arena output is unchanged (the owner picks the deck type in Arena).

## Non-goals
- Historic Brawl variants beyond Arena's 100-card Brawl, Alchemy cards, rebalanced (A-) cards.
- Meta data or win rates (no source the app may use).

## Anti-goals
- Suggesting a card that is not legal in Standard Brawl or not on Arena.
- Quietly changing existing Arena decks: they stay Brawl until switched.

## Testing
- Ingest: `standardBrawlLegality` read from a Scryfall fixture row; fixture card DB refreshed (`fixtures.ts --arena-only` extended) without moving tuned tests.
- Engine: a 60-card legal deck passes; 61 cards, a duplicate, an out-of-identity card and a non-Standard card each fail with a reason; land target for curves 2/3/4; role targets scaled with the 1v1 shifts; package minimum 5; rating weights sum to 100 with bracket dropped; the builder fills a legal 60-card deck from a fixture pool; Fix deck on an over-sized deck cuts to 60.
- Server: `deckFormat` for Physical, Arena without `arenaFormat`, Arena with `standardbrawl`; switching format.
- UI on a scratch copy of real data: pick Standard Brawl, build a deck for an owned Arena commander, Fix deck, Switch to Brawl and back, Copy for Arena; at most 3 screenshots.
