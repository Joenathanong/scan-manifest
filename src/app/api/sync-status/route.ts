import { prisma } from '@/lib/db';
import { handle, requireUser } from '@/lib/api';
import { ocsEnabled } from '@/server/ocs-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Dipakai lonceng status di topbar: apakah data kita sudah sama dengan OCS?
 * Angka > 0 di salah satu kolom berarti ADA SELISIH yang belum terkirim.
 */
export async function GET() {
  return handle(async () => {
    await requireUser();
    const [outboxPending, outboxFailed, docsBermasalah, scanBelumSinkron, itemPending] = await Promise.all([
      prisma.ocsOutbox.count({ where: { status: { in: ['PENDING', 'RUNNING'] } } }),
      prisma.ocsOutbox.count({ where: { status: 'FAILED' } }),
      prisma.manifestDoc.findMany({
        where: { OR: [{ status: { in: ['SYNCING', 'FAILED'] } }, { lastError: { not: null } }] },
        orderBy: { id: 'desc' },
        take: 20,
        select: {
          id: true,
          basketCode: true,
          status: true,
          lastError: true,
          lastSyncAt: true,
          totalValid: true,
          ocsDocNo: true,
        },
      }),
      prisma.manifestScan.count({ where: { valid: true, syncedAt: null } }),
      prisma.scanItem.count({ where: { ocsState: { in: ['PENDING', 'FAILED'] } } }),
    ]);

    const selisih = outboxPending + outboxFailed + scanBelumSinkron;
    return {
      ocsAktif: ocsEnabled(),
      outboxPending,
      outboxFailed,
      scanBelumSinkron,
      itemPending,
      docsBermasalah,
      selisih,
      sehat: selisih === 0,
      waktuServer: new Date().toISOString(),
    };
  });
}
