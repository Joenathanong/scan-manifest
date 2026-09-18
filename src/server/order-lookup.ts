import { prisma } from '@/lib/db';
import { cleanResi } from '@/lib/resi';
import { memo, lupakan } from '@/lib/cache';

/**
 * Pemetaan order ID <-> nomor resi <-> kurir.
 *
 * Sumbernya daftar Items dari OCS yang SUDAH diambil saat Scan 2 membuka
 * dokumen manifest. Jadi tabel ini terisi sendiri dari lalu lintas yang sudah
 * ada — tidak ada satu pun panggilan OCS tambahan, dan tidak ada dokumen
 * manifest baru yang tidak sengaja terbentuk di OCS.
 *
 * Yang dipakainya: Scan 1. Kalau operator menembak barcode ORDER ID, pola
 * nomornya tidak cocok dengan prefix ekspedisi mana pun, jadi tanpa tabel ini
 * resi tersebut masuk sebagai "BELUM DIKENALI" sampai diproses di Scan 2.
 */

export type HasilLookup = {
  orderId: string;
  trackingNumber: string;
  shipper: string;
  expedisiId: number | null;
  expedisiCode: string | null;
};

/** shipper OCS ("J&T") -> ekspedisi lokal. Dipakai dua arah, jadi di-cache. */
async function petaShipper(): Promise<Map<string, { id: number; code: string }>> {
  return memo('lookup:shipper', 300, async () => {
    const rows = (await prisma.expedisi.findMany({
      select: { id: true, code: true, ocsShipper: true },
    })) as { id: number; code: string; ocsShipper: string }[];
    return new Map(rows.map((e) => [e.ocsShipper.trim().toUpperCase(), { id: e.id, code: e.code }]));
  });
}

export function lupakanPetaShipper() {
  lupakan('lookup:shipper');
}

/**
 * Simpan daftar Items OCS ke tabel pemetaan.
 *
 * createMany + skipDuplicates dipakai supaya satu basket berisi ribuan order
 * tetap cukup beberapa perjalanan ke database. Order yang sudah ada dilewati,
 * bukan ditimpa — isinya toh sama, dan menimpa berarti satu UPDATE per baris.
 */
export async function simpanDariItems(
  items: { OrderId?: unknown; TrackingNumber?: unknown }[],
  shipper: string,
): Promise<number> {
  const peta = await petaShipper();
  const ekspedisi = peta.get(shipper.trim().toUpperCase()) ?? null;

  const baris = items
    .map((it) => ({
      orderId: String(it.OrderId ?? '').trim().toUpperCase(),
      trackingNumber: cleanResi(String(it.TrackingNumber ?? '')),
      shipper,
      expedisiId: ekspedisi?.id ?? null,
    }))
    .filter((b) => b.orderId && b.trackingNumber);

  if (!baris.length) return 0;

  // Buang orderId kembar di dalam satu kiriman — createMany menolak batch yang
  // bentrok dengan dirinya sendiri walau skipDuplicates menyala.
  const unik = [...new Map(baris.map((b) => [b.orderId, b])).values()];

  let masuk = 0;
  for (let i = 0; i < unik.length; i += 500) {
    const hasil = await prisma.orderLookup.createMany({
      data: unik.slice(i, i + 500),
      skipDuplicates: true,
    });
    masuk += hasil.count;
  }
  return masuk;
}

/** Simpan satu pasangan hasil CheckInvalidManifest. */
export async function simpanSatu(orderId: string, trackingNumber: string, shipper: string): Promise<void> {
  const oid = orderId.trim().toUpperCase();
  const resi = cleanResi(trackingNumber);
  if (!oid || !resi) return;
  const peta = await petaShipper();
  const ekspedisi = peta.get(shipper.trim().toUpperCase()) ?? null;
  try {
    await prisma.orderLookup.upsert({
      where: { orderId: oid },
      create: { orderId: oid, trackingNumber: resi, shipper, expedisiId: ekspedisi?.id ?? null },
      update: { trackingNumber: resi, shipper, expedisiId: ekspedisi?.id ?? null, syncedAt: new Date() },
    });
  } catch {
    // Pemetaan hanya pelengkap — kegagalannya tidak boleh menggagalkan scan.
  }
}

/**
 * Cari satu nilai yang discan, entah itu order ID atau nomor resi.
 * Mengembalikan null kalau tidak ada di pemetaan.
 */
export async function cariOrder(nilai: string): Promise<HasilLookup | null> {
  const cari = cleanResi(nilai);
  if (!cari) return null;

  const row = (await prisma.orderLookup.findFirst({
    where: { OR: [{ orderId: cari }, { trackingNumber: cari }] },
    orderBy: { syncedAt: 'desc' },
  })) as {
    orderId: string;
    trackingNumber: string;
    shipper: string;
    expedisiId: number | null;
  } | null;
  if (!row) return null;

  const peta = await petaShipper();
  const ekspedisi = peta.get(row.shipper.trim().toUpperCase()) ?? null;
  return {
    orderId: row.orderId,
    trackingNumber: row.trackingNumber,
    shipper: row.shipper,
    expedisiId: row.expedisiId ?? ekspedisi?.id ?? null,
    expedisiCode: ekspedisi?.code ?? null,
  };
}

/** Berapa banyak pemetaan yang tersimpan, untuk panel Admin. */
export async function statistikLookup() {
  const [total, terbaru] = await Promise.all([
    prisma.orderLookup.count(),
    prisma.orderLookup.findFirst({ orderBy: { syncedAt: 'desc' }, select: { syncedAt: true } }),
  ]);
  return { total, terbaru: terbaru?.syncedAt ?? null };
}
