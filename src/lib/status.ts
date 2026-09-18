/**
 * Label status paket — SATU sumber untuk seluruh aplikasi.
 *
 * Nilai di database sengaja TIDAK diganti (AWAITING_PICKUP / PICKUP), karena
 * mengganti enum berarti migrasi tabel dan memutus data lama. Yang berubah
 * hanya kata yang dilihat operator:
 *
 *   AWAITING_PICKUP  sudah discan tahap 1, belum dimanifest  -> "Awaiting to shipment"
 *   PICKUP           sudah dimanifest di Scan 2              -> "Awaiting to pickup"
 *
 * Jadi "awaiting to pickup" sekarang berarti sudah siap dan tinggal menunggu
 * kurir menjemput, bukan menunggu diproses.
 */
export const LABEL_STATUS: Record<string, string> = {
  AWAITING_PICKUP: 'Awaiting to shipment',
  PICKUP: 'Awaiting to pickup',
  VOID: 'Dibatalkan',
};

/** Versi pendek untuk judul kolom tabel yang sempit. */
export const LABEL_STATUS_PENDEK: Record<string, string> = {
  AWAITING_PICKUP: 'Shipment',
  PICKUP: 'Pickup',
  VOID: 'Batal',
};

export function labelStatus(kode: string): string {
  return LABEL_STATUS[kode] ?? kode;
}
