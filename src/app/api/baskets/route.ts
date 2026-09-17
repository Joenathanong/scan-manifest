import { prisma } from '@/lib/db';
import { handle, requireUser } from '@/lib/api';
import { dateOnly, todayISO } from '@/lib/date';
import type { Prisma } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handle(async () => {
    await requireUser();
    const url = new URL(req.url);
    const dari = url.searchParams.get('dari') || todayISO();
    const sampai = url.searchParams.get('sampai') || dari;
    const status = url.searchParams.get('status');
    const where: Prisma.BasketWhereInput = {
      date: { gte: dateOnly(dari), lte: dateOnly(sampai) },
      ...(status ? { status: status as Prisma.BasketWhereInput['status'] } : {}),
    };
    const rows = await prisma.basket.findMany({
      where,
      orderBy: { id: 'desc' },
      take: 300,
      select: {
        id: true,
        code: true,
        status: true,
        areaId: true,
        date: true,
        createdAt: true,
        closedAt: true,
        note: true,
        expedisi: { select: { code: true, name: true } },
        createdBy: { select: { name: true } },
        _count: { select: { items: true } },
        docs: {
          orderBy: { id: 'desc' },
          take: 1,
          select: { id: true, status: true, ocsDocNo: true, totalValid: true, totalNotValid: true, lastError: true },
        },
      },
    });
    return { rows, filter: { dari, sampai, status } };
  });
}
