/** An error a route answers with `{ error }` and this status. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

/** Runs a route body; `HttpError` and unexpected errors become JSON error responses. */
export async function handle(fn: () => Response | Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
  }
}

export type Body = Record<string, unknown>;

/** The request body as a JSON object; anything else is a 400. */
export async function readBody(req: Request): Promise<Body> {
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    throw new HttpError(400, 'The request body must be JSON.');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new HttpError(400, 'The request body must be a JSON object.');
  return data as Body;
}

export const isObject = (v: unknown): v is Body => typeof v === 'object' && v !== null && !Array.isArray(v);

/** An integer from a query string or body value, clamped; `fallback` when absent or not a number. */
export function intParam(value: unknown, fallback: number, min: number, max: number): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}
