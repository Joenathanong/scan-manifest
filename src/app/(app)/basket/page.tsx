'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '@/lib/client';
import { fmtDateTime, fmtNumber, todayISO } from '@/lib/date';
import ExportButton from '@/components/ExportButton';

type Row = {
  id: number;
  code: string;
  status: string;
  areaId: string;
  createdAt: string;
  closedAt: string | null;
  note: string | null;
  expedisi: { code: string; name: string };
  createdBy: { name: string };
  _count: { items: number };
  docs: { id: number; status: string; ocsDocNo: string | null; totalValid: number; lastError: string | null }[];
};

const badgeBasket: Record<string, string> = {
  OPEN: 'badge-neutral',
  MANIFESTING: 'badge-informative',
  CLOSED: 'badge-critical',
  DONE: 'badge-positive',
};

export default function BasketPage() {
  const today = todayISO();
  const [dari, setDari] = useState(today);
  const [sampai, setSampai] = useState(today);
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const muat = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({ dari, sampai, ...(status ? { status } : {}) });
    const res = await apiGet<{ rows: Row[] }>(`/api/baskets?${qs.toString()}`);
    setLoading(false);
    if (res.ok) setRows(res.data.rows);
  }, [dari, sampai, status]);

  useEffect(() => {
    void muat();
  }, [muat]);

  return (
    <div style={{ display: 'grid', gap: 'var(--gap)' }}>
      <h1 className="page-title">Basket</h1>

      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        <div style={{ minWidth: 150 }}>
          <label className="field-label" htmlFor="d1">
            Dari
          </label>
          <input id="d1" type="date" className="input-field" value={dari} onChange={(e) => setDari(e.target.value)} />
        </div>
        <div style={{ minWidth: 150 }}>
          <label className="field-label" htmlFor="d2">
            Sampai
          </label>
          <input id="d2" type="date" className="input-field" value={sampai} onChange={(e) => setSampai(e.target.value)} />
        </div>
        <div style={{ minWidth: 160 }}>
          <label className="field-label" htmlFor="stt">
            Status
          </label>
          <select id="stt" className="select-field" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Semua</option>
            <option value="MANIFESTING">Sedang dimanifest</option>
            <option value="DONE">Selesai</option>
            <option value="CLOSED">Ditutup</option>
            <option value="OPEN">Terbuka</option>
          </select>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => void muat()} disabled={loading}>
          {loading ? 'Memuat…' : 'Terapkan'}
        </button>
        <ExportButton params={{ dari, sampai }} />
      </div>

      <div className="grid-card">
        <div className="grid-toolbar">
          <strong style={{ fontSize: 13 }}>Daftar basket</strong>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-label)' }}>
            {fmtNumber(rows.length)} entries
          </span>
        </div>
        <div className="table-scroll">
          <table className="rtable">
            <thead>
              <tr>
                <th>Kode</th>
                <th>Ekspedisi</th>
                <th className="n">Isi</th>
                <th>Status</th>
                <th className="p2">Dokumen OCS</th>
                <th className="p3">Dibuat</th>
                <th>Label</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td className="mono title" data-label="Kode">
                    <Link href={`/basket/${b.id}`}>{b.code}</Link>
                  </td>
                  <td data-label="Ekspedisi">{b.expedisi.code}</td>
                  <td className="n" data-label="Isi">
                    {fmtNumber(b._count.items)}
                  </td>
                  <td data-label="Status">
                    <span className={`badge ${badgeBasket[b.status] ?? 'badge-neutral'}`}>{b.status}</span>
                  </td>
                  <td className="mono p2" data-label="Dokumen OCS">
                    {b.docs[0]?.ocsDocNo || '—'}
                    {b.docs[0]?.lastError ? <span style={{ color: 'var(--negative)' }}> ⚠</span> : null}
                  </td>
                  <td className="mono p3" data-label="Dibuat">
                    {fmtDateTime(b.createdAt)}
                  </td>
                  <td data-label="Label">
                    <Link href={`/label/${b.code}`} target="_blank" className="btn btn-ghost btn-sm">
                      Cetak
                    </Link>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={7} className="muted" data-label="Info">
                    Belum ada basket pada rentang ini.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
