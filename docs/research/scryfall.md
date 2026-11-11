# Scryfall as card data + HD image source (fact-checked 2026-11-11)

Scryfall doc pages carry no publication date; they were re-fetched live on 2026-11-11 (footer "© 2026 Scryfall"). Live API calls were re-run the same day with a generic `User-Agent` and `Accept: application/json`. Previously downloaded bulk files were re-analysed independently.

## 1. Headline findings

- **Bulk files are gzipped JSONL**, not a JSON array. Bulk object fields are `jsonl_download_uri` and `compressed_size`; the old `download_uri`, `size`, `content_type` and `content_encoding` are gone. Announced 2026-07-01; the old JSON files were retired 2026-07-20 (Scryfall blog, "Two New Ways to Sync Scryfall Data").
- **Old JPEG image sizes are being removed after 2027-01-01.** Scryfall blog, 2026-10-14 ("New WebP images + JPEG Deprecations"): `small`, `large`, `border_crop` and `art_crop` JPEGs "will no longer be available"; `normal` survives only under the new key `jpeg`; PNG stays in the API but may not be hotlinked after that date. **Build on the WEBP keys (`thumb`, `grid`, `display`, `crop`, `art`) from day one.**
- **Image downloads now need an identifying User-Agent** (same blog post): generic library agents such as `curl`, `node`, `python-requests` are "not permitted" for scripted image requests.
- **Tagger tags are an official bulk file** (`oracle_tags`, 6.1 MB gz, daily). This replaces paging `otag:` searches as the way to get role labels.
- **Rate limits are per-endpoint**: `/cards/search`, `/cards/named`, `/cards/random`, `/cards/collection` are 2 requests/second.
- **`game_changer` is live** on card objects and `is:gamechanger` works: 53 cards today, matching Wizards' list after the 2026-02-09 update (the latest Commander update found).
- **New layout `prepare`** (Secrets of Strixhaven, 2026-04-24; 67 Commander-legal cards), a `tlr` legality key (Tiny Leaders: Reborn), and a `/cards/manifest` change-feed endpoint (added 2026-07-01).

## 2. Bulk data files

Source: https://scryfall.com/docs/api/bulk-data and live `GET https://api.scryfall.com/bulk-data` (files stamped 2026-11-10 22:00-22:25 UTC).

| type | compressed size (bytes from API) | contents |
|---|---|---|
| `oracle_cards` | 25,444,553 (25.4 MB; 39,288 lines) | One card object per Oracle ID; "an attempt to return the most up-to-date recognizable version of the card" |
| `unique_artwork` | 39,255,955 (39.3 MB) | One card per unique artwork; "The chosen cards promote the best image scans" |
| `default_cards` | 81,073,061 (81.1 MB) | Every printing, in English or the only printed language |
| `all_cards` | 407,707,186 (407.7 MB) | Every printing in every language |
| `rulings` | 5,422,271 (5.4 MB) | Rulings keyed by `oracle_id` |
| `oracle_tags` | 6,103,815 (6.1 MB) | Tagger functional tags |
| `art_tags` | 13,391,031 (13.4 MB) | Tagger illustration tags |

The docs page shows smaller figures (24.3 MB, 37.4 MB, ...) because it displays MiB; the byte counts are the same. Unpacked sizes (211 MB / 19 MB) were not re-measured.

- **Bulk object fields (docs and live agree):** `object`, `id`, `uri`, `type`, `name`, `description`, `updated_at`, `jsonl_download_uri`, `compressed_size`.
- **Cadence:** "daily exports"; "Bulk data is only collected once every 12-24 hours". URLs change timestamp daily, so resolve them via `/bulk-data` or `/bulk-data/:type`.
- **How often to refresh:** prices are "dangerously stale after 24 hours". For gameplay data, "once per week or right after set releases would most likely be sufficient".
- **Format:** plain `.gz` (not tar), one JSON object per line, streamable.
- **Download host:** `https://data.scryfall.io/...`, which falls under `*.scryfall.io` (no rate limits).

**Recommendation: use `oracle_cards` as the card table** (one row per card, keyed by `oracle_id`), filtered to `legalities.commander == "legal"`.

