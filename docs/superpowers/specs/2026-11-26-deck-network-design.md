# Deck network: see how a deck's cards work together, and stop the engine adding cards that work with nothing

Date: 2026-11-26. Owner: "There are too many themes; when the current deck engine gives a commander too many, unrelated cards get in. Show EVERY deck visually with three.js as a network, built from how cards are played together and from combos, taking everything into account, and how connected the network is. An interactive network showing cards connected to each other; many things can be understood from it." The owner handed over the how; every decision below is the designer's call. Governed by `2026-11-26-app-map-and-shared-design.md`.

## The problem in the engine

Theme weights come from the commander's text (payoff 1.0, enabler 0.6, keyword hint 0.3, own subtype 0.3) blended with EDHREC theme counts. Many commanders light up five or more axes a little, and the builder rewards any of them, so a deck ends up with a few cards for each of several themes that never meet: each card is "on theme", but the cards do not work with each other.

## Goals

1. **A network for every deck** (deck page, and the Average deck on commander pages): nodes are the deck's cards, edges are reasons two cards work together, each with a strength and a plain-English reason.
2. **Connectedness numbers** with reasons: cohesion (0–100), the clusters (named by what joins them), and the unconnected cards.
3. **The engine uses the same network**: fewer, stronger themes, and no "connected to nothing" cards in builds, improvements and Fix deck.
4. **An interactive three.js view** that makes it obvious at a glance which cards carry the deck and which sit alone.

## The network (pure engine, `src/engine/network/`)

`deckNetwork(deck, ctx): { nodes, edges, clusters, cohesion, unconnected }`

- **Nodes**: every nonland card plus the commander(s); lands are left out (they would connect to everything through mana and say nothing). Each node carries its roles and its strongest axes.
- **Edges** (undirected for drawing; the reason text keeps the direction):
  - **Combo** (strongest, weight 1.0): two cards in the same Commander Spellbook combo that the deck contains in full (or misses one piece: weight 0.5, reason "one card away").
  - **Feeds** (enabler → payoff on the same axis): weight = e(enabler) × p(payoff) × the deck's weight for that axis. Reason: "Makes tokens for Intangible Virtue's anthem".
  - **Typal**: a typal payoff and a creature of its type (weight 0.6), or the commander's named type.
  - **Commander**: every card's synergy with the commander (the scorer's synergy part), drawn as faint spokes; with EDHREC on, its lift raises the weight.
  - **Plays together** (EDHREC co-play, when cached): a weak edge between two cards EDHREC sees together in this commander's decks — only when that data exists; never fetched for this.
  - Role-only links (ramp, draw, removal, protection) are not edges: staples serve every card and would hide the structure. They are shown as their own ring instead (see View).
- **Clusters**: weighted label propagation over the theme/combo/typal edges; each cluster is named by its dominant axis or combo ("+1/+1 counters", "Spellslinger", "Thassa's Oracle combo"). Clusters with 8 or more cards line up with the 8×8 theme packages.
- **Unconnected cards**: non-staple nonland cards (no core role: ramp, draw, removal, protection, tutor, wipe, counter) whose strongest theme/combo/typal edge is below 0.15 and whose commander synergy is below 0.3.
- **Cohesion** (0–100): 60% share of non-staple cards that are connected + 40% how much of the edge weight sits inside the two biggest clusters (a deck with one or two tight engines scores high; five scattered mini-themes score low). Tests pin the ordering, not exact values.

## Engine changes (shared numbers, AGENTS rule 6)

- **Focus the themes**: `resolveThemeWeights` keeps the commander's top two axes (plus its named creature type, if any) at their weights and scales every other axis by 0.25 (not to zero, so incidental synergy still counts a little). A deck's own saved theme weights are respected as they are; the Themes tab gets "Focus on these two" to apply the same to a deck explicitly.
- **No connected-to-nothing picks**: the card scorer gets a connection term for non-staple cards: a card that would be unconnected in the current deck loses up to 15 points of its synergy part; the builder, improve, swapIn, Fix deck and Complete package all see it because they all use the scorer.
- **Rating**: the Synergy sub-score becomes 70% on-theme density (as now) + 30% cohesion, and gets a fix "N cards connect to nothing in this deck: …" naming the unconnected cards (filter: the deck's primary axis), which Fix deck then acts on.
- Tests: a commander with five weak axes builds a deck whose top two axes hold most of its theme cards; an auto-build has no unconnected cards when the pool allows; the rating's reference ranges still hold; cohesion of the precon > cohesion of the same deck with ten random on-colour cards swapped in.

## API

`POST /api/network {deck}` → `{ nodes, edges, clusters, cohesion, unconnected, cards }` (`cards` = CardLookup). Deck tiles on the home page show cohesion next to the rating.

## The view (deck page tab "Network", and the commander page's Average deck)

- **three.js** (new dependency `three`, MIT), WebGL, a small force-directed layout written in the app (no further dependency): edges pull with their weight, nodes repel, clusters settle into their own regions; the commander sits fixed at the centre.
- **Nodes** are circular crops of the card art (the app's own art crops), sized by how connected the card is; unconnected cards are drawn smaller with an ember outline and drift to the edge; the staple ring (ramp, draw, removal, protection) orbits loosely around the centre so it is visible but does not tangle the clusters.
- **Edges** coloured by kind: combo ember, feeds brass, typal bone, commander faint ash; thickness by weight; a legend toggles each kind on and off.
- **Interaction**: drag to rotate, scroll to zoom, hover a card to light up its neighbours and show its strongest reasons ("Feeds Ezuri's +1/+1 counters", "Combo with Thassa's Oracle"); click opens the shared card detail drawer (with Put it in instead of, Suggest swaps); click a cluster in the side list to fly to it.
- **Side list** (shared Section style): Cohesion 72 with its two parts explained; clusters with their card counts; "Not connected (6)" with the cards and one button **Swap the unconnected cards** (runs Fix deck with `only='synergy'`, result in the shared ResultPanel with Undo).
- Respects reduced motion (layout settles without animation), stays at 60 fps for 100 nodes and ~600 edges, and falls back to a 2D SVG drawing of the same layout when WebGL is unavailable.

## Non-goals
- Pairwise data that the app does not have (no new EDHREC requests, no scraping).
- Networks for decks of other players.

## Anti-goals
- A pretty graph that says nothing: every edge has a reason a player can read.
- Staples looking like "unconnected" problems.
- A focus change that quietly rewrites saved decks: saved theme weights stay as they are; only new builds and explicit "Focus on these two" use the focused weights.

## Testing
- Engine: edges with reasons for combo / feeds / typal on fixture decks; clusters stable for a fixed seed; cohesion ordering; unconnected excludes staples; theme focus; scorer connection term; rating reference ranges.
- UI on the scratch copy: the Network tab for Mr. Spock, Science Officer and a typal deck; hover, click, cluster focus, Swap the unconnected cards then Undo (deck JSON identical); screenshots.

## Corrections after planning (2026-11-26, rulings D19)
- No "plays together" edges: EDHREC data has no pairwise numbers in the app.
- "Unconnected" reads the scorer's static commander link (synergy share plus EDHREC lift) before the new connection penalty, so the definition is not circular.
- Saved decks whose theme weights are derived (null) are re-rated with the focused weights; their cards and stored weights never change.
- Synergy = 70% today's whole synergy value (density and balance) + 30% cohesion.
- Colours follow the app map: combo edges brass, feeds bone, typal ash, commander spokes smoke; unconnected nodes get a dashed outline (ember stays reserved for "!"); the staple ring stays still.
- Commanders that name several creature types keep every type tied for the top weight.
