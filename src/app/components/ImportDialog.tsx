'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Bracket } from '@/engine/types';
import { createDeck, importDeck, type ImportResponse } from '../lib/api';
import { BRACKETS, deckCount } from '../lib/ui';
import { CardImage, Overlay } from './card';
import { useNotify } from './Shell';

const SAMPLE = 'Commander\n1 Lathril, Blade of the Elves\n\nDeck\n1 Sol Ring\n1 Elvish Mystic\n...';

/** Paste an existing decklist, see what was understood and what was not, then open it in the builder. */
export function ImportDialog({ onClose, defaultBracket = 3 }: { onClose: () => void; defaultBracket?: Bracket }) {
  const router = useRouter();
  const notify = useNotify();
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [bracket, setBracket] = useState<Bracket>(defaultBracket);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [readText, setReadText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const read = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await importDeck({ text, name: name.trim() || undefined, targetBracket: bracket });
      setResult(res);
      setReadText(text);
      if (!name.trim() && res.deck.name) setName(res.deck.name);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!result) return;
    setBusy(true);
    try {
      const saved = await createDeck({ ...result.deck, id: null, name: name.trim() || result.deck.name || 'Imported deck', targetBracket: bracket });
      router.push(`/deck/${saved.deck.id}`);
    } catch (e) {
      notify.error(e);
      setBusy(false);
    }
  };

  const fresh = result !== null && readText === text;
  const count = result ? deckCount(result.deck) : 0;

  return (
    <Overlay onClose={onClose} label="Import a decklist" wide>
      <div className="p-6" data-testid="import-dialog">
        <div className="flex items-start">
          <div>
            <h2 className="text-[1.5rem]">Import a decklist</h2>
            <p className="mt-1 max-w-[62ch] text-ash">
              Paste a list exported from Moxfield, Archidekt, MTG Arena or a text file: one card per line, with the commander under a “Commander” heading.
              Set codes, collector numbers and foil marks are ignored.
            </p>
          </div>
          <button type="button" className="btn btn-quiet btn-sm ml-auto" onClick={onClose}>Close</button>
        </div>

        <div className="mt-4 grid grid-cols-[1fr_20rem] gap-5">
          <div>
            <textarea
              className="field h-[24rem] w-full"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={SAMPLE}
              spellCheck={false}
              aria-label="Decklist text"
              data-testid="import-text"
            />
            <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-ash hover:text-bone">
              <input
                type="file"
                accept=".txt,.dec,.csv,text/plain"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) setText(await file.text());
                }}
              />
              <span className="underline underline-offset-2">Or choose a text file</span>
            </label>
          </div>

          <div className="flex flex-col gap-3">
            <label className="grid gap-1">
              <span className="text-ash">Deck name</span>
              <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Taken from the commander" data-testid="import-name" />
            </label>
            <label className="grid gap-1">
              <span className="text-ash">Target bracket</span>
              <select className="field" value={bracket} onChange={(e) => setBracket(Number(e.target.value) as Bracket)}>
                {BRACKETS.map((b) => (
                  <option key={b.n} value={b.n}>{b.n}. {b.name}</option>
                ))}
              </select>
            </label>

            {problem && (
              <div role="alert" className="rounded-md border border-band-low bg-[#3a1a16] px-3 py-2">{problem}</div>
            )}

            {result && (
              <div className={`rounded-md border border-slag bg-soot p-3 ${fresh ? '' : 'opacity-50'}`} data-testid="import-result">
                <div className="flex items-center gap-3">
                  {result.deck.commanders.slice(0, 2).map((id) => (
                    <div key={id} className="card w-14 shrink-0">
                      <CardImage id={id} name={result.cards[id]?.name ?? 'Commander'} known={!!result.cards[id]} />
                    </div>
                  ))}
                  <div className="min-w-0">
                    <div className="display text-[1.05rem]" data-testid="import-count">{count} cards read</div>
                    <div className="text-ash">
                      {result.deck.commanders.length
                        ? result.deck.commanders.map((id) => result.cards[id]?.name ?? 'Unknown').join(' and ')
                        : 'No commander found. You can pick one in the builder.'}
                    </div>
                  </div>
                </div>

                {result.unresolved.length > 0 && (
                  <div className="mt-3" data-testid="import-unresolved">
                    <div className="text-band-mid">
                      {result.unresolved.length} {result.unresolved.length === 1 ? 'line was' : 'lines were'} not recognised. Fix the spelling on the left and read the list again, or carry on without them.
                    </div>
                    <ul className="mt-1.5 max-h-32 overflow-auto text-[0.82rem]">
                      {result.unresolved.map((l) => (
                        <li key={l.line} className="flex gap-2">
                          <span className="w-14 shrink-0 text-smoke">line {l.line}</span>
                          <span className="break-all">{l.text}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {result.ignored.length > 0 && (
                  <p className="mt-2 text-[0.82rem] text-smoke">
                    {result.ignored.length} sideboard or maybeboard {result.ignored.length === 1 ? 'line' : 'lines'} left out.
                  </p>
                )}
              </div>
            )}

            <div className="mt-auto flex gap-2">
              <button type="button" className={`btn flex-1 ${fresh ? '' : 'btn-primary'}`} disabled={busy || !text.trim()} onClick={read} data-testid="import-read">
                {result ? 'Read the list again' : 'Read the list'}
              </button>
              <button type="button" className={`btn flex-1 ${fresh ? 'btn-primary' : ''}`} disabled={busy || !fresh || count === 0} onClick={create} data-testid="import-create">
                Open in the builder
              </button>
            </div>
          </div>
        </div>
      </div>
    </Overlay>
  );
}
