import { prisma, isUniqueViolation, nextSeq, withRetry } from '@/lib/db';
import { ApiError, writeAudit, type SessionUser } from '@/lib/api';
import { cleanResi } from '@/lib/resi';
import { compactDate, dateOnly, todayISO } from '@/lib/date';
import * as ocs from './ocs-client';
import type { OcsScanPayload } from './ocs-client';

export type Scan2Result = {
  status: 'OK' | 'DOUBLE' | 'NOT_IN_SCAN1' | 'INVALID' | 'REJECT';
  tone: 'success' | 'double' | 'failed';
  message: string;
  resi: string;
  orderId?: string;
  reason?: string;
  totalValid: number;
  totalNotValid: number;
  sisaBasket: number;
};

/** Kode basket final: JNT-20260917-001 */
async function newBasketCode(expedisiCode: string, iso: string) {
  const seq = await nextSeq(`basket:${expedisiCode}:${iso}`);
  return { code: `${expedisiCode}-${compactDate(iso)}-${String(seq).padStart(3, '0')}`, seq };
}

/**
 * Buka sesi manifest (SCAN 2).
 * Membuat keranjang final + dokumen OCS, lalu menyalin daftar order
 * yang belum dimanifest sebagai kandidat validasi.
 */
export async function openDoc(
  user: SessionUser,
  params: { expedisiId: number; areaId: string; basketCode?: string | null; note?: string | null },
) {
  const expedisi = await prisma.expedisi.findUnique({ where: { id: params.expedisiId } });
  if (!expedisi || !expedisi.active) throw new ApiError('Ekspedisi tidak ditemukan atau non-aktif.', 404);

  const iso = todayISO();
  const date = dateOnly(iso);

  let basket = params.basketCode
    ? await prisma.basket.findUnique({ where: { code: params.basketCode.trim().toUpperCase() } })
    : null;

  if (basket && basket.status === 'DONE') {
    throw new ApiError(`Basket ${basket.code} sudah selesai dimanifest.`);
  }

  if (!basket) {
    basket = await withRetry(async () => {
      const { code, seq } = await newBasketCode(expedisi.code, iso);
      try {
        return await prisma.basket.create({
          data: {
            code,
            expedisiId: expedisi.id,
            areaId: params.areaId,
            date,
            seq,
            status: 'MANIFESTING',
            note: params.note ?? null,
            createdById: user.id,
          },
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw new Error('write conflict basket code');
        throw e;
      }
    });
  } else {
    await prisma.basket.update({ where: { id: basket.id }, data: { status: 'MANIFESTING' } });
  }

  // Dokumen yang masih terbuka untuk basket ini dipakai ulang, tidak dibuat dobel.
  const open = await prisma.manifestDoc.findFirst({
    where: { basketId: basket.id, status: { in: ['OPEN', 'SYNCING', 'FAILED'] } },
    orderBy: { id: 'desc' },
  });

  const doc =
    open ??
    (await prisma.manifestDoc.create({
      data: {
        basketId: basket.id,
        basketCode: basket.code,
        shipper: expedisi.ocsShipper,
        areaId: params.areaId,
        status: 'OPEN',
        createdById: user.id,
      },
    }));

  let ocsWarning: string | null = null;
  if (ocs.ocsEnabled()) {
    try {
      const remote = await ocs.startManifest({
        shipper: expedisi.ocsShipper,
        areaId: params.areaId,
        basketId: basket.code,
        isProcessing: !!doc.ocsDocId,
        docId: doc.ocsDocId,
      });
      await prisma.manifestDoc.update({
        where: { id: doc.id },
        data: { ocsDocId: remote.DocId, ocsDocNo: remote.DocNo, lastError: null },
      });
      doc.ocsDocId = remote.DocId;
      doc.ocsDocNo = remote.DocNo;

      const items = Array.isArray(remote.Items) ? remote.Items : [];
      await prisma.manifestCandidate.deleteMany({ where: { docId: doc.id } });
      for (let i = 0; i < items.length; i += 500) {
        await prisma.manifestCandidate.createMany({
          data: items.slice(i, i + 500).map((it) => ({
            docId: doc.id,
            orderId: String(it.OrderId ?? ''),
            trackingNumber: cleanResi(String(it.TrackingNumber ?? '')),
          })),
        });
      }
    } catch (e) {
      ocsWarning = e instanceof Error ? e.message : 'OCS tidak bisa dihubungi.';
      await prisma.manifestDoc.update({ where: { id: doc.id }, data: { lastError: ocsWarning } });
    }
  } else {
    ocsWarning = 'Pengiriman ke OCS sedang dimatikan (OCS_ENABLED=false).';
  }

  await writeAudit(user.id, 'OPEN_DOC', 'ManifestDoc', doc.id, {
    basket: basket.code,
    shipper: expedisi.ocsShipper,
  });

  return {
    docId: doc.id,
    basket: { id: basket.id, code: basket.code, areaId: basket.areaId },
    expedisi: { id: expedisi.id, code: expedisi.code, name: expedisi.name, ocsShipper: expedisi.ocsShipper },
    ocsDocId: doc.ocsDocId,
    ocsDocNo: doc.ocsDocNo,
    ocsWarning,
    ...(await docTotals(doc.id)),
  };
}

export async function docTotals(docId: number) {
  const [totalValid, totalNotValid, sisaBasket] = await Promise.all([
    prisma.manifestScan.count({ where: { docId, valid: true } }),
    prisma.manifestScan.count({ where: { docId, valid: false } }),
    prisma.scanItem.count({ where: { manifestDocId: docId, status: 'PICKUP' } }),
  ]);
  return { totalValid, totalNotValid, sisaBasket };
}

/** SCAN 2 — resi diikat ke basket, status jadi PICKUP, lalu dikirim ke OCS. */
export async function scanSecond(user: SessionUser, docId: number, rawResi: string): Promise<Scan2Result> {
  const resi = cleanResi(rawResi);
  const doc = await prisma.manifestDoc.findUnique({
    where: { id: docId },
    include: { basket: { include: { expedisi: true } } },
  });
  if (!doc) throw new ApiError('Dokumen manifest tidak ditemukan.', 404);
  if (doc.status === 'SUBMITTED' || doc.status === 'CANCELLED') {
    throw new ApiError('Dokumen ini sudah ditutup. Buka sesi baru.', 409);
  }

  const now = new Date();
  const fail = async (
    status: Scan2Result['status'],
    message: string,
    reason: string,
  ): Promise<Scan2Result> => {
    await prisma.manifestScan.create({
      data: {
        docId,
        scanResult: resi,
        manifestTime: now,
        shippingProvider: doc.shipper,
        valid: false,
        reason: reason.slice(0, 180),
        scannedById: user.id,
      },
    });
    return { status, tone: 'failed', message, resi, reason, ...(await docTotals(docId)) };
  };

  if (resi.length < 6) {
    return { status: 'REJECT', tone: 'failed', message: 'Resi terlalu pendek — scan ulang.', resi, ...(await docTotals(docId)) };
  }

  const already = await prisma.manifestScan.findFirst({ where: { docId, scanResult: resi, valid: true } });
  if (already) {
    await prisma.manifestScan.create({
      data: {
        docId,
        scanResult: resi,
        manifestTime: now,
        shippingProvider: doc.shipper,
        valid: false,
        reason: 'Double',
        scannedById: user.id,
      },
    });
    return {
      status: 'DOUBLE',
      tone: 'double',
      message: `${resi} sudah discan di basket ini.`,
      resi,
      reason: 'Double',
      ...(await docTotals(docId)),
    };
  }

  const item = await prisma.scanItem.findUnique({ where: { resiUnik: resi } });
  if (!item) {
    return fail('NOT_IN_SCAN1', `${resi} belum ada di scan tahap 1.`, 'Belum discan tahap 1');
  }
  if (item.status === 'PICKUP') {
    return fail('DOUBLE', `${resi} sudah dimanifest di basket lain.`, 'Sudah dimanifest');
  }

  // Cocokkan dengan daftar order OCS yang belum dimanifest.
  let orderId = '';
  let tracking = resi;
  const candidate = await prisma.manifestCandidate.findFirst({
    where: { docId, used: false, OR: [{ trackingNumber: resi }, { orderId: resi }] },
  });

  if (candidate) {
    orderId = candidate.orderId;
    tracking = candidate.trackingNumber || resi;
    await prisma.manifestCandidate.update({ where: { id: candidate.id }, data: { used: true } });
  } else if (ocs.ocsEnabled()) {
    try {
      const check = await ocs.checkInvalidManifest(resi, doc.shipper);
      if (!check.ok) return fail('INVALID', `${resi} ditolak OCS: ${check.reason}`, check.reason);
      orderId = check.orderId;
      tracking = check.trackingNumber || resi;
    } catch (e) {
      // OCS tidak bisa dihubungi: scan TETAP diterima, sinkronisasi menyusul.
      orderId = '';
    }
  }

  const scan = await prisma.manifestScan.create({
    data: {
      docId,
      scanResult: resi,
      manifestTime: now,
      orderId: orderId || null,
      trackingNumber: tracking,
      shippingProvider: doc.shipper,
      valid: true,
      itemId: item.id,
      scannedById: user.id,
    },
  });

  await withRetry(() =>
    prisma.scanItem.update({
      where: { id: item.id },
      data: {
        status: 'PICKUP',
        basketId: doc.basketId,
        expedisiId: doc.basket.expedisiId,
        manifestDocId: docId,
        scan2At: now,
        scan2ById: user.id,
        ocsState: 'PENDING',
        ocsOrderId: orderId || null,
        ocsTracking: tracking,
      },
    }),
  );

  // Sinkron otomatis tiap 50 scan supaya tidak menumpuk.
  const totals = await docTotals(docId);
  if (totals.totalValid > 0 && totals.totalValid % 50 === 0) {
    void syncDoc(docId).catch(() => undefined);
  }

  return {
    status: 'OK',
    tone: 'success',
    message: `${resi} berhasil dimanifest.`,
    resi,
    orderId: orderId || undefined,
    ...totals,
  };
}

function payloadOf(rows: { scanResult: string; manifestTime: Date; orderId: string | null; trackingNumber: string | null; shippingProvider: string }[]): OcsScanPayload[] {
  return rows.map((r) => ({
    ScanResult: r.scanResult,
    ManifestTime: r.manifestTime.toISOString(),
    OrderId: r.orderId ?? '',
    TrackingNumber: r.trackingNumber ?? r.scanResult,
    ShippingProvider: r.shippingProvider,
  }));
}

/** Kirim scan yang belum tersinkron ke OCS (SaveTemporaryManifestV2). */
export async function syncDoc(docId: number): Promise<{ sent: number; error: string | null }> {
  const doc = await prisma.manifestDoc.findUnique({ where: { id: docId } });
  if (!doc) throw new ApiError('Dokumen tidak ditemukan.', 404);
  if (!ocs.ocsEnabled() || !doc.ocsDocId) return { sent: 0, error: doc.lastError };

  type PendingRow = {
    id: number;
    itemId: number | null;
    scanResult: string;
    manifestTime: Date;
    orderId: string | null;
    trackingNumber: string | null;
    shippingProvider: string;
  };
  const pending = (await prisma.manifestScan.findMany({
    where: { docId, valid: true, syncedAt: null },
    orderBy: { id: 'asc' },
  })) as PendingRow[];
  if (!pending.length) return { sent: 0, error: null };

  try {
    await ocs.saveTemporaryManifest(
      { shipper: doc.shipper, basketId: doc.basketCode, areaId: doc.areaId, docId: doc.ocsDocId },
      payloadOf(pending),
    );
    const now = new Date();
    await prisma.manifestScan.updateMany({
      where: { id: { in: pending.map((p) => p.id) } },
      data: { syncedAt: now },
    });
    await prisma.scanItem.updateMany({
      where: { id: { in: pending.map((p) => p.itemId).filter((x): x is number => !!x) } },
      data: { ocsState: 'SENT', ocsSentAt: now },
    });
    await prisma.manifestDoc.update({
      where: { id: docId },
      data: { lastSyncAt: now, lastError: null, status: doc.status === 'FAILED' ? 'OPEN' : doc.status },
    });
    return { sent: pending.length, error: null };
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Gagal sinkron ke OCS.';
    await prisma.manifestDoc.update({ where: { id: docId }, data: { lastError: error } });
    await enqueue('SYNC', docId);
    return { sent: 0, error };
  }
}

/** Submit final ke OCS lalu tutup basket. */
export async function submitDoc(user: SessionUser, docId: number) {
  const doc = await prisma.manifestDoc.findUnique({ where: { id: docId } });
  if (!doc) throw new ApiError('Dokumen tidak ditemukan.', 404);
  if (doc.status === 'SUBMITTED') throw new ApiError('Dokumen ini sudah disubmit.');

  const rows = await prisma.manifestScan.findMany({
    where: { docId, valid: true },
    orderBy: { id: 'asc' },
  });
  if (!rows.length) throw new ApiError('Belum ada resi yang discan di basket ini.');

  const totals = await docTotals(docId);

  if (!ocs.ocsEnabled() || !doc.ocsDocId) {
    await enqueue('SUBMIT', docId);
    await prisma.manifestDoc.update({
      where: { id: docId },
      data: {
        status: 'SYNCING',
        totalValid: totals.totalValid,
        totalNotValid: totals.totalNotValid,
        lastError: 'OCS tidak aktif / dokumen OCS belum terbentuk — masuk antrean kirim.',
      },
    });
    return { ...totals, submitted: false, queued: true, error: 'Masuk antrean pengiriman ke OCS.' };
  }

  const sync = await syncDoc(docId);
  if (sync.error) {
    await prisma.manifestDoc.update({ where: { id: docId }, data: { status: 'SYNCING' } });
    return { ...totals, submitted: false, queued: true, error: sync.error };
  }

  try {
    await ocs.submitManifest(
      { shipper: doc.shipper, basketId: doc.basketCode, areaId: doc.areaId, docId: doc.ocsDocId },
      payloadOf(rows),
    );
    const now = new Date();
    await prisma.manifestDoc.update({
      where: { id: docId },
      data: {
        status: 'SUBMITTED',
        finishedAt: now,
        totalValid: totals.totalValid,
        totalNotValid: totals.totalNotValid,
        lastError: null,
      },
    });
    await prisma.basket.update({
      where: { id: doc.basketId },
      data: { status: 'DONE', closedAt: now },
    });
    await prisma.scanItem.updateMany({
      where: { manifestDocId: docId },
      data: { ocsState: 'SENT', ocsSentAt: now },
    });
    await writeAudit(user.id, 'SUBMIT_DOC', 'ManifestDoc', docId, { basket: doc.basketCode, ...totals });
    return { ...totals, submitted: true, queued: false, error: null };
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Submit ke OCS gagal.';
    await prisma.manifestDoc.update({ where: { id: docId }, data: { status: 'SYNCING', lastError: error } });
    await enqueue('SUBMIT', docId);
    return { ...totals, submitted: false, queued: true, error };
  }
}

export async function cancelDoc(user: SessionUser, docId: number, reason: string) {
  const doc = await prisma.manifestDoc.findUnique({ where: { id: docId } });
  if (!doc) throw new ApiError('Dokumen tidak ditemukan.', 404);
  if (doc.status === 'SUBMITTED') throw new ApiError('Dokumen sudah disubmit, tidak bisa dibatalkan di sini.');

  await prisma.manifestDoc.update({
    where: { id: docId },
    data: { status: 'CANCELLED', finishedAt: new Date(), lastError: reason.slice(0, 180) },
  });
  // Resi dikembalikan ke antrean scan 1.
  await prisma.scanItem.updateMany({
    where: { manifestDocId: docId },
    data: {
      status: 'AWAITING_PICKUP',
      basketId: null,
      manifestDocId: null,
      scan2At: null,
      scan2ById: null,
      ocsState: 'NONE',
      ocsOrderId: null,
      ocsTracking: null,
      ocsSentAt: null,
    },
  });
  await prisma.basket.update({ where: { id: doc.basketId }, data: { status: 'CLOSED' } });
  await writeAudit(user.id, 'CANCEL_DOC', 'ManifestDoc', docId, { reason });
  return { ok: true };
}

export async function enqueue(kind: 'SYNC' | 'SUBMIT', docId: number) {
  const existing = await prisma.ocsOutbox.findFirst({
    where: { kind, docId, status: { in: ['PENDING', 'RUNNING'] } },
  });
  if (existing) return existing;
  return prisma.ocsOutbox.create({ data: { kind, docId, status: 'PENDING' } });
}

/** Dipanggil cron Vercel tiap 10 menit — mengirim ulang yang tertunda. */
export async function flushOutbox(limit = 20) {
  const jobs = await prisma.ocsOutbox.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
    orderBy: { id: 'asc' },
    take: limit,
  });

  const results: { id: number; kind: string; docId: number | null; ok: boolean; error?: string }[] = [];
  for (const job of jobs) {
    await prisma.ocsOutbox.update({ where: { id: job.id }, data: { status: 'RUNNING' } });
    try {
      if (!job.docId) throw new Error('Job tanpa docId.');
      const doc = await prisma.manifestDoc.findUnique({ where: { id: job.docId } });
      if (!doc) throw new Error('Dokumen sudah tidak ada.');

      if (!doc.ocsDocId && ocs.ocsEnabled()) {
        const basket = await prisma.basket.findUnique({ where: { id: doc.basketId } });
        const remote = await ocs.startManifest({
          shipper: doc.shipper,
          areaId: doc.areaId,
          basketId: doc.basketCode,
          isProcessing: false,
        });
        await prisma.manifestDoc.update({
          where: { id: doc.id },
          data: { ocsDocId: remote.DocId, ocsDocNo: remote.DocNo },
        });
        doc.ocsDocId = remote.DocId;
        void basket;
      }

      const sync = await syncDoc(job.docId);
      if (sync.error) throw new Error(sync.error);

      if (job.kind === 'SUBMIT' && doc.ocsDocId) {
        const rows = await prisma.manifestScan.findMany({
          where: { docId: job.docId, valid: true },
          orderBy: { id: 'asc' },
        });
        await ocs.submitManifest(
          { shipper: doc.shipper, basketId: doc.basketCode, areaId: doc.areaId, docId: doc.ocsDocId },
          payloadOf(rows),
        );
        const now = new Date();
        await prisma.manifestDoc.update({
          where: { id: job.docId },
          data: { status: 'SUBMITTED', finishedAt: now, lastError: null },
        });
        await prisma.basket.update({ where: { id: doc.basketId }, data: { status: 'DONE', closedAt: now } });
        await prisma.scanItem.updateMany({
          where: { manifestDocId: job.docId },
          data: { ocsState: 'SENT', ocsSentAt: now },
        });
      }

      await prisma.ocsOutbox.update({
        where: { id: job.id },
        data: { status: 'DONE', doneAt: new Date(), lastError: null },
      });
      results.push({ id: job.id, kind: job.kind, docId: job.docId, ok: true });
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Gagal.';
      const attempts = job.attempts + 1;
      await prisma.ocsOutbox.update({
        where: { id: job.id },
        data: {
          status: attempts >= 10 ? 'FAILED' : 'PENDING',
          attempts,
          lastError: error,
          nextAttemptAt: new Date(Date.now() + Math.min(30, attempts * 5) * 60 * 1000),
        },
      });
      results.push({ id: job.id, kind: job.kind, docId: job.docId, ok: false, error });
    }
  }
  return { processed: jobs.length, results };
}
