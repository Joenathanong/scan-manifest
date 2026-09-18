import { prisma } from '@/lib/db';
import { ApiError, handle, requireUser } from '@/lib/api';
import { docTotals } from '@/server/manifest-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ docId: string }> }) {
  return handle(async () => {
    await requireUser();
    const { docId: raw } = await ctx.params;
    const docId = Number(raw);
    const doc = await prisma.manifestDoc.findUnique({
      where: { id: docId },
      include: { basket: { include: { expedisi: true } } },
    });
    if (!doc) throw new ApiError('Dokumen tidak ditemukan.', 404);

    const scans = await prisma.manifestScan.findMany({
      where: { docId },
      orderBy: { id: 'desc' },
      take: 60,
      select: {
        id: true,
        scanResult: true,
        orderId: true,
        valid: true,
        reason: true,
        dupCount: true,
        manifestTime: true,
        syncedAt: true,
      },
    });

    return {
      doc: {
        id: doc.id,
        status: doc.status,
        basketCode: doc.basketCode,
        shipper: doc.shipper,
        areaId: doc.areaId,
        ocsDocId: doc.ocsDocId,
        ocsDocNo: doc.ocsDocNo,
        lastError: doc.lastError,
        lastSyncAt: doc.lastSyncAt,
        expedisi: { id: doc.basket.expedisiId, code: doc.basket.expedisi.code, name: doc.basket.expedisi.name },
      },
      scans,
      ...(await docTotals(docId)),
    };
  });
}
