'use client';

import { useEffect, useRef } from 'react';

export type FlashData = {
  tone: 'success' | 'double' | 'failed';
  ekspedisi: string;
  status: string;
  resi: string;
  /** Penanda unik supaya scan berulang dengan isi sama tetap memicu popup. */
  key: number;
};

let urut = 0;
/** Kunci naik terus supaya dua scan identik beruntun tetap memicu popup baru. */
export function kunciFlash(): number {
  urut += 1;
  return urut;
}

const DURASI: Record<FlashData['tone'], number> = {
  success: 850,
  double: 1300,
  failed: 1600,
};

/**
 * Layar penuh sekejap setelah scan: hijau berhasil, merah gagal, kuning dobel.
 * Dibaca dari jarak beberapa meter tanpa perlu mendekat ke monitor, dan hilang
 * sendiri supaya tidak menghalangi scan berikutnya. Field scan tetap fokus
 * karena overlay ini tidak menerima fokus (pointer-events: none).
 */
export default function ScanFlash({ data, onSelesai }: { data: FlashData | null; onSelesai: () => void }) {
  // Disimpan di ref supaya jam yang berdetak tiap detik di halaman induk tidak
  // terus-menerus mengulang hitungan mundur dan membuat popup tidak hilang.
  const selesaiRef = useRef(onSelesai);
  selesaiRef.current = onSelesai;

  const kunci = data?.key ?? 0;
  const tone = data?.tone;

  useEffect(() => {
    if (!tone) return;
    const t = setTimeout(() => selesaiRef.current(), DURASI[tone]);
    return () => clearTimeout(t);
  }, [kunci, tone]);

  if (!data) return null;

  return (
    <div className="scan-flash" data-tone={data.tone} role="status" aria-live="assertive">
      <div>
        <div className="scan-flash-ikon">{data.tone === 'success' ? '✓' : data.tone === 'double' ? '!' : '✕'}</div>
        <div className="scan-flash-exp">{data.ekspedisi}</div>
        <div className="scan-flash-status">{data.status}</div>
        <div className="scan-flash-resi">{data.resi}</div>
      </div>
    </div>
  );
}
