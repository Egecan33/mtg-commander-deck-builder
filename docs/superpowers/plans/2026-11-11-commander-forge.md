# Commander Forge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local web app that builds, scores, rates and improves Magic: The Gathering Commander decks with HD card images on disk.

**Architecture:** One Next.js process. A pure TypeScript engine (`src/engine`, no IO) does rules, brackets, card features, scoring, rating and building over an in-memory card database. Ingest CLIs load Scryfall and Commander Spellbook bulk data into SQLite and download images. Route handlers expose the engine; a React UI renders image grids.

**Tech Stack:** Node 22, pnpm, Next.js (App Router), React, TypeScript (strict), Tailwind, better-sqlite3, Vitest, Playwright, stream-json (Spellbook parse), tsx (CLIs).

**Spec:** `docs/superpowers/specs/2026-11-11-commander-deck-builder-design.md`. Research the spec cites: `docs/research/*.md`. Read the spec section named in each task before starting it.

## Global Constraints

- Repo: `~/github_repositories/commander-forge`. Never touch any other repository.
- `src/engine/**` imports nothing from Node, Next, React or `src/server`. It takes a `CardDb` (below) and plain data.
- All shared types live in `src/engine/types.ts` exactly as written in Task 1. Do not rename or reshape them; if a task needs a new field, add it there and say so in the commit message.
- Game Changers, banned cards and copy-limit cards come from synced data, never from a hardcoded list. Allowed hardcodes: Lutri companion ban, Grist, the 8 Rulebreaker commanders, 3 colour-choice commanders, 10 companion predicates.
- HTTP to Scryfall/Spellbook: header `User-Agent: CommanderForge/0.1` and `Accept: */*`; bulk files only, no search endpoints at runtime; on 429 wait 60 s and retry. No personal data in any request.
- EDHREC is off by default (`settings.edhrecEnabled = false`); the app must be fully usable with it off.
- Images are WebP: sizes `display` and `grid`, files `data/images/{size}/{oracleId}_{face}.webp` (face 0 or 1).
- `data/` is gitignored. Test fixtures are committed under `tests/fixtures/`.
- UI language English. Desktop layout only. Every card is shown as an image; text lists are secondary.
- Each task ends with `pnpm typecheck && pnpm test` green and a commit that stages only that task's paths (`git add <paths>`; if `index.lock` exists, wait and retry).
- Commit trailer: `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Review Focus

1. **Imported decklists are messy:** set codes and collector numbers (`1 Sol Ring (C21) 263`), `1x`, foil markers `*F*`, section headers (`Commander`, `Deck`, `Sideboard`, `// Lands`), split/DFC names given as front face only or with ` // ` or ` / `, wrong case, curly apostrophes, blank lines. Expected: all resolve; unresolved lines are reported, never silently dropped. → Task 9 tests.
2. **Double-faced and split cards everywhere:** oracle text and images live on faces; MDFC lands count as partial lands; colour identity covers both faces. Expected: no `undefined` text, both face images downloadable, correct land weight. → Tasks 2, 4 tests.
3. **Decks that are not 100 cards or have no commander yet** (empty deck, 37 cards, 104 cards): scoring, rating and bracket analysis must return sane values and never throw or divide by zero. → Tasks 6, 7 tests.
4. **Colourless and five-colour commanders, and two commanders:** identity `[]` (only colourless cards + Wastes; mana base of colourless lands) and WUBRG; partner identity is the union. Auto-build must still reach exactly 100 legal cards. → Tasks 3, 8 tests.
5. **A card missing from the database or with missing features** (new set after last sync, name typo): engine functions skip it with a violation `unknown-card`; UI shows a placeholder tile. → Tasks 3, 9, 11 tests.

---

## File map

```
src/engine/types.ts            shared contract (Task 1)
src/engine/rules/              commander.ts, identity.ts, copies.ts, companion.ts, validate.ts, index.ts
src/engine/features/           roles.ts, axes.ts, mana-info.ts, compute.ts, theme.ts, index.ts
src/engine/mana/               karsten.ts, hypergeo.ts, index.ts
src/engine/summary.ts          DeckSummary from a deck
src/engine/targets.ts          per-bracket bands, archetype deltas, land target
src/engine/brackets/           combos.ts, analyze.ts, index.ts
src/engine/scoring/            scorer.ts, index.ts
src/engine/rating/             rate.ts, index.ts
src/engine/builder/            auto.ts, improve.ts, index.ts
src/engine/text/               decklist.ts, collection.ts, index.ts
src/ingest/                    http.ts, cards.ts, tags.ts, combos.ts, features.ts, images.ts, sync.ts, fixtures.ts
src/server/                    db.ts (schema+open), carddb.ts (in-memory CardDb), decks.ts, edhrec.ts, settings.ts
src/app/api/**                 route handlers
src/app/**                     pages and components
tests/fixtures/cards.json      ~600 real cards + features inputs (tags), combos.json, decks/*.txt
tests/engine/**                Vitest
tests/e2e/**                   Playwright
```

