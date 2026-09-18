import { prisma, isUniqueViolation, nextSeq, withRetry } from '@/lib/db';
import { ApiError, writeAudit, type SessionUser } from '@/lib/api';
import { cleanResi } from '@/lib/resi';
import { compactDate, dateOnly, todayISO } from '@/lib/date';
import * as ocs from './ocs-client';
import type { OcsScanPayload } from './ocs-client';
import { kredensialUntukUser } from './ocs-credentials';

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

/**
 * BATAS KERAS: kolom basketId di OCS bertipe **varchar(10)**.
 * Dipastikan 17 Sep 2026 lewat pesan asli OCS:
 *   "22001: value too long for type character varying(10)"
 * Kode yang lebih panjang ditolak SEBELUM dokumen manifest terbentuk, jadi
 * panjang ini bukan preferensi tampilan — ini syarat agar data sampai ke OCS.
 */
export const BASKET_MAXLEN = Math.max(6, Number(process.env.BASKET_CODE_MAXLEN || 10));

/**
 * Kode basket yang pasti muat.
 *
 *   <awalan 3><dd><MM><urut>   contoh: JNT1709001  (3+2+2+3 = 10)
 *
 * Awalan diambil dari `ocsPrefix` ekspedisi (atau 3 huruf pertama kodenya),
 * sehingga SICEPAT -> SIC dan ANTERAJA -> ANT tetap muat. Tahun tidak ikut
 * karena basket hanya hidup satu hari; nomor urut per ekspedisi per hari.
 *
 * Kalau suatu saat kolom OCS dilebarkan, naikkan BASKET_CODE_MAXLEN ke 16 dan
 * bentuk panjang yang lebih mudah dibaca (JNT-20260917-001) dipakai otomatis.
 */
export function buildBasketCode(params: {
  expedisiCode: string;
  ocsPrefix?: string | null;
  iso: string;
  seq: number;
}): string {
  const { expedisiCode, ocsPrefix, iso, seq } = params;
  const padat = compactDate(iso); // YYYYMMDD

  const lengkap = `${expedisiCode}-${padat}-${String(seq).padStart(3, '0')}`;
  if (lengkap.length <= BASKET_MAXLEN) return lengkap;

  const awalan = (ocsPrefix || expedisiCode).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 3);
  const hari = padat.slice(6, 8);
  const bulan = padat.slice(4, 6);
  const lebarUrut = Math.max(2, BASKET_MAXLEN - awalan.length - 4);
  return `${awalan}${hari}${bulan}${String(seq).padStart(lebarUrut, '0')}`.slice(0, BASKET_MAXLEN);
}

async function newBasketCode(expedisiCode: string, ocsPrefix: string | null, iso: string) {
  const seq = await nextSeq(`basket:${expedisiCode}:${iso}`);
  return { code: buildBasketCode({ expedisiCode, ocsPrefix, iso, seq }), seq };
}

/**
 * Buat keranjang final BARU tanpa menyentuh OCS.
 * Dipakai tombol "Generate Basket": labelnya bisa langsung dicetak dan
 * ditempel di keranjang, jauh sebelum operator mulai scan tahap 2.
 */
