'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/client';
import { toast } from '@/components/Toast';
import { labelStatus } from '@/lib/status';
import { fmtDateTime, fmtNumber, fmtTime } from '@/lib/date';

type Detail = {
  id: number;
  code: string;
  status: string;
  areaId: string;
  note: string | null;
  createdAt: string;
  closedAt: string | null;
  expedisi: { code: string; name: string; ocsShipper: string };
  createdBy: { name: string };
  docs: {
    id: number;
    status: string;
    ocsDocId: number | null;
    ocsDocNo: string | null;
    totalValid: number;
    totalNotValid: number;
    lastError: string | null;
    lastSyncAt: string | null;
  }[];
  items: {
    id: number;
    resi: string;
    status: string;
    scan2At: string | null;
    ocsState: string;
    ocsOrderId: string | null;
    ocsReason: string | null;
    scan2By: { name: string } | null;
  }[];
};

const badgeOcs: Record<string, string> = {
  SENT: 'badge-positive',
  PENDING: 'badge-critical',
  FAILED: 'badge-negative',
  INVALID: 'badge-negative',
  NONE: 'badge-neutral',
};

export default function BasketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);

  const muat = useCallback(async () => {
    const res = await apiGet<Detail>(`/api/baskets/${id}`);
    if (res.ok) setData(res.data);
    else toast('error', res.error);
  }, [id]);

  useEffect(() => {
    void muat();
  }, [muat]);

  const doc = data?.docs[0];

  const sinkron = async () => {
    if (!doc) return;
    setBusy(true);
    const res = await apiPost<{ sent: number; error: string | null }>('/api/scan2/sync', { docId: doc.id });
    setBusy(false);
    if (!res.ok) toast('error', res.error);
    else if (res.data.error) toast('warning', res.data.error);
    else toast('success', `${res.data.sent} scan tersinkron.`);
    void muat();
  };

  const submit = async () => {
    if (!doc) return;
    setBusy(true);
    const res = await apiPost<{ submitted: boolean; error: string | null }>('/api/scan2/submit', { docId: doc.id });
    setBusy(false);
    if (!res.ok) toast('error', res.error);
    else if (res.data.submitted) toast('success', 'Terkirim ke OCS.');
    else toast('warning', `Masuk antrean: ${res.data.error ?? 'menunggu jaringan'}`);
    void muat();
  };

  if (!data) return <p className="muted">Memuat…</p>;

  return (
    <div style={{ display: 'grid', gap: 'var(--gap)' }}>
      <h1 className="page-title">{data.code}</h1>

      <div className="card" style={{ display: 'grid', gap: 8 }}>
        <Baris label="Ekspedisi" value={`${data.expedisi.code} — ${data.expedisi.name} (OCS: ${data.expedisi.ocsShipper})`} />
        <Baris label="Area" value={data.areaId} />
        <Baris label="Status" value={data.status} />
        <Baris label="Dibuat" value={`${fmtDateTime(data.createdAt)} oleh ${data.createdBy.name}`} />
        <Baris label="Ditutup" value={data.closedAt ? fmtDateTime(data.closedAt) : '—'} />
        <Baris label="Dokumen OCS" value={doc?.ocsDocNo ?? '—'} />
        <Baris label="Sinkron terakhir" value={doc?.lastSyncAt ? fmtDateTime(doc.lastSyncAt) : '—'} />
        {doc?.lastError && (
          <div style={{ color: 'var(--negative)', fontSize: 13 }}>
            <strong>Masalah terakhir:</strong> {doc.lastError}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
          <Link href={`/label/${data.code}`} target="_blank" className="btn btn-secondary btn-sm">
            Cetak label
          </Link>
          {doc && doc.status !== 'SUBMITTED' && (
            <>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void sinkron()} disabled={busy}>
                Sinkron ke OCS
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void submit()} disabled={busy}>
                Submit manifest
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid-card">
        <div className="grid-toolbar">
          <strong style={{ fontSize: 13 }}>Isi basket</strong>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-label)' }}>
            {fmtNumber(data.items.length)} resi
          </span>
        </div>
        <div className="table-scroll">
          <table className="rtable">
            <thead>
              <tr>
                <th>Resi</th>
                <th className="p2">Order ID</th>
                <th>Status</th>
                <th>OCS</th>
                <th className="p3">Scan 2</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.id}>
                  <td className="mono title" data-label="Resi">
                    {i.resi}
                  </td>
                  <td className="mono p2" data-label="Order ID">
                    {i.ocsOrderId || '—'}
                  </td>
                  <td data-label="Status">
                    <span className={`badge ${i.status === 'PICKUP' ? 'badge-positive' : 'badge-critical'}`}>
                      {labelStatus(i.status)}
                    </span>
                  </td>
                  <td data-label="OCS">
                    <span className={`badge ${badgeOcs[i.ocsState] ?? 'badge-neutral'}`}>{i.ocsState}</span>
                  </td>
                  <td className="mono p3" data-label="Scan 2">
                    {i.scan2At ? `${fmtTime(i.scan2At)} · ${i.scan2By?.name ?? ''}` : '—'}
                  </td>
                </tr>
              ))}
              {!data.items.length && (
                <tr>
                  <td colSpan={5} className="muted" data-label="Info">
                    Basket ini belum berisi resi.
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

function Baris({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 12, fontSize: 13 }}>
      <span style={{ width: 130, flex: 'none', color: 'var(--ink-label)' }}>{label}</span>
      <span className="mono">{value}</span>
    </div>
  );
}
