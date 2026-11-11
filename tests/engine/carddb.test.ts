import { describe, expect, it } from 'vitest';
import { createCardDb, normalizeName } from '@/engine/carddb';
import type { Card, Combo } from '@/engine/types';
import { imageRefs, meldResultNames, toCard } from '@/ingest/cards';

const legal = { commander: 'legal' };
const img = (side: string, id: string) => ({
  display: `https://cards.scryfall.io/display/${side}/${id}.webp`,
  grid: `https://cards.scryfall.io/grid/${side}/${id}.webp`,
});

const delver = {
  id: 'p-delver', oracle_id: 'o-delver', name: 'Delver of Secrets // Insectile Aberration', layout: 'transform',
  cmc: 1, type_line: 'Creature — Human Wizard // Creature — Human Insect', color_identity: ['U'],
  keywords: ['Flying', 'Transform'], legalities: legal, edhrec_rank: 9000, prices: { usd: '0.25' },
  card_faces: [
    { name: 'Delver of Secrets', mana_cost: '{U}', type_line: 'Creature — Human Wizard', oracle_text: 'At the beginning of your upkeep, look at the top card of your library.', colors: ['U'], power: '1', toughness: '1', image_uris: img('front', 'd') },
    { name: 'Insectile Aberration', mana_cost: '', type_line: 'Creature — Human Insect', oracle_text: 'Flying', colors: ['U'], power: '3', toughness: '2', image_uris: img('back', 'd') },
  ],
};
const fireIce = {
  id: 'p-fire', oracle_id: 'o-fire', name: 'Fire // Ice', layout: 'split', mana_cost: '{1}{R} // {1}{U}', cmc: 4,
  type_line: 'Instant // Instant', colors: ['R', 'U'], color_identity: ['R', 'U'], keywords: [], legalities: legal,
  prices: { usd: null, usd_foil: '1.50' }, image_uris: img('front', 'f'),
  card_faces: [
    { name: 'Fire', mana_cost: '{1}{R}', type_line: 'Instant', oracle_text: 'Fire deals 2 damage divided as you choose among one or two targets.' },
    { name: 'Ice', mana_cost: '{1}{U}', type_line: 'Instant', oracle_text: 'Tap target permanent.\nDraw a card.' },
  ],
};
const vault = {
  id: 'p-vault', oracle_id: 'o-vault', name: 'Lim-Dûl’s Vault'.replace('’', "'"), layout: 'normal', mana_cost: '{U}{B}', cmc: 2,
  type_line: 'Instant', oracle_text: 'Look at the top five cards of your library.', colors: ['U', 'B'], color_identity: ['B', 'U'],
  keywords: [], legalities: legal, edhrec_rank: 2500, prices: {}, image_uris: img('front', 'v'),
};
const solRing = {
  id: 'p-sol', oracle_id: 'o-sol', name: 'Sol Ring', layout: 'normal', mana_cost: '{1}', cmc: 1, type_line: 'Artifact',
  oracle_text: '{T}: Add {C}{C}.', colors: [], color_identity: [], keywords: [], produced_mana: ['C'], legalities: legal,
  edhrec_rank: 1, game_changer: false, prices: { usd: '1.20' }, image_uris: img('front', 's'),
};
const lotus = { ...solRing, id: 'p-lotus', oracle_id: 'o-lotus', name: 'Black Lotus', mana_cost: '{0}', cmc: 0, legalities: { commander: 'banned' } };
const artSeries = { ...delver, id: 'p-art', oracle_id: 'o-art', layout: 'art_series', legalities: { commander: 'not_legal' } };
const gisela = {
  id: 'p-gis', oracle_id: 'o-gis', name: 'Gisela, the Broken Blade', layout: 'meld', mana_cost: '{2}{W}{W}', cmc: 4,
  type_line: 'Legendary Creature — Angel Horror', oracle_text: 'Flying, first strike, lifelink', colors: ['W'], color_identity: ['W'],
  keywords: [], legalities: legal, prices: {}, image_uris: img('front', 'g'),
  all_parts: [
    { component: 'meld_part', name: 'Gisela, the Broken Blade' },
    { component: 'meld_result', name: 'Brisela, Voice of Nightmares' },
  ],
};
const brisela = { ...gisela, id: 'p-bri', oracle_id: 'o-bri', name: 'Brisela, Voice of Nightmares', mana_cost: '', cmc: 11 };

const must = (raw: unknown): Card => {
  const c = toCard(raw);
  if (!c) throw new Error('expected a card');
  return c;
};