export async function generateBasket(
  user: SessionUser,
  params: { expedisiId: number; areaId: string; note?: string | null },
) {
  const expedisi = await prisma.expedisi.findUnique({ where: { id: params.expedisiId } });
  if (!expedisi || !expedisi.active) throw new ApiError('Ekspedisi tidak ditemukan atau non-aktif.', 404);

  const iso = todayISO();
  const basket = await withRetry(async () => {
    const { code, seq } = await newBasketCode(expedisi.code, expedisi.ocsPrefix, iso);
    try {
      return await prisma.basket.create({
        data: {
          code,
          expedisiId: expedisi.id,
          areaId: params.areaId,
          date: dateOnly(iso),
          seq,
          status: 'OPEN',
          note: params.note ?? null,
          createdById: user.id,
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new Error('write conflict basket code');
      throw e;
    }
  });

  await writeAudit(user.id, 'GENERATE_BASKET', 'Basket', basket.id, { code: basket.code });
  return {
    id: basket.id,
    code: basket.code,
    areaId: basket.areaId,
    status: basket.status,
    expedisi: { id: expedisi.id, code: expedisi.code, name: expedisi.name },
    jumlahItem: 0,
    sudahDipakai: false,
  };
}

/**
 * Basket milik satu ekspedisi pada satu tanggal, lengkap dengan penanda
 * apakah sudah pernah dipakai — supaya operator tidak memakai ulang keranjang
 * yang isinya sudah dimanifest.
 */
export async function daftarBasketTersedia(params: { expedisiId: number; tanggal?: string }) {
  const iso = params.tanggal || todayISO();

  type Row = {
    id: number;
    code: string;
    status: string;
    areaId: string;
    note: string | null;
    createdAt: Date;
    createdBy: { name: string };
    _count: { items: number };
    docs: { id: number; status: string; ocsDocNo: string | null; totalValid: number }[];
  };

  const rows = (await prisma.basket.findMany({
    where: { expedisiId: params.expedisiId, date: dateOnly(iso) },
    orderBy: { seq: 'asc' },
    select: {
      id: true,
      code: true,
      status: true,
      areaId: true,
      note: true,
      createdAt: true,
      createdBy: { select: { name: true } },
      _count: { select: { items: true } },
      docs: {
        orderBy: { id: 'desc' },
        take: 1,
        select: { id: true, status: true, ocsDocNo: true, totalValid: true },
      },
    },
  })) as Row[];

  return {
    tanggal: iso,
    rows: rows.map((b) => {
      const doc = b.docs[0];
      const selesai = b.status === 'DONE' || doc?.status === 'SUBMITTED';
      return {
        id: b.id,
        code: b.code,
        status: b.status,
        areaId: b.areaId,
        note: b.note,
        createdAt: b.createdAt.toISOString(),
        dibuatOleh: b.createdBy.name,
        jumlahItem: b._count.items,
        ocsDocNo: doc?.ocsDocNo ?? null,
        selesai,
        // "Sudah pernah digunakan" = sudah berisi resi atau dokumennya sudah jalan.
        sudahDipakai: selesai || b._count.items > 0 || b.status === 'MANIFESTING',
        bisaDipakai: !selesai,
      };
    }),
  };
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

  if (basket) {
    const sudahSubmit = await prisma.manifestDoc.count({
      where: { basketId: basket.id, status: 'SUBMITTED' },
    });
    if (basket.status === 'DONE' || sudahSubmit > 0) {
      throw new ApiError(
        `Basket ${basket.code} SUDAH PERNAH DIGUNAKAN dan manifestnya sudah dikirim ke OCS. ` +
          'Ambil keranjang lain atau tekan Generate Basket untuk membuat yang baru.',
        409,
      );
    }
    if (basket.expedisiId !== params.expedisiId) {
      throw new ApiError(
        `Basket ${basket.code} milik ekspedisi lain. Pilih basket yang sesuai ekspedisinya.`,
        409,
      );
    }
  }
  if (params.basketCode && params.basketCode.trim().length > BASKET_MAXLEN) {
    throw new ApiError(
      `Kode basket maksimal ${BASKET_MAXLEN} karakter — itu batas kolom basketId di OCS. ` +
        `"${params.basketCode.trim()}" (${params.basketCode.trim().length} karakter) pasti ditolak.`,
    );
  }

  if (!basket) {
    basket = await withRetry(async () => {
      const { code, seq } = await newBasketCode(expedisi.code, expedisi.ocsPrefix, iso);
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
  const akun = await kredensialUntukUser(user.id);
  if (ocs.ocsEnabled()) {
    try {
      const remote = await ocs.startManifest(
        {
          shipper: expedisi.ocsShipper,
          areaId: params.areaId,
          basketId: basket.code,
          isProcessing: !!doc.ocsDocId,
          docId: doc.ocsDocId,
        },
        akun,
      );
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

  const jumlahItem = await prisma.scanItem.count({ where: { basketId: basket.id } });
  const peringatan =
    jumlahItem > 0
      ? `Basket ${basket.code} sudah pernah digunakan dan berisi ${jumlahItem} resi. Scan berikutnya akan MENAMBAH ke basket yang sama.`
      : null;

  await writeAudit(user.id, 'OPEN_DOC', 'ManifestDoc', doc.id, {
    basket: basket.code,
    shipper: expedisi.ocsShipper,
    jumlahItem,
  });

  return {
    docId: doc.id,
    jumlahItem,
    sudahDipakai: jumlahItem > 0,
    peringatan,
    basket: { id: basket.id, code: basket.code, areaId: basket.areaId },
    expedisi: { id: expedisi.id, code: expedisi.code, name: expedisi.name, ocsShipper: expedisi.ocsShipper },
    ocsDocId: doc.ocsDocId,
    ocsDocNo: doc.ocsDocNo,
    ocsWarning,
    akunOcs: akun?.label ?? null,
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

  // Dokumen dan pasangan order ID <-> resi sama-sama hanya butuh docId, jadi
  // ditembak berbarengan (lihat catatan kecepatan di scan-service).
  const [doc, candidate] = await Promise.all([
    prisma.manifestDoc.findUnique({
      where: { id: docId },
      include: { basket: { include: { expedisi: true } } },
    }),
    // Sengaja TIDAK disaring used:false supaya kandidat yang sudah terpakai
    // tetap terbaca — justru itu penanda dobel.
    prisma.manifestCandidate.findFirst({
      where: { docId, OR: [{ trackingNumber: resi }, { orderId: resi }] },
    }),
  ]);
  if (!doc) throw new ApiError('Dokumen manifest tidak ditemukan.', 404);
  if (doc.status === 'SUBMITTED' || doc.status === 'CANCELLED') {
    throw new ApiError('Dokumen ini sudah ditutup. Buka sesi baru.', 409);
  }

  const now = new Date();

  const catatTolak = (reason: string) =>
    prisma.manifestScan.create({
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

  const fail = async (
    status: Scan2Result['status'],
    message: string,
    reason: string,
  ): Promise<Scan2Result> => {
    await catatTolak(reason);
    return { status, tone: 'failed', message, resi, reason, ...(await docTotals(docId)) };
  };

  const dobel = async (message: string, reason = 'Double'): Promise<Scan2Result> => {
    await catatTolak(reason);
    return { status: 'DOUBLE', tone: 'double', message, resi, reason, ...(await docTotals(docId)) };
  };

  if (resi.length < 6) {
    return { status: 'REJECT', tone: 'failed', message: 'Resi terlalu pendek — scan ulang.', resi, ...(await docTotals(docId)) };
  }

  /* ------------------------------------------------------------------
   * Satu paket punya DUA barcode: nomor resi dan order ID. Keduanya boleh
   * discan, tapi hanya salah satu yang boleh dihitung. Jadi sebelum apa pun,
   * yang discan diterjemahkan dulu menjadi SEMUA identitas paket itu, lalu
   * pemeriksaan ganda dilakukan terhadap seluruh identitas tersebut — bukan
   * hanya terhadap teks yang barusan ditembak.
   * ------------------------------------------------------------------ */

  const identitas = [...new Set([resi, candidate?.orderId ?? '', candidate?.trackingNumber ?? ''].filter(Boolean))];

  const cocokIdentitas = [
    { scanResult: { in: identitas } },
    { orderId: { in: identitas } },
    { trackingNumber: { in: identitas } },
  ];
  const cocokItem = [
    { resiUnik: { in: identitas } },
    { ocsOrderId: { in: identitas } },
    { ocsTracking: { in: identitas } },
  ];

  // Tiga pemeriksaan ini saling bebas, jadi dijalankan berbarengan.
  const [already, terpakai, item] = await Promise.all([
    // Sudah pernah discan di basket ini? Dicek lewat ketiga kolom sekaligus,
    // jadi resi yang menyusul order ID (atau sebaliknya) tetap tertangkap.
    prisma.manifestScan.findFirst({
      where: { docId, valid: true, OR: cocokIdentitas },
      select: { scanResult: true, orderId: true, trackingNumber: true },
    }),
    // Paket yang sama sudah dimanifest di basket LAIN.
    prisma.scanItem.findFirst({
      where: { status: 'PICKUP', OR: cocokItem },
      select: { resi: true, basket: { select: { code: true } } },
    }),
    // Baris scan tahap 1 — dicocokkan dengan semua identitas supaya paket yang
    // di tahap 1 discan pakai resi tetap ketemu walau di sini order ID-nya
    // yang ditembak.
    prisma.scanItem.findFirst({
      where: { status: { not: 'VOID' }, OR: cocokItem },
      orderBy: { id: 'asc' },
    }),
  ]);

  if (already) {
    const lewat =
      already.scanResult === resi
        ? 'barcode yang sama'
        : already.scanResult === candidate?.orderId || already.orderId === resi
          ? `order ID ${already.orderId ?? already.scanResult}`
          : `resi ${already.trackingNumber ?? already.scanResult}`;
    return dobel(`${resi} sudah discan di basket ini lewat ${lewat}.`);
  }

  if (terpakai) {
    return dobel(
      `${resi} sudah dimanifest${terpakai.basket ? ` di basket ${terpakai.basket.code}` : ''}.`,
      'Sudah dimanifest',
    );
  }

  if (!item) {
    return fail('NOT_IN_SCAN1', `${resi} belum ada di scan tahap 1.`, 'Belum discan tahap 1');
  }

  // Cocokkan dengan daftar order OCS yang belum dimanifest.
  let orderId = candidate?.orderId ?? '';
  let tracking = candidate?.trackingNumber || resi;

  if (candidate) {
    if (!candidate.used) {
      await prisma.manifestCandidate.update({ where: { id: candidate.id }, data: { used: true } });
    }
  } else if (ocs.ocsEnabled()) {
    try {
      const check = await ocs.checkInvalidManifest(resi, doc.shipper, await kredensialUntukUser(user.id));
      if (!check.ok) return fail('INVALID', `${resi} ditolak OCS: ${check.reason}`, check.reason);
      orderId = check.orderId;
      tracking = check.trackingNumber || resi;

      // OCS baru saja memberi pasangan order ID <-> resi. Periksa ulang dobel
      // dengan identitas yang sekarang sudah lengkap.
      const lengkap = [...new Set([resi, orderId, tracking].filter(Boolean))];
      if (lengkap.length > identitas.length) {
        const susulan = await prisma.manifestScan.findFirst({
          where: {
            docId,
            valid: true,
            OR: [
              { scanResult: { in: lengkap } },
              { orderId: { in: lengkap } },
              { trackingNumber: { in: lengkap } },
            ],
          },
          select: { scanResult: true },
        });
        if (susulan) {
          return dobel(`${resi} sudah discan di basket ini lewat ${susulan.scanResult}.`);
        }
      }
    } catch {
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
  void scan;

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
      await kredensialUntukUser(doc.createdById),
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
      await kredensialUntukUser(doc.createdById),
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

      const akunDoc = await kredensialUntukUser(doc.createdById);

      if (!doc.ocsDocId && ocs.ocsEnabled()) {
        const basket = await prisma.basket.findUnique({ where: { id: doc.basketId } });
        const remote = await ocs.startManifest(
          {
            shipper: doc.shipper,
            areaId: doc.areaId,
            basketId: doc.basketCode,
            isProcessing: false,
          },
          akunDoc,
        );
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
          akunDoc,
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

/**
 * Perbaiki basket yang terlanjur dibuat dengan kode kepanjangan (>10 karakter).
 * Dokumennya belum pernah terbentuk di OCS, jadi mengganti kodenya aman:
 * nomor urut dipertahankan, hanya bentuk kodenya yang dipendekkan.
 * Basket yang sudah SUBMITTED tidak disentuh.
 */
export async function perbaikiKodeBasket(user: SessionUser) {
  type Row = {
    id: number;
    code: string;
    seq: number;
    date: Date;
    status: string;
    expedisi: { code: string; ocsPrefix: string | null };
  };

  const semua = (await prisma.basket.findMany({
    where: { status: { not: 'DONE' } },
    select: {
      id: true,
      code: true,
      seq: true,
      date: true,
      status: true,
      expedisi: { select: { code: true, ocsPrefix: true } },
    },
  })) as Row[];

  const perlu = semua.filter((b) => b.code.length > BASKET_MAXLEN);
  const hasil: { lama: string; baru: string; ok: boolean; pesan?: string }[] = [];

  for (const b of perlu) {
    const iso = b.date.toISOString().slice(0, 10);
    let baru = buildBasketCode({
      expedisiCode: b.expedisi.code,
      ocsPrefix: b.expedisi.ocsPrefix,
      iso,
      seq: b.seq,
    });

    // Kalau kode pendeknya bentrok (mis. dua ekspedisi berawalan sama), ambil urut baru.
    const bentrok = await prisma.basket.findUnique({ where: { code: baru } });
    if (bentrok && bentrok.id !== b.id) {
      const seqBaru = await nextSeq(`basket:${b.expedisi.code}:${iso}`);
      baru = buildBasketCode({
        expedisiCode: b.expedisi.code,
        ocsPrefix: b.expedisi.ocsPrefix,
        iso,
        seq: seqBaru,
      });
    }

    try {
      await withRetry(() => prisma.basket.update({ where: { id: b.id }, data: { code: baru } }));
      await prisma.manifestDoc.updateMany({
        where: { basketId: b.id, status: { not: 'SUBMITTED' } },
        data: { basketCode: baru, lastError: null },
      });
      await writeAudit(user.id, 'RENAME_BASKET', 'Basket', b.id, { lama: b.code, baru });
      hasil.push({ lama: b.code, baru, ok: true });
    } catch (e) {
      hasil.push({ lama: b.code, baru, ok: false, pesan: e instanceof Error ? e.message : 'gagal' });
    }
  }

  return {
    batas: BASKET_MAXLEN,
    diperiksa: semua.length,
    diperbaiki: hasil.filter((h) => h.ok).length,
    gagal: hasil.filter((h) => !h.ok).length,
    hasil,
  };
}