---

### Task 1: Scaffold and contract

**Files:** `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `playwright.config.ts`, Tailwind config, `src/app/layout.tsx`, `src/app/page.tsx` (placeholder), `src/engine/types.ts`, `tests/engine/smoke.test.ts`.

- [ ] Create the Next.js + TypeScript + Tailwind app in the repo root (existing `docs/` and `.gitignore` stay). Scripts: `dev`, `build`, `start` (port 3210 for dev and start), `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `e2e` (`playwright test`), `sync` (`tsx src/ingest/sync.ts`). Path alias `@/*` → `src/*`. `better-sqlite3` listed in `serverExternalPackages`.
- [ ] Write `src/engine/types.ts` exactly:

```ts
export type Color = 'W' | 'U' | 'B' | 'R' | 'G';
export type Bracket = 1 | 2 | 3 | 4 | 5;

export interface CardFace {
  name: string; manaCost: string; typeLine: string; oracleText: string;
  power: string | null; colors: Color[];
}
export interface Card {
  oracleId: string; scryfallId: string;
  name: string;            // full Scryfall name, "Front // Back" for multi-face
  frontName: string;
  layout: string;
  manaCost: string;        // front face cost for DFCs; combined for split/adventure
  cmc: number;
  typeLine: string;        // full
  frontTypeLine: string;
  oracleText: string;      // all faces joined with "\n//\n"
  colors: Color[]; colorIdentity: Color[];
  keywords: string[];
  power: string | null;    // front face
  producedMana: string[];
  legality: 'legal' | 'banned';
  gameChanger: boolean;
  edhrecRank: number | null;
  priceUsd: number | null;
  faces: CardFace[];       // length 1 for single-faced cards
  imageFaces: 1 | 2;       // 2 only for transform / modal_dfc
  isMeldResult: boolean;
}

export type Role =
  | 'land' | 'ramp' | 'fast-mana' | 'draw' | 'tutor' | 'spot-removal' | 'counterspell'
  | 'wipe' | 'protection' | 'recursion' | 'graveyard-hate' | 'win-condition' | 'stax'
  | 'extra-turn' | 'mass-land-denial' | 'game-changer';

export type AxisId = string; // e.g. 'tokens', 'counters', 'typal:elf'

export interface CardFeatures {
  oracleId: string;
  roles: Role[];
  axes: Record<AxisId, { e: number; p: number }>; // sparse; strengths in [0,1]
  instantSpeed: boolean;
  landWeight: number;      // 1 land, 0.38 / 0.74 MDFC land-spell, 0 otherwise
  taplandWeight: number;   // 0, 0.25 or 1
  sources: Partial<Record<Color | 'C', number>>; // mana source weight per colour
  pips: Partial<Record<Color, number>>;          // coloured pips in the (front) mana cost
  powerTier: 1 | 2 | 3 | 4 | 5;
  creatureTypes: string[];
}

export interface Combo {
  id: string;
  cards: { oracleId: string; mustBeCommander: boolean }[];
  requiresCount: number;   // template slots; 0 means the listed cards are sufficient
  bracketTag: 'R' | 'S' | 'P' | 'O' | 'C' | 'E';
  manaValueNeeded: number;
  produces: string[];
  popularity: number;
}

export interface CardDb {
  get(oracleId: string): Card | undefined;
  features(oracleId: string): CardFeatures | undefined;
  byName(name: string): Card | undefined;   // case/diacritic-insensitive; full or front name
  all(): readonly Card[];                    // legal, non-meld-result cards only
  combosFor(oracleId: string): readonly Combo[];
}

export interface DeckEntry { oracleId: string; qty: number; locked: boolean }
export interface Deck {
  id: string | null; name: string;
  commanders: string[];          // 0, 1 or 2 oracleIds
  companion: string | null;
  chosenColor: Color | null;
  main: DeckEntry[];             // excludes commanders and companion
  targetBracket: Bracket;
  themeWeights: Record<AxisId, number> | null; // null = derive from commander
}

export interface Violation { code: string; message: string; oracleIds: string[] }

export interface DeckSummary {
  cardCount: number;                         // commanders + main quantities
  landCount: number; landsEffective: number; // effective counts MDFC weights
  roleCounts: Record<Role, number>;
  avgMv: number;                             // nonland
  curve: number[];                           // index 0..7, 7 = 7+
  sources: Record<Color | 'C', number>;
  taplands: number;                          // weighted
  axisTotals: Record<AxisId, { e: number; p: number }>; // counts with strength >= 0.5
  gameChangers: string[];
  instantInteraction: number; interaction: number;
}

export interface RoleBand { lo: number; hi: number }
export interface Targets {
  lands: number;
  roles: Partial<Record<Role, RoleBand>>;
  avgMv: RoleBand;
  themeCards: number;
  taplandCap: number;
}

export interface FoundCombo { combo: Combo; missing: string[]; twoCard: boolean; early: boolean; relevant: boolean }
export interface BracketReport {
  floor: 1 | 2 | 3 | 4;
  playsLike: Bracket;
  reasons: { text: string; oracleIds: string[]; floor: number }[];
  warnings: string[];
  violationsOfTarget: Violation[];
  combos: { included: FoundCombo[]; oneAway: FoundCombo[] };
}

export interface EdhrecCard { numDecks: number; potentialDecks: number; lift: number | null }
export interface EdhrecData { commanderDecks: number; cards: Record<string, EdhrecCard>; themes: Record<string, number> }

export interface ScorePart { key: 'synergy' | 'coplay' | 'quality' | 'role' | 'cast' | 'bracket'; points: number; max: number }
export interface CardScore {
  oracleId: string; score: number;           // 0..100 integer
  parts: ScorePart[]; reasons: string[];
  gate: { code: string; message: string } | null; // when set, score is 0
}

export interface SubScore { key: string; label: string; weight: number; value: number; fixes: Fix[] }
export interface Fix { text: string; filter: { role?: Role; axis?: AxisId; color?: Color; maxMv?: number; land?: boolean } | null }
export interface DeckRating { rating: number; legal: boolean; complete: boolean; subscores: SubScore[]; violations: Violation[] }

export interface BuildOptions { ownedOnly: boolean; owned: Set<string> | null; maxPriceUsd: number | null; seed: number }
export interface SwapProposal { out: string; in: string; reason: string; ratingBefore: number; ratingAfter: number }

export interface EngineContext { db: CardDb; edhrec: EdhrecData | null; mldOverrides: Record<string, boolean>; extraTurnOverrides: Record<string, boolean> }
```

