'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CardImage, ColorPip } from '@/app/components/card';
import { HeldMark } from '@/app/components/held';
import { Menu, type MenuItem } from '@/app/components/Menu';
import { imageUrl, type CommanderCard, type CommanderPageResponse } from '@/app/lib/api';
import { commanderHref, themeHref } from '@/app/lib/links';
import { fmtPrice } from '@/app/lib/ui';
import type { Color } from '@/engine/types';
import { COLOR_NAME } from '@/app/lib/ui';
import { joinNames } from './shell';

/** The commander banner: the one bold moment on the page. */
export function Banner({
  page, partners, busy, onBuild, onBest, onOpenBuilder, onDecks, color, onColor,
}: {
  /** The colour chosen for a colour-choice commander. */
  color: Color | null;
  onColor: (c: Color) => void;
  page: CommanderPageResponse;
  partners: CommanderCard[];
  busy: string | null;
  onBuild: () => void;
  onBest: () => void;
  onOpenBuilder: () => void;
  onDecks: () => void;
}) {
  const router = useRouter();
  const [first, second] = page.commanders;
  const name = joinNames(page.commanders);
  const chooses = page.commanders.some((c) => c.needsColorChoice);
  const owned = page.commanders.every((c) => c.owned);
  const heldNames = page.commanders.flatMap((c) => page.heldBy[c.oracleId] ?? []);
  const items: MenuItem[] = partners.slice(0, 30).map((p) => ({
    label: p.frontName, description: p.typeLine, onSelect: () => router.push(commanderHref(first, p)),
  }));
  const hasPartnerKind = !second && first.partnerKinds.length > 0 && partners.length > 0;
  return (
    <header className="relative overflow-hidden border-b border-slag" data-testid="commander-banner">
      <img
        src={imageUrl(first.oracleId, 'display')}
        alt=""
        aria-hidden
        className="absolute left-0 max-w-none opacity-70"
        style={{ width: '100%', top: '-18%' }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-ember/45 via-soot/85 to-soot" />
      <div className="relative mx-auto flex max-w-[1500px] gap-6 px-8 pb-6 pt-7">
        <div className="flex shrink-0 gap-3">
          {page.commanders.map((c) => (
            <div key={c.oracleId} className="card w-[11rem]"><CardImage id={c.oracleId} name={c.name} size="display" /></div>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-end gap-3">
          <h1 className="display text-[32px] leading-tight" data-testid="commander-name">{name}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-ash">
            <span className="flex items-center gap-1">
              {(page.identity.length ? page.identity : ['C']).map((c) => <ColorPip key={c} color={c} size="1.2rem" />)}
            </span>
            {first.rank !== null && <span title="Scryfall's EDHREC rank" className="tabular-nums">Popularity #{first.rank}</span>}
            <span title="Scryfall price" className="tabular-nums">{fmtPrice(page.price)}</span>
            <span className="flex items-center gap-1.5">
              {owned ? 'In your collection' : 'Not in your collection'}
              {heldNames.length > 0 && <HeldMark names={[...new Set(heldNames)]} small />}
            </span>
            {chooses && (
              <span className="flex items-center gap-1.5" role="group" aria-label="Chosen colour" data-testid="commander-color">
                <span>{color ? 'Chosen colour' : 'Choose a colour'}</span>
                {(['W', 'U', 'B', 'R', 'G'] as const).map((c) => (
                  <button key={c} type="button" aria-pressed={color === c} title={COLOR_NAME[c]} className={`rounded-full p-0.5 ${color === c ? 'outline outline-2 outline-brass' : ''}`} onClick={() => onColor(c)} data-testid={`commander-color-${c}`}>
                    <ColorPip color={c} size="1.3rem" dim={color !== null && color !== c} />
                  </button>
                ))}
              </span>
            )}
            <button type="button" className="underline-offset-2 hover:text-bone hover:underline" onClick={onDecks} data-testid="commander-decks-link">Your decks · {page.decks.length}</button>
          </div>
          {(page.themes.length > 0 || page.edhrecThemes) && (
            <div className="flex flex-wrap gap-1.5">
              {page.themes.map((t) => (
                <Link key={t.axis} href={themeHref(t.axis)} className="chip hover:text-bone" title={`Forge: from ${name}'s text`} data-testid="theme-chip">{t.label}</Link>
              ))}
              {page.edhrecThemes?.map((t) => (
                <span key={t.slug} className="chip border-brass-deep" title={`EDHREC: ${t.count} of ${page.edhrecDecks} decks`} data-testid="edhrec-chip">{t.slug} · {t.count}</span>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-primary" onClick={onBuild} disabled={busy !== null} data-testid="commander-build">
              {busy === 'build' ? 'Building…' : 'Build a deck'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={onBest}
              disabled={busy !== null || page.ownedCards === 0}
              title={page.ownedCards === 0 ? `None of your cards fits ${name}` : 'Build the best deck from the cards you own'}
              data-testid="commander-best"
            >
              {busy === 'best' ? 'Building…' : 'Best from my collection'}
            </button>
            <button type="button" className="btn" onClick={onOpenBuilder} disabled={busy !== null} data-testid="commander-open-builder">Open in builder</button>
            {hasPartnerKind && <Menu label="Add a partner" items={items} testId="commander-partner" className="btn" />}
            {second && <Link href={commanderHref(first)} className="btn btn-quiet" data-testid="commander-without">Without {second.frontName}</Link>}
          </div>
        </div>
      </div>
    </header>
  );
}
