import { prisma } from '@/lib/db';
import * as ocs from './ocs-client';
import { kredensialSistem } from './ocs-client';
import { awalHariUtc, dateOnly, todayISO } from '@/lib/date';
import { lupakan, memo } from '@/lib/cache';

/**
 * Angka untuk dashboard TV.
 *
 * Dua angka tengah datang dari database kita sendiri (murah), dua angka
 * lainnya dari OCS (mahal). Karena TV menyala seharian dan menyegarkan terus,
 * hasilnya TIDAK dihitung ulang setiap kali halaman meminta — dihitung sekali
 * lalu disimpan sebagai snapshot, dan hanya dibangun ulang kalau sudah basi.
 *
 * In Transit sengaja dibatasi pada resi yang ADA di daftar "awaiting to
 * pickup" kita: begitu status paket berubah dari IN_TRANSIT (terkirim,
 * dibatalkan, apa pun), resi itu tidak lagi terhitung dan angkanya turun
 * sendiri — persis yang diminta.
 *
 * SIFATNYA REPLACE, bukan tambah. Snapshot disimpan sebagai SATU baris di
 * tabel Setting dan setiap penarikan menimpanya utuh — tidak ada riwayat yang
 * menumpuk, dan tidak ada angka lama yang ikut dijumlahkan. Ini penting karena
 * status paket di OCS berubah-ubah: satu-satunya jawaban yang benar adalah
 * hasil hitung terakhir, bukan akumulasi.
 */

const KUNCI = 'tv:snapshot';
const KUNCI_JEDA = 'tv:interval-menit';

/** Bawaan kalau belum pernah disetel dari menu Setelan. */
const JEDA_BAWAAN_MENIT = Math.max(1, Number(process.env.TV_REFRESH_MENIT || 5));
export const JEDA_MIN_MENIT = 1;
export const JEDA_MAKS_MENIT = 120;
/** OData dikirim sebagai URL, jadi daftar resi harus dipecah agar tidak kepanjangan. */
const PER_KIRIMAN = Math.max(10, Number(process.env.TV_ODATA_CHUNK || 50));
/** Batas pengaman: jangan pernah menembak ratusan permintaan ke OCS sekaligus. */
const MAKS_KIRIMAN = Math.max(1, Number(process.env.TV_ODATA_MAKS || 40));

/**
 * Berapa menit sekali data OCS ditarik ulang. Disimpan di tabel Setting supaya
 * bisa diubah dari menu Setelan tanpa deploy ulang; env hanya jadi nilai awal.
 * Di-cache 30 detik supaya tidak jadi satu query tambahan tiap TV menyapa.
 */
export function intervalMenit(): Promise<number> {
  return memo('tv:interval', 30, async () => {
    const row = (await prisma.setting.findUnique({ where: { key: KUNCI_JEDA } })) as { value: string } | null;
    const n = Number(row?.value);
    if (Number.isFinite(n) && n >= JEDA_MIN_MENIT && n <= JEDA_MAKS_MENIT) return n;
    return JEDA_BAWAAN_MENIT;
  });
}

export async function setIntervalMenit(menit: number): Promise<number> {
  const n = Math.min(JEDA_MAKS_MENIT, Math.max(JEDA_MIN_MENIT, Math.round(menit)));
  const value = String(n);
  await prisma.setting.upsert({
    where: { key: KUNCI_JEDA },
    create: { key: KUNCI_JEDA, value },
    update: { value },
  });
  lupakan('tv:interval');
  return n;
}

export type Snapshot = {
  tanggal: string;
  orderPicked: number;
  awaitingShipment: number;
  awaitingPickup: number;
  inTransit: number;
  perEkspedisi: { code: string; awaitingShipment: number; awaitingPickup: number }[];
  ocsAktif: boolean;
  ocsError: string | null;
  dibuatPada: string;
  /** Ikut dikirim supaya layar TV bisa menyebutkan iramanya sendiri. */
  intervalMenit: number;
};

function kosong(iso: string): Snapshot {
  return {
    tanggal: iso,
    orderPicked: 0,
    awaitingShipment: 0,
    awaitingPickup: 0,
    inTransit: 0,
    perEkspedisi: [],
    ocsAktif: ocs.ocsEnabled(),
    ocsError: null,
    dibuatPada: new Date(0).toISOString(),
    intervalMenit: JEDA_BAWAAN_MENIT,
  };
}

export async function bacaSnapshot(): Promise<Snapshot | null> {
  const row = (await prisma.setting.findUnique({ where: { key: KUNCI } })) as { value: string } | null;
  if (!row) return null;
  try {
    return JSON.parse(row.value) as Snapshot;
  } catch {
    return null;
  }
}

async function simpanSnapshot(snap: Snapshot): Promise<void> {
  const value = JSON.stringify(snap);
  await prisma.setting.upsert({
    where: { key: KUNCI },
    create: { key: KUNCI, value },
    update: { value },
  });
}

export async function basi(snap: Snapshot | null): Promise<boolean> {
  if (!snap) return true;
  const umurMs = (await intervalMenit()) * 60000;
  return Date.now() - new Date(snap.dibuatPada).getTime() > umurMs;
}

/* ---------------- bagian yang datang dari database kita ---------------- */

type BarisEks = { code: string | null; awaitingShipment: bigint | number; awaitingPickup: bigint | number };