- [ ] `tests/engine/smoke.test.ts`: imports a type and asserts `1 + 1 === 2`. Run `pnpm typecheck && pnpm test`. Commit.

### Task 2: Data ingest, database, fixtures

**Spec:** §6. **Research:** `scryfall.md §2–§7`, `synergy-data.md §2.2–§2.3`.

**Files:** `src/ingest/{http,cards,tags,combos,images,sync,fixtures}.ts`, `src/server/{db,carddb}.ts`, `tests/fixtures/*`, `tests/engine/carddb.test.ts`.

**Produces:**
- `openDb(path?: string): Database` creating tables `cards(oracle_id PK, name, front_name, json)`, `tags(id PK, slug, label)`, `card_tags(oracle_id, tag_id)`, `combos(id PK, json)`, `combo_cards(combo_id, oracle_id)`, `card_features(oracle_id PK, json)`, `edhrec_cache(key PK, fetched_at, etag, json)`, `collection(oracle_id PK, qty)`, `decks(id PK, name, json, updated_at)`, `settings(key PK, json)`, `sync_state(step PK, finished_at, info)`.
- `toCard(scryfall: any): Card | null` (returns null unless `legalities.commander` is `legal` or `banned`).
- `loadCardDb(db): CardDb & { tagSlugs(oracleId): string[] }`, cached module-level, `invalidateCardDb()`.
- `createCardDb(cards: Card[], features: CardFeatures[], combos: Combo[]): CardDb` — the in-memory implementation, in `src/engine/carddb.ts` (pure) so tests use it too.
- CLI `pnpm sync [cards|tags|combos|features|images|all]`, each step writing `sync_state` and printing progress lines `step done/total`.
- `tests/fixtures/cards.json` (`{cards: Card[], tags: Record<oracleId, string[]>}`), `tests/fixtures/combos.json` (`Combo[]`), and `tests/helpers/fixture-db.ts` exporting `fixtureDb(): CardDb` and `card(name): Card` (features computed lazily via Task 4's `computeFeatures` once it exists; until then `features()` returns undefined).

- [ ] Tests (`carddb.test.ts`, on small inline Scryfall-shaped samples): `toCard` on a transform card joins both faces' oracle text with `"\n//\n"`, sets `imageFaces: 2`, `frontName`; on a split card `imageFaces: 1`; on a `not_legal` card returns null; `byName('lim-dul\'s vault')`-style lookup is case- and diacritic-insensitive and accepts the front name of a DFC.
- [ ] `cards`: resolve `oracle_cards` via `https://api.scryfall.com/bulk-data`, stream-gunzip `jsonl_download_uri`, parse line by line, upsert. Mark `isMeldResult` for cards that appear as `meld_result` in any `all_parts`.
- [ ] `tags`: load `oracle_tags`, roll up taggings through `child_ids` (cycle-safe), store slug per card.
- [ ] `combos`: stream-parse `https://json.commanderspellbook.com/variants.json.gz` with `stream-json` (never whole-file `JSON.parse`); keep `status === 'OK'`, `legalities.commander === true`, `bracketTag !== 'B'`; map to `Combo`.
- [ ] `images`: for every legal non-meld-result card download `display` and `grid` WebP per face; 6 parallel; skip files that exist with size > 0; write to `*.part` then rename; log every 500; failures collected and reported, not fatal. Flag `--limit N` for tests.
- [ ] `fixtures`: after a real `pnpm sync cards tags combos`, write the fixture files containing: every card named anywhere in this plan or in `docs/research/rules.md` §2–§5 and §8; all 53 Game Changers; all `is:commander`-style candidates among: Atraxa Praetors' Voice, Kinnan Bonder Prodigy, Lathril Blade of the Elves, Krenko Mob Boss, Meren of Clan Nel Toth, Talrand Sky Summoner, Karn Legacy Reforged, Kenrith the Returned King, Thrasios Triton Hero, Tymna the Weaver, Wilson Refined Grizzly, Raised by Giants, The Tenth Doctor, Rose Tyler, Kozilek the Great Distortion; plus the top 400 cards by `edhrec_rank`; plus all basic lands; plus every card in `tests/fixtures/decks/*.txt`. Combos fixture: every combo all of whose cards are in the fixture.
- [ ] Add three reference decklists as `tests/fixtures/decks/{precon,upgraded,cedh}.txt` (100 cards each, commander on the first line under a `Commander` header). Source them from Commander Spellbook-independent public lists: a 2025–2026 precon list, a Bracket 3 list, a cEDH list; verify each parses to 100 known cards.
- [ ] Run the real sync for cards, tags, combos. Record counts in the commit message (expect ≈32.6k legal cards, ≈4.6k tags, ≈119k combos). Commit code and fixtures.

