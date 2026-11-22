import { collectionCsv, listCollections } from '@/server/collection';
import { HttpError, handle } from '@/server/http';

export const dynamic = 'force-dynamic';

/** A collection (the active one unless `?id=` names another) as a CSV download that the import reads back. */
export const GET = (req: Request) =>
  handle(() => {
    const wanted = new URL(req.url).searchParams.get('id');
    const collection = listCollections().find((c) => (wanted ? c.id === wanted : c.active));
    if (!collection) throw new HttpError(404, `There is no collection "${wanted}".`);
    const day = new Date().toISOString().slice(0, 10);
    return new Response(collectionCsv(collection.id), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="commander-forge-${collection.id}-collection-${day}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  });
