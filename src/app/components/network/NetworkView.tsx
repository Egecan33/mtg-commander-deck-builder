'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { NetworkResponse } from '@/app/lib/api';
// d3-free: the force layout (d3-force-3d) is loaded only where it runs, the 2D fallback (review M4).
import { drawnEdges, toGraphData } from '@/engine/network/draw';
import type { Vec3 } from '@/engine/network/layout';
import type { NetworkEdgeKind } from '@/engine/types';
import { EmptyState } from '../EmptyState';
import { NetworkSvg } from './NetworkSvg';
import type { NetworkScene } from './scene';
import { EDGE_COLOR, EDGE_KINDS, EDGE_LABEL, nodeReasons } from './style';

/** Whether WebGL works here. The probe's own context is given back at once (review M3). */
const hasWebgl = (): boolean => {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
};

/** The hover card's widest size (18rem) and a height that fits three reasons, for keeping it inside the view. */
const HOVER_W = 288;
const HOVER_H = 132;

/**
 * The deck's cards as a network: 3d-force-graph for layout and interaction, our own three.js objects
 * for every node and edge, an SVG drawing of the same layout when WebGL is missing or lost.
 */
export function NetworkView({
  network, error, focusCluster, onOpen, onRetry, onEmpty,
}: {
  network: NetworkResponse | null;
  error: string | null;
  focusCluster: number | null;
  onOpen(oracleId: string): void;
  onRetry(): void;
  onEmpty?(): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<NetworkScene | null>(null);
  const [renderer, setRenderer] = useState<'webgl' | 'svg' | null>(null);
  const [kinds, setKinds] = useState<ReadonlySet<NetworkEdgeKind>>(new Set(EDGE_KINDS));
  const kindsRef = useRef(kinds);
  kindsRef.current = kinds;
  const [settled, setSettled] = useState(false);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [visible, setVisible] = useState(0);
  const [flights, setFlights] = useState(0);
  const lastFocus = useRef<number | null>(null);
  const empty = !!network && network.nodes.every((n) => n.commander);

  useEffect(() => {
    const two = new URLSearchParams(window.location.search).get('network') === '2d';
    setRenderer(!two && hasWebgl() ? 'webgl' : 'svg');
  }, []);

  // What is drawn: each card's strongest few feeds links and every other link; the legend shows drawn of total.
  const drawn = useMemo(() => (network ? drawnEdges(network.edges) : new Set<number>()), [network]);
  const counts = useMemo(() => {
    const zero = (): Record<NetworkEdgeKind, number> => ({ combo: 0, feeds: 0, typal: 0, commander: 0, package: 0 });
    const total = zero();
    const shown = zero();
    (network?.edges ?? []).forEach((e, i) => { total[e.kind]++; if (drawn.has(i)) shown[e.kind]++; });
    return { total, shown };
  }, [network, drawn]);
  useEffect(() => {
    setVisible(network ? network.edges.filter((e, i) => drawn.has(i) && kinds.has(e.kind)).length : 0);
  }, [network, kinds, drawn]);

  // The 2D fallback settles the layout here; the layout code is loaded only then.
  const [positions, setPositions] = useState<Map<string, Vec3> | null>(null);
  useEffect(() => {
    setPositions(null);
    if (!network || renderer !== 'svg' || empty) return;
    let cancelled = false;
    void import('@/engine/network/layout').then(({ settle }) => { if (!cancelled) setPositions(settle(network)); });
    return () => { cancelled = true; };
  }, [network, renderer, empty]);

  // The three.js scene, rebuilt when the network changes.
  useEffect(() => {
    if (renderer !== 'webgl' || !network || empty || !host.current) return;
    const el = host.current;
    let cancelled = false;
    let scene: NetworkScene | null = null;
    setSettled(false);
    const names = (id: string) => network.cards[id]?.name ?? id;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    import('./scene')
      .then(({ createNetworkScene }) => createNetworkScene(el, { network, names, reducedMotion: reduced, kinds: kindsRef.current }, {
        hover: (id, at) => setHover(id && at ? { id, x: at.x, y: at.y } : null),
        open: (id) => onOpenRef.current(id),
        contextLost: () => setRenderer('svg'),
        settled: (s) => setSettled(s),
      }))
      .then((s) => {
        if (cancelled) { s.dispose(); return; }
        scene = s;
        sceneRef.current = s;
        const box = el.getBoundingClientRect();
        s.resize(box.width, box.height);
      })
      .catch((e: unknown) => { console.warn('The 3D network could not start, drawing it flat instead.', e); if (!cancelled) setRenderer('svg'); });
    const watch = new ResizeObserver(([entry]) => sceneRef.current?.resize(entry.contentRect.width, entry.contentRect.height));
    watch.observe(el);
    return () => {
      cancelled = true;
      watch.disconnect();
      scene?.dispose();
      sceneRef.current = null;
      el.replaceChildren();
    };
  }, [renderer, network, empty]);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => { if (renderer === 'webgl') setVisible(sceneRef.current?.setKinds(kinds) ?? visible); }, [kinds]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!network || lastFocus.current === focusCluster) return;
    lastFocus.current = focusCluster;
    const ids = focusCluster === null ? network.nodes.map((n) => n.oracleId) : network.clusters.find((c) => c.id === focusCluster)?.cards ?? [];
    sceneRef.current?.flyTo(ids);
    setFlights((n) => n + 1);
  }, [focusCluster, network]);

  const toggle = (kind: NetworkEdgeKind) => {
    const next = new Set(kinds);
    if (next.has(kind)) next.delete(kind); else next.add(kind);
    setKinds(next);
  };
  const exportJson = () => {
    if (!network) return;
    const data = toGraphData(network, (id) => network.cards[id]?.name ?? id);
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'graph.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (error && !network) {
    return <EmptyState title="The network could not be read" message={error} action={<button type="button" className="btn" onClick={onRetry}>Try again</button>} testId="network-view" />;
  }
  if (!network) return <p className="py-10 text-ash" data-testid="network-view">Reading how the cards connect</p>;
  if (empty) {
    return (
      <div data-testid="network-view">
        <EmptyState
          message="Add cards to the deck to see how they work together."
          action={onEmpty && <button type="button" className="btn" onClick={onEmpty}>Show the deck</button>}
        />
      </div>
    );
  }

  const hoverCard = hover ? network.cards[hover.id] : null;
  const hoverNode = hover ? network.nodes.find((n) => n.oracleId === hover.id) : null;
  // The hover card stays inside the view (review M2): flipped to the pointer's left or above near an edge.
  const place = (() => {
    if (!hover) return { left: 0, top: 0 };
    const w = frame.current?.clientWidth ?? 0;
    const h = frame.current?.clientHeight ?? 0;
    const left = hover.x + 14 + HOVER_W > w ? hover.x - 14 - HOVER_W : hover.x + 14;
    const top = hover.y + 14 + HOVER_H > h ? hover.y - 14 - HOVER_H : hover.y + 14;
    return { left: Math.max(8, Math.min(left, w - HOVER_W - 8)), top: Math.max(8, Math.min(top, h - HOVER_H - 8)) };
  })();
  return (
    <div
      ref={frame}
      className="relative overflow-hidden rounded-[6px] border border-slag bg-anvil"
      style={{ height: 'min(74vh, 780px)', minHeight: 420 }}
      data-testid="network-view"
      data-renderer={renderer ?? 'webgl'}
      data-settled={renderer === 'svg' ? 'true' : settled ? 'true' : 'false'}
      data-visible-edges={visible}
      data-flights={flights}
    >
      <div ref={host} className={renderer === 'svg' ? 'hidden' : 'absolute inset-0'} />
      {renderer === 'svg' && positions && (
        <NetworkSvg
          network={network} positions={positions} kinds={kinds} hoverId={hover?.id ?? null}
          onHover={(id, at) => setHover(id && at ? { id, x: at.x, y: at.y } : null)} onOpen={onOpen}
        />
      )}
      <div className="absolute left-3 top-3 flex flex-wrap gap-1.5" role="group" aria-label="Link kinds">
        {EDGE_KINDS.filter((kind) => kind !== 'package' || counts.total.package > 0).map((kind) => (
          <button
            key={kind}
            type="button"
            className={`chip gap-1.5 ${kinds.has(kind) ? 'text-bone' : 'text-smoke'}`}
            aria-pressed={kinds.has(kind)}
            onClick={() => toggle(kind)}
            title={`${kinds.has(kind) ? 'Hide' : 'Show'} ${EDGE_LABEL[kind].toLowerCase()} links${counts.shown[kind] < counts.total[kind] ? `. ${counts.shown[kind]} of ${counts.total[kind]} are drawn: each card's strongest three; every link counts in the numbers` : ''}`}
            data-testid={`network-legend-${kind}`}
          >
            <span className="inline-block h-0.5 w-3" style={{ background: EDGE_COLOR[kind], opacity: kinds.has(kind) ? 1 : 0.35 }} />
            {EDGE_LABEL[kind]}{' '}
            <span className="tabular-nums">{counts.shown[kind] < counts.total[kind] ? `${counts.shown[kind]}/${counts.total[kind]}` : counts.total[kind]}</span>
          </button>
        ))}
      </div>
      <button type="button" className="btn btn-sm absolute right-3 top-3" onClick={exportJson} title="Save the network as graph.json (nodes and links)" data-testid="network-export">
        Export graph.json
      </button>
      {hover && hoverCard && hoverNode && (
        <div
          className="pointer-events-none absolute z-10 max-w-[18rem] rounded-[6px] border border-slag bg-iron px-3 py-2 text-[0.86rem] shadow-lg"
          style={place}
          data-testid="network-hover"
        >
          <p className="font-medium text-bone">{hoverCard.name}</p>
          {hoverNode.commander && <p className="text-ash">Commander</p>}
          <ul className="mt-1 grid gap-0.5 text-ash">
            {nodeReasons(hover.id, network.edges).map((r, i) => <li key={i}>{r}</li>)}
            {nodeReasons(hover.id, network.edges).length === 0 && !hoverNode.commander && <li>Connects to nothing in this deck.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