### Task 3: Rules engine

**Spec:** §7. **Research:** `rules.md §1–§6`.

**Files:** `src/engine/rules/*`, `tests/engine/rules.test.ts`.

**Produces:**
```ts
isCommanderEligible(card: Card): boolean
partnerKind(card: Card): { kind: 'partner' | 'partner-with' | 'partner-variant' | 'background-chooser' | 'background' | 'doctors-companion' | 'doctor'; detail: string }[]
canPair(a: Card, b: Card): boolean
copyLimit(card: Card): number               // Infinity allowed
allowedIdentity(deck: Deck, db: CardDb): Set<Color>
cardFitsDeck(card: Card, deck: Deck, db: CardDb): Violation | null   // identity incl. Rulebreaker overrides, legality
needsColorChoice(commanders: Card[]): boolean
validateDeck(deck: Deck, db: CardDb): Violation[]
```
Violation codes: `size`, `no-commander`, `bad-commander`, `bad-pair`, `identity`, `copies`, `banned`, `unknown-card`, `companion`, `needs-color`.

- [ ] Tests, each on fixture cards: 99-card deck → `size`; Relentless Rats ×30 ok; Seven Dwarves ×8 → `copies`; Nazgûl ×9 ok; two Sol Rings → `copies`; basic Forest ×30 ok; Bayou in a mono-green deck → `identity`; Kenrith accepts any colour; The Prismatic Piper without `chosenColor` → `needs-color`, with `'R'` accepts Lightning Bolt; Grist eligible; Raised by Giants alone → `bad-commander`; Wilson + Raised by Giants ok; Thrasios + Tymna ok; Thrasios + Rose Tyler → `bad-pair`; The Tenth Doctor + Rose Tyler ok; a legendary Vehicle eligible; Black Lotus → `banned`; Lutri as companion → `companion`, Lutri in main ok; Tolabow with `chosenColor 'R'` accepts Lightning Bolt and rejects a green-identity sorcery; unknown oracleId → `unknown-card`; empty deck with no commander returns `no-commander` and `size` and does not throw; Kozilek (colourless) accepts Sol Ring and Wastes, rejects Forest.
- [ ] Implement. Rulebreaker table and companion predicates per `rules.md §4.4, §4.6`.
- [ ] `pnpm test` green. Commit.

