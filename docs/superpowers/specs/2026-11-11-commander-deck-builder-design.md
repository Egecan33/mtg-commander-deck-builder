# Commander Forge — design

Date: 2026-11-11. Status: approved by the owner 2026-11-11 ("I approve, do it as you like"), with goal 6 added at their request. Working name "Commander Forge" (builder's call, rename freely).

Research this design rests on (fact-checked against primary sources on 2026-11-11) is in `docs/research/`:
`rules.md`, `brackets.md`, `scryfall.md`, `synergy-data.md`, `deck-theory.md`. Section references below look like `rules.md §4.3`. When this document and a research file disagree, this document wins; when this document is silent, the research file is the spec.

## 1. Intent

A local, single-user web app for building Magic: The Gathering Commander decks. The owner cannot build without seeing the cards, so every card is shown as an HD image everywhere, and all images live on disk.

The owner said, in their words: it must build Commander decks, fit the brackets, pay attention to synergies, understand what a good deck needs, follow Commander's specific rules, use HD card images stored locally for personal use, let them build decks comfortably, rate the deck, and score every card out of 100 dynamically relative to each commander.

Choices the owner made when asked: card pool is all Commander-legal cards with an optional imported collection marking owned cards; scoring is rule- and data-based with no AI; UI language is English; "large" image quality for every card.

## 2. Goals

1. **Two ways to build, one screen.** Auto-build a full legal 100-card deck from a commander and a target bracket; or build by hand from an empty deck; or any mix (lock some cards, auto-fill the rest).
2. **Per-card score 0–100 relative to the commander**, bracket-aware, updating as the deck changes, with a visible breakdown of why.
3. **Deck rating 0–100** with sub-scores and concrete fixes.
4. **Commander rules enforced exactly** as of the Comprehensive Rules effective 2026-11-06.
5. **Bracket-aware**: the user picks a target bracket 1–5; the app computes the minimum bracket the hard rules force, flags violations of the target, and never suggests cards that break it.
6. **Improve an existing deck** (owner, 2026-11-11: "I'll have it make my existing Commander deck better"). Paste or import a decklist; the app rates it, then proposes an ordered list of swaps — weakest card out, best replacement in — each with the reason and the rating change it produces. The owner accepts or rejects swaps one by one, or applies all. Options: keep the bracket or aim for a different one; owned cards only; max price per card; cards to never cut (locks).
7. **Images first.** Card browser and deck view are image grids. Works offline after the first sync.

## 3. Non-goals (v1)

- Accounts, multi-user, hosting, or any public deployment. This is a personal local tool; the data sources' terms assume that.
- AI/LLM features.
- Goldfish/playtest simulator.
- Attraction and sticker side decks (the cards themselves stay legal in the pool).
- Other formats, non-English cards, phone layout.
- Price optimisation. An optional max-price-per-card filter is the only budget feature.

## 4. Anti-goals — these make it a failure even if it runs

- A deck that the app calls legal but is not.
- A score or rating shown without its reasons.
- Hardcoded lists that go stale: Game Changers, banned list, "any number of" cards must come from synced data. (A Wizards Commander announcement is expected before the end of 2026; a re-sync must be all it takes.)
- The app breaking or degrading badly when EDHREC is disabled or unreachable.
- Auto-assigning Bracket 1 or Bracket 5. Those are declarations of intent; only the user sets them.
- Text-only card lists as the primary view.

## 5. How it gets made (builder's calls unless marked)

- **Stack:** Next.js (App Router) + TypeScript + React + Tailwind, pnpm, Node 22. One process, `pnpm dev` / `pnpm start`, opened at localhost. The owner's other projects use the same stack.
- **Storage:** SQLite via `better-sqlite3` at `data/forge.db`. Images under `data/images/`. All of `data/` is gitignored.
- **Location (owner agreed to "separate project"):** `~/github_repositories/commander-forge`, its own git repo.
- **Layout:**
  - `src/engine/` — pure TypeScript, no IO, no React: `rules/`, `brackets/`, `features/`, `scoring/`, `rating/`, `builder/`, `mana/`. Everything here is unit-tested with Vitest.
  - `src/ingest/` — CLI scripts that download and load data.
  - `src/server/` — SQLite repositories and route handlers.
  - `src/app/` — UI.
- **Images are WebP, not JPG** (deviation from the owner's "large JPG" pick, same resolution): Scryfall removes the `large` JPG after 2027-01-01 (`scryfall.md §4`). Download `display` (672×936, detail view) and `grid` (488×680, grids) for every Commander-legal card. Estimated total ≈ 5 GB (±15%); the machine has 339 GB free.

## 6. Data

### 6.1 Sources and sync

`pnpm sync` runs these in order, each resumable and idempotent. The app has a Data page showing each source's date, row counts, and a Sync button with progress.

| Step | Source | Notes |
|---|---|---|
| cards | Scryfall bulk `oracle_cards` (gzipped JSONL, URL resolved via `GET /bulk-data`, field `jsonl_download_uri`) | One row per `oracle_id`. Keep `legalities.commander` in (`legal`, `banned`); drop the rest. Stream line by line. |
| tags | Scryfall bulk `oracle_tags` | Key on tag `id`, store slug for display. Roll taggings up through `child_ids` — parent tags have no direct taggings (`scryfall.md §7`). |
| combos | Commander Spellbook `variants.json.gz` | 729 MB uncompressed: must be stream-parsed, never `JSON.parse`d whole. Keep status `OK` and Commander-legal variants. Store per variant: id, bracketTag, manaValueNeeded, popularity, produces (feature names), `requires` count, and per used card: oracleId, mustBeCommander, zoneLocations. Build an index card → variants. Drop image URLs and prose. |
| features | computed locally (§8) | Re-run whenever cards/tags/rules change. |
| images | `cards.scryfall.io`, URLs read from card data (`image_uris ?? card_faces[i].image_uris`) | `display` + `grid` WebP. 4–8 parallel, resume, skip when `image_updated_at` unchanged. Files: `data/images/{size}/{oracle_id}_{face}.webp`. |
| edhrec | EDHREC commander JSON, **only on demand** (§6.3) | Not part of bulk sync. |

Every request to Scryfall and Spellbook sends `User-Agent: CommanderForge/<version>` and an `Accept` header, respects 429, and uses bulk files rather than search endpoints. No personal information goes in any header or URL.

Exclusions from the card pool: cards that are a `meld_result` in `all_parts`; anything not `legal`. Banned cards are kept only so the app can explain "banned" when a list is imported.

A banner appears when card data is older than 7 days. The Data page shows "Game Changers: N cards, as of <sync date>".

### 6.2 Local tables (shape, not final DDL)

`cards` (oracle_id PK, name, front-face name, layout, mana_cost, cmc, type_line, oracle_text concatenated across faces, colors, color_identity, keywords, power/toughness presence, produced_mana, game_changer, edhrec_rank, price_usd, faces JSON, image status), `tags`, `card_tags`, `combos`, `combo_cards`, `card_features` (§8), `edhrec_cache`, `collection` (oracle_id, qty), `decks`, `deck_cards` (deck_id, oracle_id, qty, locked, zone: commander | main | companion), `settings`.

A deck stores: name, commander(s), chosen colour where a commander needs one (`rules.md §3`, §4.6 Tolabow), target bracket, theme weights (§8.2), created/updated.

### 6.3 EDHREC (optional layer)

EDHREC has no official API and its terms forbid automated queries (`synergy-data.md §1.7`). The JSON feed is used only like this:

- One fetch sequence per commander, triggered by the user selecting that commander: base page, plus the page for the target bracket. Requests are serial, ≥1.5 s apart.
- Cached on disk for 7 days; revalidated with `If-None-Match`.
- 403 means "no page". A `{"redirect": ...}` body is followed once. Schema is validated on read; any surprise falls back to "no EDHREC data".
- A setting turns EDHREC off entirely. Scores then show "based on card text and tags only".
- Bracket pages with fewer than 300 decks are ignored in favour of the base page.
- Data never leaves the machine.

**Whether this is on by default is the owner's decision** (§14).

## 7. Rules engine (`src/engine/rules`)

`validateDeck(deck, cards) → Violation[]` where a violation has a code, the cards involved, and a plain-English message. Zero violations = legal. Implement exactly `rules.md §1–§6`; the points that are easy to get wrong:

- **Size:** exactly 100 including commander(s). Whtz, the Bibliophile as commander: ≥100.
- **Singleton:** keyed on `oracle_id`. Limit is parsed from oracle text: "any number of cards named" → unlimited; "up to seven/nine cards named" → 7/9; supertype Basic → unlimited; else 1.
- **Colour identity:** use Scryfall's `color_identity` as is; never recompute. Allowed set = union of commanders' identities + chosen colour (The Prismatic Piper, Faceless One, Clara Oswald) + Rulebreaker overrides.
- **Commander eligibility:** front face is Legendary and (Creature, or Vehicle, or Spacecraft with a power value); or oracle text contains "can be your commander"; or Grist, the Hunger Tide. A Background alone is not a commander.
- **Two commanders:** Partner (plain), Partner with (each names the other), Partner—variant (same variant text), Choose a Background + legendary Background, Doctor's companion + type line exactly "Legendary Creature — Time Lord Doctor". Plain Partner must be detected by excluding the other two from oracle text because Scryfall gives all three the `Partner` keyword. Different kinds never mix.
- **Rulebreaker commanders** (8 cards): a table keyed by `oracle_id`, per `rules.md §4.6`.
- **Companion:** optional 101st card. Must fit identity and singleton; Lutri is banned as a companion (hardcoded — the one unavoidable hardcode, Scryfall cannot express it); each of the 10 companions' deck conditions is a hand-written predicate.
- **Banned:** `legalities.commander !== "legal"`.

## 8. Card understanding (`src/engine/features`)

Computed once per sync for every card and stored; this is what makes scoring fast enough to run across the whole pool on every deck change.

### 8.1 Roles

A card can hold several: `land`, `ramp`, `fast-mana`, `draw` (card advantage), `tutor`, `spot-removal`, `counterspell`, `wipe`, `protection`, `recursion`, `graveyard-hate`, `win-condition`, `stax`, `extra-turn`, `mass-land-denial`, `game-changer`.

Source of truth is Scryfall Tagger tags (rolled up, by tag id) combined with oracle-text rules; the tags alone are too broad (`removal` covers 19% of the pool), so prefer narrow child tags and add text checks. Roles with no Tagger tag (`fast-mana`, `stax`, `win-condition`) are text/heuristic rules plus small seed lists. `mass-land-denial` and `extra-turn` come from their Tagger tags; the user can override either flag per card in Settings because there is no official list.

Also stored per card: instant-speed flag, tapland weight (always-tapped 1.0, conditional 0.25), colours of mana produced and source weight (land 1.0, rock 0.75, dork 0.5), MDFC land weight (0.38 / 0.74), coloured-pip requirement.

### 8.2 Theme axes

About 24 axes (tokens, +1/+1 counters, sacrifice, graveyard/reanimator, spellslinger, artifacts, enchantments, equipment/auras, landfall, lifegain, blink/ETB, typal per creature type, attack triggers, wheels/draw-matters, discard, mill, treasure/food/clue, stax, group hug, extra combat, big mana/X, legends/historic, named counters such as energy, voltron). The list and the regexes are the builder's to write.

For each card and axis: enabler strength `e` and payoff strength `p` in [0,1] — a card that makes tokens is a token enabler; a card that rewards having tokens is a token payoff.

For a commander: a weight per axis from its own text (payoff text 1.0, enabler text 0.6, keyword hint 0.3; a creature type named in rules text 1.0, own subtype only 0.3), blended with EDHREC's theme counts for that commander when available. The user sees these weights as sliders on the deck and can change them; the deck stores them.

## 9. Brackets (`src/engine/brackets`)

Per `brackets.md §3, §9`. Output: `{ floor, reasons[], warnings[], violationsOfTarget[] }`.

| Check | Source | Effect on minimum bracket |
|---|---|---|
| Game Changers (commander included) | `game_changer` | 1–3 → 3; 4+ → 4 |
| Mass land denial | role flag | any → 4 |
| Extra-turn cards | role flag | any → 2; 3 or more → warning "chaining likely, plays like 4" |
| Two-card combo that is infinite, game-ending or a lock | local Spellbook data: exactly 2 used cards, no template requirements, all pieces in deck/command zone, `mustBeCommander` honoured | any → 3; early (Spellbook tag Ruthless, or mana needed ≤ 5) → 4 |
| Tutors | — | none (rule removed 2025-10-21); still counted for consistency |

- The target bracket is user-chosen. Violations of the target are listed with the cards that cause them; the UI says "legal at Bracket N" rather than hiding a card.
- Bracket 1 additionally forbids any extra-turn card; Bracket 1 and 5 are reachable only by the user picking them.
- A separate soft estimate, "plays like Bracket X", comes from fast-mana count, tutor count, Game Changers, free interaction, combo speed, average mana value and mean card quality. It is shown beside the floor, never used as a rule.
- Combo panel: combos the deck contains, and combos one card away, from the local data. No live Spellbook calls in v1.

## 10. Per-card score (`src/engine/scoring`)

`scoreCard(card, context) → { score 0–100, parts, reasons[], gate? }`. Context = commander(s), theme weights, target bracket, current deck summary, EDHREC data if any.

**What the number means:** how much this card belongs in *this* deck *right now*. For a card already in the deck, the deck-dependent parts are computed as if that card were removed, so in-deck and out-of-deck cards are on the same scale and the weakest cards in a deck can be ranked.

**Gates** (score shown as 0 with the reason; the card stays visible, greyed): outside colour identity; banned; would exceed its copy limit; breaks the target bracket (Game Changer at B1–2; fourth Game Changer at B3; mass land denial at B1–3; extra-turn card at B1; completes a two-card combo with a card in the deck at B1–2, or an early one at B3).

**Parts** (weights are starting values, tuned during calibration):

| Part | Weight | Depends on deck? | What it measures |
|---|---|---|---|
| Synergy | 35 | slightly | Best match between the card's enabler/payoff strengths and the commander's axis weights; small bonus for a second strong axis; ×1.15 when the card is on the side (enabler vs payoff) the deck is short of. |
| Co-play data | 15 | no | EDHREC inclusion rate and lift for this commander, lift normalised within the commander's page (percentile), shrunk when sample is small. Cards absent from the page get a prior from global `edhrec_rank`. When EDHREC is off: weight redistributed to Synergy (+8) and Quality (+7). |
| Quality | 20 | no | `edhrec_rank` bucket, instant-speed bonus for interaction, penalty per mana above the role's normal cost. |
| Role need | 15 | yes | How short the deck is on this card's roles against the bracket's target bands (§11). Zero when the role is full. |
| Castability and curve | 10 | yes | Whether the deck's coloured sources meet the card's pip requirement (Karsten table, `deck-theory.md §4.2`); whether its mana-value bucket is under target; small penalty at the commander's own mana value. |
| Bracket fit | 5 | no | Distance between the card's power tier and the bracket's ideal tier; penalties for taplands at B4–5 and for 6+ mana cards at B5. |

A core-role card (ramp, draw, removal, land) of high quality never scores below 55, so staples do not sink under weak on-theme cards.

Every score keeps its parts and human-readable reasons, e.g. "+31 synergy: makes tokens, commander rewards tokens · +12 role: deck is 4 short on ramp · −6: fifth card at 4 mana, same as commander".

**Performance target:** rescoring the whole legal pool (~32,600 cards) after a deck change in under 150 ms on the owner's machine. Deck-independent parts are cached per (commander, bracket, theme weights).

## 11. Deck rating (`src/engine/rating`)

`rateDeck(deck, context) → { rating 0–100, subscores[], fixes[] }`. Formulas and bands: `deck-theory.md §2.3` (role bands per bracket), `§3` (archetype deltas, applied from the deck's top theme axes), `§4` (land count, coloured sources, taplands), `§7` (sub-score formulas). Those are starting values.

| Sub-score | Weight |
|---|---|
| Mana base (land count vs Karsten target adjusted by bracket, coloured sources, taplands, utility lands) | 18 |
| Role coverage (ramp, card advantage, spot interaction, wipes, protection, recursion, graveyard hate) | 16 |
| Synergy density (on-theme count, enabler/payoff balance) | 16 |
| Curve (average mana value, shape vs commander cost, early plays) | 10 |
| Interaction (count, instant-speed share, coverage of permanent types) | 10 |
| Win conditions (count, speed appropriate to bracket) | 10 |
| Consistency (hypergeometric opening-hand and land-drop odds, redundancy) | 10 |
| Bracket fit (hard violations of target → 0; else closeness of "plays like" to target) | 10 |

- **Legality** is a separate pass/fail chip. An illegal deck's rating is capped at 40 and every violation is listed.
- **Incomplete decks:** targets scale with the number of cards so far; the header shows "87/100" and the rating is labelled "so far".
- Each sub-score lists its top three shortfalls as concrete fixes ("3 short on white sources for Wrath of God: have 23, need 26"). Clicking a fix filters the card browser to cards that solve it. Role shortfalls are the same numbers the card score's Role-need part uses, so recommendations follow from the rating.

## 12. Auto-builder (`src/engine/builder`)

Inputs: commander(s), target bracket, theme weights, locked cards, options (owned cards only; max price per card; seed).

1. Compute targets: land count, role quotas (middle of each band, with archetype deltas), curve.
2. Fill nonland slots greedily by current score, rescoring as the deck grows: strongest theme cards first, then roles up to quota, then best remaining.
3. Build the mana base last from the actual coloured-pip demand: nonbasic lands by score, then basics split to meet the Karsten source numbers.
4. Repair: resolve any rules or target-bracket violation by swapping the offender for the best legal alternative in the same role.
5. Improve: bounded hill-climb of single swaps that raise the deck rating.
6. Output is deterministic for a seed. "Reroll" changes the seed, which perturbs scores slightly so builds differ.

**Improve deck** (goal 6): starting from a complete imported deck, first repair rule and target-bracket violations, then run the same hill-climb, but record each accepted swap as a proposal `{out, in, reason, ratingBefore, ratingAfter}` instead of applying it. Proposals are ordered by rating gain; at most ~15 are shown; locked cards are never cut. The UI shows each swap as two card images side by side with accept/reject, and a running "rating 62 → 78 if all accepted".

Also exposed in the UI: **Fill the rest** (same algorithm, everything already in the deck treated as locked) and **Suggest swaps** (for the lowest-scored cards, the best replacements in the same role).

Guarantee: the result has exactly 100 cards, zero rule violations, and a bracket floor ≤ target. Target build time under 3 seconds.

## 13. Screens

Desktop only. The exact layout is the builder's, guided by the owner's reaction to mockups; these are the required pieces.

- **Data / first run:** what is synced, sync button, progress for data and images, EDHREC and override settings.
- **Decks:** saved decks as commander-art tiles with bracket, rating and card count. New, duplicate, delete, import.
- **Commander picker:** image grid of eligible commanders with search and colour filters; second-commander flow that offers only legal partners; colour picker when the commander needs one; bracket choice; then "Auto-build" or "Start empty".
- **Builder (the main screen):**
  - Header: commander image(s), target bracket selector, count (87/100), rating gauge, legality chip, "minimum bracket" and "plays like" chips.
  - Card browser: image grid, score badge on every card, default sort by score. Search by name/text/type; filters for role, theme axis, colour, mana value, type, owned, "legal at this bracket", price cap. Hover or click shows the `display` image at full size with the score breakdown; double-faced cards flip.
  - Deck: image grid grouped by role or by type (toggle), with a compact list view as an alternative. Score badge on each card; the weakest cards are marked. Add, remove, lock.
  - Rating panel: the eight sub-scores with their fixes; curve and colour-source charts.
  - Bracket panel: floor reasons, target violations, combos present and one card away.
  - Theme sliders.
  - Buttons: Auto-build, Fill the rest, Reroll, Suggest swaps, Export.
- **Import / export:** plain text lists ("1 Sol Ring" per line, commander marked) in and out; card names resolved by exact name, then front-face name, with unresolved lines shown for manual fix.
- **Collection:** import CSV (name and quantity columns auto-detected; Moxfield, Archidekt and ManaBox exports should work) or plain text; owned cards get a marker everywhere.

## 14. Decisions for the owner

1. **EDHREC on or off by default.** On gives noticeably better per-commander scores from real deck data; it is also automated access that EDHREC's terms do not permit, kept to a couple of cached requests per commander. Off costs score quality and nothing else. **Resolved 2026-11-11:** the owner approved the design and delegated remaining choices ("do it as you like"). Designer's call: ships **off**, with a clearly explained toggle on the Data page, so that accepting the terms risk is something the owner does knowingly.

Everything else in this document that the owner did not state is the designer's call and can be overruled: project name, stack, WebP over JPG, no live Spellbook calls, companion support in v1, price cap as the only budget feature, score weights.

## 15. Testing and done

- **Engine unit tests (Vitest)** against a committed fixture of real card objects (a few hundred cards extracted from the synced data): every rule in §7 including Lutri-as-companion, Tolabow, Grist, each partner kind, a Rulebreaker override, copy limits; bracket floors (Thassa's Oracle + Demonic Consultation → 4; three Game Changers → 3; Armageddon → 4); gates; scoring monotonicity (a ramp card's score drops as ramp fills up).
- **Calibration script** (not CI): for a handful of commanders with EDHREC data, high-lift cards should mostly score 70+ and off-theme cards below 30; three reference decklists as fixtures — a recent precon should rate roughly 60–75 at Bracket 2, a cEDH list declared Bracket 5 must not be punished for 28 lands or no wipes.
- **Auto-build property test:** for 30 varied commanders × 5 brackets, the build is 100 cards, legal, floor ≤ target.
- **End-to-end smoke (Playwright):** pick a commander, auto-build, see 100 card images, a rating, and no violations; remove a land and see the rating and scores change.

Done means: sync completes on the owner's machine with images on disk; the owner can pick a commander, auto-build at a chosen bracket, edit by hand with scores updating live, see the rating with reasons, and export the list — all with the network unplugged after sync (EDHREC aside).

## 16. Left to the builder

Exact SQL schema; the axis list and regexes; role heuristics and seed lists; soft-power formula constants; UI layout and visual design; the hill-climb budget; how incomplete-deck scaling is smoothed; build order and milestones.
