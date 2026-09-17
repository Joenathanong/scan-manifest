'use client';

import Link from 'next/link';
import { usePerangkat, type JenisPerangkat } from '@/lib/device';

const LAWAN: Record<JenisPerangkat, { href: string; label: string; nama: string }> = {
  pdt: { href: '/scan-desktop', label: 'Buka Scan 1 — Desktop', nama: 'PC / laptop' },
  desktop: { href: '/scan-1', label: 'Buka Scan 1 — PDT', nama: 'PDT / HP' },
};

/**
 * Muncul hanya kalau halaman dibuka di perangkat yang bukan peruntukannya —
 * mis. halaman versi PDT dibuka di PC. Tidak memblokir, hanya menunjukkan
 * halaman yang lebih cocok.
 */
export default function PerangkatHint({ untuk }: { untuk: JenisPerangkat }) {
  const { jenis } = usePerangkat();
  if (jenis === null || jenis === untuk) return null;

  const lain = LAWAN[untuk];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        background: 'var(--critical-bg)',
        color: 'var(--critical)',
        border: '1px solid var(--critical-border)',
        borderRadius: 'var(--r-md)',
        padding: '10px 14px',
        fontSize: 13,
      }}
    >
      <span style={{ flex: 1, minWidth: 220 }}>
        Halaman ini dirancang untuk <strong>{untuk === 'pdt' ? 'PDT / HP' : 'PC / laptop'}</strong>, sedangkan
        perangkat yang Anda pakai terbaca sebagai <strong>{lain.nama}</strong>.
      </span>
      <Link href={lain.href} className="btn btn-secondary btn-sm">
        {lain.label}
      </Link>
    </div>
  );
}
