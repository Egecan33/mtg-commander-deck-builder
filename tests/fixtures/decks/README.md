# Reference decklists

Real public 100-card Commander lists, fetched 2026-11-11. Format: a `Commander` header, the commander,
a blank line, a `Deck` header, then `<qty> <Scryfall name>` lines.

| File | Deck | Source |
|---|---|---|
| `precon.txt` | Temur Roar (Tarkir: Dragonstorm Commander, 2025-04-11), commander Eshki, Temur's Roar | MTGJSON `https://mtgjson.com/api/v5/decks/TemurRoar_TDC.json` |
| `upgraded.txt` | "It came from the woods", Lathril, Blade of the Elves; tagged Bracket 3 by its author | Archidekt deck 15073736 (`https://archidekt.com/api/decks/15073736/`) |
| `cedh.txt` | "[cEDH] Kinnan Lil' flips", Kinnan, Bonder Prodigy; tagged Bracket 5 by its author | Archidekt deck 26554156 (`https://archidekt.com/api/decks/26554156/`) |

Maybeboard and sideboard entries of the Archidekt lists were left out. `tests/engine/fixtures.test.ts`
checks that each list is exactly 100 cards known to the fixture database.
