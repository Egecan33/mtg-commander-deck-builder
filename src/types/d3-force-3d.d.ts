declare module 'd3-force-3d' {
  /** A force: the methods the network layout uses; each setter returns the force. */
  export interface Force {
    (alpha: number): void;
    id(fn: (d: never) => string): Force;
    distance(f: number | ((d: never) => number)): Force;
    strength(f: number | ((d: never) => number)): Force;
    distanceMax(n: number): Force;
    iterations(n: number): Force;
  }
  export interface Simulation {
    force(name: string): Force | undefined;
    force(name: string, force: unknown): Simulation;
    stop(): Simulation;
    tick(iterations?: number): Simulation;
    alpha(a: number): Simulation;
    nodes(): unknown[];
  }
  export function forceSimulation(nodes?: unknown[], numDimensions?: 1 | 2 | 3): Simulation;
  export function forceLink(links?: unknown[]): Force;
  export function forceManyBody(): Force;
  export function forceRadial(radius: number | ((d: never) => number), x?: number, y?: number, z?: number): Force;
  export function forceZ(z?: number): Force;
}
