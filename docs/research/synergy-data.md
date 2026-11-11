# External data sources for synergy and combos (re-verified 2026-11-11)

Every "live" item below was re-fetched independently on 2026-11-11 (server time 2026-11-10 ~22:55 GMT) with a generic User-Agent.

## 1. EDHREC

### 1.1 JSON endpoint: exists, unauthenticated, undocumented
- `GET https://json.edhrec.com/pages/commanders/atraxa-praetors-voice.json` returned 200, 130,804 bytes, `application/json`.
- It is served from S3 + CloudFront with `cache-control: public, max-age=1620, stale-while-revalidate=180`, an `etag` and `last-modified` (Tue 10 Nov 2026 13:30:34 GMT), so conditional GETs work. All pages I sampled were last modified on 10 Nov between 13:17 and 15:30 GMT, which is consistent with a roughly daily rebuild; the rebuild cadence itself is not documented.
- A missing page returns **403** (S3 AccessDenied XML), not 404. Treat 403 as "no such page".
- A non-canonical slug returns 200 with `{"redirect":"/commanders/<canonical>"}`. Follow it.
- This is the site's internal data feed. I found no public API documentation or stability guarantee.

### 1.2 Real structure of a commander page
**Top level**
- Average type counts as ints: `creature, instant, sorcery, artifact, enchantment, battle, planeswalker, land, basic, nonbasic`.
- `similar[]`: similar commanders.
- `bracket_counts`: `{"1":153,"2":3149,"3":4136,"4":2596,"5":193}`. These sum to 10,227, which is only 22% of Atraxa's 46,230 decks (see 1.3).
- `budget_counts`: `{budget:4623, middle:36984, expensive:4623}`.
- `tag_counts[]`: `{count, slug, value}`, 184 themes for Atraxa (e.g. `infect` 3545).
- `savedate_counts`: decks per day, 730 entries.
- `panels`: `piechart`, `taglinks`, `mana_curve`, `rank_over_time`, `combocounts[]` (`{value, alt, href}` with links like `/combos/golgari/1529-1887`, which are Commander Spellbook card IDs), `articles`.
- `header`, `description`, `container`.

**`container.json_dict.card`** (the commander)
- `name, num_decks (46230), rank (4), salt (1.77), cmc, color_identity[], id, sanitized, slug, type, type_line, primary_type, rarity, layout, names, legal_commander, is_commander, precon, prices{…}, image_uris, scryfall_uri, url`.
- `id` is a Scryfall **card (printing) id**, not an oracle id: `d0d33d52-…` resolves on `api.scryfall.com/cards/<id>` to the 2XM printing of Atraxa, whose `oracle_id` is `7e6b9b59-…`.
- For partner pairs, `card.cards[]` holds both cards and `name` is `"A // B"`.

**`container.json_dict.cardlists[]`**: `{header, tag, cardviews[]}`
- Atraxa has New Cards (5), Top Cards (10), Creatures (50), Instants (44), Sorceries (28), Utility Artifacts (16), Enchantments (24), Planeswalkers (28), Utility Lands (17), Mana Artifacts (16), Lands (50).
- Some pages also carry "High Lift Cards" (10; seen on the cEDH variant) or Battles. The set of lists varies per page, so do not hard-code it.
- Atraxa totals 288 unique cards. Lists cap at 50 per type, so **a card absent from the page has unknown inclusion** (low, not zero).

**cardview fields** (verbatim example, commander page)
```json
{"id":"2d389264-…","name":"Tekuthal, Inquiry Dominus","sanitized":"tekuthal-inquiry-dominus","slug":"tekuthal-inquiry-dominus",
 "url":"/cards/tekuthal-inquiry-dominus","image_version":"1783906040",
 "synergy":0.2702,"lift":1.6768,"num_decks":30953,"potential_decks":46230,"trend_zscore":-0.04}
```
- `inclusion` is not a field. Compute it as `num_decks / potential_decks`.
- `potential_decks` is per card: newer cards have fewer (Sanctum Lurker: 612 / 5959).
- cardviews carry no salt, price, type or bracket data. Join those from Scryfall by `id` or name.
- Field sets differ by page type. On `/cards/<slug>.json`, card cardviews have `lift` but **no `synergy`**, and the Top Commanders cardviews have neither (only `num_decks`/`potential_decks`). On `/top/salt.json`, cardviews have `salt` and `potential_decks: 0`.

