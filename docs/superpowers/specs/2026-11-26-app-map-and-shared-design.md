# One app, not a pile of pages: the app map and the shared design

Date: 2026-11-26. Owner: "a comprehensive piece of work like this, but what matters is an easy-to-use, connected design, not a disjointed one." This document governs every screen built from now on: the deck page work, commander pages, Packages, the Collection additions, Best from collection and Arena mode. Each feature spec says what a screen does; this says how all screens fit together and look alike.

## What the product is, and its one job

A deck workshop for one Commander player with a real paper collection and an Arena account. Its job: go from "which commander?" to "a deck I can sleeve up (or play on Arena) from cards I own", and keep that deck good. Every page is a step on that path, and every page links to the next step.

```
Commanders ──► Commander page ──► Build a deck ──► Deck page ──► Fix deck / Packages / Put it in
     ▲              │   ▲                              │  ▲              │
     │              │   └──── Your decks ◄──────────────┘  │              │
Best from collection ┘                                     │              ▼
     ▲                                                     │        Collection (boxes, built decks, "!")
Packages (8×8 from my cards) ──── Add to a deck ───────────┘              │
     ▲                                                                    │
     └──────────────────── Card detail ("Commanders that want this card") ◄┘
```

## Navigation (top bar, same on every page)

Decks · Commanders · Collection · Packages · Best from collection · Proxies · Card data — and on the right, the collection switcher (Physical / MTG Arena), which is also the mode: Arena shows "Brawl" next to it (Arena spec).

## Cross-link rules (the "connected" part)

1. **Every commander name or art anywhere links to its commander page** (deck tiles, deck header, Discover entries, similar commanders, card detail lists).
2. **Every card opens the same card detail drawer**, and the drawer offers the actions that fit where you are:
   - a deck is open and the card is in it → Suggest swaps, Remove, Lock;
   - a deck is open and the card is not in it → Put it in instead of… (with the list), Add;
   - you own it → − / + copies; it is in a box → Take out; held → "Held by Landing Party box";
   - always → "Commanders that want this card", price, roles, themes.
3. **Every deck links to its commander page** (header), and every commander page lists **Your decks** with that commander.
4. **Best from collection entries open the commander page** with "Only my collection" already on, not a bare deck.
5. **Packages page → "Add to a deck…"** picks one of your decks with that colour identity and opens its Packages tab with that package highlighted.
6. **Results always say where they went**: "Built a deck: Mr. Spock — open it", "Fixed: 12 changes — Undo".

## Shared filters (one store, every page)

Bracket (1–5), Budget (any / under $5 / under $1 per card), **Only my collection**, **Use free copies only**. They live in one client store (localStorage keys `cf-bracket`, `cf-budget`, `cf-owned-only`, `cf-free-only`; the last two already exist) and one `FilterBar` component. A deck page shows the deck's own bracket instead of the stored one. Changing a filter on one page carries to the next.

## Shared components (one implementation each, in `src/app/components/`)

| Component | What it is | Used on |
|---|---|---|
| `CardTile` | Card image + one caption row underneath (never overlays): score chip (band colour), owned dot, "!" with holders, and the optional stats the page passes (synergy %, EDHREC inclusion % / lift, odds, price). Sizes S / M / L. | everywhere a card appears |
| `CardGrid` | Even grid of CardTiles for a size | all card lists |
| `Section` | Display-serif heading with the count ("Ramp · 10" written as "Ramp" + muted "10"), optional right-side actions, the grid, "Show all N" when capped | commander page, deck page, packages, collection |
| `JumpRail` | Sticky left column listing the page's sections (label + count), highlights the one in view, back to top | commander page, deck page, packages |
| `FilterBar` | The shared filters + view controls (size, images/list, group by, sort) | commander page, deck browser, packages, discover |
| `CardDetail` | The drawer of rule 2 | everywhere |
| `ResultPanel` | "What changed" panel: title with before → after, grouped change list (out → in, reason, "!"), Undo, Dismiss | Fix deck, Complete package, Build a deck, Best from my collection |
| `Menu` | Accessible dropdown | header menus |
| `OddsBar` | Two thin bars: opening hand %, by draw 7 % | packages, deck Packages tab, charts |
| `EmptyState` | One sentence on what is missing + the one action that fixes it | all lists |
| Message stack | Existing toasts (still under the pointer while hovered) | everywhere |

