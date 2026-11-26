# Deck network and focused themes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show every deck as an interactive network of how its cards work together, with a cohesion number, and make the engine build fewer, tighter themes with no cards that connect to nothing.

**Architecture:** A pure engine module `src/engine/network/` turns a deck into nodes, reasoned edges (combo, feeds, typal, commander), clusters and cohesion. Its edge rules (`edges.ts`) are the one source that the network, the scorer's new connection term and the rating's Synergy part all read, and `resolveTheme` focuses commander-derived theme weights, so scorer, rating and builder share the focused numbers. The server answers `POST /api/network` from the deck's cached analysis and puts cohesion on deck tiles. The deck page gets a Network tab: a three.js view: layout and interaction from `3d-force-graph` (three.js-based, MIT), every node and edge drawn by our own three.js objects (owner: "draw it with three.js … do whichever is better"); dynamic import; SVG fallback from the same node/link data; an "Export graph.json" button in Graphify's node/link shape; and a side list whose "Swap the unconnected cards" runs Fix deck with `only='synergy'`.

**Tech Stack:** TypeScript strict, Vitest, Next.js 16 route handlers, React 19 + Tailwind v4, three.js (new dependencies `three` and `3d-force-graph`, both MIT, bundled through npm, never loaded from a CDN).

**Ruling D23 (controller, 2026-11-26, replaces D20 and D22):** the owner asked for the better option. Layout, camera controls, hover and click come from `3d-force-graph` (proven, three.js underneath, the stack Graphify's 3D viewers use); every node and link is our own three.js object through `nodeThreeObject` / `linkThreeObject` (art-crop sprite in a ring sized by connectedness, dashed outline for unconnected cards, edge colours per D19), so the look is ours and the physics is not re-invented. Wherever a task below describes an in-app force layout (`layout.ts`), use the library's d3-force-3d instead: commander pinned at the origin (`fx/fy/fz = 0`), link strength from edge weight, charge for repulsion, `cooldownTicks` so it settles, reduced motion → `warmupTicks` with the animation off. Keep a pure `toGraphData(network)` in the engine producing Graphify's shape `{ nodes: [{ id, name, group, val }], links: [{ source, target, relation, weight, reason }] }`; it feeds the view and "Export graph.json". The SVG fallback runs a few hundred synchronous ticks of the same forces (via the library's headless d3-force-3d, no second algorithm).

**Spec:** `docs/superpowers/specs/2026-11-26-deck-network-design.md`, governed by `docs/superpowers/specs/2026-11-26-app-map-and-shared-design.md`.

**Order:** Tasks 1–5 need nothing else. Tasks 6–7 start once the deck-page plan (`docs/superpowers/plans/2026-11-26-deck-page-fix-deck.md`) has Task 4a (shared kit) and Tasks 4–5 (Fix deck flow with `ResultPanel` and Undo in `Builder.tsx`) on main.

**Not in this plan:** "plays together" edges (the app has no pairwise EDHREC data and the spec forbids fetching it); the commander page's Average deck (no commander page exists yet: `NetworkView` and `NetworkSummary` are built to be dropped in by that plan); lining clusters up with 8×8 packages (packages do not exist yet).

## Global Constraints

- `src/engine` stays pure: no Node, Next, React, three or `src/server` imports; no `any`. `src/engine/types.ts` changes are additive only.
- Scoring and rating share numbers (AGENTS rule 6): theme weights only through `resolveTheme` / `resolveThemeWeights` (the focus lives inside them); edge weights and "unconnected" only from `src/engine/network/edges.ts`; the commander link only from `scorer.commanderLink`; the rating's and the tile's cohesion is `deckNetwork(...).cohesion`, never recomputed.
- Never report an illegal deck as legal. Every `CardScore` keeps `parts` and `reasons` (the connection term adds its own reason); every low sub-score has fixes. Brackets 1 and 5 are never assigned automatically.
- The app works with EDHREC off; no network calls on any path. EDHREC data reaches the engine only as `ctx.edhrec` from `engineContext` (`peekEdhrec`, cache only). No pairwise data exists, so no "plays together" edges.
- Saved decks are never rewritten: a deck's own `themeWeights` come back exactly as saved; only the explicit **Focus on these two** button writes focused weights, through the normal save.
- `src/app/lib/api.ts` documents every endpoint and new field in its header: `POST /api/network`, `DeckTile.cohesion`, `AnalyzeResponse.themeFocus`.
- UI per the app-map spec, composed from the shared kit in `src/app/components/` (`Section`, `CardGrid`, `CardTile`, `EmptyState`, `ResultPanel`, `CardDetail`, with their props as built in deck-page Task 4a). Existing colour tokens only, per ruling D19 (app map reserves ember for "!"): combo edges brass `#d6ab52`, feeds bone `#efe7d7`, typal ash `#a79d8b`, commander spokes smoke `#7d7566`; unconnected nodes get a dashed outline, never ember; the staple ring does not move on its own. Display serif for headings only, tabular figures, sentence case, plain English that says what a control does, desktop 1440×900 (fine at 1280), motion only answering actions, reduced motion respected. Every existing `data-testid` keeps working.
- New dependencies: `three`, `3d-force-graph` (and `d3-force-3d` if the SVG fallback needs it directly), `@types/three` (dev). All are loaded with `await import(...)` inside the view, so no other page's bundle grows.
- UI checks only on the scratch copy: `COMMANDER_FORGE_DATA=/Users/egecanaktan/github_repositories/commander-forge/.superpowers/sdd/2026-11-25-physical-collection-boxes/uidata pnpm exec next dev --webpack -p 3211`. Never `data/`, never port 3210, never `pnpm build` (it rewrites the `.next` a running dev server uses). Every check is net-zero (deck JSON identical afterwards). Revert any AGENTS.md rewrite by `next dev` (`git checkout AGENTS.md`). Screenshots and reports go to `.superpowers/sdd/2026-11-26-deck-network/`.
- Small commits on main, one concern each, imperative subject, no Co-Authored-By or "Generated with" lines. `git add` named paths only (another agent commits on main too). Never amend, rebase or reset commits that are not yours.
- Existing tests are not edited to make them pass. If one fails the change is wrong, unless the test pinned a pre-focus theme weight; then change only that value and name it in the task report.

## Review Focus

