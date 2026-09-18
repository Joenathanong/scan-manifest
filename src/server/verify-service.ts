import { prisma } from '@/lib/db';
import * as ocs from './ocs-client';
import { kredensialUntukUser } from './ocs-credentials';
import { memo } from '@/lib/cache';
import * as lookup from './order-lookup';

/**
 * Pemeriksaan resi Scan 1 ke OCS — SELALU di luar jalur scan.
 *
 * Masalahnya: resi yang polanya tidak dikenali tetap masuk hitungan "awaiting
 * to shipment", termasuk salah tembak barcode atau nomor yang memang tidak ada
 * di OCS. Hitungan jadi lebih besar daripada barang fisiknya.
 *
 * Syaratnya: TIDAK BOLEH memperlambat scan. Jadi scan tetap menyimpan apa
 * adanya dan langsung membalas; barisnya ditandai PENDING, lalu diperiksa
 * belakangan lewat after() sesudah balasan terkirim, dan oleh cron untuk sisa
 * yang tertinggal saat operator berhenti menembak.
 *
 * Cara memeriksanya: CheckInvalidManifest butuh nama kurir, sedangkan kurir
 * resi ini justru yang tidak diketahui. Jadi kurir dicoba satu per satu.
 * Kuncinya ada di BEDA ALASAN penolakan:
 *
 *   "Resi Not Found"  -> resi memang tidak ada pada kurir itu
 *   alasan lain        -> resinya ADA, cuma tidak bisa dimanifest sekarang
 *                         (mis. Wrong Shipper, Cancelled, Shipped)
 *
 * Jadi satu jawaban selain "not found" sudah membuktikan resinya nyata, dan
 * pencarian berhenti di situ. INVALID hanya disimpulkan kalau SEMUA kurir
 * yang dicoba sama-sama bilang tidak ketemu.
 */

const AKTIF = process.env.OCS_VERIFY_SCAN1 !== 'false';
const MAKS_ITEM = Math.max(1, Number(process.env.OCS_VERIFY_BATCH || 3));
/* Jatah waktu sekali jalan. Satu resi bisa perlu belasan panggilan OCS, dan
   after() masih dihitung sebagai durasi fungsi — tanpa batas ini sebuah
   putaran bisa terbunuh Vercel di tengah jalan. */
const JATAH_MS = Math.max(2000, Number(process.env.OCS_VERIFY_BUDGET_MS || 8000));
const MAKS_KURIR = Math.max(1, Number(process.env.OCS_VERIFY_MAKS_KURIR || 12));
const MAKS_PERCOBAAN = 3;
const JEDA_MS = 5000;

const terakhir = ((globalThis as unknown as { __iegVerify?: { pada: number } }).__iegVerify ??= { pada: 0 });

function tidakKetemu(alasan: string): boolean {
  return /not\s*found|tidak\s*ditemukan|tidak\s*ada/i.test(alasan);
}

type Kurir = { id: number; code: string; ocsShipper: string };

