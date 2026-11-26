# A page for every commander, at EDHREC's level of clarity, plus what only Commander Forge knows

Date: 2026-11-26. Status: owner asked for it ("a page for every commander… everything should be there"; "copy the designs and pages in parallel, same quality for our extra things, and take the extra things you see there") and handed over the how. Every decision below is the designer's call.

## Intent

The owner likes how EDHREC presents a commander and wants the same experience inside Commander Forge for every commander, joined with what only this app knows: their collection, boxes and built decks, brackets, the deck rating, Fix deck, 8×8 packages.

What an EDHREC commander page offers (studied on edhrec.com/commanders/mr-spock-science-officer, 2026-11-26, viewed by hand, nothing scraped):
- A header with the commander card, colour identity, rank, deck count, price, popular tags with counts.
- Filters: bracket (any, 1–5), budget (any, $, $$$), advanced.
- Tabs: Card recs, Average deck, Decks, Charts, Combos, Similar commanders.
- Card recs grouped into sections: New cards, Top cards, High lift (synergy), Game Changers, Creatures, Instants, Sorceries, Utility artifacts, Enchantments, Planeswalkers, Utility lands, Mana artifacts, Lands. A sticky icon rail jumps between sections.
- Each card: the image, prices, and three numbers under it (inclusion %, decks, lift/synergy).
- View controls: card size, view (stats / images / grid / text), group by, sort by.

## Data, and the rule that limits it

AGENTS.md: EDHREC has no public API and its terms do not permit automated queries; the existing opt-in integration makes a couple of cached requests per commander when the owner picks a commander or opens a deck, and nothing else. So:
- **Every commander page works without EDHREC**, from the app's own data: the card scorer (synergy, quality from Scryfall's EDHREC rank, role, castability, bracket), Scryfall tagger tags, Commander Spellbook combos, the auto-builder, prices from Scryfall.
- **With EDHREC on, opening a commander page counts as "picking a commander"**: the existing `getEdhrec` call (cached 7 days) adds EDHREC's inclusion %, deck count and synergy under the cards and its theme counts in the header. No other EDHREC request; no crawling of other commanders.
- Each number says where it comes from (a small "EDHREC" or "Forge" label in its tooltip).

## Pages and features (designer's calls)

### `/commanders` — every commander
- A searchable, filterable grid of all commander-eligible cards (the existing `GET /api/commanders` with colours, mode and paging): colour chips, a theme filter, "In my collection" toggle, sort by popularity (Scryfall's EDHREC rank), name, price, or "best deck from my collection" when a Discover result exists.
- Each tile: art crop, name, colour pips, owned dot, and a one-line caption (top theme, rank).
- Top navigation gains "Commanders" between "New deck" and "Collection".

### `/commander/[slug]` — one commander (slug = Scryfall name, kebab-case; partners via `?with=`)
- **Header**: card image, name, colour identity, Scryfall rank, price, owned / held state, theme chips (the commander's own theme weights; with EDHREC, its theme counts), buttons **Build a deck** (auto-build at the chosen bracket and open it), **Best from my collection** (owned-only build), **Open in builder** (empty deck with this commander).
- **Filters** (sticky under the header): Bracket 1–5 (default 3), Budget (any / under $5 / under $1 per card), **Only my collection**, **Use free copies only**. Filters change every tab.
- **Tabs**:
  1. **Card recs** — sections: New cards (from the newest two sets), High synergy, Top cards (quality), Game Changers (when the bracket allows), then by type: Creatures, Instants, Sorceries, Utility artifacts, Mana artifacts, Enchantments, Planeswalkers, Utility lands, Lands. Our extra sections: **In your collection** (best owned cards), **Packages** (the 8×8 view for this commander: ramp, draw, removal, protection + top themes). Up to 30 cards per section, "Show all" expands.
  2. **Average deck** — the auto-builder's deck at the chosen bracket (unlimited pool, or owned-only when that filter is on), shown as the deck page shows decks, with its rating, bracket estimate and "Open as a deck".
  3. **Charts** — for that deck: mana curve, card types, roles against the bracket's bands, colour sources; plus the 8×8 odds per package.
  4. **Combos** — Commander Spellbook combos that fit the colour identity, those that include the commander first; each shows its cards, which you own, and its bracket tag.
  5. **Similar commanders** — same colour identity or one colour off, ranked by theme-weight similarity; tiles as on `/commanders`.
  6. **Your decks** — the owner's saved decks with this commander (our replacement for EDHREC's "Decks" tab, which lists other people's).
- **Card tile** (shared component, used on these pages, the deck browser and Packages): the image, then one caption row: score (0–100, Forge), synergy % (Forge), and with EDHREC on, inclusion % and lift; owned dot, "!" with holders, price. Click opens the card detail (with "Put it in instead of" when a deck is open).
- **View controls**: size (S / M / L), view (images / text list), group by (category / role / none), sort (score / synergy / price / name).
- **Sticky left rail** with one icon + label per section of the current tab (labels show on hover), and a back-to-top button.

### `/themes` and `/theme/[axis]`
- Every theme axis the app knows, with how many commanders lead it; a theme page lists those commanders (tiles) and the top cards for the theme in the chosen colours.

### Card detail
- Gains "Commanders that want this card": the top commanders by score for this card in its colour identity (computed on demand, cached per card and bracket).

## Performance
- Scoring the whole pool for one commander takes ~150 ms (design target in the original spec); a commander page needs one scoring pass per filter change, cached per (commander, bracket, owned, freeOnly, budget). Average deck and charts are built lazily when their tab opens. "Similar commanders" uses theme weights only (no scoring of other commanders). "Commanders that want this card" scores at most 40 candidate commanders by colour identity and theme fit.

## Non-goals
- EDHREC's deck lists of other players, its articles, its prices from several shops (Scryfall's one price is shown), salt scores (no source in the app's data).
- Any EDHREC request beyond the existing per-commander integration.

## Anti-goals
- A page that fails or shows nothing with EDHREC off.
- Numbers without a source.
- Controls that change the owner's collection or decks from these pages (only explicit buttons create a deck).

## Look
The UI direction section of `2026-11-26-deck-page-fix-deck-design.md` applies: titled sections with counts, sticky navigation, one caption row under each card, nothing over the card name or mana cost, few controls at once, the app's existing palette and fonts.

## Testing
- Server: the recs for a fixture commander are grouped by the listed sections, deterministic, filtered by bracket, budget and owned-only; similar commanders share colours; combos fit the identity; with no EDHREC data every number is still present (Forge) and EDHREC fields are absent.
- UI on the scratch copy (never data/, never port 3210): `/commanders` search and filters; a commander page's six tabs for Mr. Spock, Science Officer; Build a deck opens a deck; screenshots at 1440×900.

## Left to the builder
Section icons, exact caps per section, chart drawing (plain SVG), layout within the project's look.
