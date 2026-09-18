import { after } from 'next/server';
import { prisma } from '@/lib/db';
import { handle, requireUser } from '@/lib/api';
import { ocsEnabled } from '@/server/ocs-client';
import { flushOutbox } from '@/server/manifest-service';
import { verifikasiTertunda } from '@/server/verify-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Vercel paket Hobby hanya mengizinkan cron 1x sehari, jadi cron TIDAK bisa
 * jadi satu-satunya pengirim ulang. Selama ada halaman terbuka, lonceng status
 * memanggil endpoint ini tiap 30 detik — di sinilah antrean ikut dikirim ulang.
 * Throttle 20 detik per instance supaya banyak PDT sekaligus tidak saling tabrak
 * (baris outbox sendiri sudah dijaga status RUNNING).
 */
const globalForFlush = globalThis as unknown as { __lastAutoFlush?: number };
const JEDA_MS = 20000;

async function autoFlush(pending: number) {
  if (!pending || !ocsEnabled()) return null;
  const now = Date.now();
  if (globalForFlush.__lastAutoFlush && now - globalForFlush.__lastAutoFlush < JEDA_MS) return null;
  globalForFlush.__lastAutoFlush = now;
  try {
    return await flushOutbox(5);
  } catch {
    return null;
  }
}

export async function GET() {
  return handle(async () => {
    await requireUser();

    const siapKirim = await prisma.ocsOutbox.count({
      where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
    });
    const autoFlushResult = await autoFlush(siapKirim);

    // Saat operator berhenti menembak, tidak ada lagi permintaan scan yang
    // memicu pemeriksaan. Lonceng status dipanggil tiap 30 detik selama ada
    // halaman terbuka, jadi sisa antrean ikut dibereskan dari sini.
    after(() => verifikasiTertunda());

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
      autoFlush: autoFlushResult ? autoFlushResult.processed : 0,
      waktuServer: new Date().toISOString(),
    };
  });
}
