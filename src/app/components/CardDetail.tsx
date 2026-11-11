'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { CardScore } from '@/engine/types';
import type { ClientCard } from '../lib/api';
import { BAND_VAR, PART_LABEL, ROLE_LABEL, bandOf, fmtPrice } from '../lib/ui';
import { CardImage, Mana, Overlay, ScoreBadge } from './card';
import { useProxies } from './Shell';

/**
 * The card at full size with why it scores what it scores. Two-faced cards flip.
 * `actions` is whatever the caller lets you do with the card (add, remove, lock, pick).
 */
export function CardDetail({
  id, card, score, onClose, actions, note,
}: {
  id: string;
  card: ClientCard | undefined;
  score?: CardScore | null;
  onClose: () => void;
  actions?: ReactNode;
  note?: ReactNode;
}) {
  const [face, setFace] = useState<0 | 1>(0);
  const proxies = useProxies();
  const onList = proxies.qty[id] ?? 0;
  useEffect(() => setFace(0), [id]);
  const name = card?.name ?? 'Unknown card';
  const twoFaced = card?.imageFaces === 2;
  const band = score ? bandOf(score.score, !!score.gate) : null;

  return (
    <Overlay onClose={onClose} label={name} wide>
      <div className="flex gap-7 p-6" data-testid="card-detail">
        <div className="w-[21rem] shrink-0">
          <div className="card" data-testid="detail-image">
            <CardImage id={id} name={twoFaced && face === 1 ? (card?.name.split(' // ')[1] ?? name) : (card?.frontName ?? name)} size="display" face={face} known={!!card} />
          </div>
          {twoFaced && (
            <button type="button" className="btn mt-3 w-full" onClick={() => setFace(face === 0 ? 1 : 0)} data-testid="flip-card">
              Flip to the {face === 0 ? 'back' : 'front'} face
            </button>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-[1.6rem] leading-tight">{name}</h2>
              {card ? (
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-ash">
                  {card.manaCost && <Mana cost={card.manaCost} size="1.15rem" />}
                  <span>{card.typeLine}</span>
                </p>
              ) : (
                <p className="mt-1 text-ash">
                  This card is not in the local card database. It may be from a set released after the last sync, or the name may be misspelt. It is left out of
                  scoring and the deck is not legal while it is in the list.
                </p>
              )}
            </div>
            <button type="button" className="btn btn-quiet btn-sm" onClick={onClose} aria-label="Close card detail">
              Close
            </button>
          </div>

          {card && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {card.roles.map((r) => (
                <span key={r} className="chip">{ROLE_LABEL[r] ?? r}</span>
              ))}
              {card.gameChanger && <span className="chip border-ember text-ember">Game Changer</span>}
              <span className="chip">{fmtPrice(card.priceUsd)}</span>
              {card.owned && <span className="chip border-band-top text-band-top">In your collection</span>}
            </div>
          )}

          {score && (
            <section className="mt-5 border-t border-slag pt-4">
              <div className="flex items-center gap-3">
                <ScoreBadge score={score} large />
                <div className="min-w-0">
                  <div className="display text-[1.05rem]">{score.gate ? 'Cannot go in this deck' : 'Score for this deck'}</div>
                  <div className="text-ash" data-testid="detail-score-note">
                    {score.gate ? score.gate.message : 'Out of 100. It moves as the deck changes.'}
                  </div>
                </div>
              </div>

              {!score.gate && (
                <div className="mt-4 grid gap-2">
                  {score.parts.filter((p) => p.max > 0).map((p) => {
                    const share = p.max > 0 ? Math.max(0, Math.min(1, p.points / p.max)) : 0;
                    return (
                      <div key={p.key} className="grid grid-cols-[13rem_1fr_4.5rem] items-center gap-3" data-testid="score-part">
                        <span className="text-ash">{PART_LABEL[p.key] ?? p.key}</span>
                        <span className="h-2 overflow-hidden rounded-full bg-iron">
                          <span className="block h-full rounded-full" style={{ width: `${share * 100}%`, background: BAND_VAR[bandOf(share * 100)] }} />
                        </span>
                        <span className="text-right">
                          {Math.round(p.points * 10) / 10}
                          <span className="text-smoke"> / {p.max}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {score.reasons.length > 0 && (
                <ul className="mt-4 grid gap-1 text-[0.9rem]" data-testid="score-reasons">
                  {score.reasons.map((r, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-[0.5em] h-1 w-1 shrink-0 rounded-full" style={{ background: band ? BAND_VAR[band] : undefined }} />
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {note && <div className="mt-4 text-ash">{note}</div>}
          <div className="mt-auto flex flex-wrap gap-2 pt-6">
            {actions}
            {card && (
              <button
                type="button"
                className="btn"
                onClick={() => void proxies.add([{ oracleId: id, qty: 1 }], `Added ${card.name} to the proxy list`)}
                title="Put this card on the list of playtest proxies to print"
                data-testid="detail-proxy"
              >
                {onList > 0 ? `Proxy another (${onList} on the list)` : 'Proxy'}
              </button>
            )}
          </div>
        </div>
      </div>
    </Overlay>
  );
}