async function angkaLokal(iso: string) {
  const tanggal = dateOnly(iso);

  const [awaitingShipment, awaitingPickup, perEkspedisiMentahRaw, resiPickupRaw] = await Promise.all([
    prisma.scanItem.count({
      where: { scanDate: tanggal, status: 'AWAITING_PICKUP', verifyState: { not: 'INVALID' } },
    }),
    prisma.scanItem.count({ where: { scanDate: tanggal, status: 'PICKUP' } }),
    prisma.$queryRaw`
      SELECT e.code AS code,
             SUM(CASE WHEN i.status = 'AWAITING_PICKUP' AND i.verifyState <> 'INVALID' THEN 1 ELSE 0 END) AS awaitingShipment,
             SUM(CASE WHEN i.status = 'PICKUP' THEN 1 ELSE 0 END) AS awaitingPickup
      FROM ScanItem i
      LEFT JOIN Expedisi e ON e.id = i.expedisiId
      WHERE i.scanDate = ${tanggal} AND i.status <> 'VOID'
      GROUP BY e.code
      ORDER BY 2 DESC, 3 DESC
    `,
    // Resi yang sudah dimanifest hari ini — inilah yang ditanyakan ke OCS.
    prisma.scanItem.findMany({
      where: { scanDate: tanggal, status: 'PICKUP' },
      select: { resi: true, ocsTracking: true },
      take: PER_KIRIMAN * MAKS_KIRIMAN,
    }),
  ]);

  const perEkspedisiMentah = perEkspedisiMentahRaw as BarisEks[];
  const resiPickup = resiPickupRaw as { resi: string; ocsTracking: string | null }[];

  const perEkspedisi = perEkspedisiMentah
    .map((r: BarisEks) => ({
      code: r.code ?? 'BELUM DIKENALI',
      awaitingShipment: Number(r.awaitingShipment),
      awaitingPickup: Number(r.awaitingPickup),
    }))
    .filter((r: { awaitingShipment: number; awaitingPickup: number }) => r.awaitingShipment > 0 || r.awaitingPickup > 0);

  // Nomor yang dikenal OCS adalah TrackingNumber-nya kalau ada; kalau tidak,
  // nomor yang discan memang sudah nomor resinya.
  const daftarResi: string[] = [
    ...new Set(resiPickup.map((r: { resi: string; ocsTracking: string | null }) => (r.ocsTracking || r.resi).trim().toUpperCase())),
  ].filter(Boolean);

  return { awaitingShipment, awaitingPickup, perEkspedisi, daftarResi };
}

/* ---------------- bagian yang datang dari OCS ---------------- */

async function hitungInTransit(daftarResi: string[]): Promise<number> {
  if (!daftarResi.length) return 0;
  const kolom = ocs.kolomResiOdata();
  const cred = kredensialSistem();
  let total = 0;

  for (let i = 0; i < daftarResi.length; i += PER_KIRIMAN) {
    const bagian = daftarResi.slice(i, i + PER_KIRIMAN);
    const cocok = bagian.map((r) => `${kolom} eq ${ocs.kutipOdata(r)}`).join(' or ');
    total += await ocs.hitungOrder(`StatusCode eq ${ocs.STATUS_OCS.IN_TRANSIT} and (${cocok})`, cred);
  }
  return total;
}

/** Bangun snapshot baru. Dipanggil dari route lewat after(), tidak memblokir TV. */
export async function bangunSnapshot(): Promise<Snapshot> {
  const iso = todayISO();
  const lokal = await angkaLokal(iso);

  const snap: Snapshot = {
    ...kosong(iso),
    awaitingShipment: lokal.awaitingShipment,
    awaitingPickup: lokal.awaitingPickup,
    perEkspedisi: lokal.perEkspedisi,
    dibuatPada: new Date().toISOString(),
    intervalMenit: await intervalMenit(),
  };

  if (ocs.ocsEnabled()) {
    const sejak = awalHariUtc(iso).toISOString();
    try {
      snap.orderPicked = await ocs.hitungOrder(
        `StatusCode eq ${ocs.STATUS_OCS.PICKED} and CreatedAt ge ${sejak}`,
        kredensialSistem(),
      );
      snap.inTransit = await hitungInTransit(lokal.daftarResi);
    } catch (e) {
      // OCS bermasalah: angka lokal tetap tampil, angka OCS dipertahankan dari
      // snapshot sebelumnya supaya layar TV tidak tiba-tiba jatuh ke nol.
      const lama = await bacaSnapshot();
      snap.orderPicked = lama?.orderPicked ?? 0;
      snap.inTransit = lama?.inTransit ?? 0;
      snap.ocsError = e instanceof Error ? e.message : 'OCS tidak bisa dihubungi.';
    }
  } else {
    snap.ocsError = 'Pengiriman ke OCS sedang dimatikan (OCS_ENABLED=false).';
  }

  await simpanSnapshot(snap);
  return snap;
}

/** Snapshot untuk ditampilkan: yang tersimpan, atau bangun baru kalau belum ada. */
export async function snapshotUntukTampil(): Promise<{ snap: Snapshot; perluSegarkan: boolean }> {
  const ada = await bacaSnapshot();
  if (ada && ada.tanggal === todayISO()) return { snap: ada, perluSegarkan: await basi(ada) };
  // Belum ada sama sekali, atau snapshot milik hari kemarin.
  return { snap: await bangunSnapshot(), perluSegarkan: false };
}
