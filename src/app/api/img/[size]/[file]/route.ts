import { serveImage } from '@/server/images';

type Ctx = { params: Promise<{ size: string; file: string }> };

export const GET = async (_req: Request, { params }: Ctx) => {
  const { size, file } = await params;
  return serveImage(size, file);
};
