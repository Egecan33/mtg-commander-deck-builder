import type { AxisId } from '../types';
import { creatureSubtypes, creatureTypeOfWord, typeMentions } from './creature-types';
import { hasRepeatableManaAbility } from './mana-info';
import { isManaProducer, isStax } from './roles';
import { hasKw, hasTag, repeatable, type Ctx } from './text';

/** Static theme axes. Typal axes are dynamic: `typal:<creature type>`, plus `typal` for any-type cards. */
export const AXES: { id: AxisId; label: string }[] = [
  { id: 'tokens', label: 'Tokens' },
  { id: 'counters', label: '+1/+1 counters' },
  { id: 'sacrifice', label: 'Sacrifice / aristocrats' },
  { id: 'graveyard', label: 'Graveyard / reanimator' },
  { id: 'spellslinger', label: 'Spellslinger' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'enchantments', label: 'Enchantments' },
  { id: 'attachments', label: 'Equipment / auras' },
  { id: 'auras', label: 'Auras' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'voltron', label: 'Voltron' },
  { id: 'landfall', label: 'Lands matter' },
  { id: 'lifegain', label: 'Lifegain' },
  { id: 'blink', label: 'Blink / ETB' },
  { id: 'attack', label: 'Attack triggers' },
  { id: 'evasion', label: 'Combat damage / ninjutsu' },
  { id: 'defender', label: 'Defenders / toughness' },
  { id: 'wheels', label: 'Wheels / draw matters' },
  { id: 'discard', label: 'Discard' },
  { id: 'mill', label: 'Mill' },
  { id: 'treasure', label: 'Treasure / Food / Clue' },
  { id: 'stax', label: 'Stax' },
  { id: 'group-hug', label: 'Group hug' },
  { id: 'extra-combat', label: 'Extra combat' },
  { id: 'big-mana', label: 'Big mana / X spells' },
  { id: 'legends', label: 'Legends / historic' },
  { id: 'energy', label: 'Energy' },
  { id: 'poison', label: 'Poison / infect' },
  { id: 'typal', label: 'Typal (any type)' },
];

const STATIC_LABEL = new Map(AXES.map((a) => [a.id, a.label]));

/** Display label for any axis id, including dynamic typal ones. */
export function axisLabel(id: AxisId): string {
  const known = STATIC_LABEL.get(id);
  if (known) return known;
  if (id.startsWith('typal:')) {
    const type = id.slice(6);
    return `${type.replace(/(^|[\s-])\w/g, (ch) => ch.toUpperCase())} typal`;
  }
  return id;
}

export interface AxisSignal {
  e: number; // enabler strength from rules text, keywords and tags
  p: number; // payoff strength from rules text, keywords and tags
  memberE: number; // enabler strength the card has just by being what it is (an artifact, a legend, an Elf)
  memberP: number; // payoff strength it has just by being what it is (a creature with an enters trigger)
}

type Side = 'e' | 'p' | 'b'; // b = both (axes without a separate payoff, e.g. stax)
interface Rule {
  axis: AxisId;
  side: Side;
  s: number;
  member?: true;
  when: (c: Ctx) => boolean;
}

const re = (pattern: RegExp) => (c: Ctx) => pattern.test(c.t);
const rep = (pattern: RegExp) => (c: Ctx) => repeatable(c, pattern);
const tag = (...slugs: string[]) => (c: Ctx) => hasTag(c, ...slugs);
const kw = (...kws: string[]) => (c: Ctx) => hasKw(c, ...kws);
const any = (...fns: ((c: Ctx) => boolean)[]) => (c: Ctx) => fns.some((f) => f(c));
const all = (...fns: ((c: Ctx) => boolean)[]) => (c: Ctx) => fns.every((f) => f(c));
const not = (f: (c: Ctx) => boolean) => (c: Ctx) => !f(c);
const typeIs = (pattern: RegExp) => (c: Ctx) => pattern.test(c.type);