function daftarKurir(): Promise<Kurir[]> {
  return memo('verify:kurir', 300, async () => {
    const rows = (await prisma.expedisi.findMany({
      where: { active: true },
      select: { id: true, code: true, ocsShipper: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    })) as Kurir[];
    return rows.slice(0, MAKS_KURIR);
  });
}

type Putusan = {
  state: 'VALID' | 'INVALID' | 'SKIP';
  reason: string | null;
  expedisiId: number | null;
  orderId: string | null;
  tracking: string | null;
};

async function periksaSatu(resi: string, userId: number, batasWaktu: number): Promise<Putusan> {
  // Gratis dulu: kalau sudah ada di pemetaan order, resinya jelas nyata.
  const dariPeta = await lookup.cariOrder(resi);
  if (dariPeta) {
    return {
      state: 'VALID',
      reason: null,
      expedisiId: dariPeta.expedisiId,
      orderId: dariPeta.orderId,
      tracking: dariPeta.trackingNumber,
    };
  }

  if (!ocs.ocsEnabled()) return { state: 'SKIP', reason: 'OCS dimatikan', expedisiId: null, orderId: null, tracking: null };

  const kurir = await daftarKurir();
  if (!kurir.length) return { state: 'SKIP', reason: 'Master ekspedisi kosong', expedisiId: null, orderId: null, tracking: null };

  const cred = await kredensialUntukUser(userId);
  let adaJawaban = false;
  let alasanTerakhir: string | null = null;

  for (const k of kurir) {
    if (Date.now() > batasWaktu) {
      // Waktu habis sebelum semua kurir dicoba — jangan simpulkan apa pun.
      return { state: 'SKIP', reason: 'Waktu pemeriksaan habis', expedisiId: null, orderId: null, tracking: null };
    }
    let hasil;
    try {
      hasil = await ocs.checkInvalidManifest(resi, k.ocsShipper, cred);
    } catch {
      // Jaringan/OCS bermasalah — jangan sampai resi nyata divonis tidak ada.
      return { state: 'SKIP', reason: 'OCS tidak bisa dihubungi', expedisiId: null, orderId: null, tracking: null };
    }
    adaJawaban = true;

    if (hasil.ok) {
      void lookup.simpanSatu(hasil.orderId, hasil.trackingNumber, k.ocsShipper).catch(() => undefined);
      return {
        state: 'VALID',
        reason: null,
        expedisiId: k.id,
        orderId: hasil.orderId || null,
        tracking: hasil.trackingNumber || resi,
      };
    }

    alasanTerakhir = hasil.reason;
    // Alasan selain "tidak ketemu" membuktikan resinya ada.
    if (!tidakKetemu(hasil.reason)) {
      return { state: 'VALID', reason: hasil.reason, expedisiId: null, orderId: null, tracking: null };
    }
  }

  if (!adaJawaban) return { state: 'SKIP', reason: 'Tidak ada jawaban OCS', expedisiId: null, orderId: null, tracking: null };
  return {
    state: 'INVALID',
    reason: alasanTerakhir ?? 'Resi tidak ditemukan di OCS',
    expedisiId: null,
    orderId: null,
    tracking: null,
  };
}

/**
 * Kerjakan sebagian antrean. Dipanggil lewat after() sesudah balasan scan, dan
 * oleh cron untuk sisa yang tertinggal.
 */
export async function verifikasiTertunda(paksa = false): Promise<{ diperiksa: number; invalid: number }> {
  if (!AKTIF) return { diperiksa: 0, invalid: 0 };

  const sekarang = Date.now();
  if (!paksa && sekarang - terakhir.pada < JEDA_MS) return { diperiksa: 0, invalid: 0 };
  terakhir.pada = sekarang;

  type Antre = { id: number; resi: string; scan1ById: number; verifyTries: number };
  const antre = (await prisma.scanItem.findMany({
    where: { verifyState: 'PENDING', verifyTries: { lt: MAKS_PERCOBAAN }, status: { not: 'VOID' } },
    orderBy: { id: 'asc' },
    take: MAKS_ITEM,
    select: { id: true, resi: true, scan1ById: true, verifyTries: true },
  })) as Antre[];
  if (!antre.length) return { diperiksa: 0, invalid: 0 };

  const batasWaktu = sekarang + JATAH_MS;
  let invalid = 0;
  let diperiksa = 0;
  for (const item of antre) {
    if (Date.now() > batasWaktu) break;
    diperiksa += 1;
    const putusan = await periksaSatu(item.resi, item.scan1ById, batasWaktu);

    // SKIP hanya sementara: selama percobaan belum habis, biarkan PENDING
    // supaya dicoba lagi nanti saat OCS pulih atau waktunya cukup.
    const lanjutAntre = putusan.state === 'SKIP' && item.verifyTries + 1 < MAKS_PERCOBAAN;

    await prisma.scanItem.update({
      where: { id: item.id },
      data: {
        verifyState: lanjutAntre ? 'PENDING' : putusan.state,
        verifyReason: putusan.reason?.slice(0, 180) ?? null,
        verifiedAt: lanjutAntre ? null : new Date(),
        verifyTries: { increment: 1 },
        ...(putusan.expedisiId ? { expedisiId: putusan.expedisiId } : {}),
        ...(putusan.orderId ? { ocsOrderId: putusan.orderId } : {}),
        ...(putusan.tracking ? { ocsTracking: putusan.tracking } : {}),
      },
    });
    if (putusan.state === 'INVALID') invalid += 1;
  }

  return { diperiksa, invalid };
}

/** Berapa yang masih diperiksa dan berapa yang divonis tidak ada, untuk panel. */
export async function statusVerifikasi(scanDate: Date) {
  const [menunggu, tidakAda] = await Promise.all([
    prisma.scanItem.count({ where: { scanDate, verifyState: 'PENDING', status: { not: 'VOID' } } }),
    prisma.scanItem.count({ where: { scanDate, verifyState: 'INVALID', status: { not: 'VOID' } } }),
  ]);
  return { menunggu, tidakAda };
}
