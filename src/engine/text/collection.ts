import type { CardDb } from '../types';
import { MAX_LINE_QTY, parseCardLine, resolveCardName, type UnresolvedLine } from './decklist';
import { parsePrintCode } from './printcode';

export interface ParsedCollection {
  owned: { oracleId: string; qty: number }[];
  unresolved: UnresolvedLine[];
}

interface CsvRecord { line: number; cells: string[]; raw: string }

/** RFC 4180-style reader: quoted cells, doubled quotes, line breaks inside quotes. */
function parseCsv(text: string, delimiter: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let startLine = 1;
  let rawStart = 0;
  const flush = (end: number) => {
    cells.push(cell);
    const raw = text.slice(rawStart, end);
    if (raw.trim()) records.push({ line: startLine, cells: cells.map((c) => c.trim()), raw: raw.trim() });
    cells = [];
    cell = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
    } else if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (ch === delimiter) {
      cells.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      flush(i);
      line++;
      startLine = line;
      rawStart = i + 1;
    } else cell += ch;
  }
  flush(text.length);
  return records;
}

const NAME_HEADERS = ['name', 'card name', 'card', 'cardname', 'card_name', 'product name'];
const QTY_HEADERS = ['quantity', 'count', 'qty', 'amount', 'owned', 'total', 'total qty', 'total quantity', 'copies', 'number'];

function findColumn(header: string[], wanted: string[]): number {
  for (const w of wanted) {
    const i = header.indexOf(w);
    if (i >= 0) return i;
  }
  return -1;
}

function detectCsv(text: string): { delimiter: string; nameCol: number; qtyCol: number } | null {
  const first = text.split(/\r\n|\r|\n/).find((l) => l.trim() !== '');
  if (!first) return null;
  for (const delimiter of [',', ';', '\t']) {
    const header = parseCsv(first, delimiter)[0]?.cells.map((c) => c.toLowerCase());
    if (!header || header.length < 2) continue;
    const nameCol = findColumn(header, NAME_HEADERS);
    if (nameCol >= 0) return { delimiter, nameCol, qtyCol: findColumn(header, QTY_HEADERS) };
  }
  // A one-column CSV that is just "Name".
  if (NAME_HEADERS.includes(first.trim().replace(/^"|"$/g, '').toLowerCase())) return { delimiter: ',', nameCol: 0, qtyCol: -1 };
  return null;
}

/**
 * Reads a collection: a CSV with a header row (name and quantity columns found by header text, so
 * Moxfield, Archidekt and ManaBox exports work; no quantity column means one copy per row) or a
 * plain "<qty> <name>" list, whose lines may also be a set code and collector number as printed on
 * the card when `findPrinting` is given. Rows for the same card add up. Rows naming no known card are
 * returned in `unresolved` with the 1-based line they start on.
 */
export function parseCollection(text: string, db: CardDb, findPrinting?: (set: string, number: string) => string | undefined): ParsedCollection {
  // Drop a byte-order mark and blank out Excel's "sep=," hint line (kept as an empty line so numbering holds).
  const body = text.replace(/^\uFEFF/, '').replace(/^sep=.?[ \t]*(?=\r|\n)/i, '');
  const owned = new Map<string, number>();
  const unresolved: UnresolvedLine[] = [];
  const add = (oracleId: string, qty: number) => {
    if (qty > 0) owned.set(oracleId, (owned.get(oracleId) ?? 0) + qty);
  };

  const csv = detectCsv(body);
  if (csv) {
    const records = parseCsv(body, csv.delimiter);
    for (const rec of records.slice(1)) {
      const name = rec.cells[csv.nameCol] ?? '';
      const card = name ? resolveCardName(name, db) : undefined;
      if (!card) { unresolved.push({ line: rec.line, text: rec.raw }); continue; }
      const qtyText = csv.qtyCol >= 0 ? (rec.cells[csv.qtyCol] ?? '') : '';
      const qty = qtyText === '' ? 1 : Number.parseInt(qtyText.replace(/x$/i, ''), 10);
      if (Number.isNaN(qty) || qty > MAX_LINE_QTY) { unresolved.push({ line: rec.line, text: rec.raw }); continue; }
      add(card.oracleId, qty);
    }
  } else {
    body.split(/\r\n|\r|\n/).forEach((raw, i) => {
      const line = raw.trim();
      if (!line || /^(\/\/|#)/.test(line)) return;
      const parsed = parseCardLine(line, db);
      if (parsed) { add(parsed.card.oracleId, parsed.qty); return; }
      // A set code and collector number as printed on the card ("tdm 123", "3 TDM 045").
      const code = findPrinting ? parsePrintCode(line) : null;
      const printed = code && findPrinting ? findPrinting(code.set, code.number) : undefined;
      if (code && printed) add(printed, code.qty);
      else {
        // Bare section words ("Deck", "Sideboard:") in a pasted list are not cards and not errors.
        const key = line.replace(/[\s:]*(\(\d+\))?[\s:]*$/, '').toLowerCase();
        if (!SECTION_WORDS.has(key)) unresolved.push({ line: i + 1, text: line });
      }
    });
  }

  return { owned: [...owned].map(([oracleId, qty]) => ({ oracleId, qty })), unresolved };
}

const SECTION_WORDS = new Set([
  'commander', 'commanders', 'companion', 'deck', 'main', 'mainboard', 'main deck', 'sideboard',
  'maybeboard', 'considering', 'lands', 'creatures', 'instants', 'sorceries', 'artifacts',
  'enchantments', 'planeswalkers', 'battles', 'tokens',
]);
