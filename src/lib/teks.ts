/**
 * Buang nomor resi dari awal pesan server.
 *
 * Pesan dari server berbentuk "JX1234567 tersimpan (JNT)." — di layar scan
 * nomor resinya sudah ditampilkan besar-besar sendiri, jadi kalau pesannya
 * dipakai apa adanya nomornya muncul dua kali.
 */
export function pesanTanpaResi(pesan: string, resi: string): string {
  if (!resi || !pesan.toUpperCase().startsWith(resi.toUpperCase())) return pesan;
  const sisa = pesan.slice(resi.length).replace(/^[\s:—-]+/, '');
  if (!sisa) return pesan;
  return sisa.charAt(0).toUpperCase() + sisa.slice(1);
}
