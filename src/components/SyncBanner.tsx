'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/client';
import { clearReports, flushQueue, startQueueWatcher, subscribeQueue, type QueueReport } from '@/lib/offline-queue';

type SyncStatus = {
  ocsAktif: boolean;
  outboxPending: number;
  outboxFailed: number;
  scanBelumSinkron: number;
  itemPending: number;
  selisih: number;
  sehat: boolean;
  docsBermasalah: { id: number; basketCode: string; status: string; lastError: string | null }[];
};

export default function SyncBanner() {
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);
  const [flushingLocal, setFlushingLocal] = useState(false);
  const [reports, setReports] = useState<QueueReport[]>([]);
  const [server, setServer] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    startQueueWatcher();
    return subscribeQueue((s) => {
      setPending(s.pending);
      setOnline(s.online);
      setFlushingLocal(s.flushing);
      setReports(s.reports);
    });
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const res = await apiGet<SyncStatus>('/api/sync-status');
      if (alive && res.ok) setServer(res.data);
    };
    void load();
    const t = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [pending]);

  const kirimUlang = async () => {
    setBusy(true);
    await flushQueue();
    await apiPost('/api/outbox/flush');
    const res = await apiGet<SyncStatus>('/api/sync-status');
    if (res.ok) setServer(res.data);
    setBusy(false);
  };

  const adaMasalahServer = !!server && !server.sehat;
  const adaLaporan = reports.length > 0;
  if (online && pending === 0 && !adaMasalahServer && !adaLaporan) return null;

  return (
    <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
      {!online && (
        <Strip kind="negative">
          <strong>Jaringan terputus.</strong> {pending > 0 ? `${pending} scan tersimpan di perangkat ini` : 'Scan tetap bisa dilakukan'} — akan dikirim otomatis begitu jaringan kembali.
        </Strip>
      )}

      {online && pending > 0 && (
        <Strip kind="critical" action={{ label: flushingLocal ? 'Mengirim…' : 'Kirim sekarang', onClick: kirimUlang, busy: busy || flushingLocal }}>
          <strong>{pending} scan menunggu terkirim</strong> dari perangkat ini.
        </Strip>
      )}

      {adaMasalahServer && server && (
        <Strip kind="critical" action={{ label: busy ? 'Mengirim…' : 'Kirim ulang ke OCS', onClick: kirimUlang, busy }}>
          <strong>Data sistem belum sama dengan OCS.</strong>{' '}
          {server.scanBelumSinkron > 0 && `${server.scanBelumSinkron} scan belum tersinkron. `}
          {server.outboxPending > 0 && `${server.outboxPending} antrean menunggu. `}
          {server.outboxFailed > 0 && `${server.outboxFailed} antrean gagal berulang. `}
          {!server.ocsAktif && 'Pengiriman ke OCS sedang dimatikan. '}
          {server.docsBermasalah[0]?.lastError && (
            <span className="muted"> ({server.docsBermasalah[0].basketCode}: {server.docsBermasalah[0].lastError})</span>
          )}
        </Strip>
      )}

      {adaLaporan && (
        <Strip kind="informative" action={{ label: 'Tutup', onClick: () => void clearReports(), busy: false }}>
          <div style={{ display: 'grid', gap: 2 }}>
            <strong>{reports.length} scan tertunda ditolak saat dikirim ulang:</strong>
            {reports.slice(0, 5).map((r) => (
              <span key={r.id} className="mono" style={{ fontSize: 12 }}>
                {r.label} — {r.message}
              </span>
            ))}
          </div>
        </Strip>
      )}
    </div>
  );
}

function Strip({
  kind,
  children,
  action,
}: {
  kind: 'negative' | 'critical' | 'informative';
  children: React.ReactNode;
  action?: { label: string; onClick: () => void; busy: boolean };
}) {
  const bg = `var(--${kind}-bg)`;
  const fg = `var(--${kind})`;
  const bd = kind === 'informative' ? 'var(--informative)' : `var(--${kind}-border)`;
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        background: bg,
        color: fg,
        border: `1px solid ${bd}`,
        borderRadius: 'var(--r-md)',
        padding: '10px 14px',
        fontSize: 13,
      }}
    >
      <div style={{ flex: 1, minWidth: 220 }}>{children}</div>
      {action && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={action.onClick} disabled={action.busy}>
          {action.label}
        </button>
      )}
    </div>
  );
}
