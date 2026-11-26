import type { ProductsResponse } from '@/app/lib/api';
import { handle, intParam, json } from '@/server/http';
import { searchProducts } from '@/server/products';

export const dynamic = 'force-dynamic';

export const GET = (req: Request) =>
  handle(() => {
    const params = new URL(req.url).searchParams;
    return json(searchProducts(params.get('q') ?? '', intParam(params.get('limit'), 50, 1, 200)) satisfies ProductsResponse);
  });
