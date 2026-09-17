import { prisma } from '@/lib/db';
import { ApiError, handle, requireUser } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireUser();
    const { id } = await ctx.params;
    const basket = await prisma.basket.findUnique({
      where: { id: Number(id) },
      include: {
        expedisi: true,
        createdBy: { select: { name: true } },
        docs: { orderBy: { id: 'desc' } },
        items: {
          orderBy: { id: 'desc' },
          select: {
            id: true,
            resi: true,
            status: true,
            scan2At: true,
            ocsState: true,
            ocsOrderId: true,
            ocsReason: true,
            scan2By: { select: { name: true } },
          },
        },
      },
    });
    if (!basket) throw new ApiError('Basket tidak ditemukan.', 404);
    return basket;
  });
}
