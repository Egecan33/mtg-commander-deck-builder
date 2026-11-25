import { HttpError, handle, json } from '@/server/http';
import { productDetail } from '@/server/products';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const GET = (_req: Request, { params }: Ctx) =>
  handle(async () => {
    const found = productDetail((await params).id);
    if (!found) throw new HttpError(404, 'No such product.');
    return json(found);
  });
