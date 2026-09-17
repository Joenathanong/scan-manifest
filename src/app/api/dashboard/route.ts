import { prisma } from '@/lib/db';
import { handle, requireUser } from '@/lib/api';
import { dateOnly, isoFromDate, todayISO } from '@/lib/date';
import type { Prisma } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handle(async () => {
    await requireUser();
    const url = new URL(req.url);
    const dari = url.searchParams.get('dari') || todayISO();
    const sampai = url.searchParams.get('sampai') || dari;
    const expedisiId = url.searchParams.get('expedisi');
    const take = Math.min(Number(url.searchParams.get('take') || 200), 1000);
    const skip = Math.max(Number(url.searchParams.get('skip') || 0), 0);

    const range: Prisma.ScanItemWhereInput = {
      scanDate: { gte: dateOnly(dari), lte: dateOnly(sampai) },
      ...(expedisiId ? { expedisiId: Number(expedisiId) } : {}),
    };

    const [awaiting, pickup, voided, byStatusDate, byExpedisi, rows, total, baskets, outbox] =
      await Promise.all([
        prisma.scanItem.count({ where: { ...range, status: 'AWAITING_PICKUP' } }),
        prisma.scanItem.count({ where: { ...range, status: 'PICKUP' } }),
        prisma.scanItem.count({ where: { ...range, status: 'VOID' } }),
        prisma.scanItem.groupBy({
          by: ['scanDate', 'status'],
          where: range,
          _count: { _all: true },
        }),
        prisma.scanItem.groupBy({
          by: ['expedisiId', 'status'],
          where: range,
          _count: { _all: true },
        }),
        prisma.scanItem.findMany({
          where: { ...range, status: 'AWAITING_PICKUP' },
          orderBy: { id: 'desc' },
          take,
          skip,
          select: {
            id: true,
            resi: true,
            scanDate: true,
            scan1At: true,
            expedisi: { select: { code: true, name: true } },
            scan1By: { select: { name: true } },
            session: { select: { code: true } },
          },
        }),
        prisma.scanItem.count({ where: { ...range, status: 'AWAITING_PICKUP' } }),
        prisma.basket.findMany({
          where: { date: { gte: dateOnly(dari), lte: dateOnly(sampai) } },
          orderBy: { id: 'desc' },
          take: 50,
          select: {
            id: true,
            code: true,
            status: true,
            areaId: true,
            createdAt: true,
            closedAt: true,
            expedisi: { select: { code: true } },
            _count: { select: { items: true } },
          },
        }),
        prisma.ocsOutbox.count({ where: { status: { in: ['PENDING', 'RUNNING'] } } }),
      ]);

    const expedisiList = (await prisma.expedisi.findMany({
      select: { id: true, code: true, name: true },
    })) as { id: number; code: string; name: string }[];
    const expedisiName = new Map<number, string>(expedisiList.map((e) => [e.id, e.code]));

    const perTanggalMap = new Map<string, { tanggal: string; awaiting: number; pickup: number; void: number }>();
    type DateGroup = { scanDate: Date; status: string; _count: { _all: number } };
    for (const row of byStatusDate as unknown as DateGroup[]) {
      const iso = isoFromDate(row.scanDate);
      const entry = perTanggalMap.get(iso) ?? { tanggal: iso, awaiting: 0, pickup: 0, void: 0 };
      if (row.status === 'AWAITING_PICKUP') entry.awaiting += row._count._all;
      else if (row.status === 'PICKUP') entry.pickup += row._count._all;
      else entry.void += row._count._all;
      perTanggalMap.set(iso, entry);
    }

    const perExpedisiMap = new Map<string, { code: string; awaiting: number; pickup: number }>();
    type ExpGroup = { expedisiId: number | null; status: string; _count: { _all: number } };
    for (const row of byExpedisi as unknown as ExpGroup[]) {
      const code = row.expedisiId ? expedisiName.get(row.expedisiId) ?? '—' : 'BELUM DIKENALI';
      const entry = perExpedisiMap.get(code) ?? { code, awaiting: 0, pickup: 0 };
      if (row.status === 'AWAITING_PICKUP') entry.awaiting += row._count._all;
      else if (row.status === 'PICKUP') entry.pickup += row._count._all;
      perExpedisiMap.set(code, entry);
    }

    return {
      filter: { dari, sampai, expedisiId: expedisiId ? Number(expedisiId) : null },
      kpi: {
        awaiting,
        pickup,
        void: voided,
        total: awaiting + pickup + voided,
        basketAktif: (baskets as { status: string }[]).filter((b) => b.status !== 'DONE').length,
        outboxTertunda: outbox,
      },
      perTanggal: [...perTanggalMap.values()].sort((a, b) => a.tanggal.localeCompare(b.tanggal)),
      perExpedisi: [...perExpedisiMap.values()].sort((a, b) => b.awaiting - a.awaiting),
      baskets,
      rows,
      total,
      expedisiList,
    };
  });
}