### 1.3 Variant pages (all returned 200)
| Variant | URL pattern | Result |
|---|---|---|
| Bracket | `/commanders/<slug>/{exhibition\|core\|upgraded\|optimized\|cedh}.json` | Brackets 1-5; `card.num_decks` matches the bracket count (153 / 3149 / 4136 / 2596 / 193) |
| Budget | `/commanders/<slug>/{budget\|expensive}.json` | 200 (4623 decks each) |
| Theme | `/commanders/<slug>/<tag-slug>.json` (e.g. `/infect` = 3545 decks, `/lathril-blade-of-the-elves/elves`) | 200 |
| Combined | `/<bracket>/budget`, `/<theme>/budget` | 200 (`upgraded/budget` = 413 decks) |
| Average deck | `/average-decks/<slug>[/<bracket>\|/budget].json` | Adds `deck:{commander, commander_v2, cards}` and `archidekt:[{c,f,q,u:<scryfall id>}]` (91 entries) |
| Deck table | `/decks/<slug>.json` | **11.7 MB** (11,690,443 bytes); `table[]` of 46,230 rows `{urlhash, savedate, price, salt, type counts, bracket, deck_color_id, tags}` |
| Card page | `/cards/<slug>.json` | `card.salt` (Sol Ring 1.59), global `num_decks/potential_decks` (Sol Ring 8,777,799 / 10,538,195), New Commanders (5), Top Commanders (24), co-played cards up to 50 per type |
| Other | `/top/salt.json` (100), `/top/game-changers.json` (53), `/tags/<slug>.json`, `/combos/<colors>/<ids>.json`, `/partners/<slug>.json` (60 pairings for Thrasios), `/commanders/year.json` | all 200 |

- Numeric bracket slugs (`/2`, `/bracket-3`) return 403.
- Bracket pages with few decks are noisy (cEDH Atraxa has 193, Exhibition 153). Fall back to the unfiltered page when `card.num_decks` is below roughly 300.
- **Bracket coverage is partial.** In the Atraxa deck table, `bracket` is `null` in 36,003 of 46,230 rows; the 10,227 non-null rows match `bracket_counts` exactly. So bracket pages are built from about a fifth of the decks. A web-search snippet of an EDHREC `/decks/…` page reads "This page includes only decks with user-set brackets. Auto-detected brackets are not included"; I could not re-find that sentence in the server-rendered HTML or JSON, but it is consistent with the data. Archidekt's public deck search exposes a per-deck `edhBracket` that is null on most decks.

