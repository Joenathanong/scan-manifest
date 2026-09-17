import { prisma } from '@/lib/db';
import { dateOnly } from '@/lib/date';

/**
 * "Resi menggantung" = alurnya tidak lengkap.
 *
 * Alur normal: scan 1 -> sortir -> scan 2 -> terkirim ke OCS.
 * Empat cara alur itu bisa putus, dan keempatnya harus kelihatan:
 *
 *  A. SCAN1_TANPA_SCAN2  resi sudah discan tahap 1, lewat batas jam, belum dimanifest
 *  B. SCAN2_TANPA_SCAN1  resi muncul di scan 2 padahal tidak pernah discan tahap 1
 *  C. BELUM_SAMPAI_OCS   sudah dimanifest tapi datanya belum diterima OCS
 *  D. BASKET_MENGGANTUNG basket dibuka lalu tidak pernah disubmit
 */
export type JenisAnomali = 'SCAN1_TANPA_SCAN2' | 'SCAN2_TANPA_SCAN1' | 'BELUM_SAMPAI_OCS' | 'BASKET_MENGGANTUNG';

export type BarisAnomali = {
  jenis: JenisAnomali;
  resi: string;
  ekspedisi: string | null;
  basket: string | null;
  waktu: string;
  umurJam: number;
  operator: string;
  keterangan: string;
  itemId: number | null;
};

export const LABEL_ANOMALI: Record<JenisAnomali, string> = {
  SCAN1_TANPA_SCAN2: 'Scan 1 tanpa scan 2',
  SCAN2_TANPA_SCAN1: 'Scan 2 tanpa scan 1',
  BELUM_SAMPAI_OCS: 'Belum sampai OCS',
  BASKET_MENGGANTUNG: 'Basket belum disubmit',
};

const JAM = 3600 * 1000;

function umur(sejak: Date, sekarang: Date) {
  return Math.max(0, Math.round(((sekarang.getTime() - sejak.getTime()) / JAM) * 10) / 10);
}