const CREATURE_TOKEN = /create[sd]?\b[^.\n]*(creature tokens?|tokens? that(?:'s| are) (a )?cop(y|ies)|\bcop(y|ies) of[^.\n]*token)|\bamass\b|\bincubate\b|\bpopulate\b/;
/** A token made for someone else (Beast Within, Forbidden Orchard, Hunted Horror) does not enable your token deck. */
const GIVEN_AWAY = /(its controller|their controller|that player|target opponent|each opponent|an opponent|that (permanent|spell|creature)'s controller|its owner|target player|each other player|defending player) creates?\b/;
const makesOwnTokens = (c: Ctx) => c.t.split(/[.\n]/).some((sentence) => CREATURE_TOKEN.test(sentence) && !GIVEN_AWAY.test(sentence));
const MANY_TOKENS = /create[sd]? (two|three|four|five|six|seven|eight|ten|x|that many|a number of|twice)\b[^.\n]*tokens?|for each[^.\n]*create|create[^.\n]*tokens?[^.\n]*for each/;
const UTILITY_TOKEN = /create[sd]?\b[^.\n]*\b(treasure|food|clue|blood|map|gold|powerstone|junk)\b tokens?|\binvestigate\b/;
const PP_ON = /put[s]? [^.\n]*\+1\/\+1 counters? on|enters? with [^.\n]*\+1\/\+1 counters?|\b(bolster|support|adapt|amass|fabricate|mentor|reinforce|outlast)\b/;
const PP_ON_OTHERS = /put[s]? [^.\n]*\+1\/\+1 counters? on (each|target|another|up to|any number|a creature|one or more|x target|two target|it\b|that creature|them)|distribute [^.\n]*\+1\/\+1 counters|\+1\/\+1 counters? on each|(creatures?|[a-z]+s?) you control enters? with (an additional|x additional|a|two|that many)[^.\n]*\+1\/\+1 counters?/;
const SAC_OUTLET = /sacrifice (a|an|another|one or more|x|two|three|any number of) (other )?(nontoken )?(creatures?|permanents?|artifacts? or creatures?|creatures? or artifacts?|tokens?)\b/;
/**
 * Rewards for your own creatures dying or being sacrificed. Not: a creature an opponent controls
 * dying (Massacre Wurm, see `OPP_DEATH_PAYOFF`), sacrificing a Clue, Treasure or Food (Tireless
 * Tracker: the `treasure` axis), or counters moving off a creature that left (The Ozolith).
 */
const DEATH_PAYOFF = /creature dying causes|whenever ((~|this creature) or )?(a|another|one or more|a nontoken|another nontoken) (other )?(nontoken )?(creatures?|permanents?|creature tokens?|artifacts? or creatures?)( or \w+)?( you control)?( with [^.\n,]*)? (dies|die|is put into|are put into)|whenever ((~|this creature) or another creature|a creature you control|another creature you control|a creature)( with [^.\n,]*)? (dies|is put into a graveyard)|whenever you sacrifice (?!an? (clue|treasure|food|land|blood|map|powerstone)\b)|whenever a player sacrifices|creatures? died this turn|whenever (a|another|one or more) (creatures?|permanents?) you control (leave|leaves) the battlefield(?!, if it had counters)/;
const OPP_DEATH_PAYOFF = /whenever (a|another|one or more) (nontoken )?creatures? (an opponent controls|your opponents control) (dies|die)/;
const REANIMATE = /(return|put) [^.\n]*(creature|permanent|artifact|planeswalker|enchantment)s? cards?[^.\n]* from (your|a|any|all|each player's|target player's|an opponent's) graveyards?[^.\n]* (to|onto) the battlefield/;
/** "Put it onto the battlefield under your control" is reanimation only when the card came from a graveyard, not from exile (a flicker). */
const REANIMATE_IT = /(return|put) (it|that card|them|those cards) (to|onto) the battlefield[^.\n]*under your control/;
const FROM_YARD = /from your graveyard|\b(flashback|escape|unearth|embalm|eternalize|encore|disturb|delve|dredge|retrace|jump-start|aftermath)\b|cards? in your graveyard|threshold|delirium|undergrowth|descend/;
const SELF_MILL = /\bmills? (a card|two|three|four|five|six|seven|x|that many) ?(cards)?|put the top [^.\n]* of your library into your graveyard|\bsurveil\b|\bdredge\b|search your library for [^.\n]*put (it|that card|them|one of them) into your graveyard/;
const SPELL_PAYOFF = /whenever you cast (an?|your (first|second)) (instant|sorcery|noncreature|instant or sorcery|instant, sorcery|non-?creature)[^.\n]*spell|whenever you cast or copy an instant or sorcery|\bmagecraft\b|instant (and|or) sorcery (spells|cards)|instant and sorcery spells you cast|copy (target|that|the next) (instant|sorcery|instant or sorcery|spell)|whenever you cast a noncreature spell|for each instant and sorcery|whenever a player casts an? (instant|sorcery|instant or sorcery|noncreature) spell|(cast|play) [^.\n]*instant (and|or|and\/or) sorcery (spells?|cards?) from your graveyard|instant (and|or|and\/or) sorcery cards? (in|from) your graveyard/;
const ARTIFACT_PAYOFF = /artifacts you control|whenever (an?|one or more|another) (nontoken )?artifacts? (you control )?(enters|is put|are put|leaves)|for each artifact|number of artifacts|artifact spells?( you cast)?|whenever you cast an artifact|\bmetalcraft\b|\baffinity for artifacts\b|\bimprovise\b|sacrifice (an|another|two|three|x) artifacts?|artifact creatures? you control|each artifact (creature )?you control|artifact (card|creature card)s? from your graveyard|tap (an|two|three) untapped artifacts? you control|noncreature artifacts/;
const ENCHANT_PAYOFF = /enchantments you control|whenever (an?|one or more|another) (nontoken )?enchantments? (you control )?(enters|is put|are put)|for each enchantment|number of enchantments|enchantment spells?( you cast)?|whenever you cast an enchantment|\bconstellation\b|\beerie\b|enchantment cards? from your graveyard/;
const ATTACH_PAYOFF = /whenever you cast an? (aura|equipment)|(aura|equipment)s? (and|or|and\/or) (aura|equipment)s?|for each (aura|equipment)|(aura|equipment) (spells?|cards?)|whenever (an?|one or more) (aura|equipment)s?|(auras|equipment) you control|is (enchanted|equipped)\b|(enchanted|equipped) creatures? you control|attach (it|them|target equipment|any number)|equip (abilities|costs?)|\bmodified\b|\breconfigure\b|search your library for an? (aura|equipment)/;
const AURA_PAYOFF = /whenever you cast an? aura|auras?,? (and |or |and\/or )?equipment|equipment,? (and |or |and\/or )?auras?|for each aura|aura (spells?|cards?)|whenever (an?|one or more) auras?|auras you control|is enchanted\b|enchanted creatures? you control|search your library for an? (equipment or )?aura|auras? attached|aura or equipment/;
const EQUIP_PAYOFF = /whenever you cast an? equipment|auras?,? (and |or |and\/or )?equipment|equipment,? (and |or |and\/or )?auras?|for each equipment|equipment (spells?|cards?)|whenever (an?|one or more|~ or another) equipment|equipment you control|is equipped\b|equipped creatures? you control|attach (target equipment|any number of equipment)|equip (abilities|costs?)|search your library for an? (aura or )?equipment|equipment attached|equipment or aura/;
const isEquipment = (c: Ctx) => /\bequipment\b/.test(c.type);
const isBuffAura = (c: Ctx) => /\baura\b/.test(c.type) && /enchant (creature|permanent)/.test(c.t) && !hasTag(c, 'pacifism', 'removal-aura', 'parasitic-aura', 'lockdown-creature');
const DEFENDER_PAYOFF = /with defender|toughness rather than (its|their) power|as though (it|they) didn't have defender|toughness greater than (its|their) power/;
/** A list of card types ("an artifact, creature, enchantment, land, or planeswalker") names no one of them as a theme. */
const TYPE_LIST = /(artifact|creature|land|instant), (creature, |enchantment, |land, |instant, )*(enchantment|artifact)(,| or| and)/;
const LANDFALL = /\blandfall\b|whenever (a|one or more) lands? (you control )?enters?|whenever a land enters the battlefield under your control/;
const LAND_PAYOFF = /for each land you control|number of lands you control|lands? (card|cards) from your graveyard|play lands from your graveyard|whenever you (sacrifice|play) a land|lands you control (are|become)|whenever (a|one or more) lands?( cards?)? (is|are) put into (your|a) graveyard/;
const EXTRA_LAND = /you may play (an|two|three|x|up to \w+) additional lands?|put (a|up to \w+|x|any number of|two|that many) (basic )?lands? cards? [^.\n]*(from your hand|from among them|onto the battlefield)|search your library for [^.\n]*(land|forest|plains|island|swamp|mountain)[^.\n]*put (it|them|that card|those cards|one)[^.\n]*onto the battlefield|return [^.\n]*land cards? from your graveyard/;
const LIFE_PAYOFF = /whenever you gain life|if you (gained|would gain) life|life you('ve)? gained|gained (\w+) or more life|if you would gain life|for each 1 life you gained|whenever you gain or lose life|you have (\d+|\w+) or more life( more)? than/;
const LIFE_GAIN = /\byou gain (x|\d+|that much|life equal|twice)|\blifelink\b|gains? (x|\d+|that much) life|you gain life/;
const FLICKER = /exile (another |up to \w+ |any number of |one or more |x )?(other )?(target|another|all|each|that|any number of)[^.\n]*(creatures?|permanents?|artifacts?)[^.\n]*(, then |\. ?)return (it|that card|them|those cards|the exiled cards?)[^.\n]* to the battlefield|exile[^.\n]*\. return (it|that card|them|those cards|the exiled card) to the battlefield under (its|their) owner's control|\bflicker\b|exile (it|~|this creature|them), then return (it|them|~)[^.\n]* to the battlefield/;
/** Anything of yours entering triggers again: the payoff a blink deck is built around. */
const ETB_DOUBLE = /enter(s|ing)?\b[^.\n]*triggers? an additional time/;
/**
 * Watches creatures or permanents enter (Soul Warden, Guardian Project). Pays off a blink deck, and
 * a token deck just as well, so it is the weaker signal. Not: a watcher of one card type (Hammer of
 * Nazahn: Equipment) or of permanents entering tapped (Amulet of Vigor).
 */
const ETB_WATCH = /whenever (~|this creature) or another (nontoken )?(creature|permanent)[^.\n]*? enters(?! tapped)|whenever (a|another|one or more|a nontoken|another nontoken) (other )?(nontoken )?(creatures?|permanents?|artifacts? or creatures?)( you control)? enters?(?! tapped)( the battlefield)?( under your control)?/;
/** Rewards for attacking. Rewards for connecting ("deals combat damage to a player") are the `evasion` axis. */
const TEAM_ATTACK = /creature attacking causes|whenever (a|another|one or more) [\w-]+( [\w-]+)? you control attacks|whenever (a|one or more|another|two or more|three or more) (other )?(nontoken )?(creatures?|\w+s?) (you control )?(attacks?|attack)\b|whenever you attack|whenever one or more creatures you control attack|attacking creatures you control|each creature that attacked|\b(battle cry|melee|myriad|raid)\b|whenever a creature you control attacks/;
/**
 * "Whenever one or more Dragons you control attack" rewards Dragons, not attacking in general: the
 * trigger is left to the typal axis and only an untyped one makes a card an attack payoff.
 */
const TYPED_TRIGGER = /[Ww]henever (?:a|an|another|one or more) (?:nontoken )?([A-Z][a-z]+(?:-[A-Z][a-z]+)?) (?:you control )?(?:attacks?|deals? combat damage)[^.\n]*/g;
const teamAttack = (c: Ctx) => TEAM_ATTACK.test(c.raw.replace(TYPED_TRIGGER, (m, word: string) => (creatureTypeOfWord(word) ? '' : m)).toLowerCase());
const SELF_ATTACK = /whenever (~|this creature|equipped creature|enchanted creature) (attacks|deals combat damage to (a player|an opponent))|whenever (~|this creature) (and at least|attacks and)/;
const TEAM_EVASION = /creatures you control (have|gain|get)[^.\n]*(haste|flying|menace|trample|double strike|first strike|can't be blocked)|creatures you control can't be blocked|goad/;
/** Any of your creatures connecting pays off (Yuriko, Edric, Coastal Piracy), as opposed to one creature's own trigger. */
const TEAM_SABOTEUR = /whenever (a|another|one or more) ([\w-]+ ){0,3}(you control )?deals? combat damage to (a player|an opponent|one of your opponents|one or more)|whenever one or more creatures you control deal combat damage|creatures you control[^.\n]*deals? combat damage to a player/;
const UNBLOCKABLE = /can't be blocked(?! by more| except by two)/;
const SELF_SABOTEUR = /whenever (~|this creature|equipped creature|enchanted creature) deals combat damage to (a player|an opponent)/;
const EVASION_KW = ['flying', 'shadow', 'fear', 'intimidate', 'horsemanship'] as const;
const evasive = (c: Ctx) => hasKw(c, ...EVASION_KW) || new RegExp(`^(~|this creature) ${UNBLOCKABLE.source}`, 'm').test(c.front) || hasTag(c, 'unblockable');
const DRAW_PAYOFF = /whenever you draw (a card|your second card|one or more cards|cards)|whenever (an opponent|a player) draws|for each card (you've )?drawn|cards? you've drawn this turn|if you('ve| have) drawn|draw your second card|whenever you draw/;
const WHEEL = /each player (discards their hand|shuffles their hand)[^.\n]*draws?|discards? (your|their) hand,? (then|and) draws?|each player draws (two|three|four|five|seven|x|that many) cards|shuffles? (your|their) hand and graveyard into/;
const DISCARD_PAYOFF = /whenever (you|a player|an opponent|one or more players|each opponent)[^.\n]* discards?|\bmadness\b|whenever you (cycle|discard)|discarded this turn|if you (have no cards in hand|discarded)|\bhellbent\b|whenever you cycle or discard|whenever one or more cards are discarded/;
const MAKE_DISCARD = /(target (player|opponent)|each (player|opponent)|that player|defending player) discards?|discards? (a card|two cards|x cards) at random|each opponent discards/;
const SELF_DISCARD = /discard (a|two|three|x|your|any number of) (cards?|hand)|\b(cycling|connive|rummage|loot)\b|draw (a|two|three) cards?, then discard/;
const MILL_OPP = /(target (player|opponent)|each (player|opponent)|that player|defending player|opponents?) mills?\b|puts? the top [^.\n]* of (their|that player's|target player's) library into (their|that player's) graveyard|each opponent mills/;
const MILL_PAYOFF = /whenever (a|one or more) (creature |nonland |land )?cards? (is|are) put into (a|an opponent's|your|their) graveyard from (a|their|your|anywhere)|whenever (a player|an opponent|you|one or more players) mills?|cards? in (your )?opponents' graveyards?|in each opponent's graveyard|would mill|was milled|cards? milled this way|can't draw from an empty/;
const UTILITY_PAYOFF = /whenever you sacrifice (a|an|one or more) (treasure|food|clue|token|artifact)|(treasures?|foods?|clues?) you control|for each (treasure|food|clue)|sacrifice (a|two|three|x) (treasures?|foods?|clues?)|whenever you (create|sacrifice) (a|one or more) (treasure|food|clue)|whenever you create or sacrifice a token|treasures? (are|is) |if you would create (one or more )?(treasure|tokens)/;
const GROUP_HUG = /each player (draws|may draw|may put|creates|gains|adds|may search|untaps|may play)|each opponent (draws|creates|may draw)|at the beginning of each player's (draw step|upkeep|end step), that player (draws|may|creates|adds|puts)|whenever a player taps a land for mana, that player adds|each other player (draws|creates|gains)|target opponent (draws|creates|gains control)|players? may play (an additional|two additional) land/;
const EXTRA_COMBAT = /additional combat phase|untap all (attacking )?creatures (you control|that attacked)[^.\n]*combat|after this (phase|combat)[^.\n]*additional/;
const X_COST = (c: Ctx) => /\{x\}/i.test(c.card.manaCost ?? '');
const BIG_PAYOFF = /\{x\}[^:\n]*:|for each mana|mana (spent|you spent) to cast|you don't lose (unspent|this) mana|costs? \{x\}|with mana value (6|7|8|x) or greater|power (5|6|7) or greater/;
const MANA_DOUBLE = /whenever (you tap|a player taps) (a|an) ([\w-]+ )?(land|permanent|forest|swamp|island|mountain|plains|creature)[^.\n]*for mana[^.\n]*adds?( an additional| one additional| twice)?|produces? (twice|three times) as much|add (x|an amount of) mana|add \{[wubrgc]\} for each|adds? [^.\n]*mana[^.\n]* for each|double the amount of[^.\n]*mana/;
const LEGEND_PAYOFF = /legendary (creature|permanent|spell|artifact|card|land|sorcery)s?( spells?)?( you (control|cast))?|\bhistoric\b|whenever you cast a legendary|for each legendary|legendary (creatures?|permanents?) you control|\bsagas?\b[^.\n]*(you control|lore counter)|lore counters?/;
const ENERGY_GET = /you get [^.\n]*\{e\}/;
const ENERGY_USE = /pay [^.\n]*\{e\}|for each \{e\}|energy counters? you have|whenever you get one or more \{e\}/;
const POISON = /\b(infect|toxic|poisonous)\b|poison counters?|\bcorrupted\b/;
const PROLIFERATE = /\bproliferate\b/;
const COUNTER_PAYOFF = /(?<!enters )(?<!enter )(?<!and )with (a |one or more )?\+1\/\+1 counters? on (it|them)|for each \+1\/\+1 counter|number of \+1\/\+1 counters|(\+1\/\+1 )?counters (would be|are) (put|placed) on|\+1\/\+1 counter (would be|is) (put|placed) on|whenever (you put )?one or more (\+1\/\+1 )?counters? (are put|on)|twice that many[^.\n]*counters|that many plus (one|two)[^.\n]*counters|\bmove (a|any number of|x|one or more) [^.\n]*counters?|double the number of[^.\n]*counters|remove (a|x|two|any number of) \+1\/\+1 counters? from (a|another|target|among)|each creature you control with a \+1\/\+1 counter|has a \+1\/\+1 counter on it|modified creatures?/;
const TOKEN_PAYOFF = /tokens? you control (get|have|gain|gets|has)|for each (creature )?tokens?|number of (creature )?tokens|whenever (a|one or more|another) (creature |nontoken )?tokens? (you control )?(enters?|is created|leaves?|dies|die|are created)|whenever you create (a|one or more) (creature )?tokens?|would create (one or more )?(creature )?tokens?|tokens? would be created|twice that many[^.\n]*tokens|that many plus (one|two)[^.\n]*tokens|\bpopulate\b|create a token that's a copy of (target|another|each|a) [^.\n]*token|sacrifice (a|two|x|any number of) (creature )?tokens?|creature tokens you control|tokens? (enters?|entering) (the battlefield )?under your control/;
const GO_WIDE = /creatures you control get \+[\dx]\/\+[\dx]|for each (other )?creature you control|number of creatures you control|other creatures you control get \+|whenever (a|another|one or more) (other )?(nontoken )?creatures? (you control )?enters?( the battlefield)?( under your control)?\b|for each (other )?(attacking|tapped) creature( you control)?/;
const VOLTRON_PAYOFF = /commander (deals|dealt) combat damage|combat damage dealt by (a |your )?commanders?|(auras?|equipment) attached to (~|this creature|it)|as long as (~|this creature) is (enchanted|equipped)|for each (aura|equipment) (and (aura|equipment) )?(attached|you control)|whenever (~|this creature) becomes (enchanted|equipped)|equipped creature you control|enchanted creature you control|each (aura|equipment) (you control )?attached/;
const VOLTRON_ENABLE = /(equipped|enchanted) creature (gets \+[2-9x]\/|has (double strike|hexproof|protection|flying and|trample and|indestructible)|gets \+\d\/\+\d and has)|target creature (you control )?gains? (double strike|protection from|hexproof)[^.\n]*until end of turn/;
const STAX_HINT = /costs? \{\d\} more to (cast|activate)|can't (cast|attack|untap|activate)|don't untap|enters? tapped|skip (their|your) (untap|draw)/;

const RULES: Rule[] = [
  // tokens
  { axis: 'tokens', side: 'e', s: 1, when: all(makesOwnTokens, any(rep(CREATURE_TOKEN), tag('repeatable-creature-tokens'))) },
  { axis: 'tokens', side: 'e', s: 0.7, when: any(all(makesOwnTokens, re(MANY_TOKENS)), all(makesOwnTokens, tag('multiple-bodies')), kw('fabricate', 'afterlife', 'squad', 'myriad', 'encore', 'offspring')) },
  { axis: 'tokens', side: 'e', s: 0.4, when: any(makesOwnTokens, kw('amass', 'incubate', 'embalm', 'eternalize', 'living weapon', 'for mirrodin!')) },
  { axis: 'tokens', side: 'p', s: 1, when: any(re(TOKEN_PAYOFF), tag('token-doubler', 'token-increaser', 'synergy-token', 'synergy-token-creature')) },
  { axis: 'tokens', side: 'p', s: 0.6, when: any(re(GO_WIDE), all(tag('anthem'), not(tag('typal'))), tag('overrun'), kw('convoke')) },
  // +1/+1 counters
  { axis: 'counters', side: 'e', s: 1, when: any(all(re(PP_ON_OTHERS), rep(PP_ON_OTHERS)), all(tag('repeatable-pp-counters'), tag('gives-pp-counters'))) },
  { axis: 'counters', side: 'e', s: 0.7, when: any(re(PP_ON_OTHERS), tag('gives-pp-counters', 'gives-pp-counters-to-all'), kw('mentor', 'support', 'bolster', 'fabricate', 'backup', 'training')) },
  { axis: 'counters', side: 'e', s: 0.4, when: any(re(PP_ON), tag('gains-pp-counters'), kw('adapt', 'evolve', 'outlast', 'riot', 'modular', 'graft', 'bloodthirst', 'unleash', 'monstrosity', 'renown', 'scavenge', 'undying', 'explore')) },
  { axis: 'counters', side: 'p', s: 1, when: any(re(PROLIFERATE), re(COUNTER_PAYOFF), kw('proliferate'), tag('pp-counters-matter', 'counter-doubler', 'counter-increaser', 'repeatable-proliferate', 'move-counters')) },
  // sacrifice
  { axis: 'sacrifice', side: 'e', s: 1, when: any(all(re(SAC_OUTLET), rep(SAC_OUTLET)), tag('free-sacrifice-outlet'), all(tag('repeatable-sacrifice-outlet'), tag('sacrifice-outlet-creature'))) },
  { axis: 'sacrifice', side: 'e', s: 0.6, when: any(all(re(SAC_OUTLET), not(re(/(target|each) (opponent|player)[^.\n]*sacrifices/))), tag('sacrifice-outlet-creature'), kw('exploit', 'devour', 'emerge', 'casualty', 'bargain')) },
  { axis: 'sacrifice', side: 'p', s: 0.5, when: re(OPP_DEATH_PAYOFF) },
  { axis: 'sacrifice', side: 'p', s: 1, when: any(re(DEATH_PAYOFF), tag('sacrifice-matters', 'your-sacrifice-matters'), all(tag('death-trigger'), not(tag('death-trigger-self')), re(/whenever (a|another|one or more)[^.\n]*(dies|die)\b/), not(re(/dealt damage by/)), not(re(OPP_DEATH_PAYOFF))), kw('morbid')) },
  // graveyard
  { axis: 'graveyard', side: 'e', s: 1, when: any(all(re(SELF_MILL), rep(SELF_MILL)), tag('repeatable-mulch', 'repeatable-surveil'), re(/search your library for [^.\n]*put (it|that card|them|one of them) into your graveyard|search your library for [^.\n]*\. put [^.\n]*(the other|the rest) into your graveyard/), kw('dredge')) },
  { axis: 'graveyard', side: 'e', s: 0.6, when: any(re(SELF_MILL), tag('mill-self', 'mulch', 'graveyard-fuel-self', 'free-discard-outlet', 'repeatable-loot', 'repeatable-rummage')) },
  // Looting is how reanimator decks fill the graveyard (Faithless Looting, Careful Study).
  { axis: 'graveyard', side: 'e', s: 0.5, when: any(tag('loot', 'rummage', 'discard-outlet', 'surveil'), re(/draw (a|two|three|four) cards?, then discard|discard (a|two|three) cards?(, then|\.\n?) ?draw/)) },
  { axis: 'graveyard', side: 'p', s: 1, when: any(re(REANIMATE), all(re(REANIMATE_IT), re(/graveyard/), not(re(FLICKER))), tag('reanimate-creature', 'reanimate-permanent', 'mass-reanimation', 'reanimate-artifact', 'cards-in-graveyard-matter', 'gives-castable-from-graveyard', 'lhurgoyf', 'undergrowth', 'leaving-graveyard-matters', 'card-types-in-graveyard-matter'), kw('delirium', 'undergrowth')) },
  // Delve and threshold use the graveyard up or just count it (Treasure Cruise, Cabal Ritual): they fit the deck, they are not its payoff.
  { axis: 'graveyard', side: 'p', s: 0.6, when: any(tag('threshold'), kw('delve', 'threshold')) },
  { axis: 'graveyard', side: 'p', s: 0.6, when: any(tag('regrowth', 'recursion-creature', 'recursion-permanent', 'recursion-any', 'gives-castable-from-graveyard'), re(/cards? in your graveyard|(cast|play) [^.\n]*from your graveyard|(two|three|x|any number of) (creature |permanent |instant or sorcery )?cards? from (a |your |any |all )?graveyards?|as long as (~|this card) is in your graveyard/), kw('escape')) },
  { axis: 'graveyard', side: 'p', s: 0.4, when: any(re(FROM_YARD), kw('unearth', 'embalm', 'eternalize', 'encore', 'disturb')) },
  { axis: 'graveyard', side: 'p', s: 0.3, when: any(kw('flashback', 'jump-start', 'retrace', 'aftermath'), re(/return (~|this card) from your graveyard/)) },
  // spellslinger
  { axis: 'spellslinger', side: 'e', s: 0.5, member: true, when: (c) => c.isSpell },
  // A card that taxes or eats other players' spells (Deathrite Shaman) carries the synergy tags without rewarding yours.
  { axis: 'spellslinger', side: 'p', s: 1, when: any(re(SPELL_PAYOFF), all(tag('synergy-instant', 'synergy-sorcery'), not(tag('hate-instant', 'hate-sorcery', 'hate-noncreature'))), tag('copy-instant', 'copy-sorcery', 'cost-reducer-instant', 'prowess-like', 'second-spell-matters'), kw('storm', 'magecraft')) },
  { axis: 'spellslinger', side: 'p', s: 0.7, when: any(tag('synergy-noncreature', 'copy-spell'), re(/whenever you cast (a spell(?! with| that| from| of)|your (first|second) spell)|(^|\n)(instant and sorcery |noncreature )?spells you cast cost|second spell (each|this) turn/)) },
  { axis: 'spellslinger', side: 'p', s: 0.3, when: kw('prowess') },
  // artifacts
  { axis: 'artifacts', side: 'e', s: 0.5, member: true, when: typeIs(/\bartifact\b/) },
  { axis: 'artifacts', side: 'e', s: 0.9, when: any(tag('repeatable-artifact-tokens'), all(re(/create[sd]?\b[^.\n]*\bartifact\b[^.\n]*tokens?/), rep(/create[sd]?\b[^.\n]*\bartifact\b[^.\n]*tokens?/)), all(re(UTILITY_TOKEN), rep(UTILITY_TOKEN))) },
  { axis: 'artifacts', side: 'e', s: 0.6, when: any(re(/create[sd]?\b[^.\n]*\bartifact\b[^.\n]*tokens?/), re(UTILITY_TOKEN), re(/search your library for an? (enchantment or )?artifact/), kw('fabricate')) },
  { axis: 'artifacts', side: 'p', s: 1, when: any(re(ARTIFACT_PAYOFF), tag('synergy-artifact', 'artifact-count-matters', 'artifactfall', 'metalcraft', 'affinity-for-artifacts', 'recursion-artifact', 'cranial-plating'), kw('improvise', 'metalcraft', 'affinity')) },
  { axis: 'artifacts', side: 'p', s: 0.6, when: re(/\bhistoric\b/) },
  // enchantments
  { axis: 'enchantments', side: 'e', s: 0.5, member: true, when: typeIs(/\benchantment\b/) },
  { axis: 'enchantments', side: 'e', s: 0.9, when: rep(/search your library for an? (artifact or )?(enchantment|aura)/) },
  { axis: 'enchantments', side: 'e', s: 0.6, when: any(re(/search your library for an? (artifact or )?(enchantment|aura)/), re(/create[sd]?\b[^.\n]*\benchantment\b[^.\n]*tokens?/)) },
  // The Tagger tag is broad: it also sits on cards that list every card type (Braids, Cloud Key) and on Aura-only payoffs (Sram).
  { axis: 'enchantments', side: 'p', s: 1, when: any(re(ENCHANT_PAYOFF), all(tag('synergy-enchantment'), re(/\benchantments?\b/), not(re(TYPE_LIST))), tag('enchantmentfall', 'recursion-enchantment'), kw('constellation', 'eerie')) },
  { axis: 'enchantments', side: 'p', s: 0.6, when: all(tag('synergy-enchantment'), re(/\bauras?\b/), not(re(TYPE_LIST))) },
  // equipment / auras
  { axis: 'attachments', side: 'e', s: 0.6, member: true, when: (c) => isEquipment(c) || isBuffAura(c) },
  { axis: 'attachments', side: 'p', s: 1, when: any(re(ATTACH_PAYOFF), tag('synergy-equipment', 'synergy-aura', 'quick-equip', 'auto-equip', 'synergy-modified')) },
  // Auras alone, Equipment alone: a commander that names one kind has no use for the other (Light-Paws; Nahiri).
  { axis: 'auras', side: 'e', s: 0.6, member: true, when: isBuffAura },
  { axis: 'auras', side: 'p', s: 1, when: all(not(isEquipment), any(re(AURA_PAYOFF), tag('synergy-aura'))) },
  { axis: 'equipment', side: 'e', s: 0.6, member: true, when: isEquipment },
  { axis: 'equipment', side: 'p', s: 1, when: all(not((c: Ctx) => /\baura\b/.test(c.type)), any(re(EQUIP_PAYOFF), tag('synergy-equipment', 'quick-equip', 'auto-equip'), all(isEquipment, re(/attach (it|~|this equipment) to/)))) },
  // voltron
  { axis: 'voltron', side: 'e', s: 0.7, when: all(re(VOLTRON_ENABLE), not(tag('pacifism', 'removal-aura', 'parasitic-aura'))) },
  { axis: 'voltron', side: 'e', s: 0.5, member: true, when: (c) => (/\bequipment\b/.test(c.type) && /equipped creature/.test(c.t)) || (/\baura\b/.test(c.type) && /enchant creature/.test(c.t) && /enchanted creature (gets \+|has|can't be blocked|gains)|it gets \+|whenever enchanted creature (attacks|deals)/.test(c.t) && !hasTag(c, 'pacifism', 'parasitic-aura', 'lockdown-creature')) },
  { axis: 'voltron', side: 'p', s: 1, when: re(VOLTRON_PAYOFF) },
  { axis: 'voltron', side: 'p', s: 0.3, when: all((c) => c.isCreature && /\blegendary\b/.test(c.type), kw('double strike', 'infect', 'hexproof')) },
  // lands
  { axis: 'landfall', side: 'e', s: 1, when: any(tag('extra-land', 'play-additional-land', 'multi-land-ramp'), re(/you may play (an|two|three|x|up to \w+) additional lands?|play lands from your graveyard/)) },
  // The tags also cover lands handed to an opponent (Path to Exile): require the land to be yours.
  { axis: 'landfall', side: 'e', s: 0.7, when: any(re(EXTRA_LAND), all(tag('tutor-land-to-battlefield', 'land-ramp', 'recursion-land', 'reanimate-land', 'regrowth-land', 'fetchland', 'sneak-land'), re(/your library|your hand|your graveyard|additional land|you control/))) },
  { axis: 'landfall', side: 'p', s: 1, when: any(re(LANDFALL), kw('landfall'), tag('landfall')) },
  { axis: 'landfall', side: 'p', s: 0.7, when: re(LAND_PAYOFF) },
  { axis: 'landfall', side: 'p', s: 0.4, when: tag('land-count-matters', 'lands-matter') },
  // lifegain
  { axis: 'lifegain', side: 'e', s: 1, when: any(tag('soul-warden-ability'), all(re(LIFE_GAIN), rep(/you gain (x|\d+|that much|life)|gains? (x|\d+|that much) life/)), re(/creatures you control have lifelink/)) },
  { axis: 'lifegain', side: 'e', s: 0.7, when: any(tag('repeatable-lifegain', 'gives-lifelink'), kw('lifelink', 'extort')) },
  { axis: 'lifegain', side: 'e', s: 0.4, when: any(re(LIFE_GAIN), tag('lifegain')) },
  { axis: 'lifegain', side: 'p', s: 1, when: any(re(LIFE_PAYOFF), tag('lifegain-matters', 'pridemate')) },
  // blink
  { axis: 'blink', side: 'e', s: 1, when: any(all(re(FLICKER), rep(FLICKER)), all(tag('flicker', 'flicker-creature'), (c: Ctx) => c.isPermanent && !/sacrifice (~|this \w+)/.test(c.t))) },
  { axis: 'blink', side: 'e', s: 0.7, when: any(re(FLICKER), tag('flicker', 'flicker-creature', 'flicker-artifact', 'flicker-slow')) },
  { axis: 'blink', side: 'e', s: 0.4, when: tag('rescue-creature', 'repeatable-rescue') },
  { axis: 'blink', side: 'p', s: 1, when: any(re(ETB_DOUBLE), tag('trigger-doubler')) },
  { axis: 'blink', side: 'p', s: 0.7, when: re(ETB_WATCH) },
  { axis: 'blink', side: 'p', s: 0.5, member: true, when: (c) => c.isCreature && /(^|— )when(ever)? (~|this creature) (enters(?! tapped)|or another [^.\n]*? enters)/m.test(c.t) },
  // attack
  { axis: 'attack', side: 'e', s: 0.7, when: any(re(TEAM_EVASION), re(EXTRA_COMBAT), tag('extra-combat-phase')) },
  { axis: 'attack', side: 'e', s: 0.4, when: tag('gives-haste', 'gives-evasion', 'force-attacker') },
  { axis: 'attack', side: 'p', s: 1, when: any(teamAttack, kw('battle cry', 'melee', 'myriad', 'raid')) },
  { axis: 'attack', side: 'p', s: 0.4, when: any(re(SELF_ATTACK), re(TEAM_SABOTEUR), tag('saboteur', 'attack-trigger'), kw('exalted', 'annihilator')) },
  // combat damage: ninjutsu and "whenever a creature you control connects" want cheap evasive bodies
  { axis: 'evasion', side: 'p', s: 1, when: any(re(TEAM_SABOTEUR), kw('ninjutsu', 'commander ninjutsu'), tag('synergy-ninjutsu', 'gives-ninjutsu')) },
  { axis: 'evasion', side: 'p', s: 0.4, when: any(re(SELF_SABOTEUR), tag('saboteur')) },
  { axis: 'evasion', side: 'e', s: 0.9, when: any(re(/creatures you control (can't be blocked|have (flying|shadow|menace|fear|intimidate)|gain (flying|shadow|menace|fear|intimidate))/), all(tag('gives-unblockable'), (c: Ctx) => c.isPermanent && repeatable(c, UNBLOCKABLE))) },
  { axis: 'evasion', side: 'e', s: 0.6, when: tag('gives-unblockable') },
  { axis: 'evasion', side: 'e', s: 0.9, member: true, when: (c) => c.isCreature && c.card.cmc <= 1 && evasive(c) },
  { axis: 'evasion', side: 'e', s: 0.6, member: true, when: (c) => c.isCreature && c.card.cmc === 2 && evasive(c) },
  // defenders / toughness matters (Arcades, Doran, Assault Formation)
  { axis: 'defender', side: 'p', s: 1, when: re(DEFENDER_PAYOFF) },
  { axis: 'defender', side: 'e', s: 0.75, member: true, when: (c) => c.isCreature && hasKw(c, 'defender') },
  // wheels / draw matters
  { axis: 'wheels', side: 'e', s: 1, when: any(re(WHEEL), tag('wheel', 'wheel-symmetrical', 'wheel-one-sided')) },
  { axis: 'wheels', side: 'e', s: 0.6, when: tag('force-draw', 'burst-draw') },
  { axis: 'wheels', side: 'e', s: 0.4, when: any(tag('repeatable-pure-draw', 'draw-engine'), re(/draws? (two|three|four|five|seven|x|that many) cards/)) },
  { axis: 'wheels', side: 'p', s: 1, when: any(re(DRAW_PAYOFF), tag('draw-matters', 'second-draw-matters', 'draw-hate')) },
  { axis: 'wheels', side: 'p', s: 0.5, when: any(tag('hand-size-matters'), re(/no maximum hand size|cards in your hand/)) },
  // discard
  { axis: 'discard', side: 'e', s: 1, when: any(all(re(MAKE_DISCARD), rep(MAKE_DISCARD)), tag('free-discard-outlet'), re(WHEEL)) },
  { axis: 'discard', side: 'e', s: 0.7, when: any(re(MAKE_DISCARD), tag('discard', 'hand-disruption', 'specter-ability', 'repeatable-loot', 'repeatable-rummage')) },
  { axis: 'discard', side: 'e', s: 0.5, when: any(tag('discard-outlet', 'loot', 'rummage'), re(/discard (a|two|three|x|your|any number of) (cards?|hand)/)) },
  { axis: 'discard', side: 'e', s: 0.3, when: re(SELF_DISCARD) },
  { axis: 'discard', side: 'p', s: 1, when: any(re(DISCARD_PAYOFF), tag('discard-matters', 'self-discard-matters', 'discarded-type-matters'), kw('madness')) },
  // mill
  { axis: 'mill', side: 'e', s: 1, when: any(all(re(MILL_OPP), rep(MILL_OPP)), all(tag('mill-opponent', 'mill-any', 'mill-each'), (c: Ctx) => c.isPermanent && repeatable(c, /\bmills?\b/))) },
  { axis: 'mill', side: 'e', s: 0.7, when: any(re(MILL_OPP), tag('mill-opponent', 'mill-any', 'mill-each')) },
  { axis: 'mill', side: 'p', s: 1, when: any(re(MILL_PAYOFF), tag('synergy-mill')) },
  // treasure / food / clue
  { axis: 'treasure', side: 'e', s: 1, when: any(all(re(UTILITY_TOKEN), rep(UTILITY_TOKEN)), tag('repeatable-treasures', 'repeatable-food', 'repeatable-clues')) },
  { axis: 'treasure', side: 'e', s: 0.6, when: any(re(UTILITY_TOKEN), kw('investigate')) },
  { axis: 'treasure', side: 'p', s: 1, when: any(re(UTILITY_PAYOFF), tag('synergy-treasure', 'synergy-food')) },
  // stax, group hug, extra combat: no separate payoff side
  { axis: 'stax', side: 'b', s: 1, when: isStax },
  { axis: 'stax', side: 'b', s: 0.6, when: all(tag('hatebear', 'cost-increaser', 'prevent-cast', 'prevent-activation', 'tax', 'hand-size-hate', 'draw-hate'), re(STAX_HINT), (c: Ctx) => c.isPermanent && !hasTag(c, 'rhystic', 'pillowfort')) },
  { axis: 'group-hug', side: 'b', s: 0.8, when: any(tag('group-hug'), all(re(GROUP_HUG), not(tag('group-slug')))) },
  { axis: 'group-hug', side: 'b', s: 0.5, when: tag('selective-group-hug') },
  { axis: 'extra-combat', side: 'b', s: 1, when: any(re(EXTRA_COMBAT), tag('extra-combat-phase')) },
  // big mana
  { axis: 'big-mana', side: 'e', s: 1, when: any(re(MANA_DOUBLE), tag('mana-increaser')) },
  { axis: 'big-mana', side: 'e', s: 0.6, when: all(any(tag('adds-multiple-mana'), re(/: add (two|three|four|five|x) mana|: add (\{[wubrgc]\}){2,}/)), (c: Ctx) => !c.isSpell) },
  // Rocks and mana creatures are what a big-mana deck is made of (and what Kinnan doubles).
  { axis: 'big-mana', side: 'e', s: 0.5, member: true, when: (c) => c.isPermanent && !c.isLand && isManaProducer(c) && hasRepeatableManaAbility(c) },
  { axis: 'big-mana', side: 'p', s: 1, when: re(/spells? with \{x\} in (its|their) mana costs?|x spells/) },
  { axis: 'big-mana', side: 'p', s: 0.8, when: any(X_COST, all(tag('bottomless-mana-sink'), re(/\{x\}/))) },
  { axis: 'big-mana', side: 'p', s: 0.6, when: any(tag('bottomless-mana-sink'), re(BIG_PAYOFF)) },
  { axis: 'big-mana', side: 'p', s: 0.5, member: true, when: (c) => !c.isLand && c.card.cmc >= 7 },
  // legends
  { axis: 'legends', side: 'e', s: 0.5, member: true, when: (c) => /\blegendary\b|\bsaga\b/.test(c.type) && !c.isLand },
  { axis: 'legends', side: 'p', s: 1, when: any(re(LEGEND_PAYOFF), tag('synergy-legendary', 'synergy-historic', 'synergy-saga', 'legendify')) },
  // energy, poison
  { axis: 'energy', side: 'e', s: 0.8, when: any(re(ENERGY_GET), tag('energy-generator')) },
  { axis: 'energy', side: 'p', s: 0.8, when: any(re(ENERGY_USE), tag('counter-fuel-energy')) },
  { axis: 'poison', side: 'e', s: 0.8, when: any(re(POISON), kw('infect', 'toxic', 'poisonous'), tag('poison-mechanics', 'poisonous')) },
  { axis: 'poison', side: 'p', s: 0.8, when: re(/\bcorrupted\b|poison counters?|creatures you control have (infect|toxic)/) },
  { axis: 'poison', side: 'p', s: 0.4, when: any(re(PROLIFERATE), kw('proliferate')) },
  // any-type typal
  { axis: 'typal', side: 'p', s: 1, when: any(re(/choose a creature type|creatures? (you control )?of the chosen type|chosen creature type|creature type of your choice|shares? (a|at least one) creature type|share a creature type/), tag('typal-choose', 'typal-share')) },
  { axis: 'typal', side: 'e', s: 0.5, member: true, when: (c) => hasKw(c, 'changeling') || /(is|are) every creature type/.test(c.t) },
];

const round2 = (n: number) => Math.round(n * 100) / 100;
/**
 * Enabler strength a creature has for its own types: an Elf is a clear piece of an Elf deck, above
 * the 0.5 of merely being an artifact in an artifact deck, and below a lord (payoff 1).
 */
export const TYPE_MEMBER = 0.75;

/**
 * Enabler / payoff / membership strengths per axis for a card. Works from rules text and keywords
 * alone when `c.tags` is empty (the commander path); Tagger tags only add signals.
 */
export function axisSignals(c: Ctx): Map<AxisId, AxisSignal> {
  const out = new Map<AxisId, AxisSignal>();
  const slot = (axis: AxisId): AxisSignal => {
    let s = out.get(axis);
    if (!s) out.set(axis, (s = { e: 0, p: 0, memberE: 0, memberP: 0 }));
    return s;
  };
  for (const rule of RULES) {
    if (!rule.when(c)) continue;
    const s = slot(rule.axis);
    if (rule.member) {
      if (rule.side !== 'p') s.memberE = Math.max(s.memberE, rule.s);
      if (rule.side !== 'e') s.memberP = Math.max(s.memberP, rule.s);
      continue;
    }
    if (rule.side !== 'p') s.e = Math.max(s.e, rule.s);
    if (rule.side !== 'e') s.p = Math.max(s.p, rule.s);
  }

  // Typal: creature types the text cares about, makes tokens of, or the card simply is.
  const own = creatureSubtypes(c.card.faces);
  const lordish = /get \+|have |has |gain |for each|whenever|number of|cost[s]? \{|search your library|you control/.test(c.t);
  for (const [type, kind] of typeMentions(c.raw)) {
    const s = slot(`typal:${type}`);
    if (kind === 'token') s.e = Math.max(s.e, repeatable(c, /create|amass/) ? 0.8 : 0.6);
    else if (!hasTag(c, 'hate-typal') || hasTag(c, `typal-${type}`)) s.p = Math.max(s.p, hasTag(c, `typal-${type}`) || lordish ? 1 : 0.7);
  }
  for (const slug of c.tags) {
    if (!slug.startsWith('typal-')) continue;
    const type = slug.slice(6).replace(/-/g, ' ');
    if (type === 'choose' || type === 'share' || type === 'creature' || type === 'coupling') continue;
    if (!own.includes(type) && !new RegExp(`\\b${type}`, 'i').test(c.t)) continue;
    const s = slot(`typal:${type}`);
    s.p = Math.max(s.p, 0.8);
  }
  for (const type of own) slot(`typal:${type}`).memberE = TYPE_MEMBER;

  for (const [axis, s] of out) {
    if (s.e === 0 && s.p === 0 && s.memberE === 0 && s.memberP === 0) out.delete(axis);
    else out.set(axis, { e: round2(s.e), p: round2(s.p), memberE: round2(s.memberE), memberP: round2(s.memberP) });
  }
  return out;
}

/** Sparse `CardFeatures.axes`: membership counts as enabler strength. */
export function axesOf(c: Ctx): Record<AxisId, { e: number; p: number }> {
  const out: Record<AxisId, { e: number; p: number }> = {};
  for (const [axis, s] of axisSignals(c)) {
    const e = Math.max(s.e, s.memberE);
    const p = Math.max(s.p, s.memberP);
    if (e > 0 || p > 0) out[axis] = { e, p };
  }
  return out;
}