describe('toCard', () => {
  it('joins the faces of a transform card and reports two image faces', () => {
    const c = must(delver);
    expect(c.oracleText).toBe('At the beginning of your upkeep, look at the top card of your library.\n//\nFlying');
    expect(c.imageFaces).toBe(2);
    expect(c.frontName).toBe('Delver of Secrets');
    expect(c.name).toBe('Delver of Secrets // Insectile Aberration');
    expect(c.manaCost).toBe('{U}');
    expect(c.frontTypeLine).toBe('Creature — Human Wizard');
    expect(c.colors).toEqual(['U']);
    expect(c.power).toBe('1');
    expect(c.faces).toHaveLength(2);
    expect(c.faces[1]).toMatchObject({ name: 'Insectile Aberration', oracleText: 'Flying', power: '3' });
    expect(c.priceUsd).toBe(0.25);
  });

  it('keeps one image for a split card and the combined mana cost', () => {
    const c = must(fireIce);
    expect(c.imageFaces).toBe(1);
    expect(c.manaCost).toBe('{1}{R} // {1}{U}');
    expect(c.cmc).toBe(4);
    expect(c.frontName).toBe('Fire');
    expect(c.oracleText).toContain('\n//\nTap target permanent.');
    expect(c.faces.map((f) => f.colors)).toEqual([['R', 'U'], ['R', 'U']]);
    expect(c.priceUsd).toBe(1.5); // falls back to the foil price
  });

  it('maps a single-faced card with no undefined fields', () => {
    const c = must(solRing);
    expect(c).toMatchObject({
      oracleId: 'o-sol', scryfallId: 'p-sol', name: 'Sol Ring', frontName: 'Sol Ring', layout: 'normal',
      manaCost: '{1}', cmc: 1, typeLine: 'Artifact', frontTypeLine: 'Artifact', oracleText: '{T}: Add {C}{C}.',
      producedMana: ['C'], legality: 'legal', gameChanger: false, edhrecRank: 1, imageFaces: 1, isMeldResult: false, power: null,
    });
    expect(c.faces).toHaveLength(1);
    expect(Object.values(c).includes(undefined)).toBe(false);
    expect(must(vault).priceUsd).toBeNull();
    expect(must(vault).edhrecRank).toBe(2500);
  });

  it('returns null for a not_legal card and keeps a banned one', () => {
    expect(toCard(artSeries)).toBeNull();
    expect(toCard({})).toBeNull();
    expect(must(lotus).legality).toBe('banned');
  });
});

describe('imageRefs and meldResultNames', () => {
  it('reads root images when present, otherwise one per face', () => {
    expect(imageRefs(solRing)).toEqual([{ face: 0, ...img('front', 's') }]);
    expect(imageRefs(fireIce)).toHaveLength(1);
    expect(imageRefs(delver)).toEqual([{ face: 0, ...img('front', 'd') }, { face: 1, ...img('back', 'd') }]);
    expect(imageRefs({})).toEqual([]);
  });
  it('collects meld results from all_parts', () => {
    expect([...meldResultNames([gisela, solRing])]).toEqual(['Brisela, Voice of Nightmares']);
  });
});

describe('createCardDb', () => {
  const cards = [delver, fireIce, vault, solRing, lotus, gisela, brisela].map(must);
  cards.find((c) => c.name.startsWith('Brisela'))!.isMeldResult = true;
  const combo: Combo = {
    id: '1-2', cards: [{ oracleId: 'o-sol', mustBeCommander: false }, { oracleId: 'o-vault', mustBeCommander: false }],
    requiresCount: 0, bracketTag: 'E', manaValueNeeded: 3, produces: ['Infinite mana'], popularity: 10,
  };
  const db = createCardDb(cards, [], [combo]);

  it('looks names up without regard to case, diacritics or apostrophe style', () => {
    expect(db.byName("lim-dul's vault")?.oracleId).toBe('o-vault');
    expect(db.byName('LIM-DÛL’S  VAULT')?.oracleId).toBe('o-vault');
    expect(normalizeName('  Lim-Dûl’s   Vault ')).toBe("lim-dul's vault");
  });

  it('accepts the front name or the full name of a multi-face card', () => {
    expect(db.byName('delver of secrets')?.oracleId).toBe('o-delver');
    expect(db.byName('Delver of Secrets // Insectile Aberration')?.oracleId).toBe('o-delver');
    expect(db.byName('Fire')?.oracleId).toBe('o-fire');
    expect(db.byName('Insectile Aberration')).toBeUndefined();
    expect(db.byName('No Such Card')).toBeUndefined();
  });

  it('keeps banned cards and meld results reachable but out of all()', () => {
    expect(db.get('o-lotus')?.legality).toBe('banned');
    expect(db.byName('Black Lotus')?.oracleId).toBe('o-lotus');
    expect(db.byName('Brisela, Voice of Nightmares')?.isMeldResult).toBe(true);
    expect(db.all().map((c) => c.oracleId).sort()).toEqual(['o-delver', 'o-fire', 'o-gis', 'o-sol', 'o-vault']);
    expect(db.get('missing')).toBeUndefined();
  });

  it('indexes combos by card and returns no features when none were given', () => {
    expect(db.combosFor('o-sol')).toEqual([combo]);
    expect(db.combosFor('o-vault')).toHaveLength(1);
    expect(db.combosFor('o-fire')).toEqual([]);
    expect(db.features('o-sol')).toBeUndefined();
  });
});
