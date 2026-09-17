'use client';

import { IconDownload } from './Icons';

export type ExportParams = {
  dari?: string;
  sampai?: string;
  status?: string;
  expedisi?: string;
  cari?: string;
};

/**
 * Tautan unduh .xlsx. Sengaja <a href> biasa, bukan fetch —
 * supaya unduhan ditangani browser (jalan juga di PDT).
 */
export default function ExportButton({
  params,
  label = 'Export Excel',
  className = 'btn btn-secondary',
}: {
  params: ExportParams;
  label?: string;
  className?: string;
}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v) qs.set(k, v);
  });

  return (
    <a
      className={className}
      href={`/api/export?${qs.toString()}`}
      title="Unduh hasil scan sebagai berkas Excel"
    >
      <IconDownload className="ico" />
      {label}
    </a>
  );
}