1. **A deck that is not a deck yet** (new deck, commander only, 40 cards, no commander) opened on the Network tab: no throw, cohesion finite (0 with no cards), an empty state in the view, no NaN in the rating. (Task 1 test `empty, commander-only, partial and commanderless decks give a finite network`; Task 7 check 5.)
2. **Imported lists with odd shapes** (partner commanders, a companion, 30 copies of one card, an oracle id the database lacks): both commanders are centre nodes, the companion and unknown ids are not nodes, one node per card carrying its `qty`. (Task 1 test `partners, a companion, many copies and unknown ids`.)
3. **WebGL missing, or lost mid-session** (old GPU, laptop sleep): the same layout drawn as SVG, with hover, click and the legend still working. (Task 6 checks `?network=2d` and a forced context loss.)
4. **Saved decks re-rated by the focus**: every deck saved with `themeWeights: null` (all auto-builds) is now rated with focused weights; decks with their own weights are untouched. (Task 2 test `a deck's own weights come back untouched`; Task 2 records the scratch copy's ratings, Task 4 reports before/after per deck and flags any move over 5 points.)
5. **Swap the unconnected cards with nothing better allowed** (owned-only with no connected owned card): no changes, a plain note, deck untouched, no Undo. (Task 4 test `a synergy fix with nothing connected allowed leaves the deck untouched`; Task 7 check 4.)

---

### Task 1: The deck network in the engine

**Files:**
- Create: `src/engine/random.ts` (`mulberry32` moved from `src/engine/builder/pool.ts`; `pool.ts` re-exports it; `src/engine/builder/index.ts` unchanged)
- Create: `src/engine/network/edges.ts`, `src/engine/network/clusters.ts`, `src/engine/network/index.ts`
- Modify: `src/engine/types.ts` (append the network types), `src/engine/summary.ts` (add `namedTypes`), `src/engine/scoring/scorer.ts` (add `commanderLink`; no score changes), `src/engine/scoring/index.ts` (export type `Scorer`)
- Create: `tests/helpers/network.ts` (`fixtureDeck(name: 'precon' | 'upgraded' | 'cedh', bracket: Bracket): Deck` as in rating.test.ts; `withTenRandom(deck: Deck): Deck`; `oddDeck(): Deck`, both described in Step 2; Tasks 3, 4 and 6 reuse them)
- Test: `tests/engine/network.test.ts`

**Interfaces:**
- Consumes: `resolveThemeWeights`, `deckCards`, `AXIS_MEMBER`, `NAMED_THEME_WEIGHT` (`src/engine/summary.ts`); `cardFitsDeck` (`src/engine/rules`); `axisLabel` (`src/engine/features`); `createScorer`.
- Produces in `src/engine/types.ts`:
```ts
export type NetworkEdgeKind = 'combo' | 'feeds' | 'typal' | 'commander';
export interface NetworkNode {
  oracleId: string; qty: number; commander: boolean;
  /** Has a ring role (ramp, fast mana, draw, spot removal, protection, tutor, wipe, counterspell): drawn on the staple ring, never unconnected. */
  staple: boolean;
  roles: Role[];
  /** Its strongest theme axes in this deck (max(e, p) ≥ 0.5, ordered by max(e, p) × deck weight), at most three. */
  axes: AxisId[];
  /** Sum of its combo, feeds and typal edge weights. */
  degree: number;
  /** `scorer.commanderLink` for the card, 0..1, three decimals; 1 for a commander. */
  link: number;
  cluster: number | null;
  unconnected: boolean;
}
export interface NetworkEdge {
  a: string; b: string;                      // a < b
  kind: NetworkEdgeKind;
  weight: number;                            // 0..1, three decimals
  /** The reason as read from a's side and from b's side ("Feeds Ezuri's +1/+1 counters" / "Fed by Hardened Scales (+1/+1 counters)"). */
  reasons: [string, string];
  axis?: AxisId; comboId?: string;
}
export interface NetworkCluster { id: number; key: string; name: string; cards: string[]; weight: number }
export interface DeckNetwork {
  nodes: NetworkNode[]; edges: NetworkEdge[]; clusters: NetworkCluster[];
  cohesion: number;                                       // 0..100 integer
  cohesionParts: { connected: number; clustered: number }; // shares 0..1, three decimals
  unconnected: string[];
}
```
- Produces in `src/engine/summary.ts`: `namedTypes(weights: Record<AxisId, number>): AxisId[]` (theme code, next to `NAMED_THEME_WEIGHT`; living here keeps summary ↔ network free of an import cycle once Task 2 uses it).
- Produces in `src/engine/network/edges.ts` (imports summary, rules, features and types only; the scorer imports from this file, never from `network/index.ts`, which imports the scorer): `RING_ROLES: readonly Role[]`, `UNCONNECTED_EDGE = 0.15`, `UNCONNECTED_LINK = 0.3`, `TYPAL_EDGE = 0.6`, `COMBO_EDGE = 1`, `ONE_AWAY_EDGE = 0.5`, `MAX_EDGES_PER_NODE = 12`; `isRingCard(f: CardFeatures): boolean`; `shortName(card: Card): string`; `interface LinkCard { card: Card; f: CardFeatures; commander: boolean }`; `pairEdges(a: LinkCard, b: LinkCard, weights: Record<AxisId, number>, named: readonly AxisId[]): NetworkEdge[]`; `comboEdges(deck: Deck, db: CardDb): NetworkEdge[]`; `linkIndex(deck: Deck, db: CardDb, weights: Record<AxisId, number>): { strongest(card: Card): { weight: number; kind: 'combo' | 'feeds' | 'typal'; with: string } | null }`.
- Produces in `src/engine/network/clusters.ts`: `clusterNetwork(nodes: NetworkNode[], edges: NetworkEdge[], db: CardDb, seed: number): NetworkCluster[]`.
- Produces in `src/engine/network/index.ts`: `deckNetwork(deck: Deck, ctx: EngineContext, opts?: { scorer?: Scorer; seed?: number }): DeckNetwork` (seed default 1); `cohesionOf(nodes: NetworkNode[], edges: NetworkEdge[], clusters: NetworkCluster[]): { cohesion: number; parts: { connected: number; clustered: number } }`; re-exports `edges.ts`.
- Produces on the scorer: `commanderLink(card: Card): number | null`; `export type Scorer = ReturnType<typeof createScorer>` in `src/engine/scoring/index.ts`.
- `random.ts`: `mulberry32(seed: number): () => number`. Network and layout code import it from `../random`, never from `../builder` (that index pulls in fix → rating → network: an import cycle; and the layout ships to the browser).

- [ ] **Step 1: Move `mulberry32`** to `src/engine/random.ts` (body verbatim); `pool.ts` imports it and re-exports it. Run `pnpm vitest run tests/engine && pnpm typecheck` → PASS. Commit `refactor(engine): mulberry32 in its own module`.

- [ ] **Step 2: Write the failing tests** in `tests/engine/network.test.ts`. Fixture decks as in `rating.test.ts` (`parseDecklist(deckText(name), db)`; precon at Bracket 2, upgraded at 3, cedh at 5; `ctx.edhrec = null`):
  - `nodes are the nonland cards and the commanders`: node ids equal the main ids with `landWeight < 1` plus the commanders; exactly the commanders have `commander: true`.
  - `combo edges join the pieces of a combo the deck holds` (cedh): for every `findCombos(deck, db).included` combo, every pair of its pieces has an edge with `kind 'combo'`, `weight 1`, `comboId` the combo's id, both reasons matching `/^Combo with /`.
  - `one card away is a half-weight combo edge` (cedh): for each `oneAway` combo with at least two pieces in the deck, those pieces share a combo edge of weight 0.5, or 1 when a complete combo also joins them; a 0.5 edge's reasons match `/^One card away from a combo with .+: needs /`.
  - `feeds edges are enabler × payoff × the deck's weight` (upgraded): at least one feeds edge has `axis 'tokens'`; every feeds edge's weight equals, within 0.001, the larger of `e(a) × p(b) × w` and `e(b) × p(a) × w` with `w = resolveThemeWeights(deck, ctx)[axis]`; the enabler's reason is `Feeds <payoff short name>'s <axis label lower-cased>`, the payoff's `Fed by <enabler short name> (<axis label>)`.
  - `an Elf and an Elf payoff share a typal edge` (upgraded): Elvish Mystic and Elvish Archdruid share a `typal` edge, weight 0.6, `axis 'typal:elf'`, reasons `An Elf for Elvish Archdruid` (Mystic's side) and `Pays off Elvish Mystic, an Elf` (Archdruid's side).
  - `spokes carry the scorer's commander link`: every non-commander node with `link > 0` has exactly one `commander` edge, to `deck.commanders[0]`, with `weight === node.link === round3(createScorer(deck, ctx).commanderLink(card))`; nodes with `link 0` have none.
  - `EDHREC lift raises the commander link`: with `ctx.edhrec = { commanderDecks: 1000, themes: {}, cards: { [X]: { numDecks: 600, potentialDecks: 1000, lift: 9 }, [Y]: { numDecks: 10, potentialDecks: 1000, lift: 0.5 } } }` (X, Y two nonland cards of the upgraded deck, X with `commanderLink` < 0.7 without EDHREC), `commanderLink(X)` rises by more than 0 and at most 0.25 against `edhrec: null`; a card absent from the page is unchanged.
  - `every edge reads from both sides`: both reasons non-empty and free of `NaN|undefined`, `a < b`, `(a, b, kind)` unique, weights in (0, 1], combo/feeds/typal weights ≥ 0.15.
  - `each node keeps at most twelve theme edges`: every combo/feeds/typal edge that is not a combo edge is among the 12 strongest such edges of `a` or of `b`; the upgraded network has at most 900 edges.
  - `the link index and the network agree` (all three decks): for every non-commander node, `linkIndex(deck, db, weights).strongest(card)?.weight ?? 0` is ≥ 0.15 exactly when the node has a combo/feeds/typal edge, and then equals that node's strongest such edge weight (within 0.001).
  - `unconnected cards are never staples, lands or commanders`: every unconnected node has `staple false`, no combo/feeds/typal edge and `link < 0.3`; every non-commander, non-staple node with no such edge and `link < 0.3` is in `unconnected`.
  - `clusters are stable for a fixed seed`: `deckNetwork(deck, ctx, { seed: 7 })` twice gives identical `clusters` and node `cluster` values; every cluster has at least 2 cards; `clusters[0]` has the most cards; names are non-empty; the upgraded deck has a cluster named `Elf typal`.
  - `cohesion follows its formula` (hand-made input to `cohesionOf`): five non-staple, non-commander nodes a–e, e unconnected; clusters `[{ id: 0, cards: [a, b] }, { id: 1, cards: [c, d] }]`; edges a–b 1.0, c–d 0.5, b–c 0.5 (all `feeds`) → `parts.connected === 0.8`, `parts.clustered === 0.75`, `cohesion === 78`. No non-commander nodes → `{ cohesion: 0, parts: { connected: 0, clustered: 0 } }`.
  - `a tight deck is more cohesive than the same deck with ten random cards` (precon and upgraded): `withTenRandom(deck)` swaps 10 nonland, non-commander cards picked with `mulberry32(1)` for 10 legal, on-colour, nonland fixture cards not in the deck picked with `mulberry32(2)` → cohesion strictly lower.
  - Review Focus 1, `empty, commander-only, partial and commanderless decks give a finite network`: empty deck → 0 nodes, cohesion 0; commander only → 1 node, cohesion 0; the precon's first 40 main entries, and the precon with `commanders: []` → no throw, cohesion an integer in 0..100.
  - Review Focus 2, `partners, a companion, many copies and unknown ids`: `oddDeck()` = two fixture commanders that `canPair`, a fixture companion as `companion`, 30 copies of a fixture card without a copy limit, and the main entry `'not-a-card'` → both commanders are nodes with `commander: true`; the companion and `'not-a-card'` are not nodes; the many-copies card is one node with `qty: 30`.

- [ ] **Step 3: Run** `pnpm vitest run tests/engine/network.test.ts` → FAIL (`deckNetwork` is not exported).

- [ ] **Step 4: Implement** the interfaces above. Decisions the signatures leave open:
  - `commanderLink(card)`: null when the card is gated (`stat.gate`); 0 for a land; otherwise the static synergy share `stat.syn` exactly as `buildStat` leaves it (best axis × pull, second-axis bonus, quality scaling, or the utility share); then, when `ctx.edhrec.cards[card.oracleId].lift` is finite, `+ 0.25 × percentile(cache.lifts, lift)`; clamped to 0..1. Scarce-side boost, elite share and combo credit are left out (combos are their own edges; the others are deck-balance, not connection).
  - `RING_ROLES = ['ramp', 'fast-mana', 'draw', 'spot-removal', 'protection', 'tutor', 'wipe', 'counterspell']`.
  - `namedTypes(weights)`: every `typal:<type>` axis whose weight equals the highest `typal:*` weight, when that weight is ≥ `NAMED_THEME_WEIGHT` (0.5); else `[]`.
  - `pairEdges`, at most one edge per kind (the strongest), only edges ≥ `UNCONNECTED_EDGE`:
    - feeds: over axes other than `typal` and `typal:*` with `weights[axis] > 0`, the larger of `a.e × b.p × w` and `b.e × a.p × w`; that direction names enabler and payoff.
    - typal (weight 0.6): a member of `typal:X` (`e ≥ AXIS_MEMBER` on it, or a creature with `typal.e ≥ AXIS_MEMBER`, a changeling, for any X) and a payoff of it (`p ≥ 0.5`); an any-type payoff (`typal.p ≥ 0.5`) and a member of a named type; a member of a named type and a commander. Reasons: member `An Elf for <payoff>`, payoff `Pays off <member>, an Elf`; with a commander: member `A Dragon, the deck's creature type`, commander `Leads <member>, a Dragon`. The type word is `axisLabel(axis)` without ` typal`; `A`/`An` by its first letter.
  - `comboEdges`: the rule of `findCombos` (`src/engine/brackets/combos.ts:57`), without its 100 cap, over every combo of every deck card: complete → 1 for every pair of pieces; one legal, on-identity, non-commander piece missing and at least two pieces present → 0.5 for every pair of present pieces; the strongest per pair. Reasons `Combo with <other> (<result>)`, result = the first `produces` line matching `/win the game|loses? the game/i`, else `/^(near-)?infinite/i`, else the first, first letter lower-cased; one away: `One card away from a combo with <other>: needs <missing>`.
  - `linkIndex`: built once from the deck's nonland cards and commanders: per axis the two strongest `e` and two strongest `p` holders (so a card never meets itself), typal members and payoffs per type, the present set for combos. `strongest(card)` is the raw maximum of the same three rules, values under 0.15 included, never pairing the card with itself; for a card not in the deck it answers "if it were added".
  - `shortName`: `frontName` up to the first `, ` (Ezuri, Claw of Progress → Ezuri).
  - `deckNetwork`: weights = `resolveThemeWeights(deck, ctx)`; scorer = `opts.scorer ?? createScorer(deck, ctx)`; nodes from `deckCards(deck, db)` minus lands (unknown ids and the companion never appear there); edges = `comboEdges` + `pairEdges` for every pair, then the per-node cap (an edge stays if it is among the 12 strongest combo/feeds/typal edges of either end; combo edges always stay); spokes: one `commander` edge per non-commander node with `link > 0`, to `deck.commanders[0]`, reasons `<pct>% synergy with <commander short name>` (card side, `, played with it on EDHREC` appended when the lift raised it) and `<pct>% synergy with <card short name>`; a second commander gets a `commander` edge of weight 1 to the first, reasons `Commands the deck with <other>`. `unconnected`: non-commander, non-staple nodes with `linkIndex.strongest < 0.15` and `link < 0.3`, ordered by `link` then name.
  - `clusterNetwork`: weighted label propagation over combo/feeds/typal edges between non-commander nodes. A node starts with the key of its strongest such edge (`combo:<id>`, or the axis of a feeds/typal edge), else the axis of its typal edge to a commander, else no label. Visit order: ids sorted, then shuffled with `mulberry32(seed)`; a node takes the label with the largest summed weight among its neighbours (keeps its own on a tie, else the smallest key); at most 20 rounds, stop when nothing changes. Clusters are labels held by ≥ 2 nodes, ordered by card count, then internal weight, then key; `id` = position; `name` = `axisLabel(axis)`, or `<short name of the combo piece with the best EDHREC rank> combo`; `weight` = summed internal edge weight.
  - Cohesion (`cohesionOf`), exactly:
```text
cards      = non-commander nodes; none → cohesion 0, parts { connected: 0, clustered: 0 }
nonStaple  = cards with staple false
connected  = nonStaple.length === 0 ? 1 : (nonStaple.length − unconnected count) / nonStaple.length
E          = combo, feeds and typal edges with no commander end
inside     = Σ weight of edges in E whose two ends are in the same cluster, that cluster being id 0 or id 1
clustered  = Σ weight(E) === 0 ? 0 : inside / Σ weight(E)
cohesion   = Math.round(100 × (0.6 × connected + 0.4 × clustered)); parts rounded to three decimals
```

- [ ] **Step 5: Run** `pnpm vitest run tests/engine && pnpm typecheck` → PASS (every existing engine test unchanged).

- [ ] **Step 6: Commit** `feat(network): deck network with combo, feeds, typal and commander edges, clusters and cohesion`.

### Task 2: Focus the themes

**Files:**
- Modify: `src/engine/summary.ts` (`FOCUS_OTHER`, `themeFocus`, `focusThemeWeights`, `resolveTheme`), `src/server/context.ts` (`Report.themeFocus`), `src/app/lib/api.ts` (`AnalyzeResponse.themeFocus` and its header line), `src/app/deck/[id]/Panels.tsx` (`ThemesPanel`), `src/app/deck/[id]/Builder.tsx` (`onFocus` prop)
- Test: `tests/engine/theme-focus.test.ts`, `tests/server/api.test.ts` (one case)

**Interfaces:**
- Consumes: `namedTypes` (Task 1, same file), `commanderThemeWeights`.
- Produces: `FOCUS_OTHER = 0.25`; `themeFocus(weights: Record<AxisId, number>): { axes: AxisId[]; focused: boolean }`; `focusThemeWeights(weights: Record<AxisId, number>): Record<AxisId, number>`; `resolveTheme` returns focused weights for sources `'commander'` and `'deck'` (same `ResolvedTheme` shape; `'user'` weights untouched); `AnalyzeResponse.themeFocus: { axes: AxisId[]; focused: boolean; weights: Record<AxisId, number> }` (from the resolved weights: `themeFocus(w)` plus `weights: focusThemeWeights(w)`).
- Rule: focus axes = the two strongest axes other than `typal`, with ties at the cut all kept (every such axis whose weight ≥ the second-strongest weight), plus `namedTypes(weights)`, plus `typal` when a named type is kept. `focused` = every other axis ≤ 0.25 × the weakest focus axis' weight. `focusThemeWeights` returns its input unchanged when it is focused (so focusing twice changes nothing), else keeps the focus axes and multiplies every other axis by 0.25 (not rounded, not removed). In `resolveTheme` the "names a theme" test (`NAMED_THEME_WEIGHT`) reads the unfocused commander weights; for `'deck'` the inferred axis (and `typal` 0.8) is added first, then the whole set is focused.

- [ ] **Step 1: Record the scratch copy's ratings before any engine change** (Review Focus 4): a read-only `pnpm tsx` one-off opens the scratch copy's database with `openDb` (no writes), rates every saved deck with `ctx = { db: <its CardDb>, edhrec: null, mldOverrides: {}, extraTurnOverrides: {} }`, and writes `[{ id, name, themeWeights: deck.themeWeights === null ? 'null' : 'own', rating, synergy }]` to `.superpowers/sdd/2026-11-26-deck-network/ratings-before.json`. Not committed.

- [ ] **Step 2: Write the failing tests** in `tests/engine/theme-focus.test.ts`:
  - `keeps the commander's top two axes and its named type, and scales the rest by 0.25` (Lathril, Blade of the Elves, commander only): `typal:elf` 1, `tokens` 0.8, `typal` 0.8 unchanged; `lifegain` ≈ 0.1; `attack`, `evasion`, `typal:noble` ≈ 0.075 (`toBeCloseTo(x, 6)`); `themeFocus(...).axes` sorted equals `['tokens', 'typal', 'typal:elf']`.
  - `ties at the cut are all kept` (Leonardo, the Balance): `tokens` 1, `counters` 0.8, `evasion` 0.8 unchanged; `attack` ≈ 0.1, `lifegain` ≈ 0.075.
  - `a commander that names several creature types keeps all of them` (Kaheera, the Orphanguard): the five `typal:*` axes at 1 and `typal` 0.8 unchanged.
  - `the inferred dragon theme is kept` (precon): `typal:dragon` 1 and `typal` 0.8 (the existing quality-pass test stays green).
  - Review Focus 4, `a deck's own weights come back untouched`: `themeWeights: { tokens: 1, counters: 0.9, lifegain: 0.8, attack: 0.7 }` → `resolveThemeWeights` `toEqual` it exactly; `themeFocus` of it → `focused: false`.
  - `focusing twice changes nothing`: for Lathril, Leonardo, Grizzlegom and the weights above, `focusThemeWeights(focusThemeWeights(w))` `toEqual` `focusThemeWeights(w)`, and `themeFocus(focusThemeWeights(w)).focused` is true.
  - `a commander with five weak axes builds a deck whose top two axes hold most of its theme cards` (Grizzlegom, Hurloon Hero: tokens 1, big-mana 0.6, lifegain 0.4, counters 0.3, attack 0.3): `autoBuild` at Bracket 3, `{ ownedOnly: false, owned: null, maxPriceUsd: null, seed: 1 }`; theme cards = nonland main cards with max(e, p) ≥ 0.5 on any non-typal axis of the raw `commanderThemeWeights`; the share on `tokens` or `big-mana` is > 0.5 and ≥ the share in the same build made with `themeWeights` set to the raw commander weights.
  - `tests/server/api.test.ts`, `analyze reports the theme focus` (imported upgraded deck): `themeFocus.axes` contains `'typal:elf'` and `'tokens'`, `focused` is true, `themeFocus.weights` `toEqual` `themeWeights`.

- [ ] **Step 3: Run** `pnpm vitest run tests/engine/theme-focus.test.ts tests/server/api.test.ts` → FAIL (`focusThemeWeights` is not exported).

- [ ] **Step 4: Implement** the engine rule, `Report.themeFocus` in `makeAnalysis` (from `resolveThemeWeights(deck, ctx)`), the api.ts field and header line (`themeFocus`: the axes the deck is focused on, whether it already is, and the weights **Focus on these two** saves). `ThemesPanel`: under the sliders a line `Focused on <labels of the focus axes, without "Typal (any type)", joined with ", " and " and ">` and the button **Focus on these two** (`data-testid="theme-focus"`, `btn`), enabled only when `!analysis.themeFocus.focused`, title `Keep <labels> at full weight and turn every other theme down to a quarter` (disabled title `Already focused`); click → `onFocus()` = `mutate((d) => ({ ...d, themeWeights: analysis.themeFocus.weights }))`.

- [ ] **Step 5: Run** `pnpm vitest run tests/engine tests/server && pnpm typecheck` → PASS. Then on the scratch copy (Global Constraints): a deck whose saved `themeWeights` is null → Themes tab shows the "Focused on" line and a disabled button (screenshot `themes-focused.png`); move one slider (the deck now has its own weights) → **Focus on these two** → the other sliders drop to a quarter (screenshot `themes-focus-clicked.png`) → **Reset to the commander** → deck JSON from `GET /api/decks/:id` identical to before.

- [ ] **Step 6: Commit** `feat(themes): focus on the commander's top two themes, and Focus on these two`.

### Task 3: The scorer's connection term

**Files:**
- Modify: `src/engine/scoring/scorer.ts`
- Test: `tests/engine/connection.test.ts`

**Interfaces:**
- Consumes: `linkIndex`, `isRingCard`, `UNCONNECTED_EDGE`, `UNCONNECTED_LINK`, `deckNetwork` (Task 1); `commanderLink` (Task 1).
- Produces: `CONNECTION_LOSS = 15` exported from `scorer.ts`. In `score(card)`, for a nonland card that has no ring role and is not a commander: with `link = commanderLink(card)` and `strongest = linkIndex.strongest(card)?.weight ?? 0`, when `link < 0.3` and `strongest < 0.15`:
  `loss = min(synPts, r1(15 × min(1 − strongest / 0.15, 1 − link / 0.3)))`, subtracted from the synergy part after combo credit and before the staple floor. Reason, pushed whenever the card is unconnected: `${signed(−round(loss))} synergy: connects to nothing in this deck (no combo, theme or typal partner, little synergy with the commander)` when `round(loss) ≥ 1`, else `connects to nothing in this deck`. The index is built lazily once per scorer from the pinned deck and its `theme`; the link check runs first so most cards never touch it.

- [ ] **Step 1: Record the speed baseline**: wall time of `pnpm vitest run tests/engine/builder.test.ts tests/engine/goals.test.ts tests/engine/fix.test.ts` on the current commit (three runs, keep the median) in the task report.

- [ ] **Step 2: Write the failing tests** in `tests/engine/connection.test.ts`:
  - `a card with no partner loses synergy points, at most 15`: deck A = the upgraded deck with `themeWeights: { 'typal:elf': 1, typal: 0.8, sacrifice: 0.25 }`, without every main card whose `sacrifice.e ≥ 0.6`, plus Y; deck B = deck A without Y. Y = a fixture sacrifice enabler (`e ≥ 0.9`, in identity, no ring role); X = a fixture sacrifice payoff not in the deck (`p ≥ 0.9`, in identity, no ring role) with `createScorer(A, ctx).commanderLink(X) < 0.3` and `linkIndex(B, db, B.themeWeights).strongest(X)?.weight ?? 0` < 0.15. Both are searched in the fixture and asserted found (expected among Blood Artist, Bastion of Remembrance / Altar of Dementia, Braids, Cabal Minion). In B, X's reasons match `/connects to nothing in this deck/` and its synergy points are lower than in A by more than 0 and at most 15; in A no such reason.
  - `ring cards, lands and commanders never lose points for connection`: across the three fixture decks, no score of a card with a ring role, of a land or of a commander carries the reason.
  - `the scorer and the network agree on who connects to nothing`: for each fixture deck, the deck cards whose reasons match `/connects to nothing in this deck/` equal `deckNetwork(deck, ctx).unconnected` as sets.
  - `an auto-build has no unconnected cards when the pool allows`: `autoBuild` of Lathril, Blade of the Elves alone, Bracket 3, seed 1, owned-only off → `deckNetwork(built, ctx).unconnected` equals `[]`.

- [ ] **Step 3: Run** `pnpm vitest run tests/engine/connection.test.ts` → FAIL (no "connects to nothing" reason).

- [ ] **Step 4: Implement** the term as specified in Interfaces.

- [ ] **Step 5: Run** `pnpm vitest run tests/engine && pnpm typecheck` → PASS; repeat the Step 1 timing and report both medians. More than 30% slower → profile and fix (the early `link` check, the lazy index) before committing.

- [ ] **Step 6: Commit** `feat(scoring): cards that would connect to nothing lose up to 15 synergy points`.

### Task 4: Rating: Synergy counts cohesion and names the cards that connect to nothing

**Files:**
- Modify: `src/engine/rating/rate.ts`
- Test: `tests/engine/rating.test.ts` (new `describe('rateDeck: cohesion')`), `tests/engine/fix.test.ts` (two cases)

**Interfaces:**
- Consumes: `deckNetwork(deck, ctx, { scorer })` (Task 1), the scorer's connection term (Task 3), `fixDeck` (existing).
- Produces: `SYNERGY_THEME_SHARE = 0.7`, `SYNERGY_COHESION_SHARE = 0.3` exported from `rate.ts`; `Facts.scorer(): Scorer` and `Facts.network(): DeckNetwork`, each built at most once per `rateDeck` (`qualityPart` switches to `f.scorer()`); Synergy value = `0.7 × (0.6 × density + 0.4 × balance) + 0.3 × cohesion / 100`, still 0 when there is no primary axis; the existing synergy issues' `loss` × 0.7; a new issue when the network has unconnected cards: text `` `${n} ${n === 1 ? 'card connects' : 'cards connect'} to nothing in this deck: ${names}.` `` (names: up to five card names joined `A, B and C`; above five, the first five then ` and ${n − 5} more`), filter `{ axis: primary }`, loss `0.3 × 0.6 × n / nonStaple` (nonStaple = network nodes that are neither commander nor staple).

- [ ] **Step 1: Write the failing tests**:
  - `Synergy is 70% theme and 30% cohesion` (precon B2, upgraded B3, cedh B5): `synergy.value ≤ 0.7 + 0.3 × cohesion / 100 + 0.001` and `synergy.value ≥ 0.3 × cohesion / 100 − 0.02`, with `cohesion = deckNetwork(deck, ctx).cohesion`.
  - `ten random cards lower Synergy` (precon, `withTenRandom` from `tests/helpers/network.ts`): synergy value strictly lower.
  - `the unconnected fix names the cards and points at the deck's theme`: the upgraded deck with five nonland, non-ring main cards swapped for five fixture cards that `deckNetwork` marks unconnected after the swap (searched, asserted found) → a synergy fix matches `/^5 cards connect to nothing in this deck: /`, names each of the five, and has `filter.axis === 'typal:elf'`.
  - `fix.test.ts`, `Swap the unconnected cards: a synergy fix cuts cards that connect to nothing` (same deck): `fixDeck(deck, ctx, opts(), 'synergy')` → `deckNetwork(r.deck).unconnected.length` < before, at least 3 of the 5 inserted cards gone, `r.ratingAfter ≥ r.ratingBefore`, `validateDeck(r.deck, db)` empty.
  - `fix.test.ts`, Review Focus 5, `a synergy fix with nothing connected allowed leaves the deck untouched`: same deck with `ownedOnly: true, owned: new Set(<the deck's own card ids>)` → `r.changes` empty, `r.deck` `toEqual` the input, `r.note` a non-empty string.
  - Every existing test in `rating.test.ts` stays as it is and passes (precon B2 55–82, cedh B5 ≥ 60, upgraded B3 ≥ 55, the inferred-theme fix still listed, the any-type rules).

- [ ] **Step 2: Run** `pnpm vitest run tests/engine/rating.test.ts tests/engine/fix.test.ts` → FAIL.

- [ ] **Step 3: Implement** as in Interfaces.

- [ ] **Step 4: Run** `pnpm vitest run tests/engine && pnpm typecheck` → PASS; repeat Task 3's timing (more than 30% over Task 3's baseline → profile and fix first). Rerun Task 2's one-off into `ratings-after.json` and add a table to the task report: deck, own or null weights, rating before → after, Synergy before → after; flag every deck that moved more than 5 points and every deck with its own weights that moved at all outside Synergy.