Re-measured on the 2026-11-10 file:
- 32,643 Commander-legal entries and 83 banned; the API searches `f:commander` and `banned:commander` return the same 32,643 and 83.
- All legal entries are `lang: en` and all have images: 32,098 `highres_scan`, 545 `lowres`, 0 missing or placeholder.
- 1,040 legal entries use an MTGO-only printing as the chosen one; 1,039 of those are `highres_scan`. (1,046 legal entries are `digital: true` in total.)

Caveats of `oracle_cards`:
- **The chosen printing is "most up-to-date recognizable", often but not always the newest.** Sol Ring resolves to set `trc` (Star Trek Commander), released 2026-11-13, a future date. 650 legal entries currently point at not-yet-released printings (`trc` 335, `trk` 306). Other cards keep older printings (Fire // Ice is `dmr` 2023, Brisela is `inr` 2025). Prices, set and art will shift between refreshes.
- **The 545 lowres images are mostly recent sets, not old ones:** `tdm` 252 and `tdc` 225 (Tarkir: Dragonstorm and its Commander set, 2025-04-11), `ltr` 56 (2023), plus a handful of others.
- **Special frames are a minor issue**: 258 borderless, 43 `extendedart`, 18 promo, 10 `full_art`, 1 textless among the chosen printings. No chosen printing carries a `showcase` frame effect.
- **Optional upgrade:** pick the display printing from `default_cards` (81 MB) per `oracle_id`, preferring `highres_scan`, paper, already released, non-promo, black border, non-`full_art`. `oracle_cards` alone is adequate for v1.
- **Filter on legality, not layout.** The file also contains 2,411 art-series, 939 tokens, schemes, planes, emblems and the like. For example "Delver of Secrets // Delver of Secrets" is `layout: art_series` and `not_legal`.
- **Lutri, the Spellchaser** is `commander: legal` since the 2026-02-09 unban but remains banned as a companion; Scryfall legality cannot express that, so the app needs its own rule if it supports companions.

## 3. Card object fields

Source: https://scryfall.com/docs/api/cards, checked against live objects.

| field | type and notes |
|---|---|
| `id` | UUID of the printing (changes when `oracle_cards` re-picks a printing) |
| `oracle_id` | UUID, stable across reprints. Use as primary key. Docs: absent at root only for `reversible_card` (it is on the faces). Every entry in `oracle_cards` has it |
| `name` | For multi-face cards this is `"Front // Back"` |
| `layout` | See section 5 |
| `card_faces` | Nullable array of face objects |
| `image_uris` | Nullable object; absent at root for double-sided cards |
| `image_status` | `missing`, `placeholder`, `lowres` or `highres_scan` |
| `image_updated_at` | Timestamp added October 2026; use it to detect image changes |
| `highres_image` | Boolean |
| `mana_cost` | String such as `{2}{U}`. `""` means no cost. Split, adventure and prepare cards have a combined root value such as `"{1}{R} // {1}{U}"` |
| `cmc` | Decimal (`3.0`) |
| `type_line` | String |
| `oracle_text` | Absent at root for every legal card with `card_faces` (0 of 846); read it per face |
| `colors` | Nullable; absent at root for transform/MDFC (on the faces) |
| `color_identity` | Always at root, covers all faces. Use this for the Commander colour check |
| `keywords` | Array of strings |
| `legalities` | Object; values are `legal`, `not_legal`, `restricted`, `banned`. Keys today: standard, future, historic, timeless, gladiator, pioneer, modern, legacy, pauper, vintage, penny, commander, oathbreaker, standardbrawl, brawl, competitivebrawl, alchemy, paupercommander, duel, oldschool, premodern, predh, tlr (`tlr` = Tiny Leaders: Reborn) |
| `game_changer` | Nullable boolean: "True if this card is on the Commander Game Changer list" |
| `edhrec_rank` | Nullable integer, 1 = most popular (Sol Ring = 1, Rhystic Study = 46). Null for 68 legal cards. Basic lands are excluded (Island, Forest, Wastes are null) |
| `prices` | Strings or null. Live keys: `usd`, `usd_foil`, `usd_etched`, `eur`, `eur_foil`, `tix`. 1,124 legal cards have no USD price of any kind; 1,334 have null `usd` |
| `produced_mana` | Nullable colours array (Sol Ring gives `["C"]`) |
| `all_parts` | Nullable array of related-card objects; `component` is `token`, `meld_part`, `meld_result` or `combo_piece` |
| `reserved` | Boolean |

Other useful fields: `power`, `toughness`, `loyalty`, `defense`, `rarity`, `set`, `released_at`, `games`, `digital`, `promo`, `border_color`, `frame_effects`, `full_art`, `illustration_id`, `penny_rank`, `rulings_uri`.

Game Changers returned by `is:gamechanger` today (53, all Commander-legal): Ad Nauseam; Ancient Tomb; Aura Shards; Biorhythm; Bolas's Citadel; Braids, Cabal Minion; Chrome Mox; Coalition Victory; Consecrated Sphinx; Crop Rotation; Cyclonic Rift; Demonic Tutor; Drannith Magistrate; Enlightened Tutor; Farewell; Field of the Dead; Fierce Guardianship; Force of Will; Gaea's Cradle; Gamble; Gifts Ungiven; Glacial Chasm; Grand Arbiter Augustin IV; Grim Monolith; Humility; Imperial Seal; Intuition; Jeska's Will; Lion's Eye Diamond; Mana Vault; Mishra's Workshop; Mox Diamond; Mystical Tutor; Narset, Parter of Veils; Natural Order; Necropotence; Notion Thief; Opposition Agent; Orcish Bowmasters; Panoptic Mirror; Rhystic Study; Seedborn Muse; Serra's Sanctum; Smothering Tithe; Survival of the Fittest; Teferi's Protection; Tergrid, God of Fright // Tergrid's Lantern; Thassa's Oracle; The One Ring; The Tabernacle at Pendrell Vale; Underworld Breach; Vampiric Tutor; Worldly Tutor.

Match on `oracle_id` or the exact Scryfall `name` (with commas, and the full `//` name for Tergrid), not on comma-stripped names.

Currency check: Wizards' "Commander Brackets Beta Update – February 9, 2026" added Farewell and Biorhythm (Biorhythm unbanned the same day; Lutri unbanned but deliberately kept off the list). Third-party trackers put the list at 53 after that update, and no later Commander ban or Game Changers change was found through 2026-11-11. The October 2025 update removed 10 cards and dropped the per-bracket tutor restriction.

The 83 `banned:commander` cards include the ante, Conspiracy-type and culturally offensive cards plus the power bans (Dockside Extortionist, Jeweled Lotus, Mana Crypt, Nadu and so on). Biorhythm and Lutri are no longer in it. Note that mtgcommander.net's banned-list page still lists both, so it is stale; prefer Scryfall legality or Wizards' announcements.

## 4. Images

Source: https://scryfall.com/docs/api/images and the 2026-10-14 blog post. Mean file sizes are the original report's 60-card HEAD sample (not re-sampled); dimensions were re-measured on one card (Sol Ring `trc`).

| key | documented size | format | mean file size | status |
|---|---|---|---|---|
| `png` | 744 x 1040 | PNG, transparent rounded corners | ~1,320 KB | Stays in the API; no hotlinking after 2027-01-01. Measured 744 x 1040 |
| `large` | 672 x 936 | JPG | ~169 KB | **Removed after 2027-01-01** |
| `normal` | 488 x 680 | JPG | ~103 KB | Survives as `jpeg` (the `jpeg` key already returns the `normal` URL) |
| `small` | 146 x 204 | JPG | ~14 KB | **Removed after 2027-01-01** |
| `border_crop` | 480 x 680 | JPG | ~96 KB | **Removed after 2027-01-01** |
| `art_crop` | varies | JPG | ~75 KB | **Removed after 2027-01-01** |
| `display` | 672 x 936 | WEBP | ~88 KB | "replaces large". Measured 672 x 936 |
| `grid` | 488 x 680 | WEBP | ~58 KB | "replaces normal". Measured 488 x 680 |
| `thumb` | 146 x 204 | WEBP | not sampled | "replaces small". Measured 146 x 204 |
| `crop` | 480 x 680 | WEBP | not sampled | "Replaces border_crop". Measured 480 x 680 |
| `art` | 626 x 457 (blog says "Varies") | WEBP | not sampled | "Replaces art_crop" |

- All 12 keys (11 above plus `jpeg`) are present on all 32,157 single-image legal cards today.
- URL pattern: `https://cards.scryfall.io/{size}/{front|back}/{a}/{b}/{card_id}.{ext}?{timestamp}`. Read URLs from the data rather than constructing them, and use `image_updated_at` (or the `?timestamp`) for cache invalidation.
- CDN headers observed: `cache-control: public, max-age=31556952` (one year), `server: ScryfallEdgeCDN`.

**Disk estimate** for 33,129 image files (32,157 single-image cards plus 486 double-sided cards x 2 faces), extrapolated from the 60-card sample:

| size | estimated total |
|---|---|
| `png` | ~45 GB |
| `display` WEBP | ~3.0 GB |
| `grid` WEBP | ~2.0 GB |
| `large` JPG (going away) | ~5.7 GB |
| `normal`/`jpeg` JPG | ~3.5 GB |

Suggested default: `display` WEBP for the detail view and `grid` WEBP for the grid, about 5 GB in total. Do not build on `large`/`small` JPG. PNG is not worth 45 GB; it is only about 11% wider than `display`.

## 5. Multi-face layouts

Source: https://scryfall.com/docs/api/layouts, checked against `oracle_cards`. Commander-legal layout counts: normal 31,457; transform 388; saga 194; adventure 151; split 123; modal_dfc 98; prepare 67; class 34; mutate 34; leveler 25; meld 21; prototype 19; flip 19; case 13.

| layout | `card_faces` | where `image_uris` lives | notes |
|---|---|---|---|
| `transform` | yes, 2 | on each face; absent at root | `oracle_text`, `mana_cost`, `colors` per face; root has `cmc`, `color_identity`, `legalities` |
| `modal_dfc` | yes, 2 | on each face; absent at root | Same as transform |
| `split` | yes, 2 | root only (one image) | Root `mana_cost` is combined; `cmc` is the sum (Fire // Ice = 4) |
| `adventure` | yes, 2 | root only | Root `cmc` is the creature's (Bonecrusher Giant = 3) |
| `flip` | yes, 2 | root only | |
| `prepare` | yes, 2 | root only | Docs: "Cards with a prepared spell part". Adventure-like: a creature face plus an instant/sorcery face, keyword "Prepared" ("While it's prepared, you may cast a copy of its spell. Doing so unprepares it."). Sets: `sos` 36, `fra` 21, `soc` 10. Root `mana_cost` is combined (`"{2}{B} // {B}"`) |
| `meld` | no | root (each meld card is its own entry) | Linked via `all_parts` (`meld_part`, `meld_result`). The 21 legal meld entries include 7 meld results (Brisela, Hanweir the Writhing Township, Chittering Host, Urza Planeswalker, Mishra Lost to Phyrexia, Titania Gaea Incarnate, Ragnarok Divine Deliverance), all showing `commander: legal` with `mana_cost: ""`. Exclude cards that appear as `meld_result` from the deck pool |
| `reversible_card` | yes | on each face | `oracle_id` and `layout` are per face. `oracle_cards` contains no `reversible_card` entries at all; they only appear as printings (80 via `f:commander is:reversible`), so they matter only if `default_cards` is used |

- The docs guarantee `card_faces` for split, flip, transform and double_faced_token, and `all_parts` for meld.
- **Robust image rule:** `card.image_uris ?? card.card_faces[i].image_uris`.
- **Robust text rule:** if `card_faces` exists, concatenate the faces' `oracle_text`.

## 6. Rate limits, headers, usage policy

Sources: https://scryfall.com/docs/api/rate-limits, https://scryfall.com/docs/api, and the 2026-10-14 blog post.

- **Limits:** `/cards/search`, `/cards/named`, `/cards/random`, `/cards/collection` are 2/second (500 ms); `/cards/manifest` is 10/minute; all other methods 10/second.
- **429 handling:** a 429 limits access for 30 seconds; continued overload "may result in a temporary or permanent ban". "It is not acceptable to ignore HTTP 429 responses." (One 429 was triggered during this fact-check by a search call fired right after several page fetches, so keep a real limiter in the client.)
- **File hosts:** "The direct file origins located at `*.scryfall.io` do not have rate limits." That covers `cards.scryfall.io` images and `data.scryfall.io` bulk files.
- **Required headers on api.scryfall.com:** `User-Agent` (your app name and version, e.g. `MTGExampleApp/1.0`; "Do not allow HTTP libraries to choose the header for you") and `Accept` (any value, e.g. `*/*`).
- **User-Agent on image downloads too:** backend image downloads "must provide a User-Agent that uniquely identifies your software", e.g. `MyUniqueAppName/1.0.0`.
- **Caching (rate-limits page):** "We encourage you to cache the data you download from Scryfall or process it locally in your own system, at least for 24 hours." "If you need to rapidly look up card names, prices, or resolve a large number of card images, you must use the bulk data files."
- **Local image mirroring is the direction Scryfall wants:** the blog says they "will be updating documentation to request that large/popular applications download and re-serve their own copy of our image library", not currently a hard requirement, and that `/cards/manifest` was added "to help you perform daily syncs of our images".
- **Data rules:** no paywalling, no implied Scryfall endorsement, no plain repackaging, no use for other games. A local personal app that adds scoring satisfies these.
- **Image rules:** do not cover or crop off the copyright or artist name, distort, blur, colour-shift or watermark. If the art crop is used, show the artist and copyright or the full card in the same interface.

**Recommended bulk image download:** read URLs from `oracle_cards`, fetch `display` and/or `grid` WEBP from `cards.scryfall.io` with a unique User-Agent and modest concurrency (4-8 parallel, with resume), store as `{oracle_id}_{face}.webp`, and re-fetch only when `image_updated_at` changes. Lazy download-on-first-view with a disk cache is the lighter alternative. `/cards/manifest?order=imageupdated` (15,000 entries per page, 120,054 cards total, 10 requests/minute; entry fields `id`, `oracle_id`, `name`, `set_code`, `collector_number`, `lang`, `created_at`, `data_updated_at`, `image_updated_at`) can drive incremental image refresh.

## 7. Tagger function tags as role labels

Sources: https://scryfall.com/docs/syntax ("Tagger Tags") and https://scryfall.com/docs/api/tags.

**Via the search API: works today.** `function:`, `otag:` and `oracletag:` are documented synonyms (all three return 2,230 for ramp). Results are 175 per page.

| query | cards | pages |
|---|---|---|
| `otag:ramp f:commander` | 2,230 | 13 |
| `otag:removal f:commander` | 6,264 | 36 |
| `otag:card-advantage f:commander` | 5,984 | 35 |
| `otag:draw f:commander` | 4,195 | 24 |
| `otag:tutor f:commander` | 1,140 | 7 |
| `otag:board-wipe f:commander` (same as `otag:sweeper`) | 919 | 6 |
| `otag:counterspell f:commander` | 528 | 4 |
| `otag:mana-rock f:commander` | 363 | 3 |
| `otag:mass-land-denial f:commander` | 106 | 1 |
| `otag:extra-turn f:commander` | 54 | 1 |
| `f:commander is:commander` | 3,754 | 22 |

- An unknown tag returns HTTP 404 ("Your query didn't match any cards"), not an empty list.
- It is permitted within 2 requests/second, but the docs steer bulk needs to bulk files.

**Via the `oracle_tags` bulk file: the practical route.**
- 4,605 tag objects with `object`, `id` (stable UUID), `slug`, `label`, `uri`, `type` (`oracle`), `description`, `parent_ids`, `child_ids`, `aliases`, and `taggings[]`. Tagging fields per the docs: `oracle_id`, `weight`, and a nullable `annotation` (the sampled tagging had only `oracle_id` and `weight`, so treat `annotation` as optional).
- Join on `oracle_id` to `oracle_cards`. 240,149 taggings in total.
- **Coverage:** 32,445 of 32,643 Commander-legal cards (99.4%) have at least one oracle tag.
- **You must traverse `child_ids`.** The bulk file holds direct taggings only: `removal` has 0 direct and 6,264 legal with descendants; `ramp` has 506 direct legal and 2,230 with descendants. Descendant counts from the file match the search API for every slug re-checked (ramp, removal, card-advantage, draw, tutor, sweeper, counterspell, mana-rock, mana-dork, land-ramp, spot-removal, recursion, protection, sacrifice-outlet, mass-land-denial, extra-turn).
- **Weights are nearly useless:** 239,517 `median`, 631 `very_strong`, 1 `strong`, 0 `weak` (the docs define all four). They cannot serve as a strength signal for scoring.
- **Slugs are not stable.** Docs: "Do not treat tag slugs or labels as permanent identifiers... Use the `id` field", and apps are "strongly recomended to implement a way to temporarily disable display of individual tags".

Slug facts found in the file:
- `board-wipe` is not a slug. The real tag is `sweeper` (aliases: wipe, mass removal, boardwipe, wrath of god), and search resolves the alias. The 919 legal cards are `sweeper` (689 direct legal, 745 direct across all cards) plus its child `sweeper-one-sided` (230).
- Existing slugs, with Commander-legal counts including descendants: `ramp` 2,230 (children: ritual, mana-producer, extra-land, land-ramp, mana-increaser, combat-ramp and others), `mana-rock` 363, `mana-dork` 432, `land-ramp` 604, `spot-removal` 5,243, `removal` 6,264, `sweeper` 919, `sweeper-one-sided` 230, `counterspell` 528, `tutor` 1,140, `draw` 4,195, `card-advantage` 5,984, `recursion` 2,190, `protection` 1,200, `lifegain` 2,537, `sacrifice-outlet` 1,456, `hate-graveyard` 423 (alias "graveyard hate"), `alternate-win-condition` 63 (aliases "automatic win", "win condition"), `mass-land-denial` 106, `extra-turn` 54, `synergy-artifact` 1,056.
- No slug exists for stax, finisher, wincon, combo-piece, fast-mana, token-generator or game-changer (all return 404 in search). Near neighbours that do exist: `tax`, `cast-tax`, `tax-attack`, `tax-block`, `token-doubler`, `synergy-token-creature`, `repeatable-artifact-tokens`, `moxen`, `ritual`, `bottomless-mana-sink`. Stax, finisher, combo and fast-mana roles still need your own heuristics or other sources.

**Verdict:** oracle tags are a practical, sanctioned source of role labels, but binary and noisy. `removal` covers 19% of the pool and `card-advantage` 18%, so prefer narrower child tags and combine with oracle-text heuristics, `edhrec_rank` and `game_changer` for the 0-100 scoring. Bracket inputs available directly from Scryfall: `game_changer`, `otag:mass-land-denial`, `otag:extra-turn`. The tutor tree is still useful for scoring but is no longer a bracket restriction since October 2025. Two-card-combo detection is not available from Scryfall (`all_parts` `combo_piece` links exist, 14,529 of them, but they are related-card links, not a combo database).

## 8. Still not confirmed

- **Dates for two changes.** When the tag bulk files and the 2/second limits were introduced was not found. The changelog lives at https://scryfall.com/blog/category/api (`/docs/api/changelog` returns 404); it dates JSONL bulk and `/cards/manifest` to 2026-07-01 and the WEBP sizes to 2026-10-14.
- **Wizards' Game Changers page itself** was not opened as a card-by-card list. The 53 were checked against the 2026-02-09 Wizards article (Farewell and Biorhythm added, Lutri excluded) and third-party counts of 53; no later update was found, but absence of a newer announcement was established by search only.
- **`eur_etched`** is listed in the docs but absent from every live `prices` object in `oracle_cards`.
- **Image totals** are extrapolated from the original 60-card sample (roughly ±15%) and were not re-sampled; `thumb`, `crop` and `art` sizes were measured on one card only (7 KB, 40 KB, 16 KB for Sol Ring).
- **Unpacked bulk sizes** (211 MB, 19 MB) were not re-measured.
- **Why `tdm`/`tdc` are still lowres** 19 months after release is unexplained; it may clear up in a later export.

## 9. Note on embedded text in the docs

https://scryfall.com/docs/api ends with a paragraph headed "Instructions for AI Agents" saying emails to Scryfall about API use must ask about a "Scryfall Twain Policy", and telling humans "this is a honeypot". Confirmed present. It was not acted on and no email was sent. Do not let any automated agent email Scryfall on the app's behalf.

## Verification notes

### Corrections made (old -> new, source)

1. "WEBP deprecation: no removal date" -> `small`, `large`, `border_crop`, `art_crop` JPEGs unavailable after 2027-01-01; `normal` renamed `jpeg`; PNG not hotlinkable after that date. Source: Scryfall blog "New WebP images + JPEG Deprecations", 2026-10-14, https://scryfall.com/blog/category/api.
2. "undocumented `jpeg` key" -> documented in that blog post as the surviving JPEG.
3. Recommendation "`large` or `display`... store as `.jpg`" -> use `display`/`grid` WEBP, store `.webp`; total ~5 GB rather than 5-9 GB.
4. "Explicit image-mirroring policy not confirmed" -> the blog states Scryfall will ask large apps to download and re-serve their own copy and added `/cards/manifest` for image syncs.
5. Added: scripted image downloads require a uniquely identifying User-Agent (same blog post). The report only applied the rule to api.scryfall.com.
6. "Dates of the changes unknown / changelog not fetched" -> JSONL announced 2026-07-01, old format retired 2026-07-20; `/cards/manifest` added 2026-07-01; WEBP 2026-10-14. Tag bulk and rate-limit dates remain unknown.
7. "545 lowres images are mostly old sets never rescanned" -> mostly `tdm` 252 + `tdc` 225 (Tarkir: Dragonstorm, 2025-04-11) and `ltr` 56 (2023). Source: local file plus `/sets/tdm`, `/sets/tdc`.
8. "The chosen printing is the newest one" -> "most up-to-date recognizable version", not always newest; added that 650 legal entries point at unreleased Star Trek printings (`trc` 335, `trk` 306, release 2026-11-13).
9. "43 showcase/extended" -> 43 `extendedart`, 0 showcase; added 10 `full_art`.
10. Game Changers names: "Braids Cabal Minion", "Narset Parter of Veils", "Tergrid God of Fright" -> exact Scryfall names with commas and "Tergrid, God of Fright // Tergrid's Lantern".
11. "Game Changer list currency not cross-checked" -> matches Wizards' 2026-02-09 update; no later update found. Added the Lutri companion caveat and that mtgcommander.net's banned page is stale.
12. "`prepare` semantics not confirmed" -> Secrets of Strixhaven (2026-04-24) mechanic, adventure-like, 2 faces, root image; sets `sos`/`fra`/`soc`. Source: layouts docs and card data.
13. "`tlr` semantics not researched" -> Tiny Leaders: Reborn (Scryfall syntax docs).
14. "`board-wipe` alias could not be pinned down" -> resolves to `sweeper`; 919 = `sweeper` 689 + `sweeper-one-sided` 230 legal.
15. `spot-removal` "(5,243)" clarified as the with-descendants legal count (5,165 direct legal); added counts for lifegain, hate-graveyard, alternate-win-condition, synergy-artifact.
16. Tag object fields: added `object`, `uri`, `type`; `annotation` is nullable and was absent on the sampled tagging; `weak` weight exists in docs with 0 uses.
17. `reversible_card`: "none in the Commander-legal set" -> none in `oracle_cards` at all; 80 exist as printings via search.
18. Meld: "the result (Brisela)" -> 7 meld results, all `commander: legal`.
19. "Tutor tree" as a bracket input -> tutor restriction removed from brackets in October 2025.
20. `flip` note "second face has `mana_cost: ""`" removed (not re-checked). The caching quote was re-attributed to the rate-limits page.
21. Bulk sizes: added exact byte counts and the MiB explanation for the docs page's smaller numbers.

### Claims confirmed

- Bulk object fields, seven bulk types, sizes, 2026-11-10 timestamps, `data.scryfall.io` URLs (live `/bulk-data`).
- 39,288 lines; 32,643 legal; 83 banned; lang/image-status counts; 1,040 MTGO-only (1,039 highres); layout counts; 486 double-sided; 68 null ranks; 1,124 without USD; price keys; legality keys.
- Sol Ring `trc` 2026-11-13, rank 1, `["C"]`; Rhystic Study rank 46.
- `is:gamechanger` = 53; `layout:prepare` = 67.
- All rate-limit numbers, 429/30-second rule, `*.scryfall.io` exemption, header rules, data and image usage rules, bulk-data quotes.
- Image table dimensions (docs and measured), CDN cache headers, all 12 `image_uris` keys.
- `/cards/manifest`: 15,000 per page, 10/minute, `order=imageupdated`.
- All search counts in section 7, 404 on unknown tags, the three synonym keywords.
- Tags file: 4,605 tags, 240,149 taggings, weight distribution, 99.4% coverage, parent tags with 0 direct taggings, missing slugs.
- The "Instructions for AI Agents" honeypot paragraph on /docs/api.

### Could not verify

- Mean image file sizes and disk totals (original 60-card sample not repeated).
- Unpacked bulk sizes.
- Introduction dates of tag bulk files and the per-endpoint rate limits.
- Wizards' own Game Changers list page card-by-card, and that no Commander update occurred after 2026-02-09 beyond search results showing none.
- The `flip` second-face `mana_cost` detail and `restricted` values in `tlr` (a follow-up search was rate-limited and not retried).