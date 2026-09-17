import { prisma } from '@/lib/db';
import { handle, requireUser } from '@/lib/api';
import { dateOnly, todayISO } from '@/lib/date';
import { cleanResi } from '@/lib/resi';
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
    const cari = url.searchParams.get('cari');
    const expedisiId = url.searchParams.get('expedisi');
    const take = Math.min(Number(url.searchParams.get('take') || 200), 1000);
    const skip = Math.max(Number(url.searchParams.get('skip') || 0), 0);

    const where: Prisma.ScanItemWhereInput = cari
      ? { resi: { contains: cleanResi(cari) } }
      : {
          scanDate: { gte: dateOnly(dari), lte: dateOnly(sampai) },
          ...(status ? { status: status as Prisma.ScanItemWhereInput['status'] } : {}),
          ...(expedisiId ? { expedisiId: Number(expedisiId) } : {}),
        };

    const [rows, total] = await Promise.all([
      prisma.scanItem.findMany({
        where,
        orderBy: { id: 'desc' },
        take,
        skip,
        select: {
          id: true,
          resi: true,
          status: true,
          scanDate: true,
          scan1At: true,
          scan2At: true,
          ocsState: true,
          ocsOrderId: true,
          ocsReason: true,
          voidReason: true,
          expedisi: { select: { code: true } },
          basket: { select: { code: true } },
          scan1By: { select: { name: true } },
          scan2By: { select: { name: true } },
        },
      }),
      prisma.scanItem.count({ where }),
    ]);

    return { rows, total, filter: { dari, sampai, status, cari, expedisiId } };
  });
}
