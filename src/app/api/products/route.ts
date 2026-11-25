import type { ProductsResponse } from '@/app/lib/api';
import { handle, intParam, json } from '@/server/http';
import { listProducts } from '@/server/products';

export const dynamic = 'force-dynamic';

export const GET = (req: Request) =>
  handle(() => {
    const params = new URL(req.url).searchParams;
    const products = listProducts(params.get('q') ?? '', intParam(params.get('limit'), 50, 1, 200));
    return json({ products } satisfies ProductsResponse);
  });
