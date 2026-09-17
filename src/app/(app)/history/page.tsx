'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '@/lib/client';
import { fmtDate, fmtDateTime, fmtNumber, todayISO } from '@/lib/date';

type Row = {
  id: number;
  resi: string;
  status: string;
  scanDate: string;
  scan1At: string;
  scan2At: string | null;
  ocsState: string;
  ocsOrderId: string | null;
  ocsReason: string | null;
  voidReason: string | null;
  expedisi: { code: string } | null;
  basket: { code: string } | null;
  scan1By: { name: string };
  scan2By: { name: string } | null;
};

const badgeStatus: Record<string, string> = {
  AWAITING_PICKUP: 'badge-critical',
  PICKUP: 'badge-positive',
  VOID: 'badge-neutral',
};

const labelStatus: Record<string, string> = {
  AWAITING_PICKUP: 'Awaiting to pickup',
  PICKUP: 'Pickup',
  VOID: 'Dibatalkan',
};

export default function HistoryPage() {
  const today = todayISO();
  const [dari, setDari] = useState(today);
  const [sampai, setSampai] = useState(today);
  const [status, setStatus] = useState('');
  const [cari, setCari] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const muat = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({
      dari,
      sampai,
      ...(status ? { status } : {}),
      ...(cari.trim() ? { cari: cari.trim() } : {}),
    });
    const res = await apiGet<{ rows: Row[]; total: number }>(`/api/history?${qs.toString()}`);
    setLoading(false);
    if (res.ok) {
      setRows(res.data.rows);
      setTotal(res.data.total);
    }
  }, [dari, sampai, status, cari]);

  useEffect(() => {
    void muat();
  }, [muat]);

  return (
    <div style={{ display: 'grid', gap: 'var(--gap)' }}>
      <h1 className="page-title">Riwayat Resi</h1>

      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        <div style={{ minWidth: 190, flex: 1 }}>
          <label className="field-label" htmlFor="q">
            Cari resi (mengabaikan tanggal)
          </label>
          <input
            id="q"
            className="input-field mono"
            value={cari}
            onChange={(e) => setCari(e.target.value.toUpperCase())}
            placeholder="Ketik / scan resi"
            autoComplete="off"
          />
        </div>
        <div style={{ minWidth: 140 }}>
          <label className="field-label" htmlFor="d1">
            Dari
          </label>
          <input id="d1" type="date" className="input-field" value={dari} onChange={(e) => setDari(e.target.value)} />
        </div>
        <div style={{ minWidth: 140 }}>
          <label className="field-label" htmlFor="d2">
            Sampai
          </label>
          <input id="d2" type="date" className="input-field" value={sampai} onChange={(e) => setSampai(e.target.value)} />
        </div>
        <div style={{ minWidth: 160 }}>
          <label className="field-label" htmlFor="s">
            Status
          </label>
          <select id="s" className="select-field" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Semua</option>
            <option value="AWAITING_PICKUP">Awaiting to pickup</option>
            <option value="PICKUP">Pickup</option>
            <option value="VOID">Dibatalkan</option>
          </select>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => void muat()} disabled={loading}>
          {loading ? 'Memuat…' : 'Terapkan'}
        </button>
      </div>

      <div className="grid-card">
        <div className="grid-toolbar">
          <strong style={{ fontSize: 13 }}>Hasil</strong>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-label)' }}>
            {fmtNumber(total)} entries
          </span>
        </div>
        <div className="table-scroll">
          <table className="rtable">
            <thead>
              <tr>
                <th>Resi</th>
                <th>Ekspedisi</th>
                <th>Status</th>
                <th className="p2">Basket</th>
                <th className="p2">OCS</th>
                <th className="p3">Scan 1</th>
                <th className="p3">Scan 2</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="mono title" data-label="Resi">
                    {r.resi}
                  </td>
                  <td data-label="Ekspedisi">{r.expedisi?.code ?? '—'}</td>
                  <td data-label="Status">
                    <span className={`badge ${badgeStatus[r.status] ?? 'badge-neutral'}`}>
                      {labelStatus[r.status] ?? r.status}
                    </span>
                  </td>
                  <td className="mono p2" data-label="Basket">
                    {r.basket?.code ?? '—'}
                  </td>
                  <td className="p2" data-label="OCS">
                    {r.ocsState === 'SENT' ? (
                      <span className="badge badge-positive">Terkirim</span>
                    ) : r.ocsState === 'NONE' ? (
                      '—'
                    ) : (
                      <span className="badge badge-critical">{r.ocsState}</span>
                    )}
                  </td>
                  <td className="mono p3" data-label="Scan 1">
                    {fmtDate(r.scanDate)}
                  </td>
                  <td className="mono p3" data-label="Scan 2">
                    {r.scan2At ? fmtDateTime(r.scan2At) : '—'}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={7} className="muted" data-label="Info">
                    Tidak ada data.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="grid-foot">
          <span>{fmtNumber(rows.length)} baris ditampilkan dari {fmtNumber(total)}</span>
        </div>
      </div>
    </div>
  );
}
