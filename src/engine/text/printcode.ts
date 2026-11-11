/** What is printed at the bottom of a card, as typed: a set code and a collector number, with an optional quantity in front. */
export interface PrintCode { qty: number; set: string; number: string }

const LANGUAGES = new Set(['en', 'de', 'fr', 'it', 'es', 'sp', 'pt', 'ja', 'jp', 'ko', 'kr', 'ru', 'zhs', 'zht', 'cs', 'ct', 'ph', 'he', 'la', 'grc', 'ar', 'sa']);
const NOISE = new Set(['f', 'foil', 'etched', 'nonfoil', '★', '*', '•', '·', 'c', 'u', 'r', 'm', 'l', 't', 's', 'p']);
/** "123", "0123", "123a", "123★", "123/281". */
const NUMBER = /^(\d+[a-z★†]?)(?:\/\d+)?$/i;
const SET = /^[a-z0-9]{2,6}$/i;
const MAX_QTY = 999;

/**
 * Reads "TDM 123", "tdm-123", "123 TDM", "123/281 TDM", "0123 tdm", "R 0123 TDM • EN" or
 * "3 tdm 123" (three copies). Leading zeros of the number go; rarity, language and foil marks
 * around the two are ignored. Null when the text is not a set code and a number: a card name.
 */
export function parsePrintCode(text: string): PrintCode | null {
  let tokens = text.trim().toLowerCase().split(/[\s\-–—_,;:#()[\]]+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 7) return null;
  let qty = 1;
  // "3x tdm 123", or a bare number in front when another number follows a set code.
  const lead = /^(\d+)x$/.exec(tokens[0]);
  if (lead) {
    qty = Number(lead[1]);
    tokens = tokens.slice(1);
  }
  const isNumber = (t: string) => NUMBER.test(t);
  const isSet = (t: string) => SET.test(t) && /[a-z]/.test(t) && !isNumber(t) && !LANGUAGES.has(t) && !NOISE.has(t);
  let setAt = tokens.findIndex(isSet);
  // A set code that reads like a number with a letter ("40k 123"): the other number is the collector number.
  if (setAt < 0) {
    const odd = tokens.findIndex((t) => /^\d+[a-z]$/.test(t));
    if (odd >= 0 && tokens.some((t, i) => i !== odd && isNumber(t))) setAt = odd;
  }
  if (setAt < 0) return null;
  const numbers = tokens.map((t, i) => (i !== setAt && isNumber(t) ? i : -1)).filter((i) => i >= 0);
  if (numbers.length === 0) return null;
  let numberAt = numbers[0];
  if (!lead && numbers.length >= 2 && numbers[0] === 0 && /^\d+$/.test(tokens[0]) && setAt === 1) {
    qty = Number(tokens[0]);
    numberAt = numbers[1];
  }
  // Everything else has to be noise, or this is a card name after all ("Fire 2 Ice").
  const rest = tokens.filter((_, i) => i !== setAt && i !== numberAt && !(numberAt !== numbers[0] && i === 0));
  if (rest.some((t) => !LANGUAGES.has(t) && !NOISE.has(t))) return null;
  if (!(qty >= 1 && qty <= MAX_QTY)) return null;
  const number = (NUMBER.exec(tokens[numberAt]) as RegExpExecArray)[1].replace(/^0+(?=\d)/, '');
  return { qty, set: tokens[setAt], number };
}
