/**
 * Memo super-sederhana dengan masa berlaku, khusus untuk data yang jarang
 * berubah tapi dibaca di SETIAP scan (identitas pengguna, aturan prefix
 * ekspedisi, sesi scan yang sedang terbuka).
 *
 * Kenapa ini perlu: setiap query ke TiDB adalah satu perjalanan jaringan
 * pulang-pergi. Saat scan, perjalanan itulah biaya terbesarnya — bukan
 * kerja databasenya. Memangkas jumlah perjalanan jauh lebih berpengaruh
 * daripada mengoptimalkan query-nya.
 *
 * Cache ini per-instance dan hanya di memori: kalau Vercel menyalakan
 * instance baru, isinya kosong dan data diambil ulang. Aman karena semua
 * yang disimpan di sini bersifat boleh-sedikit-tertinggal, dan setiap
 * perubahan dari menu admin langsung membatalkannya lewat lupakan().
 */

type Entri<T> = { nilai: T; kedaluwarsa: number };

const g = globalThis as unknown as { __iegCache?: Map<string, Entri<unknown>> };
const simpanan = (g.__iegCache ??= new Map<string, Entri<unknown>>());

/** Batas kasar supaya cache tidak tumbuh tanpa henti di instance panjang umur. */
const MAKS = 500;

export function ambil<T>(kunci: string): T | undefined {
  const e = simpanan.get(kunci) as Entri<T> | undefined;
  if (!e) return undefined;
  if (Date.now() > e.kedaluwarsa) {
    simpanan.delete(kunci);
    return undefined;
  }
  return e.nilai;
}

export function simpan<T>(kunci: string, nilai: T, detik: number): T {
  if (simpanan.size > MAKS) simpanan.clear();
  simpanan.set(kunci, { nilai, kedaluwarsa: Date.now() + detik * 1000 });
  return nilai;
}

/** Ambil dari cache, atau jalankan pengambil lalu simpan hasilnya. */
export async function memo<T>(kunci: string, detik: number, ambilBaru: () => Promise<T>): Promise<T> {
  const ada = ambil<T>(kunci);
  if (ada !== undefined) return ada;
  return simpan(kunci, await ambilBaru(), detik);
}

/** Buang satu kunci, atau semua kunci yang berawalan tertentu. */
export function lupakan(kunciAtauAwalan: string, awalan = false) {
  if (!awalan) {
    simpanan.delete(kunciAtauAwalan);
    return;
  }
  for (const k of [...simpanan.keys()]) if (k.startsWith(kunciAtauAwalan)) simpanan.delete(k);
}
