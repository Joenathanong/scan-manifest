'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/client';
import { toast } from '@/components/Toast';
import { clearQueue, flushQueue, subscribeQueue } from '@/lib/offline-queue';
import { fmtDateTime, fmtNumber } from '@/lib/date';

type SyncStatus = {
  ocsAktif: boolean;
  outboxPending: number;
  outboxFailed: number;
  scanBelumSinkron: number;
  itemPending: number;
  sehat: boolean;
  waktuServer: string;
  docsBermasalah: {
    id: number;
    basketCode: string;
    status: string;
    lastError: string | null;
    lastSyncAt: string | null;
    totalValid: number;
    ocsDocNo: string | null;
  }[];
};

export default function SettingsPage() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [ping, setPing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [antrean, setAntrean] = useState(0);

  const muat = useCallback(async () => {
    const res = await apiGet<SyncStatus>('/api/sync-status');
    if (res.ok) setStatus(res.data);
  }, []);

  useEffect(() => {
    void muat();
    const t = setInterval(muat, 20000);
    const off = subscribeQueue((s) => setAntrean(s.pending));
    return () => {
      clearInterval(t);
      off();
    };
  }, [muat]);

  const tesKoneksi = async () => {
    setBusy(true);
    setPing(null);
    const res = await apiPost<{ ok: boolean; enabled: boolean; areas?: string[]; jumlahBasketOcs?: number; message?: string }>(
      '/api/ocs/ping',
    );
    setBusy(false);
    if (!res.ok) {
      setPing(`Gagal: ${res.error}`);
      toast('error', res.error);
      return;
    }
    if (!res.data.ok) {
      setPing(res.data.message ?? 'OCS tidak aktif.');
      return;
    }
    setPing(`Terhubung. Area OCS: ${(res.data.areas ?? []).join(', ')} · ${res.data.jumlahBasketOcs} basket tercatat di OCS.`);
    toast('success', 'Koneksi OCS berhasil.');
  };

  const kirimUlang = async () => {
    setBusy(true);
    await flushQueue();
    const res = await apiPost<{ processed: number }>('/api/outbox/flush');
    setBusy(false);
    if (res.ok) toast('success', `${res.data.processed} antrean diproses.`);
    else toast('error', res.error);
    void muat();
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--gap)' }}>
      <h1 className="page-title">Setelan &amp; Status OCS</h1>

      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <strong style={{ fontSize: 14 }}>Koneksi OCS</strong>
        <p style={{ fontSize: 13, color: 'var(--ink-label)' }}>
          Kredensial OCS disimpan sebagai environment variable di server (OCS_USERNAME / OCS_PASSWORD /
          OCS_COMPANYDB) — tidak pernah dikirim ke browser.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary" onClick={() => void tesKoneksi()} disabled={busy}>
            Tes koneksi
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void kirimUlang()} disabled={busy}>
            Kirim ulang semua antrean
          </button>
        </div>
        {ping && <div style={{ fontSize: 13 }}>{ping}</div>}
      </div>

      <div className="kpi-grid">
        <Kpi label="Antrean di perangkat ini" value={antrean} warn={antrean > 0} />
        <Kpi label="Antrean server ke OCS" value={status?.outboxPending ?? 0} warn={!!status?.outboxPending} />
        <Kpi label="Antrean gagal berulang" value={status?.outboxFailed ?? 0} warn={!!status?.outboxFailed} />
        <Kpi label="Scan belum tersinkron" value={status?.scanBelumSinkron ?? 0} warn={!!status?.scanBelumSinkron} />
      </div>

      <div className="card" style={{ display: 'grid', gap: 6 }}>
        <div style={{ fontSize: 13 }}>
          Status keseluruhan:{' '}
          {status?.sehat ? (
            <span className="badge badge-positive">Sama dengan OCS</span>
          ) : (
            <span className="badge badge-critical">Ada data belum terkirim</span>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-label)' }}>
          Pengiriman ke OCS {status?.ocsAktif ? 'aktif' : 'DIMATIKAN'} · waktu server{' '}
          {status ? fmtDateTime(status.waktuServer) : '—'}
        </div>
      </div>

      <div className="grid-card">
        <div className="grid-toolbar">
          <strong style={{ fontSize: 13 }}>Dokumen manifest bermasalah</strong>
        </div>
        <div className="table-scroll">
          <table className="rtable">
            <thead>
              <tr>
                <th>Basket</th>
                <th>Status</th>
                <th className="n">Valid</th>
                <th className="p2">Dokumen OCS</th>
                <th className="p3">Sinkron terakhir</th>
                <th>Masalah</th>
              </tr>
            </thead>
            <tbody>
              {(status?.docsBermasalah ?? []).map((d) => (
                <tr key={d.id}>
                  <td className="mono title" data-label="Basket">{d.basketCode}</td>
                  <td data-label="Status">
                    <span className="badge badge-critical">{d.status}</span>
                  </td>
                  <td className="n" data-label="Valid">{fmtNumber(d.totalValid)}</td>
                  <td className="mono p2" data-label="Dokumen OCS">{d.ocsDocNo ?? '—'}</td>
                  <td className="mono p3" data-label="Sinkron terakhir">
                    {d.lastSyncAt ? fmtDateTime(d.lastSyncAt) : '—'}
                  </td>
                  <td data-label="Masalah" style={{ whiteSpace: 'normal' }}>{d.lastError ?? '—'}</td>
                </tr>
              ))}
              {!status?.docsBermasalah.length && (
                <tr>
                  <td colSpan={6} className="muted" data-label="Info">
                    Tidak ada. Semua dokumen sudah tersinkron.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ display: 'grid', gap: 8 }}>
        <strong style={{ fontSize: 14 }}>Antrean perangkat ini</strong>
        <p style={{ fontSize: 13, color: 'var(--ink-label)' }}>
          Scan yang gagal terkirim tersimpan di perangkat ini dan dikirim otomatis saat jaringan kembali. Kosongkan
          antrean HANYA kalau isinya memang sudah tidak diperlukan — datanya akan hilang.
        </p>
        <button
          type="button"
          className="btn btn-danger btn-sm"
          style={{ justifySelf: 'start' }}
          onClick={async () => {
            if (!confirm('Kosongkan antrean perangkat ini? Scan yang belum terkirim akan hilang.')) return;
            await clearQueue();
            toast('warning', 'Antrean perangkat dikosongkan.');
          }}
          disabled={antrean === 0}
        >
          Kosongkan antrean ({antrean})
        </button>
      </div>
    </div>
  );
}

function Kpi({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={warn ? { color: 'var(--critical)' } : undefined}>
        {fmtNumber(value)}
      </div>
    </div>
  );
}