### Task 4: Features, theme axes, mana maths

**Spec:** §8. **Research:** `scryfall.md §7`, `deck-theory.md §4, §6.2–§6.3`.

**Files:** `src/engine/features/*`, `src/engine/mana/*`, `src/ingest/features.ts`, `tests/engine/{features,mana}.test.ts`.

**Produces:**
```ts
AXES: { id: AxisId; label: string }[]                       // ~24 static axes; typal axes are dynamic 'typal:<type>'
computeFeatures(card: Card, tagSlugs: string[]): CardFeatures
commanderThemeWeights(commanders: Card[], edhrecThemes?: Record<string, number>): Record<AxisId, number>  // values in [0,1]
karstenSources(pips: number, mv: number): number            // table deck-theory.md §4.2; 0 pips → 0
landTarget(avgMv: number, cheapRampDraw: number, bracket: Bracket): number  // §4.1: round(31.42 + 3.13*avgMv - 0.28*cheap) - [0,0,1,3,4][bracket-1], floors 36/36/35/31/26, cap 42
pAtLeast(population: number, successes: number, draws: number, k: number): number  // hypergeometric
```
`pnpm sync features` computes and stores features for all cards.

- [ ] Tests: Sol Ring roles include `ramp` and `fast-mana`, sources `{C: 0.75}`... (rock weight; value 0.75); Llanowar Elves `ramp`, sources `{G: 0.5}`; Command Tower `land`, landWeight 1, taplandWeight 0; a guildgate taplandWeight 1; an MDFC land-spell landWeight 0.38 or 0.74; Swords to Plowshares `spot-removal` + instantSpeed; Wrath of God `wipe`; Counterspell `counterspell`, pips `{U: 2}`; Demonic Tutor `tutor` + `game-changer`; Armageddon `mass-land-denial`; Time Warp `extra-turn`; Rhystic Study `draw`; Reanimate `recursion`; Bojuka Bog `graveyard-hate`; Thassa's Oracle `win-condition`; Anointed Procession tokens payoff `p ≥ 0.5`; Krenko's Command tokens enabler `e ≥ 0.5`; Elvish Archdruid `typal:elf` with `p ≥ 0.5`; Lathril's theme weights have `typal:elf ≥ 0.9` and `tokens ≥ 0.5`; Meren → `sacrifice` and `graveyard` ≥ 0.6; Talrand → `spellslinger` ≥ 0.9; Atraxa → `counters` ≥ 0.6. `karstenSources(1,1) === 19`, `(2,2) === 30`, `(2,4) === 26`, `(3,3) === 36`, `(1,6) === 14`. `landTarget(3.0, 10, 2) === 38`. `pAtLeast(99, 37, 7, 2)` between 0.78 and 0.84.
- [ ] Implement roles from tag slugs (`ramp`, `mana-rock`, `mana-dork`, `land-ramp`, `draw`, `card-advantage`, `tutor`, `spot-removal`, `counterspell`, `sweeper`, `protection`, `recursion`, `hate-graveyard`, `alternate-win-condition`, `mass-land-denial`, `extra-turn`, `ritual`) combined with oracle-text rules that narrow the broad ones; `fast-mana` = produces mana and (cmc ≤ 1 nonland, or ritual, or a land producing 2+); `stax`, `win-condition` by text rules. `powerTier` from game-changer / fast-mana / free interaction (5), `edhrecRank` ≤ 100 or cheap tutor (4), ≤ 1500 (3), ≤ 6000 (2), else 1.
- [ ] Implement axes by regex per axis for enabler and payoff; theme weights per spec §8.2.
- [ ] Wire `fixtureDb()` to compute features. Run `pnpm sync features` on the real DB and print role counts (sanity: ramp 1.5k–3k, wipe 600–1.1k, counterspell 400–600). Commit.

### Task 5: Summary, targets, brackets

**Spec:** §9, §11. **Research:** `brackets.md §3, §9`, `deck-theory.md §2.3, §3`.

**Files:** `src/engine/summary.ts`, `src/engine/targets.ts`, `src/engine/brackets/*`, `tests/engine/{summary,brackets}.test.ts`.