A screen may compose these; it does not re-implement them. Existing ad-hoc versions (deck tiles' overlays, the browser's corner badges) move onto `CardTile`.

## Page skeleton (every workspace page)

```
┌ top bar ───────────────────────────────────────────────────────────────┐
│ Page header: title (display serif) · key facts · ONE primary action    │
├ FilterBar (sticky) ────────────────────────────────────────────────────┤
│ JumpRail │ Section                                         │ Side panel │
│ (sticky) │ Section                                         │ (deck page │
│          │ Section …                                       │  only:     │
│          │                                                 │  rating,   │
│          │                                                 │  tabs)     │
└──────────┴─────────────────────────────────────────────────┴────────────┘
```
Content is left-aligned; grids fill the width; the side panel is 26rem.

### Commander page
```
[ art banner, commander card, name, colours, rank, owned ]   [Build a deck]
[ theme chips ]  [Your decks · 2]
FilterBar: Bracket 1 2 [3] 4 5 · Budget · Only my collection · Free copies · view
Tabs: Card recs | Average deck | Charts | Combos | Similar commanders | Your decks
JumpRail: New · High synergy · Top · In your collection · Packages · Creatures · …
```
### Deck page
```
[commander thumb → commander page] Deck name · 100/100 · Legal · Bracket 3 · rating ring
[Fix deck · 3] [Build ▾] [Improve] [Export ▾]   Only my collection · Free copies
ResultPanel (after an action)
JumpRail: Commander · Ramp 10 · Card draw 11 · …   │ deck sections │ side panel tabs:
                                                   │               │ Rating · Packages · Bracket · Themes · Improve
```
### Collection, Packages, Best from collection
Same header / FilterBar / JumpRail / Section pattern; Collection's left column of tools (Add a box, Add or remove cards, Your boxes) becomes its side panel on the right, so every page reads left-to-right: navigate → content → tools.

## Visual system (kept, made consistent)

- **Colour** (existing tokens): soot `#13100c` page, anvil `#1c1813` panels, iron `#27221b` controls, slag `#3b3429` borders, bone `#efe7d7` text, ash `#a79d8b` secondary text, brass `#d6ab52` the one primary action per screen and focus, ember `#e0683f` only for "!" held marks and destructive confirms, band colours only for scores. No new colours.
- **Type**: Iowan Old Style (display) for page titles and section headings only; Avenir Next for everything else; scale 32 / 24 / 18 / 15 / 13 px; tabular figures for every number; sentence case everywhere, no all-caps labels.
- **Shape**: cards keep their card radius; panels and controls 6 px; one shadow level for the side panel and drawers only.
- **The one bold moment**: the commander page banner — the commander's art, wide, warmed from the bottom by an ember-to-soot heat gradient, the name set large in the display serif across it. Everything else stays quiet.
- **Motion** only answers actions: the ResultPanel opening, a package fan spreading on hover, the JumpRail highlight moving. Respect reduced motion.
- **Desktop only** (AGENTS.md), designed at 1440×900, fine at 1280.

## Words (one name per action, through the whole flow)

Fix deck → "Fixed: N changes". Complete package → "Completed Ramp: added N". Put it in (instead of X) → "Put in X, took out Y". Build a deck → "Built a deck — open it". Best from my collection. Only my collection. Use free copies only. Held by … (for "!"). Take out (of a box). Undo / Undone. Errors say what happened and what to do; empty states name the one action that fills them.

## How this changes the open plans

- Deck page plan: a new Task 4a builds the shared kit (CardTile, CardGrid, Section, JumpRail, FilterBar, ResultPanel, Menu, OddsBar, EmptyState) and moves the deck page's sections and the browser onto it; Tasks 4–5 then use it.
- Commander pages, Packages and Arena plans are written against this kit; their screens may not add their own variants.
- A final "connected" check walks the map above end to end on the scratch copy: Commanders → a commander → Build a deck → Fix deck → Packages → Collection → card detail → back to a commander, with screenshots.
