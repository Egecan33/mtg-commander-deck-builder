'use client';

import { useMemo } from 'react';
import { imageUrl } from '@/app/lib/api';
import type { NetworkResponse } from '@/app/lib/api';
import type { Vec3 } from '@/engine/network/layout';
import type { NetworkEdgeKind } from '@/engine/types';
import { ART_BOX, EDGE_COLOR, edgeOpacity, edgeWidth, maxDegreeOf, nodeRadius } from './style';

const MARGIN = 24;

/** The same layout drawn flat: used when WebGL is missing or lost. Hover, click and the legend work as in the 3D view. */
export function NetworkSvg({
  network, positions, kinds, hoverId, onHover, onOpen,
}: {
  network: NetworkResponse;
  positions: Map<string, Vec3>;
  kinds: ReadonlySet<NetworkEdgeKind>;
  hoverId: string | null;
  onHover(id: string | null, at: { x: number; y: number } | null): void;
  onOpen(id: string): void;
}) {
  const maxDegree = maxDegreeOf(network.nodes);
  const near = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of network.edges) for (const [x, y] of [[e.a, e.b], [e.b, e.a]] as const) (m.get(x) ?? m.set(x, new Set()).get(x)!).add(y);
    return m;
  }, [network.edges]);
  const box = useMemo(() => {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const n of network.nodes) {
      const p = positions.get(n.oracleId);
      if (!p) continue;
      const r = nodeRadius(n, maxDegree);
      x0 = Math.min(x0, p[0] - r); y0 = Math.min(y0, p[1] - r); x1 = Math.max(x1, p[0] + r); y1 = Math.max(y1, p[1] + r);
    }
    if (!Number.isFinite(x0)) return { x: -100, y: -100, w: 200, h: 200 };
    return { x: x0 - MARGIN, y: y0 - MARGIN, w: x1 - x0 + 2 * MARGIN, h: y1 - y0 + 2 * MARGIN };
  }, [network.nodes, positions, maxDegree]);
  const lit = (id: string) => !hoverId || id === hoverId || (near.get(hoverId)?.has(id) ?? false);
  const art = ART_BOX;

  return (
    <svg
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      className="absolute inset-0 h-full w-full"
      role="img"
      aria-label="How the deck's cards connect"
      data-testid="network-svg"
    >
      <defs>
        {network.nodes.map((n) => (
          <pattern key={n.oracleId} id={`art-${n.oracleId}`} patternContentUnits="objectBoundingBox" width="1" height="1">
            <rect width="1" height="1" fill="#2a261f" />
            <image
              href={imageUrl(n.oracleId, 'grid')}
              x={-art.u / art.w} y={-(1 - art.v - art.h) / art.h} width={1 / art.w} height={1 / art.h}
              preserveAspectRatio="none"
            />
          </pattern>
        ))}
      </defs>
      <g>
        {network.edges.map((e, i) => {
          const a = positions.get(e.a);
          const b = positions.get(e.b);
          if (!a || !b || !kinds.has(e.kind)) return null;
          const on = !hoverId || e.a === hoverId || e.b === hoverId;
          return (
            <line
              key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={EDGE_COLOR[e.kind]}
              strokeWidth={edgeWidth(e)} strokeOpacity={on ? edgeOpacity(e.kind) : 0.06} vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </g>
      <g>
        {network.nodes.map((n) => {
          const p = positions.get(n.oracleId);
          if (!p) return null;
          const r = nodeRadius(n, maxDegree) * (n.oracleId === hoverId ? 1.25 : 1);
          return (
            <g
              key={n.oracleId}
              opacity={lit(n.oracleId) ? 1 : 0.2}
              style={{ cursor: 'pointer' }}
              onPointerEnter={(ev) => { const s = (ev.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect(); onHover(n.oracleId, { x: ev.clientX - s.left, y: ev.clientY - s.top }); }}
              onPointerLeave={() => onHover(null, null)}
              onClick={() => onOpen(n.oracleId)}
              data-node={n.oracleId}
            >
              <circle cx={p[0]} cy={p[1]} r={r} fill={`url(#art-${n.oracleId})`} />
              <circle
                cx={p[0]} cy={p[1]} r={r * 1.1} fill="none" strokeWidth={1.5}
                stroke={n.commander ? '#d6ab52' : n.unconnected ? '#a79d8b' : '#7d7566'}
                strokeDasharray={n.unconnected ? '3 3' : undefined}
              />
            </g>
          );
        })}
      </g>
    </svg>
  );
}