**Produces:**
```ts
summarizeDeck(deck: Deck, db: CardDb, exclude?: string): DeckSummary       // exclude = oracleId left out (leave-one-out)
resolveThemeWeights(deck: Deck, ctx: EngineContext): Record<AxisId, number> // deck.themeWeights ?? commanderThemeWeights
targetsFor(deck: Deck, ctx: EngineContext, summary: DeckSummary): Targets   // bands §2.3 + archetype deltas §3 for axes with weight ≥ 0.6
scaleTargets(t: Targets, cardCount: number): Targets                         // linear in cardCount/100 for incomplete decks
findCombos(deck: Deck, db: CardDb): { included: FoundCombo[]; oneAway: FoundCombo[] }
analyzeBracket(deck: Deck, ctx: EngineContext): BracketReport
bracketGate(card: Card, deck: Deck, ctx: EngineContext): { code: string; message: string } | null
```
`twoCard` = 2 cards and `requiresCount === 0`; `relevant` = bracketTag in R/S/P or produces matches `/^(Infinite|Near-infinite)|Win the game|Lock/`; `early` = bracketTag `R` or `manaValueNeeded ≤ 5`.

- [ ] Tests: deck with Thassa's Oracle + Demonic Consultation → floor 4 with a combo reason; 3 Game Changers → floor 3; 4 → floor 4; Armageddon → floor 4; one Time Warp → floor 2; none of these → floor 1; `mldOverrides[armageddon] = false` removes that reason; target 2 with Rhystic Study → `violationsOfTarget` names it; `bracketGate(Rhystic Study, target 2)` non-null, at target 3 with 3 Game Changers already → non-null, with 2 → null; `findCombos` honours `mustBeCommander`; `oneAway` lists a combo when exactly one piece is missing and it fits the identity; empty deck → floor 1, no throw; `summarizeDeck` on the precon fixture: cardCount 100, landCount 34–40.
- [ ] Implement. `playsLike` from a 0–100 soft score (fast mana, tutors, Game Changers, free interaction, combo speed, avg MV, mean powerTier) with cutoffs 20/40/60/80; constants are yours, but the precon fixture must read 2, the cEDH fixture 4 or 5.
- [ ] Commit.

### Task 6: Card scoring

**Spec:** §10. **Research:** `deck-theory.md §6`.

**Files:** `src/engine/scoring/*`, `tests/engine/scoring.test.ts`.

**Produces:**
```ts
createScorer(deck: Deck, ctx: EngineContext): {
  score(card: Card): CardScore;                 // in-deck cards scored leave-one-out
  scoreAll(filter?: (c: Card) => boolean): CardScore[];
}
```
Weights: synergy 35, coplay 15, quality 20, role 15, cast 10, bracket 5; with `ctx.edhrec === null`: synergy 43, quality 27, coplay 0. Staple floor 55 (roles ramp/draw/spot-removal/land with quality ≥ 0.8). Gates per spec §10 using `cardFitsDeck`, `copyLimit`, `bracketGate`.