- [ ] **Step 5: Commit** `feat(rating): Synergy counts cohesion and names the cards that connect to nothing`.

### Task 5: `POST /api/network`, and cohesion on deck tiles

**Files:**
- Create: `src/app/api/network/route.ts`
- Modify: `src/server/context.ts` (`Analysis.network()`, `networkResponse`), `src/server/decks.ts` (`TileNumbers` gains `cohesion`), `src/app/lib/api.ts` (`NetworkResponse`, `getNetwork`, `DeckTile.cohesion`, header), `src/app/page.tsx` (tile badge)
- Test: `tests/server/api.test.ts` (add `[/^\/api\/network$/, networkRoute]` to `ROUTES`)

**Interfaces:**
- Consumes: `deckNetwork` (Task 1).
- Produces: `Analysis.network(): DeckNetwork` (lazy, `deckNetwork(deck, ctx, { scorer })` with the analysis' own scorer and context); `networkResponse(deck: Deck): NetworkResponse` (`{ ...getAnalysis(deck).network(), cards: cardLookup(<node ids>) }`); route `POST` = `handle(async () => json(networkResponse(sanitizeDeck((await readBody(req)).deck))))`; in api.ts `export type NetworkResponse = DeckNetwork & { cards: CardLookup }`, `export const getNetwork = (deck: Deck, signal?: AbortSignal) => call<NetworkResponse>('POST', '/api/network', { deck }, signal)`, `DeckTile.cohesion: number`.
- Header text (api.ts, after `/api/analyze`):
```text
 * POST /api/network     {deck}          -> NetworkResponse
 *        How the deck's cards work together. `nodes`: every nonland card and the commanders (lands are
 *        left out). `edges`: { a, b, kind, weight 0..1, reasons [from a, from b] }, kind 'combo' (1, or 0.5
 *        one card away), 'feeds' (enabler x payoff x the deck's theme weight), 'typal' (0.6) or
 *        'commander' (the card's synergy with the commander). `clusters`: biggest first, named by their
 *        theme or combo. `cohesion` 0-100 = 60% the share of non-staple cards that connect + 40% the share
 *        of link weight inside the two biggest clusters (`cohesionParts`). `unconnected`: non-staple cards
 *        with no link of 0.15 or more and commander synergy under 0.3. `cards` covers every node. Cached
 *        EDHREC data only, never a request. A body that is not a deck is a 400.
```
  and on `GET /api/decks`: tiles carry `cohesion` (the same number). Tile: beside the rating badge, a smaller badge `Cohesion 72` (`data-testid="deck-cohesion"`, iron background, bone text, tabular figures, title `How well the cards work together, out of 100`).

- [ ] **Step 1: Write the failing tests** in `tests/server/api.test.ts`:
  - `POST /api/network returns the deck's network with a card for every node` (imported upgraded deck): status 200, more than 50 nodes, `cards[id]` for every node id, `cohesion === deckNetwork(deck, engineContext(deck).ctx).cohesion`.
  - `POST /api/network with a body that is not a deck is a 400`.
  - `the network makes no request with EDHREC on and nothing cached`: `PUT /api/settings { edhrecEnabled: true }`, `vi.stubGlobal('fetch', vi.fn(() => { throw new Error('no network') }))` → `POST /api/network` 200 and `fetch` not called; settings restored afterwards.
  - `deck tiles carry the network's cohesion`: save the upgraded deck → `GET /api/decks` → its tile's `cohesion` is an integer 0–100 equal to `deckNetwork(deck, ctx).cohesion`.

- [ ] **Step 2: Run** `pnpm vitest run tests/server/api.test.ts` → FAIL (no route).

- [ ] **Step 3: Implement** as in Interfaces.

- [ ] **Step 4: Run** `pnpm vitest run tests/server && pnpm typecheck` → PASS. On the scratch copy: the home page tiles show the cohesion badge beside the rating (screenshot `tiles-cohesion.png`).

- [ ] **Step 5: Commit** `feat(api): POST /api/network, and cohesion on deck tiles`.

### Task 6: The three.js network view

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml` (`pnpm add three`, `pnpm add -D @types/three`)
- Create: `src/engine/network/layout.ts`, `tests/engine/network-layout.test.ts`
- Create: `src/app/components/network/style.ts`, `src/app/components/network/scene.ts`, `src/app/components/network/NetworkSvg.tsx`, `src/app/components/network/NetworkView.tsx`, `src/app/components/network/useNetwork.ts`
- Modify: `src/app/deck/[id]/Panels.tsx` (`PanelId` gains `'network'`), `src/app/deck/[id]/Builder.tsx` (tab and content area)

**Interfaces:**
- Consumes: `DeckNetwork`, `NetworkNode`, `NetworkEdge`, `NetworkEdgeKind` (Task 1), `getNetwork`, `NetworkResponse` (Task 5), `imageUrl`, `EmptyState`, Builder's `openCard`.
- Produces in `layout.ts` (imports only `../random` and types: it ships to the browser): `type Vec3 = [number, number, number]`; `LAYOUT_MAX_ITERATIONS = 400`; `interface ForceLayout { positions: Map<string, Vec3>; alpha: number; step(iterations?: number): boolean /* true once settled */ }`; `createLayout(net: Pick<DeckNetwork, 'nodes' | 'edges'>, seed?: number): ForceLayout`; `settle(layout: ForceLayout): ForceLayout`.
- Produces in `style.ts`: `EDGE_COLOR: Record<NetworkEdgeKind, string>` (combo `#e0683f`, feeds `#d6ab52`, typal `#efe7d7`, commander `#a79d8b`); `edgeWidth(e: NetworkEdge): 1 | 2 | 3` (commander 1; else weight < 0.34 → 1, < 0.67 → 2, else 3); `edgeOpacity(kind: NetworkEdgeKind): number` (commander 0.18, typal 0.55, others 0.85); `nodeRadius(n: NetworkNode, maxDegree: number): number` (commander 34; unconnected 8; else 10 + 18 × sqrt(degree / maxDegree), 10 when maxDegree is 0); `ART_BOX = { u: 0.194, v: 0.45, w: 0.613, h: 0.44 }` (the square at the centre of the art box the deck tiles crop, `src/app/page.tsx:11`, in texture coordinates); `nodeReasons(id: string, edges: NetworkEdge[]): string[]` (the three strongest edges touching the node, read from its side).
- Produces: `useNetwork(deck: Deck, enabled: boolean): { network: NetworkResponse | null; error: string | null; reload(): void }` (fetches when enabled and the deck changes, 400 ms debounce, aborts the previous request, ignores stale answers); `NetworkView(props: { network: NetworkResponse | null; error: string | null; focusCluster: number | null; onOpen(oracleId: string): void; onRetry(): void; onEmpty?(): void })`, root `data-testid="network-view"` with `data-renderer="webgl" | "svg"`, `data-settled`, `data-visible-edges`; `createNetworkScene(three: typeof import('three'), canvas: HTMLCanvasElement, input: { network: DeckNetwork; layout: ForceLayout; reducedMotion: boolean }, on: { hover(id: string | null, at: { x: number; y: number } | null): void; open(id: string): void; contextLost(): void }): { setKinds(kinds: ReadonlySet<NetworkEdgeKind>): number /* edges now visible */; highlight(id: string | null): void; flyTo(ids: readonly string[]): void; resize(width: number, height: number): void; dispose(): void }`; `NetworkSvg` with the same data, layout, kinds and handlers (`data-testid="network-svg"`).
- Force layout, exactly:
```text
start   first commander fixed at (0, 0, 0), a second one fixed at (36, 0, 0)
        cluster k of K: anchor at angle 2πk/K, radius 140; its members at anchor ± 25 in x and y
        staples at a random angle, radius 70 ± 10; unconnected at radius 240 ± 10; the rest within ± 60 of 0
        z ± 20 for all; every random draw from mulberry32(seed), seed default 1
step    F = 0 for each node, then:
          repulsion  every pair: 1800 / max(16, d²), pushing apart
          springs    combo, feeds, typal edges: 0.06 × weight × (d − 34 × (1.6 − 0.6 × weight)), along the edge
          spokes     commander edges: 0.008 × weight × d, toward the commander
          clusters   0.03 × (centroid of its cluster − p)
          rings      staples 0.05 × (70 − r), unconnected 0.05 × (240 − r), radially in x, y (r = |(x, y)|)
          flatten    −0.12 × z on z
        v = (v + alpha × F) × 0.82, |v| capped at 12; p += v; fixed nodes never move
        alpha starts at 1, × 0.985 per step; settled when alpha < 0.01 or after 400 steps
```
- Scene: `WebGLRenderer({ canvas, antialias: true, alpha: true })`, pixel ratio at most 2; `PerspectiveCamera(45, w / h, 1, 5000)` at (0, 0, 620); `OrbitControls` (`three/examples/jsm/controls/OrbitControls.js`): rotate on drag, zoom on scroll (distance 150–1600), no pan, damping on. Nodes are `Sprite`s with `SpriteMaterial({ map, alphaMap })`: `map` loads `imageUrl(id, 'grid')` with `offset`/`repeat` from `ART_BOX`; `alphaMap` is one shared circular `CanvasTexture` (white disc, 128 px). A missing image (load error, or `naturalWidth === 252`, the server's placeholder) becomes a `CanvasTexture` disc in iron with the card's initials in bone. Unconnected nodes get an ember ring sprite. Edges are `LineSegments2` + `LineSegmentsGeometry` + `LineMaterial` (`three/examples/jsm/lines/`), one object per kind and width bucket, `resolution` updated on resize. Hover: `Raycaster` on the sprites; the node grows 1.25×, its neighbours and their edges stay, everything else dims to opacity 0.2 (edges 0.06). Click = pointer up within 5 px of pointer down → `open(id)`. `flyTo` moves the orbit target to the ids' centroid and the camera distance to 2.2 × their radius over 600 ms ease-out (at once with reduced motion). Render on demand: the rAF loop runs only while the layout settles, the controls damp, a fly runs or the pointer moves. The staple ring does not move on its own (motion only answers actions). `webglcontextlost` → `preventDefault()` and `contextLost()`. `dispose()` frees geometries, materials, textures, controls and the renderer.
- View: WebGL when `canvas.getContext('webgl2') ?? canvas.getContext('webgl')` is non-null and the URL has no `network=2d`, else `NetworkSvg`; `contextLost` switches to `NetworkSvg` for the rest of the visit. Reduced motion (`matchMedia('(prefers-reduced-motion: reduce)')`) → `settle(layout)` before the first frame; otherwise 4 layout steps per frame until settled. Legend, top left of the view: toggle buttons `Combo N`, `Feeds N`, `Typal N`, `Commander N` with a swatch in the edge colour (`data-testid="network-legend-<kind>"`, `aria-pressed`). Hover card (`data-testid="network-hover"`): the card's name and `nodeReasons`. States: no answer yet → `Reading how the cards connect`; error → the message and **Try again**; no nodes besides commanders → `EmptyState` message `Add cards to the deck to see how they work together.`, action **Show the deck** (`onEmpty`). `NetworkSvg` draws the layout's x and y (viewBox fitted with a 24 px margin) with the `style.ts` rules, nodes as circles filled by a `<pattern>` of the grid image placed to `ART_BOX`, the same hover card, click and legend.
- Builder: `PANELS` gains `{ id: 'network', label: 'Network' }` (`data-testid="tab-network"`); while it is selected the content area left of the side panel shows `NetworkView` fed by `useNetwork(deck, panel === 'network')` in place of the deck sections and the browser; `onEmpty` selects the Rating tab; card clicks call the existing `openCard`. The side panel shows `Cohesion N` until Task 7.

- [ ] **Step 1: Write the failing tests** in `tests/engine/network-layout.test.ts` (networks from `deckNetwork` on the fixture decks):
  - `the same seed gives the same layout`: `settle(createLayout(net, 3))` twice → identical positions.
  - `the commanders stay where they are fixed`: (0, 0, 0); with `oddDeck()` the second at (36, 0, 0).
  - `unconnected cards settle farther out than the rest` (`withTenRandom(precon)`, asserted to have at least 3 unconnected cards): mean `|(x, y)|` of unconnected nodes > 1.3 × that of connected non-staple, non-commander nodes.
  - `staples sit on a loose ring`: median `|(x, y)|` of staple nodes between 40 and 130.
  - `clusters settle into their own regions` (upgraded): for clusters 0 and 1, the mean distance within each is below the mean distance between their members.
  - `settles with finite coordinates for any network`: 0 nodes, 1 node, nodes without edges, the cedh network → `settle` returns within 400 steps and every coordinate is finite.

- [ ] **Step 2: Run** `pnpm vitest run tests/engine/network-layout.test.ts` → FAIL (`createLayout` is not exported).

- [ ] **Step 3: Implement** `createLayout` and `settle` with the parameters above.

- [ ] **Step 4: Run** `pnpm vitest run tests/engine/network-layout.test.ts` → PASS.

- [ ] **Step 5: Build the view**: `pnpm add three` and `pnpm add -D @types/three`, then `style.ts`, `scene.ts`, `NetworkSvg.tsx`, `NetworkView.tsx`, `useNetwork.ts` and the tab, as in Interfaces.

- [ ] **Step 6: Verify** `pnpm typecheck && pnpm test` → PASS. On the scratch copy (Global Constraints), screenshots to `.superpowers/sdd/2026-11-26-deck-network/`:
  1. "Mr. Spock, Science Officer" → Network: node count equals the API's `nodes.length` (nonland cards + commander); screenshot `network-spock.png`.
  2. Hover a node → the hover card lists its reasons (`network-hover.png`); click → the card detail drawer opens with the deck's actions; close it.
  3. Toggle each legend kind → `data-visible-edges` drops by that kind's count, and returns.
  4. Frame rate: on the scratch deck with the most edges (report its node and edge counts), rotate the view for 2 s with scripted pointer events while a JS snippet counts `requestAnimationFrame` callbacks → at least 55 per second.
  5. `?network=2d` → `data-renderer="svg"`, hover and click work (`network-2d.png`); back on WebGL, `canvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()` → the view switches to `svg` without an error.
  6. Reduced motion (`browser_emulate_media` with `reducedMotion: 'reduce'`) → `data-settled="true"` on the first frame after load; a cluster fly (Task 7) later jumps.

- [ ] **Step 7: Commit** `feat(network): three.js deck network view with a 2D fallback`.

### Task 7: The Network side list and Swap the unconnected cards

**Files:**
- Create: `src/app/components/network/NetworkSummary.tsx`
- Modify: `src/app/deck/[id]/Builder.tsx` (side tab body, cluster focus, swap)

**Interfaces:**
- Consumes: `NetworkResponse` (Task 5), `NetworkView` and `useNetwork` (Task 6), the Fix deck flow with `only` that deck-page Tasks 4–5 put in `Builder.tsx` (the handler behind `fix-part`; result in `ResultPanel` with Undo), `Section`, `CardGrid`, `CardTile`, `EmptyState`.
- Produces: `NetworkSummary(props: { network: NetworkResponse; focus: number | null; onFocus(cluster: number | null): void; onOpen(oracleId: string): void; onSwap?(): void; busy?: boolean })` — `onSwap` is left out where there is no deck to change (the commander page's Average deck, later). Builder state `networkFocus: number | null`, passed to `NetworkView.focusCluster`.
- Copy and layout (`data-testid="panel-network"`):
  - `Section` `Cohesion` with count = cohesion (`data-testid="network-cohesion"`): `Connected: <connected %> of the cards that are not staples work with another card or with the commander (60% of the score).` and `Focused: <clustered %> of the links between cards sit inside <cluster 0 name> and <cluster 1 name> (40% of the score).` (one cluster: `inside <name>`; none: `Focused: no group of cards works together yet (40% of the score).`)
  - `Section` `Clusters` with count: one button per cluster, `<name>` and muted `<n> cards` (`data-testid="network-cluster"`, `data-cluster=<id>`, `aria-pressed` when focused); a click flies the view there, a second click clears the focus.
  - `Section` `Not connected` with count (`data-testid="network-unconnected"`): `CardGrid size="S"` of `CardTile` (stat `{ label: 'synergy', value: '<link %>' }`, `onOpen`); action **Swap the unconnected cards** (`data-testid="swap-unconnected"`, `btn`, disabled while busy, title `Runs Fix deck on synergy: cards that connect to nothing are swapped for cards that work with this deck`); with none, `EmptyState` message `Every card works with another card or with the commander.`
- Swap: `onSwap` runs the Fix deck flow with `only: 'synergy'` and the header's owned-only and free-copies options; the shared `ResultPanel` shows `Fixed: N changes` with Undo (or the note, without Undo, when nothing changed); the network reloads with the deck.

- [ ] **Step 1: Implement** as in Interfaces.

- [ ] **Step 2: Verify** on the scratch copy, screenshots to `.superpowers/sdd/2026-11-26-deck-network/`:
  1. Mr. Spock → Network: the side list (`network-side.png`); click a cluster → the view flies to it (`network-cluster-before.png`, `network-cluster-after.png`); click it again → focus cleared.
  2. A typal deck (a saved deck whose commander's focus includes a creature type; if the scratch copy has none, a new deck for such a commander, Auto-build, then delete it afterwards): a `<Type> typal` cluster in the list and the view (`network-typal.png`).
  3. A deck with unconnected cards: `GET /api/decks/:id` JSON saved → **Swap the unconnected cards** → `ResultPanel` (`network-swap.png`), `Not connected` count lower → Undo → JSON byte-identical to the saved one.
  4. Review Focus 5: "Only my collection" on, on a deck where the swap finds nothing owned → the note shows, no Undo, deck JSON unchanged.
  5. Review Focus 1: New deck, pick a commander, do not build → Network: the empty state with **Show the deck**; side list cohesion 0; delete the deck.
  6. `pnpm typecheck && pnpm test` → PASS; AGENTS.md unchanged (`git status`).

- [ ] **Step 3: Commit** `feat(deck): Network tab side list with clusters, unconnected cards and Swap the unconnected cards`.
