# Packages: the 8×8 way of building, from your own collection

Date: 2026-11-26. Status: owner asked for it and handed over the how ("stop asking, finish them all"); every decision below is the designer's call, listed so the owner can overrule it.

## Intent

The owner builds with the "8×8" (Tavern) theory: 8 packages of 8 cards plus 35 lands = 99. Four packages are fixed: card draw, ramp, removal, protection. The other four are whatever the deck focuses on. Eight copies of a kind in 99 cards put at least one in the opening hand about 45% of the time, roughly 4 points more per draw, about 72% after 7 draws.

Owner's words: "I want to see my best packages in my collection for each colour, shown in a fun way. And while building a deck manually, hand-picking cards, I can build off these and also put a package in: let's do a ramp package…"

**Owner's correction (same day): "Not all decks need all packages or that many lands; those are specific — find them."** So 8×8 + 35 is the starting picture, not a rule: the app works out each deck's own plan (which packages, how big, how many lands) and says why. See "The deck's own plan" below; it overrides any fixed 8 / 35 elsewhere in this document.

## Goals

1. **Packages page** (`/packages`, in the top navigation after Collection): pick a colour (W, U, B, R, G, colourless, or several for a colour pair or more) and see, from the active collection, your best 8-card packages for that colour: the four core packages, then up to four theme packages the collection can actually fill. Fun: each package is a fanned hand of 8 cards that spreads on hover, with the odds of drawing one ("45% in your opening hand, 72% by your seventh draw").
2. **Packages in the deck builder**: a "Packages" tab on the deck page shows the deck's 8 packages (4 core + the deck's top 4 themes) with how many of each the deck has (e.g. "Ramp 6/8"), the live odds for that count, and the lands against 35. **Complete package** adds the best missing cards of that package for this deck in one click (with Undo); **Add a package** offers theme packages the commander supports that the deck does not have yet.
3. The browser's role filter gains the same package names, so hand-picking from a package is one click.

## Non-goals

- Changing the auto-builder's targets to 8×8 (the bracket role bands stay; the Packages tab is a lens and a tool, not a new rule). The rating is unchanged.
- New card data. Roles and theme axes come from the existing card features; quality from the scorer's existing quality.

## Anti-goals

- A package card the deck cannot play (wrong colour identity, banned, over the bracket's rules).
- Completing a package silently cutting cards: when the deck is full, the cuts are listed and Undo restores the deck exactly.
- Ignoring the player's limits: "Only my … collection", "Use free copies only", max price and locked cards hold.
- Odds that are wrong: the numbers come from the hypergeometric formula, tested against the owner's figures (8 in 99: 45.6% in 7 cards, 71.9% in 14).

## Decisions (designer's calls)

### What a package is
- Core packages and the roles behind them: **Ramp** = `ramp` (+ `fast-mana`); **Card draw** = `draw`; **Removal** = `spot-removal`, `counterspell`, `wipe`; **Protection** = `protection`. A card counts once per package even with several of its roles.
- Membership also reads Scryfall's tagger tags (already synced by the `tags` step from Scryfall's bulk file; owner: "use Scryfall and scrape all"): Ramp also takes `ramp`, `mana-rock`, `mana-dork`; Card draw takes `draw`, `card-advantage`; Removal takes `removal`, `sweeper`, `counterspell`; Protection takes `protection`, `protects-creature`, `gives-hexproof`, `gives-indestructible`. A card is in a package when its role OR one of those tags says so. Nothing is scraped from Scryfall's website: everything comes from Scryfall's bulk files (cards, printings, tags), as AGENTS.md requires, refreshed by a full sync on 2026-11-26.
- Theme packages: one per theme axis (the same axes the Themes tab shows). In the deck builder, the deck's top four axes by theme weight; on the Packages page, the four axes with the most good owned cards in that colour (at least 8 cards to qualify).
- Lands: 35 in the 8×8 frame; the tab shows the deck's land count against 35 and against the bracket's own target, without changing either.

### Ranking cards in a package
- Packages page (no deck): owned cards whose colour identity fits inside the chosen colours, ranked by a deck-free quality: the scorer's base quality (EDHREC rank curve, overcost penalty for the role) through a shared pure function exported from `src/engine/scoring` (no copy). Theme packages rank by quality times how strongly the card serves that axis.
- Deck builder: ranked by the deck's own card scores (the scorer the browser already uses), so the picks fit the commander.
- Held copies (boxes, built decks) show "!" as everywhere else; with "Use free copies only" on they are ranked after free cards and excluded from Complete package.