- [ ] Tests (Lathril deck unless stated): Elvish Archdruid scores above a generic off-theme creature of similar rank by ≥ 15; Lightning Bolt → gate `identity`, score 0; Black Lotus → gate `banned`; Rhystic Study at target 2 → gate, at target 4 → no gate; Sol Ring ≥ 55 in any deck that allows it; Cultivate's score with 0 ramp in deck > its score with 14 ramp in deck; a card already in the deck gets the same score as it would if absent (leave-one-out); every non-gated score's parts sum to `score` (±1 rounding) and `reasons.length ≥ 1`; empty deck with a commander does not throw; `scoreAll()` over the whole fixture DB returns one entry per card; with fake `ctx.edhrec` giving a card high inclusion and lift, its coplay part ≥ 12 of 15.
- [ ] Performance test: build a synthetic DB of 32,000 cards by cloning fixture cards with new ids; `scoreAll()` after constructing the scorer runs in < 400 ms in CI terms (target 150 ms on the owner's machine). Cache deck-independent parts inside the scorer.
- [ ] Commit.

### Task 7: Deck rating

**Spec:** §11. **Research:** `deck-theory.md §2.3, §4, §7`.

**Files:** `src/engine/rating/*`, `tests/engine/rating.test.ts`.

**Produces:** `rateDeck(deck: Deck, ctx: EngineContext): DeckRating` — sub-score keys and weights: `mana` 18, `roles` 16, `synergy` 16, `curve` 10, `interaction` 10, `wincons` 10, `consistency` 10, `bracket` 10. `value` in [0,1]. `rating = round(Σ weight·value)`, capped at 40 when `validateDeck` is non-empty. `complete = cardCount === 100` (or ≥ 100 for Whtz).

- [ ] Tests: precon fixture at target 2 rates 55–80 and is legal; cEDH fixture at target 5 rates ≥ 60 and its `mana` sub-score ≥ 0.6 (not punished for ~28 lands); the same cEDH list at target 2 has `bracket` value 0; removing 10 lands from the precon lowers `mana` and adds a fix with `filter.land === true`; removing all ramp adds a fix with `filter.role === 'ramp'`; an illegal deck rates ≤ 40 and lists violations; a 40-card partial deck returns a rating, `complete: false`, no NaN anywhere; every sub-score has ≤ 3 fixes; empty deck → rating 0–40, no throw.
- [ ] Implement with `summarizeDeck`, `scaleTargets`, `karstenSources`, `pAtLeast`, `analyzeBracket`. Commit.

### Task 8: Auto-build, fill, swaps, improve

**Spec:** §12.

**Files:** `src/engine/builder/*`, `tests/engine/builder.test.ts`.

**Produces:**
```ts
autoBuild(deck: Deck, ctx: EngineContext, opts: BuildOptions): Deck          // keeps commanders and locked entries; replaces the rest
fillRest(deck: Deck, ctx: EngineContext, opts: BuildOptions): Deck           // keeps everything present
suggestSwaps(deck: Deck, ctx: EngineContext, opts: BuildOptions, count?: number): SwapProposal[]  // weakest cards, same-role replacements
improveDeck(deck: Deck, ctx: EngineContext, opts: BuildOptions, max?: number): SwapProposal[]     // ordered by gain; applying all in order is valid
applySwaps(deck: Deck, swaps: SwapProposal[]): Deck
```
Seeded RNG (mulberry32) for score jitter ±3. Basics: choose per-colour counts to meet the largest `karstenSources` demand proportionally; colourless decks use Wastes.

- [ ] Tests: for each of Lathril, Atraxa, Krenko, Talrand, Kozilek (colourless), Kenrith (five-colour), Thrasios + Tymna, and each bracket 1–5: `autoBuild` → `validateDeck` empty, 100 cards, `analyzeBracket().floor ≤ max(target, 1)` (for targets 1–2 floor must be ≤ 2 and no Game Changers), rating ≥ 55; same seed → identical deck, different seed → different deck; locked entries survive; `ownedOnly` with a small owned set uses only owned cards plus basics and still returns 100 legal cards; `maxPriceUsd: 1` yields no card priced above 1 (null price allowed only for basics); `fillRest` on the precon minus 20 cards returns 100 legal cards and keeps the 80; `improveDeck` on a precon with 10 lands swapped for off-theme junk returns ≥ 5 proposals, each `ratingAfter > ratingBefore`, never cutting a locked card, and `rateDeck(applySwaps(...)).rating` is higher than before; `improveDeck` on an illegal imported deck (off-colour card) proposes cutting the offender first; on a deck with unknown cards does not throw.
- [ ] Each full build under 3 s in tests on the fixture DB. Commit.

### Task 9: Decklist and collection text

**Spec:** §13 import/export. **Files:** `src/engine/text/*`, `tests/engine/text.test.ts`.

**Produces:**
```ts
parseDecklist(text: string, db: CardDb): { commanders: string[]; companion: string | null; main: DeckEntry[]; unresolved: { line: number; text: string }[] }
exportDecklist(deck: Deck, db: CardDb): string     // "Commander" section then "Deck", "1 Name" lines
parseCollection(text: string, db: CardDb): { owned: { oracleId: string; qty: number }[]; unresolved: { line: number; text: string }[] }  // CSV with header (auto-detect name & quantity columns) or plain list
```

- [ ] Tests: every Review Focus 1 format resolves; a list with no section headers treats a line tagged `*CMDR*` or the first legendary eligible card when the list has exactly 100 cards as commander, else leaves commanders empty; duplicates merge quantities; a typo line lands in `unresolved` with its line number; `parseDecklist(exportDecklist(d))` round-trips; Moxfield CSV header (`Count,Tradelist Count,Name,Edition,...`), Archidekt (`Quantity,Name,...`) and ManaBox (`Name,Set code,...,Quantity,...`) all parse; quoted names with commas parse.
- [ ] Commit.

### Task 10: Server layer and API

**Spec:** §6.2, §6.3, §13.

**Files:** `src/server/{decks,settings,edhrec,context}.ts`, `src/app/api/**/route.ts`, `tests/server/api.test.ts`.

**Produces (all JSON; card objects sent to the client are `ClientCard = Pick<Card, 'oracleId'|'name'|'frontName'|'manaCost'|'cmc'|'typeLine'|'colorIdentity'|'imageFaces'|'gameChanger'|'priceUsd'> & { roles: Role[]; owned: boolean }`):**
- `GET /api/status` → sync state per step, card/image counts, settings.
- `POST /api/sync {step}` → starts the CLI step as a child process; `GET /api/sync` → progress lines.
- `GET /api/commanders?q&colors&page` → eligible commanders. `GET /api/partners?id` → legal partners for a commander.
- `GET/POST /api/decks`, `GET/PUT/DELETE /api/decks/[id]`.
- `POST /api/analyze {deck}` → `{ rating: DeckRating, bracket: BracketReport, summary: DeckSummary, targets: Targets, themeWeights, deckScores: Record<oracleId, CardScore> }`.
- `POST /api/cards {deck, q, filters:{role,axis,colors,mvMin,mvMax,type,owned,legalAtBracket,maxPrice}, sort, page, pageSize}` → `{ total, cards: (ClientCard & {score: CardScore})[] }` sorted by score desc by default; gated cards last.
- `POST /api/build {deck, mode: 'auto'|'fill'|'swaps'|'improve', options}` → `{deck}` or `{proposals}`.
- `POST /api/import {text}` → parsed deck + unresolved; `POST /api/export {deck}` → text.
- `GET/POST /api/collection` (POST `{text}` replaces), `GET/PUT /api/settings`.
- `GET /api/img/[size]/[file]` → streams `data/images/...` with a one-year cache header; 404 → a small inline SVG card-back placeholder with the name omitted.
- `getEdhrec(commanders, bracket): Promise<EdhrecData | null>` — returns null when disabled; implements spec §6.3 exactly.

- [ ] Tests against a temp SQLite seeded from fixtures (route handlers called directly): analyze on precon returns rating and 100 `deckScores`; `/api/cards` with `filters.role = 'ramp'` returns only ramp cards sorted by score; build `auto` returns a legal deck; import → save → load round-trips; image route path traversal (`..%2F`) → 400; EDHREC disabled → no network call (inject a fetch that throws).
- [ ] Commit.

### Task 11: UI

**Spec:** §13. Use the `frontend-design` skill for visual direction: dark, card-art-forward, dense but calm; score badges colour-coded (≥80, 60–79, 40–59, <40); mana symbols rendered as coloured glyphs.

**Files:** `src/app/{page,decks,new,deck/[id],data,collection}/**`, `src/app/components/**`.

- [ ] `/` decks list (commander art tiles, bracket, rating, count; New, Import, Duplicate, Delete).
- [ ] `/new` commander picker → partner step when applicable → colour choice when required → bracket → "Auto-build" / "Start empty" / "Import a list".
- [ ] `/deck/[id]` builder: header (commander images, bracket selector, count, rating gauge, legality chip, floor and plays-like chips); left card browser (virtualised image grid, search, filters, score badges, gated cards greyed with reason); right deck (image grid grouped by role|type toggle, list toggle, lock, remove, weakest highlighted); panels: Rating (8 sub-scores, fixes clickable → set browser filters), Bracket (reasons, violations, combos included / one away with card images), Themes (sliders), Improve (proposal list: out image → in image, reason, rating delta, accept / reject / apply all, options owned-only and max price). Card detail overlay: `display` image, flip for two faces, score parts as bars, reasons, add/remove. Buttons: Auto-build, Fill the rest, Reroll, Suggest swaps, Export (copy to clipboard). Debounced autosave and re-analyze (200 ms) on every change; optimistic add/remove.
- [ ] `/data` sync status and buttons, image progress, EDHREC toggle with the plain explanation from spec §6.3 and §14, mass-land-denial / extra-turn overrides. First run with an empty DB redirects here.
- [ ] `/collection` paste/import and count.
- [ ] Missing image or unknown card renders a placeholder tile with the card name (Review Focus 5).
- [ ] Commit.

### Task 12: End-to-end, calibration, review

- [ ] Playwright (`tests/e2e/smoke.spec.ts`, against the real synced DB): create deck with Lathril at Bracket 3 via Auto-build → deck shows 100, legality chip "Legal", rating number visible, ≥ 90 card images loaded (`naturalWidth > 0`); remove a land → count 99 and rating changes; add top-scored land back; open Improve on an imported precon → proposals appear, accept one → deck changes; export text has 100 quantities.
- [ ] `pnpm tsx src/ingest/calibrate.ts`: prints, for 6 commanders, the top 30 scored cards and the rating of an auto-build per bracket; fix obviously wrong rankings by tuning weights/regexes, re-run tests.
- [ ] Whole-branch review against the spec's goals and anti-goals; fix findings; final `pnpm typecheck && pnpm test && pnpm e2e`.
- [ ] Write `README.md`: how to start (`pnpm install`, `pnpm sync all`, `pnpm start`, open http://localhost:3210), what each sync step does, where data lives, how to re-sync after a Wizards update.
