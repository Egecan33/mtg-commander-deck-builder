import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { imageDir } from './store';

export const IMAGE_SIZES: readonly string[] = ['display', 'grid'];
/** `<oracle id>_<face>.webp`: a lower-case UUID, face 0 or 1. Nothing else reaches the file system. */
export const IMAGE_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[01]\.webp$/;

/** A plain card back at the card aspect ratio (63 x 88 mm), shown for images that are not on disk. */
export const PLACEHOLDER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 252 352" width="252" height="352" role="img" aria-label="Card image not available">' +
  '<rect width="252" height="352" rx="13" fill="#17141f"/>' +
  '<rect x="11" y="11" width="230" height="330" rx="8" fill="#241f30" stroke="#4a4160" stroke-width="2"/>' +
  '<ellipse cx="126" cy="176" rx="64" ry="88" fill="none" stroke="#4a4160" stroke-width="3"/>' +
  '<path d="M126 132l12 32h34l-27 21 10 33-29-20-29 20 10-33-27-21h34z" fill="#4a4160"/>' +
  '</svg>';

const text = (status: number, message: string): Response =>
  new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

/**
 * GET /api/img/:size/:file. Card images never change under their name (a new printing is a new
 * sync, served under the same URL only after the file was replaced), so hits are cached for a
 * year. A miss is not cached: the image may arrive with the next sync.
 */
export async function serveImage(size: string, file: string): Promise<Response> {
  if (!IMAGE_SIZES.includes(size)) return text(400, 'size must be display or grid');
  if (!IMAGE_FILE.test(file)) return text(400, 'file must be <oracle id>_<0|1>.webp');
  try {
    const bytes = await readFile(path.join(imageDir(), size, file));
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': 'image/webp',
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return new Response(PLACEHOLDER_SVG, {
      status: 404,
      headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}