### The deck's own plan (replaces fixed 8 × 8 + 35)
- Pure engine function `packagePlan(deck, ctx): { packages: { id, name, target, reason }[]; lands: { target, reason } }`, shared by the Packages tab, Complete package, the builder and the rating (AGENTS rule 6: one set of numbers). It extends the existing role bands (`targetsFor` / `roleNeeds` in `src/engine/targets.ts`) instead of adding a second set.
- **Core packages** start from the bracket's band for the role and move with the commander and the plan, each move with its reason:
  - the commander itself draws cards → Card draw −3 (minimum 4): "Mr. Spock already doubles your draws";
  - the commander makes mana or cheats costs → Ramp −2;
  - the commander protects itself (hexproof, indestructible, ward ≥ 2) → Protection −2; a Voltron / equipment / aura plan → Protection +3;
  - commander mana value 6 or more → Ramp +2; average mana value of the plan ≤ 2.5 → Ramp −2;
  - a stax or control plan → Removal +2.
  A core package that falls below 4 cards is dropped from the plan ("not every deck needs all packages").
- **Lands** from the plan's average mana value, the commander's mana value, cheap ramp and cheap card selection, landfall and MDFCs: base `31 + 2.4 × average mana value`, −1 per 3 cheap ramp pieces beyond 6, −1 per 4 cheap cantrips, +3 for a landfall / lands-matter plan, MDFCs count as ¾ of a land; clamped to 28–40; calibrated so the reference decks land where players run them (precon ~37, upgraded ~36, cEDH ~29–31). The rating's mana part and the builder use this same number (the bracket default stays as the fallback when the plan has no cards yet).
- **Theme packages**: the deck's focused themes (the top one to three axes after the network design's focus rule), sized from the slots left after lands and core packages, split by axis weight; a theme package under 6 cards is dropped.
- The Packages tab shows the plan with each reason; the owner can pin a package size (stored in the deck's existing `roleTargets`), which then wins over the computed one.

### Clarity bar
Same UI direction as the deck page design (`2026-11-26-deck-page-fix-deck-design.md`, "UI direction"): EDHREC-level clarity, titled sections with counts, a sticky jump bar, one caption line under each card (odds, "!"), nothing over the card name or mana cost. The "fun" is in the fanned hands and the odds bars, never at the cost of reading.

### Odds
- Hypergeometric, deck size 99 (commander outside), at least one of `k` cards in the first `n` cards: opening hand n = 7, "by draw d" n = 7 + d. Shown for 7 and 14 (opening hand, seventh draw); the deck tab shows them for the deck's actual count.
- Pure function in `src/engine` with tests: 8 in 99 → 0.456 at 7, 0.719 at 14; 0 cards → 0; k ≥ 93 → 1 at 7.

### Complete package (deck builder)
- Missing = 8 − cards of that package in the deck (0 when 8 or more).
- Deck under 100: add the best `missing` cards (allowed by the options), plain adds.
- Deck at 100: swap: each added card cuts the weakest unlocked deck card that belongs to no package the deck tracks (never lands below the bracket's land target, never commanders); if none, the add is skipped with a note.
- Engine function `completePackage(deck, ctx, opts, pkg): FixResult` (same shape as Fix deck, so the same result panel with Undo serves both).
- API: `POST /api/build` mode `'package'` with `options.package` (`'ramp' | 'draw' | 'removal' | 'protection' | 'theme:<axis>'`).

### Packages page look
- Colour chips across the top (W U B R G C as the app's mana circles; multi-select). A title per package with its icon-free name and "8 of 23 owned", the fanned hand of the best 8 (overlapping card images, spread on hover, click opens the card), and the odds as two small bars.
- Below the core four, the theme packages for that colour. Empty state: "Your collection has only 5 removal cards in blue" with the five shown.
- Data: `GET /api/packages?colors=UB` → `{ packages: { id, name, kind: 'core' | 'theme', total, cards: ClientCard[] }[], heldBy }` from the active collection.

## Testing
- Engine: odds against the owner's numbers; package membership by role; ranking deterministic; completePackage adds the best allowed cards, cuts only non-package unlocked cards on a full deck, respects owned-only/free-only, never lands under target.
- Server: `/api/packages` colour filtering (identity ⊆ chosen colours), only owned cards, theme packages need ≥ 8 cards.
- UI on the scratch copy (never data/, never port 3210): Packages page for blue and for U+B; deck tab on Mr. Spock, Science Officer; Complete package then Undo (deck JSON identical). Screenshots.

## Left to the builder
Exact fan animation, bar styling, page layout within the project's look, wording within AGENTS.md conventions.