export async function cariAnomali(params: {
  dari: string;
  sampai: string;
  batasJam?: number;
  expedisiId?: number | null;
  take?: number;
}) {
  const { dari, sampai, expedisiId } = params;
  const batasJam = params.batasJam ?? 12;
  const take = params.take ?? 300;
  const sekarang = new Date();
  const ambang = new Date(sekarang.getTime() - batasJam * JAM);
  const rentang = { gte: dateOnly(dari), lte: dateOnly(sampai) };

  type ItemRow = {
    id: number;
    resi: string;
    scan1At: Date;
    scan2At: Date | null;
    ocsState: string;
    ocsReason: string | null;
    expedisi: { code: string } | null;
    basket: { code: string } | null;
    scan1By: { name: string };
    scan2By: { name: string } | null;
  };

  const pilih = {
    id: true,
    resi: true,
    scan1At: true,
    scan2At: true,
    ocsState: true,
    ocsReason: true,
    expedisi: { select: { code: true } },
    basket: { select: { code: true } },
    scan1By: { select: { name: true } },
    scan2By: { select: { name: true } },
  } as const;

  /* A. discan tahap 1, sudah lewat batas jam, belum dimanifest */
  const scan1TanpaScan2 = (await prisma.scanItem.findMany({
    where: {
      scanDate: rentang,
      status: 'AWAITING_PICKUP',
      scan1At: { lt: ambang },
      ...(expedisiId ? { expedisiId } : {}),
    },
    orderBy: { scan1At: 'asc' },
    take,
    select: pilih,
  })) as ItemRow[];

  /* C. sudah dimanifest tapi belum diterima OCS */
  const belumSampaiOcs = (await prisma.scanItem.findMany({
    where: {
      scanDate: rentang,
      status: 'PICKUP',
      ocsState: { in: ['PENDING', 'FAILED'] },
      ...(expedisiId ? { expedisiId } : {}),
    },
    orderBy: { scan2At: 'asc' },
    take,
    select: pilih,
  })) as ItemRow[];

  /* B. muncul di scan 2 tanpa pernah discan tahap 1 */
  type ScanRow = {
    id: number;
    scanResult: string;
    manifestTime: Date;
    reason: string | null;
    shippingProvider: string;
    scannedBy: { name: string };
    doc: { basketCode: string };
  };
  const scan2TanpaScan1 = (await prisma.manifestScan.findMany({
    where: {
      valid: false,
      reason: 'Belum discan tahap 1',
      manifestTime: { gte: dateOnly(dari), lte: new Date(dateOnly(sampai).getTime() + 24 * JAM) },
    },
    orderBy: { id: 'desc' },
    take,
    select: {
      id: true,
      scanResult: true,
      manifestTime: true,
      reason: true,
      shippingProvider: true,
      scannedBy: { select: { name: true } },
      doc: { select: { basketCode: true } },
    },
  })) as ScanRow[];

  /* D. basket dibuka lalu tidak pernah disubmit */
  type BasketRow = {
    id: number;
    code: string;
    createdAt: Date;
    expedisi: { code: string };
    createdBy: { name: string };
    _count: { items: number };
  };
  const basketMenggantung = (await prisma.basket.findMany({
    where: {
      date: rentang,
      status: { in: ['MANIFESTING', 'OPEN'] },
      createdAt: { lt: ambang },
      ...(expedisiId ? { expedisiId } : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: 100,
    select: {
      id: true,
      code: true,
      createdAt: true,
      expedisi: { select: { code: true } },
      createdBy: { select: { name: true } },
      _count: { select: { items: true } },
    },
  })) as BasketRow[];

  const baris: BarisAnomali[] = [
    ...scan1TanpaScan2.map((r) => ({
      jenis: 'SCAN1_TANPA_SCAN2' as const,
      resi: r.resi,
      ekspedisi: r.expedisi?.code ?? null,
      basket: null,
      waktu: r.scan1At.toISOString(),
      umurJam: umur(r.scan1At, sekarang),
      operator: r.scan1By.name,
      keterangan: `Belum dimanifest ${umur(r.scan1At, sekarang)} jam setelah scan 1`,
      itemId: r.id,
    })),
    ...scan2TanpaScan1.map((r) => ({
      jenis: 'SCAN2_TANPA_SCAN1' as const,
      resi: r.scanResult,
      ekspedisi: r.shippingProvider,
      basket: r.doc.basketCode,
      waktu: r.manifestTime.toISOString(),
      umurJam: umur(r.manifestTime, sekarang),
      operator: r.scannedBy.name,
      keterangan: 'Ditolak saat scan 2 karena tidak ada di scan tahap 1',
      itemId: null,
    })),
    ...belumSampaiOcs.map((r) => ({
      jenis: 'BELUM_SAMPAI_OCS' as const,
      resi: r.resi,
      ekspedisi: r.expedisi?.code ?? null,
      basket: r.basket?.code ?? null,
      waktu: (r.scan2At ?? r.scan1At).toISOString(),
      umurJam: umur(r.scan2At ?? r.scan1At, sekarang),
      operator: r.scan2By?.name ?? r.scan1By.name,
      keterangan: r.ocsReason ?? (r.ocsState === 'FAILED' ? 'Pengiriman ke OCS gagal' : 'Menunggu dikirim ke OCS'),
      itemId: r.id,
    })),
    ...basketMenggantung.map((b) => ({
      jenis: 'BASKET_MENGGANTUNG' as const,
      resi: `${b._count.items} resi`,
      ekspedisi: b.expedisi.code,
      basket: b.code,
      waktu: b.createdAt.toISOString(),
      umurJam: umur(b.createdAt, sekarang),
      operator: b.createdBy.name,
      keterangan: `Basket dibuka ${umur(b.createdAt, sekarang)} jam lalu dan belum disubmit`,
      itemId: null,
    })),
  ].sort((a, b) => b.umurJam - a.umurJam);

  return {
    batasJam,
    jumlah: {
      scan1TanpaScan2: scan1TanpaScan2.length,
      scan2TanpaScan1: scan2TanpaScan1.length,
      belumSampaiOcs: belumSampaiOcs.length,
      basketMenggantung: basketMenggantung.length,
      total: baris.length,
    },
    baris,
  };
}