### 1.4 Slug rules (observed)
- Lowercase, apostrophes and commas dropped, spaces to hyphens: `atraxa-praetors-voice`, `the-ur-dragon`. The `sanitized`/`slug` field in every cardview is authoritative.
- Non-ASCII is ASCII-folded: `eowyn-shieldmaiden` (Éowyn), `cards/lim-duls-vault` (Lim-Dûl's Vault) and `cards/seance` (Séance) all return 200.
- Pairs: both slugs joined by `-` in **one specific order**; the other order returns a redirect. Observed canonical orders:
  - Partner + partner: alphabetical in both pairs tested (`thrasios-triton-hero-tymna-the-weaver`, `kraum-ludevics-opus-tymna-the-weaver`).
  - Friends forever: `max-the-daredevil-will-the-wise` (alphabetical).
  - Doctor + companion: `the-tenth-doctor-rose-tyler` (Doctor first, not alphabetical).
  - Commander + Background: `wilson-refined-grizzly-raised-by-giants` (creature first, not alphabetical).
  - This is five samples, not a documented rule. Try one order and follow the redirect.
- A solo partner page exists (`/commanders/thrasios-triton-hero`).
- DFC/MDFC: front-face name only (`esika-god-of-the-tree` is 200; with the back face appended it is 403).

### 1.5 Synergy vs. lift (changed 2025-2026)
- **Old synergy** = (% of the commander's decks running the card) − (% of potential decks running it). Range is −1 to +1.
- **Lift timeline:**
  - 2025-12-15: Julia Maddalena's article "From Synergy to Lift" announced that EDHREC "is replacing" synergy with lift and gave the maths. https://edhrec.com/articles/from-synergy-to-lift-the-math-behind-edhrecs-new-era
  - 2026-10-01: keattz's "Changelog: Replacing Synergy with Lift" rolled lift out on `/commanders`, `/combos` and `/tags` pages. It says "Earlier this year, we replaced Synergy with Lift on /cards pages". https://edhrec.com/articles/changelog-replacing-synergy-with-lift-on-edhrecs-card-pages (the slug says "card-pages" but the article is the October 2026 one).
  - The exact date lift went live on `/cards` pages is therefore not pinned down: announced December 2025, described in October 2026 as "earlier this year".
- The changelog describes lift as "like Synergy, but division instead of subtraction": inclusion rate ÷ inclusion rate in potential decks, "a ratio centered around 1".
- The 2025 article said EDHREC had "chosen to display log-lift values" (0 = independent). The 2026 changelog and the JSON both use the raw ratio. The JSON on commander pages still ships **both** `synergy` and `lift`.
  - Sol Ring on Atraxa: inclusion 0.850, synergy −0.018, lift 0.979.
  - Evolution Sage: inclusion 0.594, synergy 0.238, lift 1.668. This implies a baseline q = 0.356, and 0.594 − 0.356 = 0.238, so both fields share the same baseline.
- The 2025 article notes the median lift across all card pairs is 1.58, so "slightly above 1" is not a signal.
- **Design caveat (inference from the data, not an EDHREC statement):** commander-page lift is bounded above by 1 / (the commander's share of its potential decks). Atraxa's max is 1.739 and its median 1.478, so lift is compressed for commanders that dominate their identity and is not comparable across commanders. Normalise per page (percentile rank), or recompute your own measure from `p = num_decks/potential_decks` and `q = p/lift`.
- "Potential decks" = decks that could run both cards: commander, color identity, built on or after the date both cards were previewed, and the currently active filters (budget, bracket, tag). Source: https://edhrec.com/faq (no date on page).
- Deck data comes from Moxfield and Archidekt (2025-12-15 article). EDHREC's how-to guide says "Archidekt, Moxfield, and Scryfall" (https://edhrec.com/guides/how-to-use-edhrec).
- Themes are hand-tuned heuristics defined individually per theme, per the FAQ.

### 1.6 Salt
- Source: an annual community survey scoring cards 0-4. The current list is headed "Voted on by the community in 2026" (https://edhrec.com/top/salt; https://edhrec.com/faq).
- Where to get it:
  - `/top/salt.json`: top 100 only, `cardviews[].salt` (Stasis 3.05).
  - `/cards/<slug>.json`: `container.json_dict.card.salt`, one request per card.
  - **MTGJSON `AtomicCards`** documents `edhrecSaltiness` and `edhrecRank` per card. This is the best bulk source (https://mtgjson.com/data-models/card/card-atomic/). I confirmed the field names in the data model page, not by opening the 52 MB file.
  - `/decks/<slug>.json` rows carry a per-deck `salt` sum (e.g. 71.29), useful as a reference distribution.
- EDHREC states there is no connection between salt scores and Commander Brackets or the Game Changers list.
- Commander Spellbook has its own separate combo salt (0-4, `salt` and `saltVoteCount` per variant; `salt` is null when votes are few).

### 1.7 Terms and a polite approach
- Terms of Use, effective 2024-08-06 (https://edhrec.com/terms): the licence is "solely for your own personal, noncommercial use". The Acceptable Use Policy forbids using "software or automated agents or scripts to produce multiple accounts on the Site, or to generate automated searches, requests, or queries to the Site" and creating "an undue burden on servers or networks connected to the Site". The restrictions also say "you shall not access the Site in order to build a similar or competitive website", and that no part of the Site may be "copied, reproduced, distributed, republished, downloaded…" unless otherwise indicated.
- `edhrec.com/robots.txt` disallows only `/articles/embed/`, `/articles/preview…` and `/deckpreview/`. `json.edhrec.com` has no robots.txt (403).
- **Reading:** a scripted client is outside the letter of the AUP even for personal use. There is no official API and I found no published permission for third-party tools. Treat it as tolerated-at-best and design so the app works without it. Never redistribute the data.
- Polite pattern for a local tool:
  1. Fetch only on user action (commander selected), never crawl.
  2. Cache to disk per commander and variant with a TTL of at least 7 days; revalidate with `If-None-Match`.
  3. One request at a time, at least 1-2 s apart, about 2-4 requests per commander (base, chosen bracket, optional theme, average deck).
  4. Honest User-Agent; back off on 429/5xx; treat 403 as missing.
  5. Never pull `/decks/<slug>.json` routinely.
  6. Provide a setting to disable EDHREC entirely.

## 2. Commander Spellbook

### 2.1 API (confirmed live, version 7.3.7)
- Root `https://backend.commanderspellbook.com/` lists: `variants, features, cards, templates, variant-suggestions, variant-update-suggestions, variant-aliases, salt-votes, properties, users, find-my-combos, estimate-bracket, explain-query, card-list-from-url, card-list-from-text`.
- OpenAPI 3.0.3 schema is at `/schema/` (`?format=json` returns JSON, 243 KB).
- Usage rules from the schema description:
  - "Make sparse, unauthenticated requests, with the general guideline of a few HTTP calls per user interaction with your tool."
  - Name your service in the User-Agent.
  - "80 requests per minute should be a safe rate"; always handle 429.
  - Do not page the API to export everything; use the bulk file.
  - Credit and link back to commanderspellbook.com.
- `backend…/robots.txt` is `User-Agent: * / Disallow: /`, which targets crawlers; the API itself is explicitly offered.
- A TypeScript client is on npm: `@space-cow-media/spellbook-client` (7.3.7, MIT).

### 2.2 Bulk export
- `https://json.commanderspellbook.com/variants.json.gz`: **32.05 MB compressed** (32,053,941 bytes), 729 MB uncompressed (729,093,875 chars), last-modified 2026-11-10 22:12 GMT, internal `timestamp` 22:11:51. It is served with `Content-Encoding: gzip`, so many HTTP clients transparently decompress it; Python `urllib` does not and saves real gzip bytes. An uncompressed `variants.json` is also published.
- Shape: `{timestamp, version, variants[], aliases[]}`. Aliases are `{id, variant}` mapping old IDs to new ones; `variant` can be `null` (the old ID has no successor).
- **120,989 variants** (120,646 status `OK`, 343 `E` = Example); 119,486 are Commander-legal.
- 729 MB of JSON exceeds V8's maximum string length, so `JSON.parse` in one go will not work in Node. Ingest once with a streaming or incremental parser into SQLite (variant table plus an inverted index from card `oracleId` to variant ids), dropping image URLs.

### 2.3 Variant fields
- `id`: card ids joined by `-`, with templates after `--` (e.g. `513-5034--46`).
- `status`, `identity` (e.g. `"UB"`), `popularity`, `salt`, `saltVoteCount`, `bracketTag`, `variantCount`, `spoiler`.
- `uses[]`: `{card:{id,name,oracleId,typeLine,faces,…images}, quantity, zoneLocations[] (H/B/C/E/G/L), mustBeCommander, usedFace, battlefieldCardState, exileCardState, libraryCardState, graveyardCardState}`.
- `requires[]`: template slots `{template:{…}, quantity, zoneLocations, mustBeCommander, *CardState}`. 6,861 variants have at least one.
- `produces[]`: `{feature:{id,name,status,uncountable}, quantity}`, e.g. "Infinite +1/+1 counters on a creature".
- `of[]`, `includes[]`: generator combo ids.
- `manaNeeded`, `manaValueNeeded` (int), `easyPrerequisites`, `notablePrerequisites`, `description` (steps), `notes`.
- `legalities{commander,…}`, `prices{…}`.
- `popularity` is "the number of decks containing the combo" among EDHREC decklists (syntax guide). Median 1, p90 191, max 367,736; null on the 343 Example variants.

### 2.4 bracketTag
Enum from the schema; definitions from https://commanderspellbook.com/syntax-guide/ (no date on page).

| Code | Name | Bracket (guide wording) | Searchable as | Criteria | Count in bulk |
|---|---|---|---|---|---|
| R | Ruthless | For competitive decks at brackets 4+ | bracket 4 | Relevant two-card combo that is probably very fast, or results in infinite turns, mass land denial, infinite control of opponents' turns, or contains four or more game changers | 6,783 |
| S | Spicy | Probably 3 or 4, but hard to classify | bracket 3 | Could be ruthless but may require a third card or doesn't produce a relevant result, or stalls the game in some way | 11,925 |
| P | Powerful | For strong decks in bracket 3+ | bracket 3 | Has a game changer, or is a slow but relevant two-card combo | 2,632 |
| O | Oddball | Probably 2 or 3, but hard to classify | bracket 2 | Could be powerful but may require a third card or doesn't produce a relevant result | 3,720 |
| C | Core | For unoptimized decks in bracket 2+ | bracket 2 | Contains an extra-turn card but no extra-turn result, or a two-card combo too fast for bracket 1 | 264 |
| E | Exhibition | For any deck | bracket 1 | Combos that don't fit the other categories | 94,162 |
| B | Banned | Not legal in Commander | none | Usually contains a banned card | 1,503 |

- Spellbook states the tag is "a qualitative association to one or more brackets… rather than a strict classification", and that editors can manually override an auto-assigned tag.
- `bracket:4` and `bracket:ruthless` both return 6,783 on the live API, matching the bulk count.

### 2.5 `POST /find-my-combos` (confirmed)
- Body is JSON `{"commanders":[{"card":"Kinnan, Bonder Prodigy","quantity":1}],"main":[{"card":"…","quantity":1},…]}` or a `text/plain` decklist (both tested, both 200).
- Query params: `limit, offset, ordering, q, groupByCombo, count, variant`.
- The response is a paginated envelope `{count, next, previous, results}`; `count` is null unless `?count=true`. Follow `next` when it is set.
- `results` has `identity` plus these arrays of full Variant objects: `included`, `includedByChangingCommanders`, `almostIncluded`, `almostIncludedByAddingColors`, `almostIncludedByChangingCommanders`, `almostIncludedByAddingColorsAndChangingCommanders`.
- My own test (Kinnan + 14 cards) returned 4 `included`: Demonic Consultation + Thassa's Oracle (R), Dramatic Reversal + Isochron Scepter (S), Heliod, Sun-Crowned + Walking Ballista (S), Kinnan + Basalt Monolith (R); plus 60 `almostIncluded` and 17 `almostIncludedByAddingColors` (count 81). The original report's "131 almostIncluded" came from a different 15-card list that I do not have, so that number is unchecked.
- `almostIncluded` is directly usable as an "add this one card to complete a combo" feed.

### 2.6 `POST /estimate-bracket` (confirmed)
- Same body. Returns `{bracketTag, cards[], combos[]}`.
- `cards[]`: `{card, quantity, banned, gameChanger, massLandDenial, extraTurn}`. Rhystic Study and Thassa's Oracle came back `gameChanger`, Armageddon `massLandDenial`, Time Warp `extraTurn`.
- `combos[]`: `{combo:<Variant>, relevant, borderlineRelevant, arguablyTwoCard, definitelyTwoCard, speed, massLandDenial, extraTurn, lock, skipTurns, controlAllOpponents, controlSomeOpponents}`.
- **`speed` is defined in the backend source** (`backend/spellbook/models/variant.py`, `estimate_bracket`): 5 if `manaValueNeeded` is 0, 4 if ≤ 4, 3 if ≤ 6, 2 if ≤ 8, else 1; plus 1 when the mana figure is not an accurate minimum. So the range is 1-6 and higher is faster. All four combos in my test scored 5.
- The same function shows how the deck tag is derived: Ruthless needs, among other triggers, a combo with `speed >= 4 and relevant and definitelyTwoCard`; Spicy uses `speed >= 4` with weaker two-card or relevance flags, or any lock, skip-turns or control-some-opponents combo; Powerful uses `speed >= 3 and relevant and definitelyTwoCard`, or any game changer card.
- `/cards/` objects (CardDetail) also expose `gameChanger, tutor, massLandDenial, extraTurn, variantCount, features[], keywords, oracleText, legalities, prices`.
- `GET /variants/?q=…&ordering=-popularity&limit=` accepts the site's search syntax. Tested and working: `card:"…"`, `cards=2`, `bracket:4`, `popularity>1000` (4,751), `legal:commander`, `result:"infinite mana"` (11,807), `commander:derevi` (40).
- `commander:` means "requires this card **as** commander", not "works with this commander": `commander:kinnan` returns 0.

### 2.7 Detecting two-card infinites and early-game combos
**Offline (bulk)**
- For each variant with `legalities.commander` true and status `OK`, check that every `uses[].card.oracleId` is in the deck or command zone.
- Honor `mustBeCommander` (1,271 variants have it on at least one card).
- For `requires[]` templates, either treat as "needs a generic piece" or resolve via the template's Scryfall query.
- Strict two-card: `uses.length == 2 && requires.length == 0` gives 3,970 Commander-legal variants (S 1,921, R 866, E 833, O 186, P 100, C 64).
- Infinite: any `produces[].feature.name` starting with "Infinite" or "Near-infinite", or equal to "Win the game".
- Game-ending vs. merely infinite: use the bracket tag (R/S/P), or a whitelist of features (Win the game, Infinite damage, Infinite lifeloss, Infinite mill, Infinite turns, Lock).

**Early-game (Spellbook exposes no "turn" field)**
- Reproduce Spellbook's own `speed` from `manaValueNeeded` using the thresholds in 2.6 (0 / ≤4 / ≤6 / ≤8).
- Empty `notablePrerequisites`.
- Pieces start in hand, battlefield or command zone (`zoneLocations`).
- Or take `speed`, `definitelyTwoCard` and `arguablyTwoCard` from `/estimate-bracket`, which is Spellbook's own classifier.

**Recommendation:** call `/find-my-combos` and `/estimate-bracket` live, debounced, at most once per deck change, well under 80/min. Use the bulk file as the offline fallback and for per-card "combo potential with this commander" precomputation.

### 2.8 License
- Backend and site source are MIT (GitHub API `spdx_id: MIT` on both repos; https://commanderspellbook.com/about/ says the same).
- **I found no explicit licence for the combo data.** The API docs only ask for credit and a link back. Fine for personal local use; do not redistribute the dump.
- Spellbook, EDHREC and Archidekt all sit under Space Cow Media (EDHREC's footer and terms name Space Cow Media; the Spellbook repos and npm package are under the SpaceCowMedia org).

## 3. Other datasets

| Source | What it gives | Access and terms | Verified |
|---|---|---|---|
| **Scryfall bulk** | Canonical card data: `oracle_id`, `color_identity`, `legalities.commander`, `keywords`, `edhrec_rank`, **`game_changer`** (`is:gamechanger` returns 53, the same 53 names as EDHREC's list) | `oracle_cards` is 25.4 MB compressed. **`/bulk-data` items now expose `jsonl_download_uri` and `compressed_size`** (gzipped JSON Lines, one object per line); there is no `download_uri` or `size` field in the live response. API needs a real User-Agent and an Accept header. Hard rate limits: `/cards/search`, `/cards/named`, `/cards/random`, `/cards/collection` 2/second; `/cards/manifest` 10/minute; all other methods 10/second; `*.scryfall.io` file hosts have none. A 429 limits access for 30 seconds. Cache at least 24 h; gameplay data weekly is enough. No paywalling. https://scryfall.com/docs/api, https://scryfall.com/docs/api/rate-limits | Yes |
| **Scryfall `oracle_tags` bulk** | Tagger functional tags, 6.1 MB compressed, 19 MB JSONL, **4,605 tags** covering 36,453 distinct oracle ids. Each row: `{id, label, slug, type, uri, description, parent_ids, child_ids, aliases, taggings:[{oracle_id, weight}]}` with weights `median / strong / very_strong` | Community-maintained. **Tags are hierarchical and parents are often empty**: `removal`, `tutor`, `draw`, `recursion`, `protection` have 0 direct taggings and only get members through `child_ids` (removal 6,751, tutor 1,235, draw 4,589 with descendants). `ramp` 582 direct / 2,493 with children; `mana-dork` 463; `mana-rock` 110 / 404; `sweeper` 745 / 994; `spot-removal` 5,545 / 5,629; `counterspell` 98 / 566; `card-advantage` 58 / 6,677. `label` uses spaces ("mana dork"), `slug` hyphens. No `board-wipe` or `wincon` slug (use `sweeper`) | Yes, downloaded and parsed |
| **MTGJSON v5** | `AtomicCards.json.gz` 52.3 MB with `edhrecRank`, `edhrecSaltiness`, `isGameChanger`, `leadershipSkills`, `legalities`, `relatedCards` (per the data-model page). `AllDeckFiles.zip` 265.5 MB of precon lists | MIT, daily builds (`5.3.0+20261110`). https://mtgjson.com/license/ | Yes (sizes, version, documented fields); file contents not opened |
| **Archidekt** | Public deck JSON; search returns `edhBracket` per deck (null on most, 2/3/4 on some in a 60-deck sample) | `GET https://archidekt.com/api/decks/v3/?formats=3` returned 200 unauthenticated. Terms (effective 2018-09-07) have the same clause against automated queries as EDHREC. https://archidekt.com/terms | Yes |
| **Moxfield** | Decklists | No documented public API. `api2.moxfield.com` is behind Cloudflare. The terms page is a JS app I could not read, so the policy is unconfirmed, as is the third-party claim that a User-Agent must be whitelisted by support | No |
| 17lands | Limited data | Not relevant | - |

- Use Archidekt and Moxfield only for importing a user-supplied deck URL. Spellbook's `/card-list-from-url` endpoint exists for this (listed in the API root; not exercised).
- A source not checked: EDHTop16/TopDeck.gg tournament data for cEDH-level signal.
- Game Changers context: the latest Wizards update I could find is "Commander Brackets Beta Update – February 9, 2026" (Farewell added; Biorhythm unbanned and added). The live Scryfall and EDHREC lists both hold 53 cards including those two.

## 4. Recommended combination

**Layer A - always available, bulk, refreshed weekly in the background**
1. Scryfall `oracle_cards` (JSONL): card identity, legality, color identity, `game_changer`, `edhrec_rank`. Join key is `oracle_id` (Spellbook exposes `oracleId`; EDHREC cardview `id` is a Scryfall printing id, so map it via Scryfall `default_cards` or fall back to name).
2. Scryfall `oracle_tags`: functional roles. Roll taggings up through `child_ids` before use.
3. MTGJSON `AtomicCards`: `edhrecSaltiness`, plus a cross-check on game changers.
4. Commander Spellbook `variants.json.gz`, ingested into SQLite.

**Layer B - on demand per commander, cached at least 7 days**

5. EDHREC commander JSON (base, selected bracket, optional theme, average deck).

**Layer C - live per deck edit, debounced**

6. Spellbook `/find-my-combos` and `/estimate-bracket`.

**Per-card 0-100 score relative to a commander (sketch)**
- EDHREC signal: percentile of inclusion `p` blended with a per-page-normalised `log(lift)`, shrunk toward the baseline when `potential_decks` is small.
- Combo signal: variants containing the card that are completable with the commander or current deck, weighted by `log(popularity)`, and penalised or bonused by bracket tag against the target bracket.
- Role-need signal: oracle tags vs. the deck's current role gaps, using the commander's average deck as the target composition.
- Legality and identity are a hard gate.
- For a card missing from the EDHREC page: `p ≈ 0`, with a prior from the global `edhrec_rank`.
- Bracket-filtered EDHREC pages rest on roughly a fifth of decks (those with a bracket set), so weight them accordingly.

**Fallbacks**
- **EDHREC unavailable** (403, format change, or disabled): use stale cache, then score from Layer A only (global `edhrec_rank` prior, oracle-tag role fit, text and keyword overlap with the commander, combo signal). Mark the score "low confidence" in the UI. Validate the schema on every fetch (`container.json_dict.cardlists[].cardviews[].num_decks`), and treat `synergy` as optional: card pages already omit it.
- **Spellbook API unavailable:** local matcher over the bulk SQLite, with the bracket classifier approximated from `bracketTag`, the `speed` thresholds in 2.6 and Scryfall `game_changer`.
- **Scryfall unavailable:** MTGJSON AtomicCards covers the same core fields.

## 5. Not confirmed
- Any explicit EDHREC permission or contact route for third-party data use; the FAQ's "just email us" line is about advertising.
- The exact date lift went live on EDHREC `/cards` pages.
- The EDHREC pair-slug ordering rule beyond the five samples in 1.4.
- The wording that EDHREC bracket pages use only user-set brackets (seen in a search snippet only; the 22% coverage is measured).
- A data licence for Commander Spellbook's dump.
- Moxfield's terms and API policy.
- Whether any Commander Brackets or Game Changers update was published after 9 February 2026; I found none and the live lists match that update.
- The original report's "131 almostIncluded" figure.

## Verification notes

### Corrections made (old -> new, source)
1. **Scryfall rate limits**: "captured only 10/second for one tier" -> full table: search/named/random/collection 2/s, manifest 10/min, everything else 10/s, `*.scryfall.io` unlimited, 429 = 30 s lockout. Source: https://scryfall.com/docs/api/rate-limits.
2. **Scryfall bulk format**: implied classic JSON download -> live `/bulk-data` returns only `jsonl_download_uri` + `compressed_size` (gzipped JSONL). Source: live `GET https://api.scryfall.com/bulk-data`.
3. **`oracle_tags` "did not inspect contents"** -> inspected: 4,605 tags, hierarchical, parent tags such as `removal` and `tutor` have zero direct taggings. Source: live download of the `oracle_tags` file.
4. **`speed` "meaning not confirmed, higher = faster"** -> exact thresholds from source (range 1-6), plus the tag-derivation rules. Source: `SpaceCowMedia/commander-spellbook-backend`, `backend/spellbook/models/variant.py`.
5. **Lift timeline**: "/cards pages (article 2025-12-15)… changelog 2026-10-01" with the second URL presented as a card-pages article -> that URL is the 2026-10-01 changelog for /commanders, /combos, /tags, and it says /cards changed "earlier this year"; 2025-12-15 was the announcement. Sources: both EDHREC articles.
6. **Lift display**: "the log value the 2025 article says is displayed" kept, but added that the 2026 changelog describes a "ratio centered around 1", matching the JSON.
7. **Deck-table `bracket` "was null in the row I sampled; assignment unknown"** -> null in 36,003 / 46,230 rows; non-null rows equal `bracket_counts` exactly; bracket pages cover about 22% of decks. Source: live `/decks/atraxa-praetors-voice.json`.
8. **Archidekt `edhBracket` "null in my sample"** -> mostly null, but 2/3/4 present on several of 60 sampled decks. Source: live Archidekt search.
9. **Non-ASCII slugs "not confirmed"** -> confirmed ASCII-folded (Éowyn, Lim-Dûl's Vault, Séance all 200).
10. **Partner order "not strictly alphabetical, no rule"** -> five observed orders listed (partners and friends-forever alphabetical; Doctor before companion; creature before Background).
11. **Spellbook root endpoint list**: was missing `users`; "auth-only suggestion and salt-vote endpoints" named explicitly. Source: live root.
12. **`/find-my-combos` response**: added the paginated envelope (`count/next/previous/results`); replaced the unverifiable "131 almostIncluded" with my own run (60 + 17).
13. **`commander:` search keyword**: added that it means "must be your commander" (`commander:kinnan` = 0, `commander:derevi` = 40). Source: syntax guide and live API.
14. **bracketTag table**: wording aligned to the syntax guide and the "Searchable as" column added (Spicy and Powerful both search as bracket 3; Oddball and Core as 2). Added the manual-override note.
15. **Bulk file**: last-modified 22:11 -> 22:12:01 GMT (internal timestamp 22:11:51); "heavy to JSON.parse" -> exceeds V8 max string length; aliases can have `variant: null`; "transparently decompress" qualified (client-dependent).
16. **EDHREC cardview example**: added the `slug` and `image_version` fields that the verbatim example omitted; noted card pages have `lift` without `synergy`.
17. **EDHREC cache header**: added `stale-while-revalidate=180`; page size 131 KB -> 130,804 bytes.
18. **EDHREC card `id`**: "Scryfall id" -> specifically a printing id (resolved live to 2XM Atraxa).
19. **Terms quotes**: completed the truncated AUP quotes and added the no-copy/download restriction.
20. **EDHREC data sources**: added the how-to guide's "Archidekt, Moxfield, and Scryfall".
21. **Scryfall `oracle_cards` size** 25 MB -> 25.4 MB compressed; "rebuilt every 12-24 h" removed (not re-verified; docs say daily bulk files).

### Claims confirmed (re-fetched live)
- EDHREC: endpoint, 403-for-missing, redirect JSON, all top-level keys, `bracket_counts`, `budget_counts`, 184 tags, 730 savedates, panel keys, combocount hrefs, card fields (46,230 decks, rank 4, salt 1.77), all 11 cardlist sizes, 288 unique cards, the Tekuthal / Sanctum Lurker / Sol Ring / Evolution Sage numbers, max lift 1.74 and median 1.48, every variant URL in the table including deck counts, numeric bracket slugs 403, average-deck `deck` and 91-entry `archidekt`, deck table size and row shape, Sol Ring global counts, Top Commanders 24, salt top 100 with Stasis 3.05, game-changers 53, partners 60, Esika front-face rule, solo Thrasios page.
- EDHREC text: terms effective date and quoted clauses; robots.txt contents; FAQ on potential decks, salt (0-4, annual), themes; "Voted on by the community in 2026"; "division instead of subtraction"; Moxfield and Archidekt as sources; article dates 2025-12-15 and 2026-10-01.
- Spellbook: version 7.3.7, OpenAPI 3.0.3, usage rules, robots.txt, npm client, bulk size 32.05 MB / 729 MB, shape, 120,989 variants (120,646 OK, 343 E), 119,486 Commander-legal, every bracketTag count, 1,271 `mustBeCommander`, 3,970 strict two-card with the per-tag split, popularity median 1 / p90 191 / max 367,736, variant field list, `/find-my-combos` and `/estimate-bracket` shapes and the four example combos with their tags, card flags (Rhystic Study, Thassa's Oracle, Armageddon, Time Warp), Thoracle/Consultation speed 5, MIT on both repos.
- Scryfall: `game_changer` field, `is:gamechanger` = 53 with names identical to EDHREC's list, User-Agent and Accept requirement, 24 h caching advice, no-paywall rule, `oracle_tags` 6.1 MB.
- MTGJSON: version `5.3.0+20261110`, AtomicCards 52 MB, AllDeckFiles 265 MB, MIT, documented field names.
- Archidekt: endpoint 200 unauthenticated, terms effective 2018-09-07 with the automated-queries clause.
- Wizards: February 9, 2026 bracket update exists (Farewell added).

### Could not verify
- The "131 almostIncluded" result (original deck list not available).
- EDHREC's rebuild cadence (one day's timestamps only) and how brackets are assigned beyond the measured coverage.
- MTGJSON field presence inside the actual file (checked documentation only).
- Moxfield terms, API policy and the User-Agent whitelist report.
- `/card-list-from-url` behaviour (endpoint listed, not called).
- That no bracket or Game Changers update happened between February and November 2026; no evidence of one, and third-party timelines updated in May and July 2026 list February 9 as the latest.
- Space Cow Media ownership of Commander Spellbook as a formal statement (inferred from the GitHub org, npm scope and EDHREC footer).
- The lift upper-bound argument is a mathematical inference, not something EDHREC states.