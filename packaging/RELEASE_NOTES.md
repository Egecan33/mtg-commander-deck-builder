Commander Forge builds, scores, rates and improves Magic: The Gathering Commander decks on your own computer. These downloads include their own Node.js, so there is nothing else to install.

**New in 2.2**
- "Read my whole Arena collection": a button on the Collection page (with MTG Arena selected) reads every card you own straight from the running game and replaces the MTG Arena collection with it, so cards that sit in no deck are no longer missed. It needs the optional [mtga-reader](https://github.com/mtgatool/mtga-reader) set up once (the README has the one command) and Arena open on its home screen. Only card numbers and counts are read, never your account. macOS asks for your password in its own window, unless you choose to set up the password-free way described in the README.

**New in 2.1**
- Best from collection can now rank the commanders you do not own: which ones your cards already build the best deck around, with the commander as the one card to get, and the usual 5, 10, 15 and 20-card tiers after that.
- A full Arena card list (`[{grpId, qty}]`, as trackers and memory readers give it) can be posted to `/api/arena` to replace the MTG Arena collection with the whole collection instead of what the log shows.
- MTG Arena sync fix: Arena's ready-made decks (starter decks, event loaners, championship lists) are no longer counted as cards you own. If you synced with 2.0, clear the MTG Arena collection once and sync again.

**New in 2.0**
- Several collections. "Physical" and "MTG Arena" are kept apart, and a switcher in the top bar picks the one that "owned" means everywhere: green dots, the owned filter, owned-only builds and Best from collection. Your existing collection becomes "Physical" with every quantity kept; decks are not touched.
- MTG Arena sync. If Arena is installed (macOS or Windows; standalone, Steam or Epic), the app reads Arena's own local files on start and on "Sync Arena". Nothing leaves your computer and your Wizards account is never used. It needs "Detailed Logs (Plugin Support)" switched on in Arena (Options, Account) and finds the cards in your decks and your draft and sealed pools, not cards that sit in no deck. The README says exactly what it can and cannot see.
- Export any collection as a CSV that imports back unchanged.
- Suggest swaps for one chosen deck card.

**Downloads**
- macOS Apple Silicon (M1 and later): `CommanderForge-<version>-macos-arm64.zip`
- macOS Intel: `CommanderForge-<version>-macos-x64.zip`
- Windows 10/11 (x64): `CommanderForge-<version>-windows-x64.zip`

**First run**
1. Unzip and double-click `Commander Forge.command` (macOS) or `Commander Forge.bat` (Windows).
2. The first start downloads card data (about 3 minutes, then the app opens in your browser) and card images in the background (about 5 GB, roughly 40 minutes).
3. macOS may say the developer is unidentified: right-click the file, choose Open, then Open again. Windows SmartScreen: More info, then Run anyway.

Your data is kept in `~/Library/Application Support/Commander Forge` (macOS) or `%LOCALAPPDATA%\Commander Forge` (Windows). To update, download the new zip; your data stays. See `READ ME FIRST.txt` in the zip.
