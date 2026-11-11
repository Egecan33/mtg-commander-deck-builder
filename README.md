<div align="center">

# Commander Forge

**Build, score, rate and improve Magic: The Gathering Commander decks — locally, with every card on screen.**

[![Download](https://img.shields.io/github/v/release/Egecan33/mtg-commander-deck-builder?label=download&color=8a63d2)](https://github.com/Egecan33/mtg-commander-deck-builder/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/Egecan33/mtg-commander-deck-builder/total.svg)](https://github.com/Egecan33/mtg-commander-deck-builder/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-2ea44f.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)
![Next.js](https://img.shields.io/badge/Next.js-App%20Router-000000.svg)
![Tests](https://img.shields.io/badge/tests-460%2B%20passing-2ea44f.svg)
![Runs locally](https://img.shields.io/badge/runs-100%25%20local-8a63d2.svg)

![The deck builder: card browser, deck and rating side by side](docs/screenshots/04-builder-lathril-b3.png)

</div>

Pick a commander and a bracket. Commander Forge builds a legal 100-card deck, shows you why each card is there, scores every other card in the format against *your* commander, and tells you what the deck is missing. Paste a deck you already own and it proposes swaps, one at a time, with the reason and the rating change.

It runs on your machine. Card data and about 66,000 card images are downloaded once; after that it works offline.

## What it does

- **Auto-build** a full deck from a commander and a target bracket, or **build by hand**, or lock the cards you love and let it **fill the rest**.
- **Score every card 0–100 for your commander.** The score moves as the deck changes: the tenth ramp spell is worth less than the first. Every score opens into its parts and plain-language reasons.
- **Rate the deck 0–100** across eight parts — mana base, role coverage, synergy, curve, interaction, win conditions, consistency, bracket fit — each with fixes you can click to see cards that solve them.
- **Improve an existing deck.** Import a list; get ordered swap proposals with the card going out, the card coming in, why, and what it does to the rating. Accept, reject, or apply all.
- **Commander rules, exactly.** Colour identity, singleton and its exceptions, every partner variant, Backgrounds, Doctor's companions, companions, Vehicles and Spacecraft as commanders, the Rulebreaker commanders, the banned list.
- **Bracket-aware.** Computes the minimum bracket the official rules force (Game Changers, mass land denial, extra turns, two-card combos), shows what "plays like" a higher bracket, and never suggests a card that breaks your target.
- **Themes from the commander's own text.** Tokens, counters, sacrifice, spellslinger, landfall, typal for any creature type and more, with sliders when you disagree.
- **Combos.** What your deck already contains and what is one card away.
- **Your collection.** Import a CSV or list, or add cards one by one by the set code and number printed at the bottom of the card (`TDM 123`) or by name; mark what you own, build from owned cards only.
- **Best from collection.** Ranks the commanders you own by the deck your own cards can build at a bracket, and shows how much better each gets with 5, 10, 15 or 20 purchases, with the buy list, its price, and one click to create the deck or proxy the buys.
- **Directed improve.** Tell an improve run what you want: change at most N cards, aim for another bracket, more win conditions, removal, card draw or ramp, or lean into one theme. Each swap says which goal it serves. "Add one" buttons suggest a single card of a kind with the card to cut for it, and each deck can set its own wanted counts (win conditions default to 4–6). When the engine thinks a change is not an improvement it still offers it, marked with its objection.
- **Proxies.** Put any card, the cards an improve run proposes, or the cards of a deck you do not own on a proxy list, then print true-size playtest sheets (63 × 88 mm, nine per A4 or US Letter page, cut marks, optional back faces and a "not for sale" label) or download the images as a zip.

<table>
<tr>
<td width="50%"><img src="docs/screenshots/14-improve-proposals.png" alt="Swap proposals for an imported deck"><br><sub>Improve: swap proposals with reasons and rating change</sub></td>
<td width="50%"><img src="docs/screenshots/07-card-detail.png" alt="Card detail with score breakdown"><br><sub>Every score explains itself</sub></td>
</tr>
<tr>
<td><img src="docs/screenshots/10-deck-list-view-bracket-panel.png" alt="Bracket panel"><br><sub>Bracket floor, violations and combos</sub></td>
<td><img src="docs/screenshots/02-new-commander-picker.png" alt="Commander picker"><br><sub>Pick from every legal commander</sub></td>
</tr>
</table>

## Download

No Node.js or anything else to install. Get the zip for your computer from the [latest release](https://github.com/Egecan33/mtg-commander-deck-builder/releases/latest):

| Computer | File |
|---|---|
| Mac with Apple Silicon (M1 and later) | `CommanderForge-<version>-macos-arm64.zip` |
| Mac with Intel | `CommanderForge-<version>-macos-x64.zip` |
| Windows 10/11 (x64) | `CommanderForge-<version>-windows-x64.zip` |

Unzip it and double-click `Commander Forge.command` (macOS) or `Commander Forge.bat` (Windows). A terminal window opens and the app opens in your browser.

- **First run** downloads card data (about 3 minutes, then the app opens) and about 66,000 card images in the background (~5 GB, ~40 minutes). Cards show without pictures until theirs arrive.
- **macOS** may say the developer is unidentified: right-click the file, choose **Open**, then **Open** again. Only needed once.
- **Windows SmartScreen** may warn you: click **More info**, then **Run anyway**.
- Your decks, settings, card data and images live in `~/Library/Application Support/Commander Forge` (macOS) or `%LOCALAPPDATA%\Commander Forge` (Windows). To update, download the new zip; your data is kept.

## Run from source

Requires Node 22+ and [pnpm](https://pnpm.io). About 6 GB of free disk space.

```bash
git clone https://github.com/Egecan33/mtg-commander-deck-builder.git
cd mtg-commander-deck-builder
pnpm install
pnpm sync all
pnpm build
pnpm start
```

Open <http://localhost:3210>.

`pnpm sync all` runs six steps. Rough numbers from a home connection:

| Step | What it fetches | Size | Time |
|---|---|---|---|
| `cards` | Scryfall oracle cards (one row per card) | 25 MB | seconds |
| `printings` | Scryfall default cards: set code and collector number of every paper printing | 81 MB | under a minute |
| `tags` | Scryfall Tagger function tags | 6 MB | seconds |
| `combos` | Commander Spellbook combo export | 32 MB | ~3 min |
| `features` | computed locally: roles, themes, mana info | — | seconds |
| `images` | two WebP sizes per card face | ~4.7 GB | ~40 min |

Everything lands in `data/`, which is gitignored. Run any step alone with `pnpm sync <step>`; all steps resume where they stopped.

**When Wizards updates the banned list or Game Changers:** run `pnpm sync cards tags features`. No list is hardcoded.

## How scoring works

A card's score answers one question: *how much does this card belong in this deck right now?*

| Part | Weight | Measures |
|---|---|---|
| Synergy | 35 | Does it feed or pay off what the commander cares about? |
| Co-play data | 15 | How often real decks with this commander run it (optional, see below) |
| Quality | 20 | Format-wide strength and efficiency for its job |
| Role need | 15 | Is the deck short on what this card does? |
| Castability and curve | 10 | Can your mana base cast it, and does it fit the curve? |
| Bracket fit | 5 | Is its power level right for the bracket you chose? |

Cards that cannot go in the deck — wrong colours, banned, over the copy limit, or breaking the bracket — score 0 and say why. Mana maths uses Frank Karsten's published source and land-count tables for 99-card decks.

The design document, with the reasoning behind every number, is in [`docs/superpowers/specs`](docs/superpowers/specs/2026-11-11-commander-deck-builder-design.md). The fact-checked research on rules, brackets and data sources is in [`docs/research`](docs/research).

## Optional: deck statistics from EDHREC

Off by default. When you turn it on (Card data page), selecting a commander fetches that commander's public statistics page from EDHREC, at most a couple of requests, cached for a week. Scores then also reflect what real decks play.

EDHREC has no public API and its terms of use do not permit automated queries. Turning this on is your decision and your responsibility. The app is fully usable without it.

## Development

```bash
pnpm dev          # http://localhost:3210 with reload
pnpm typecheck
pnpm test         # engine, server and ingest tests
pnpm e2e          # Playwright; needs a synced data/ directory
```

The engine in `src/engine` is pure TypeScript with no IO and is where most of the logic and tests live. [`AGENTS.md`](AGENTS.md) describes the layout, the invariants and how to work on it — for coding agents and for people.

Stack: Next.js, React, TypeScript, Tailwind, SQLite (better-sqlite3), Vitest, Playwright.

## Limits, honestly

- Scores are rule- and data-based heuristics, not a simulation. They are a strong second opinion, not a verdict.
- Brackets are about intent. The app reports the minimum bracket the hard rules force and an estimate of how the deck plays; Brackets 1 and 5 are yours to declare.
- Unusual one-of-a-kind mechanics may be read weakly from a commander's text; use the theme sliders.
- Desktop layout only. English cards only.

## Data and credits

This project ships no card images and no bulk data; it downloads them to your machine from the sources below. Please respect their terms.

- **[Scryfall](https://scryfall.com)** — card data, images and Tagger tags. Not affiliated with or endorsed by Scryfall.
- **[Commander Spellbook](https://commanderspellbook.com)** — combo data.
- **[EDHREC](https://edhrec.com)** — optional per-commander statistics, opt-in.
- **Frank Karsten** — mana base mathematics.

Commander Forge is unofficial Fan Content permitted under the Fan Content Policy. Not approved or endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. © Wizards of the Coast LLC. Card images in the screenshots are © Wizards of the Coast and their artists.

## License

[MIT](LICENSE) for the source code. Card data, images and third-party statistics are not covered by it.
