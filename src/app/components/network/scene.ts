import type { Group, Sprite, Texture } from 'three';
import { imageUrl } from '@/app/lib/api';
import { configureForces, layoutLinks, layoutNodes } from '@/engine/network/layout';
import type { LayoutLink, LayoutNode } from '@/engine/network/layout';
import type { DeckNetwork, NetworkEdgeKind } from '@/engine/types';
import { ART_BOX, EDGE_COLOR, edgeOpacity, maxDegreeOf, nodeRadius } from './style';

/**
 * The three.js view. Layout, camera, hover and click come from `3d-force-graph` (three.js with
 * d3-force-3d underneath); every node and every edge is our own three.js object: an art-crop sprite in
 * a ring sized by how connected the card is, a dashed ring for cards that connect to nothing, a line
 * per edge in the app's colours. The forces are the ones `layout.ts` shares with the SVG fallback.
 */
export interface SceneHandlers {
  hover(id: string | null, at: { x: number; y: number } | null): void;
  open(id: string): void;
  contextLost(): void;
  settled(settled: boolean): void;
}
export interface NetworkScene {
  /** Shows the edges of these kinds only; returns how many edges are visible now. */
  setKinds(kinds: ReadonlySet<NetworkEdgeKind>): number;
  highlight(id: string | null): void;
  flyTo(ids: readonly string[]): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

interface SceneLink extends LayoutLink { edgeIndex: number }
const PLACEHOLDER_WIDTH = 252; // the server's placeholder image

export async function createNetworkScene(
  container: HTMLElement,
  input: { network: DeckNetwork; names: (id: string) => string; reducedMotion: boolean },
  on: SceneHandlers,
): Promise<NetworkScene> {
  const THREE = await import('three');
  const { default: ForceGraph3D } = await import('3d-force-graph');
  const { network } = input;
  const maxDegree = maxDegreeOf(network.nodes);
  const nodes = layoutNodes(network);
  const links: SceneLink[] = layoutLinks(network).map((l, edgeIndex) => ({ ...l, edgeIndex }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const neighbours = new Map<string, Set<string>>();
  for (const e of network.edges) {
    for (const [x, y] of [[e.a, e.b], [e.b, e.a]] as const) (neighbours.get(x) ?? neighbours.set(x, new Set()).get(x)!).add(y);
  }

  // ---- shared textures -----------------------------------------------------------------------
  const disposables: { dispose(): void }[] = [];
  const canvasTexture = (draw: (g: CanvasRenderingContext2D, size: number) => void, size = 128): Texture => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const g = canvas.getContext('2d');
    if (g) draw(g, size);
    const t = new THREE.CanvasTexture(canvas);
    disposables.push(t);
    return t;
  };
  const disc = canvasTexture((g, s) => { g.fillStyle = '#fff'; g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 1, 0, Math.PI * 2); g.fill(); });
  const ring = (color: string, dashed: boolean): Texture => canvasTexture((g, s) => {
    g.strokeStyle = color;
    g.lineWidth = s * 0.05;
    if (dashed) g.setLineDash([s * 0.09, s * 0.07]);
    g.beginPath();
    g.arc(s / 2, s / 2, s / 2 - s * 0.05, 0, Math.PI * 2);
    g.stroke();
  }, 256);
  const dashedRing = ring('#a79d8b', true);
  const solidRing = ring('#7d7566', false);
  const brassRing = ring('#d6ab52', false);
  const initials = (name: string): Texture => canvasTexture((g, s) => {
    g.fillStyle = '#2a261f';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#efe7d7';
    g.font = `600 ${s * 0.36}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(name.split(/[\s,]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase(), s / 2, s / 2 + s * 0.02);
  });

  // ---- node objects --------------------------------------------------------------------------
  const sprites = new Map<string, { group: Group; art: Sprite; ring: Sprite | null; radius: number }>();
  const loader = new THREE.TextureLoader();
  const makeNode = (node: LayoutNode): Group => {
    const n = node.info;
    const radius = nodeRadius(n, maxDegree);
    const group = new THREE.Group();
    const material = new THREE.SpriteMaterial({ map: initials(input.names(n.oracleId)), alphaMap: disc, transparent: true, depthWrite: false });
    const art = new THREE.Sprite(material);
    art.scale.set(radius * 2, radius * 2, 1);
    group.add(art);
    loader.load(imageUrl(n.oracleId, 'grid'), (tex) => {
      const img = tex.image as HTMLImageElement | undefined;
      if (!img || img.naturalWidth === PLACEHOLDER_WIDTH) { tex.dispose(); return; }
      tex.repeat.set(ART_BOX.w, ART_BOX.h);
      tex.offset.set(ART_BOX.u, ART_BOX.v);
      tex.colorSpace = THREE.SRGBColorSpace;
      material.map = tex;
      material.needsUpdate = true;
      disposables.push(tex);
    });
    let ringSprite: Sprite | null = null;
    const ringMap = n.commander ? brassRing : n.unconnected ? dashedRing : solidRing;
    ringSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringMap, transparent: true, depthWrite: false }));
    ringSprite.scale.set(radius * 2.3, radius * 2.3, 1);
    group.add(ringSprite);
    (group as Group & { userData: { id: string } }).userData = { id: n.oracleId };
    sprites.set(n.oracleId, { group, art, ring: ringSprite, radius });
    return group;
  };

  // ---- the graph -----------------------------------------------------------------------------
  const kinds = new Set<NetworkEdgeKind>(['combo', 'feeds', 'typal', 'commander']);
  const lineObjects: { line: InstanceType<typeof THREE.Line>; link: SceneLink }[] = [];
  const graph = new ForceGraph3D(container, { controlType: 'orbit', rendererConfig: { antialias: true, alpha: true } })
    .backgroundColor('rgba(0,0,0,0)')
    .showNavInfo(false)
    .nodeLabel(() => '')
    .nodeThreeObject((node) => makeNode(node as unknown as LayoutNode))
    .nodeThreeObjectExtend(false)
    .linkVisibility((l) => kinds.has((l as unknown as SceneLink).kind))
    .linkThreeObject((l) => {
      const link = l as unknown as SceneLink;
      const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const material = new THREE.LineBasicMaterial({ color: EDGE_COLOR[link.kind], transparent: true, opacity: edgeOpacity(link.kind), depthWrite: false });
      const line = new THREE.Line(geometry, material);
      line.frustumCulled = false;
      lineObjects.push({ line, link });
      return line;
    })
    .linkThreeObjectExtend(false)
    .linkPositionUpdate((obj, { start, end }) => {
      const pos = (obj as InstanceType<typeof THREE.Line>).geometry.getAttribute('position');
      pos.setXYZ(0, start.x, start.y, start.z);
      pos.setXYZ(1, end.x, end.y, end.z);
      pos.needsUpdate = true;
      return true;
    })
    .warmupTicks(input.reducedMotion ? 300 : 0)
    .cooldownTicks(input.reducedMotion ? 0 : 300)
    .graphData({ nodes: nodes as never[], links: links as never[] });
  configureForces({ get: (name) => graph.d3Force(name) as never, set: (name, f) => void graph.d3Force(name, f as never) }, nodes, links);
  graph.cameraPosition({ x: 0, y: 0, z: 620 });
  const controls = graph.controls() as { enablePan: boolean; minDistance: number; maxDistance: number; enableDamping: boolean };
  controls.enablePan = false;
  controls.minDistance = 150;
  controls.maxDistance = 1600;
  controls.enableDamping = true;

  // ---- hover, click, idle ---------------------------------------------------------------------
  let hoverId: string | null = null;
  let pointer: { x: number; y: number } | null = null;
  let down: { x: number; y: number } | null = null;
  let settled = input.reducedMotion;
  let idle: ReturnType<typeof setTimeout> | null = null;
  const wake = () => {
    graph.resumeAnimation();
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => { if (settled) graph.pauseAnimation(); }, 1500);
  };
  const apply = () => {
    const focus = hoverId;
    const near = focus ? neighbours.get(focus) : null;
    for (const [id, s] of sprites) {
      const lit = !focus || id === focus || (near?.has(id) ?? false);
      (s.art.material as InstanceType<typeof THREE.SpriteMaterial>).opacity = lit ? 1 : 0.2;
      if (s.ring) (s.ring.material as InstanceType<typeof THREE.SpriteMaterial>).opacity = lit ? 1 : 0.2;
      const scale = (id === focus ? 1.25 : 1) * s.radius;
      s.art.scale.set(scale * 2, scale * 2, 1);
      if (s.ring) s.ring.scale.set(scale * 2.3, scale * 2.3, 1);
    }
    for (const { line, link } of lineObjects) {
      const e = network.edges[link.edgeIndex];
      const lit = !focus || e.a === focus || e.b === focus;
      (line.material as InstanceType<typeof THREE.LineBasicMaterial>).opacity = lit ? edgeOpacity(link.kind) : 0.06;
    }
    wake();
  };
  graph.onNodeHover((node) => {
    hoverId = node ? (node as unknown as LayoutNode).id : null;
    container.style.cursor = hoverId ? 'pointer' : 'grab';
    on.hover(hoverId, hoverId ? pointer : null);
    apply();
  });
  graph.onNodeClick((node) => { if (!moved) on.open((node as unknown as LayoutNode).id); });
  let moved = false;
  const onMove = (e: PointerEvent) => {
    const box = container.getBoundingClientRect();
    pointer = { x: e.clientX - box.left, y: e.clientY - box.top };
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) moved = true;
    if (hoverId) on.hover(hoverId, pointer);
    wake();
  };
  const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; moved = false; wake(); };
  const onUp = () => { down = null; };
  container.addEventListener('pointermove', onMove);
  container.addEventListener('pointerdown', onDown);
  container.addEventListener('pointerup', onUp);
  container.addEventListener('wheel', wake, { passive: true });
  const canvas = graph.renderer().domElement;
  const lost = (e: Event) => { e.preventDefault(); on.contextLost(); };
  canvas.addEventListener('webglcontextlost', lost);
  graph.onEngineStop(() => { settled = true; on.settled(true); wake(); });
  if (input.reducedMotion) on.settled(true);

  const visible = (): number => network.edges.filter((e) => kinds.has(e.kind)).length;
  return {
    setKinds(next) {
      kinds.clear();
      for (const k of next) kinds.add(k);
      graph.refresh();
      wake();
      return visible();
    },
    highlight(id) { hoverId = id; apply(); },
    flyTo(ids) {
      const picked = ids.map((id) => byId.get(id)).filter((n): n is LayoutNode => n !== undefined);
      if (picked.length === 0) return;
      const c = picked.reduce((a, n) => [a[0] + n.x / picked.length, a[1] + n.y / picked.length, a[2] + n.z / picked.length], [0, 0, 0]);
      const r = Math.max(40, ...picked.map((n) => Math.hypot(n.x - c[0], n.y - c[1], n.z - c[2])));
      wake();
      graph.cameraPosition({ x: c[0], y: c[1], z: c[2] + Math.min(1600, 2.2 * r + 80) }, { x: c[0], y: c[1], z: c[2] }, input.reducedMotion ? 0 : 600);
    },
    resize(width, height) { graph.width(width).height(height); wake(); },
    dispose() {
      if (idle) clearTimeout(idle);
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('pointerup', onUp);
      container.removeEventListener('wheel', wake);
      canvas.removeEventListener('webglcontextlost', lost);
      graph.pauseAnimation();
      for (const d of disposables) d.dispose();
      for (const { line } of lineObjects) { line.geometry.dispose(); (line.material as InstanceType<typeof THREE.LineBasicMaterial>).dispose(); }
      for (const s of sprites.values()) { (s.art.material as InstanceType<typeof THREE.SpriteMaterial>).dispose(); (s.ring?.material as InstanceType<typeof THREE.SpriteMaterial> | undefined)?.dispose(); }
      graph._destructor();
    },
  };
}
