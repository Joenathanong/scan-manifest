'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '@/lib/client';
import { fmtDate, fmtDateTime, fmtNumber, fmtTime, todayISO } from '@/lib/date';
import ExportButton from '@/components/ExportButton';
import AnomaliCard from '@/components/AnomaliCard';

type Data = {
  kpi: { awaiting: number; pickup: number; void: number; total: number; basketAktif: number; outboxTertunda: number };
  perTanggal: { tanggal: string; awaiting: number; pickup: number; void: number }[];
  perExpedisi: { code: string; awaiting: number; pickup: number }[];
  baskets: {
    id: number;
    code: string;
    status: string;
    areaId: string;
    createdAt: string;
    closedAt: string | null;
    expedisi: { code: string };
    _count: { items: number };
  }[];
  rows: {
    id: number;
    resi: string;
    scanDate: string;
    scan1At: string;
    expedisi: { code: string; name: string } | null;
    scan1By: { name: string };
    session: { code: string } | null;
  }[];
  total: number;
  expedisiList: { id: number; code: string; name: string }[];
};

const badgeBasket: Record<string, string> = {
  OPEN: 'badge-neutral',
  MANIFESTING: 'badge-informative',
  CLOSED: 'badge-critical',
  DONE: 'badge-positive',
};

export default function DashboardPage() {
  const today = todayISO();
  const [dari, setDari] = useState(today);
  const [sampai, setSampai] = useState(today);
  const [expedisi, setExpedisi] = useState('');
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  const muat = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({ dari, sampai, ...(expedisi ? { expedisi } : {}) });
    const res = await apiGet<Data>(`/api/dashboard?${qs.toString()}`);
    setLoading(false);
    if (res.ok) setData(res.data);
  }, [dari, sampai, expedisi]);

  useEffect(() => {
    void muat();
  }, [muat]);

  useEffect(() => {
    const t = setInterval(muat, 60000);
    return () => clearInterval(t);
  }, [muat]);

  return (
    <div style={{ display: 'grid', gap: 'var(--gap)' }}>
      <h1 className="page-title">Dashboard Validasi</h1>

      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        <div style={{ minWidth: 150 }}>
          <label className="field-label" htmlFor="d1">
            Dari tanggal
          </label>
          <input id="d1" type="date" className="input-field" value={dari} onChange={(e) => setDari(e.target.value)} />
        </div>
        <div style={{ minWidth: 150 }}>
          <label className="field-label" htmlFor="d2">
            Sampai tanggal
          </label>
          <input id="d2" type="date" className="input-field" value={sampai} onChange={(e) => setSampai(e.target.value)} />
        </div>
        <div style={{ minWidth: 160 }}>
          <label className="field-label" htmlFor="ex">
            Ekspedisi
          </label>
          <select id="ex" className="select-field" value={expedisi} onChange={(e) => setExpedisi(e.target.value)}>
            <option value="">Semua</option>
            {(data?.expedisiList ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.code}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => void muat()} disabled={loading}>
          {loading ? 'Memuat…' : 'Terapkan'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setDari(today);
            setSampai(today);
            setExpedisi('');
          }}
        >
          Hari ini
        </button>
        <ExportButton params={{ dari, sampai, expedisi }} />
      </div>

      <div className="kpi-grid">
        <Kpi label="Awaiting to shipment" value={data?.kpi.awaiting ?? 0} color="var(--critical)" />
        <Kpi label="Awaiting to pickup" value={data?.kpi.pickup ?? 0} color="var(--positive)" />
        <Kpi label="Total discan" value={data?.kpi.total ?? 0} />
        <Kpi label="Basket aktif" value={data?.kpi.basketAktif ?? 0} />
        <Kpi
          label="Antrean ke OCS"
          value={data?.kpi.outboxTertunda ?? 0}
          color={data?.kpi.outboxTertunda ? 'var(--negative)' : undefined}
        />
      </div>

      <AnomaliCard dari={dari} sampai={sampai} expedisi={expedisi} />

      <div style={{ display: 'grid', gap: 'var(--gap)', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))' }}>
        <div className="grid-card">
          <div className="grid-toolbar">
            <strong style={{ fontSize: 13 }}>Per tanggal</strong>
          </div>
          <div className="table-scroll">
            <table className="rtable">
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th className="n">Shipment</th>
                  <th className="n">Pickup</th>
                  <th className="n p3">Batal</th>
                </tr>
              </thead>
              <tbody>
                {(data?.perTanggal ?? []).map((r) => (
                  <tr key={r.tanggal}>
                    <td className="title" data-label="Tanggal">
                      {fmtDate(`${r.tanggal}T00:00:00.000Z`)}
                    </td>
                    <td className="n" data-label="Shipment">
                      {fmtNumber(r.awaiting)}
                    </td>
                    <td className="n" data-label="Pickup">
                      {fmtNumber(r.pickup)}
                    </td>
                    <td className="n p3" data-label="Batal">
                      {fmtNumber(r.void)}
                    </td>
                  </tr>
                ))}
                {!data?.perTanggal.length && (
                  <tr>
                    <td colSpan={4} className="muted" data-label="Info">
                      Tidak ada data pada rentang ini.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid-card">
          <div className="grid-toolbar">
            <strong style={{ fontSize: 13 }}>Per ekspedisi</strong>
          </div>
          <div className="table-scroll">
            <table className="rtable">
              <thead>
                <tr>
                  <th>Ekspedisi</th>
                  <th className="n">Shipment</th>
                  <th className="n">Pickup</th>
                </tr>
              </thead>
              <tbody>
                {(data?.perExpedisi ?? []).map((r) => (
                  <tr key={r.code}>
                    <td className="title" data-label="Ekspedisi">
                      {r.code}
                    </td>
                    <td className="n" data-label="Shipment">
                      {fmtNumber(r.awaiting)}
                    </td>
                    <td className="n" data-label="Pickup">
                      {fmtNumber(r.pickup)}
                    </td>
                  </tr>
                ))}
                {!data?.perExpedisi.length && (
                  <tr>
                    <td colSpan={3} className="muted" data-label="Info">
                      Belum ada data.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid-card">
        <div className="grid-toolbar">
          <strong style={{ fontSize: 13 }}>Resi awaiting to shipment</strong>
          <span className="muted" style={{ fontSize: 12 }}>
            hilang dari daftar ini setelah discan di tahap 2
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-label)' }}>
            {fmtNumber(data?.total ?? 0)} entries
          </span>
        </div>
        <div className="table-scroll">
          <table className="rtable">
            <colgroup>
              <col style={{ width: '30%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '20%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Resi</th>
                <th>Ekspedisi</th>
                <th>Status</th>
                <th className="p2">Operator</th>
                <th className="p3">Waktu scan 1</th>
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map((r) => (
                <tr key={r.id}>
                  <td className="mono title" data-label="Resi">
                    {r.resi}
                  </td>
                  <td data-label="Ekspedisi">
                    <span className={`badge ${r.expedisi ? 'badge-brand' : 'badge-neutral'}`}>
                      {r.expedisi?.code ?? 'BELUM DIKENALI'}
                    </span>
                  </td>
                  <td data-label="Status">
                    <span className="badge badge-critical">Awaiting to shipment</span>
                  </td>
                  <td className="p2" data-label="Operator">
                    {r.scan1By.name}
                  </td>
                  <td className="mono p3" data-label="Waktu">
                    {fmtDate(r.scanDate)} {fmtTime(r.scan1At)}
                  </td>
                </tr>
              ))}
              {!data?.rows.length && (
                <tr>
                  <td colSpan={5} className="muted" data-label="Info">
                    Tidak ada resi berstatus awaiting to shipment pada rentang ini.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="grid-foot">
          <span>{fmtNumber(data?.rows.length ?? 0)} baris ditampilkan</span>
          <Link href="/history" className="btn btn-ghost btn-sm">
            Lihat riwayat lengkap
          </Link>
        </div>
      </div>

      <div className="grid-card">
        <div className="grid-toolbar">
          <strong style={{ fontSize: 13 }}>Basket pada rentang ini</strong>
          <Link href="/basket" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}>
            Semua basket
          </Link>
        </div>
        <div className="table-scroll">
          <table className="rtable">
            <thead>
              <tr>
                <th>Basket</th>
                <th>Ekspedisi</th>
                <th className="n">Isi</th>
                <th>Status</th>
                <th className="p3">Dibuat</th>
              </tr>
            </thead>
            <tbody>
              {(data?.baskets ?? []).map((b) => (
                <tr key={b.id}>
                  <td className="mono title" data-label="Basket">
                    <Link href={`/basket/${b.id}`}>{b.code}</Link>
                  </td>
                  <td data-label="Ekspedisi">{b.expedisi.code}</td>
                  <td className="n" data-label="Isi">
                    {fmtNumber(b._count.items)}
                  </td>
                  <td data-label="Status">
                    <span className={`badge ${badgeBasket[b.status] ?? 'badge-neutral'}`}>{b.status}</span>
                  </td>
                  <td className="mono p3" data-label="Dibuat">
                    {fmtDateTime(b.createdAt)}
                  </td>
                </tr>
              ))}
              {!data?.baskets.length && (
                <tr>
                  <td colSpan={5} className="muted" data-label="Info">
                    Belum ada basket.
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

function Kpi({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={color ? { color } : undefined}>
        {fmtNumber(value)}
      </div>
    </div>
  );
}
