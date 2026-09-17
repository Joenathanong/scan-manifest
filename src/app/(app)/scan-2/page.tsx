'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '@/lib/client';
import { playForTone, vibrate } from '@/lib/audio';
import { sendOrQueue } from '@/lib/offline-queue';
import { toast } from '@/components/Toast';
import { fmtNumber, fmtTime } from '@/lib/date';
import { IconPrint } from '@/components/Icons';

type Expedisi = { id: number; code: string; name: string; ocsShipper: string; active: boolean };

type OpenResult = {
  docId: number;
  basket: { id: number; code: string; areaId: string };
  expedisi: { id: number; code: string; name: string; ocsShipper: string };
  ocsDocId: number | null;
  ocsDocNo: string | null;
  ocsWarning: string | null;
  totalValid: number;
  totalNotValid: number;
};

type Scan2Result = {
  status: 'OK' | 'DOUBLE' | 'NOT_IN_SCAN1' | 'INVALID' | 'REJECT';
  tone: 'success' | 'double' | 'failed';
  message: string;
  resi: string;
  orderId?: string;
  reason?: string;
  totalValid: number;
  totalNotValid: number;
};

type StateResult = {
  doc: {
    id: number;
    status: string;
    basketCode: string;
    shipper: string;
    areaId: string;
    ocsDocId: number | null;
    ocsDocNo: string | null;
    lastError: string | null;
    expedisi: { id: number; code: string; name: string };
  };
  scans: {
    id: number;
    scanResult: string;
    orderId: string | null;
    valid: boolean;
    reason: string | null;
    manifestTime: string;
    syncedAt: string | null;
  }[];
  totalValid: number;
  totalNotValid: number;
};

const AREAS = ['Pusat', 'Surabaya', 'Yogyakarta', 'Medan', 'Makassar'];
const KEY = 'scan-manifest:doc';

export default function Scan2Page() {
  const [expedisiList, setExpedisiList] = useState<Expedisi[]>([]);
  const [expedisiId, setExpedisiId] = useState<number | ''>('');
  const [areaId, setAreaId] = useState('Pusat');
  const [basketInput, setBasketInput] = useState('');
  const [sesi, setSesi] = useState<OpenResult | null>(null);
  const [st, setSt] = useState<StateResult | null>(null);
  const [value, setValue] = useState('');
  const [feed, setFeed] = useState<{ tone: string; text: string }>({
    tone: 'idle',
    text: 'Scan resi untuk masuk ke basket ini.',
  });
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void apiGet<Expedisi[]>('/api/expedisi').then((r) => {
      if (r.ok) {
        const aktif = r.data.filter((e) => e.active);
        setExpedisiList(aktif);
        if (aktif[0]) setExpedisiId(aktif[0].id);
      }
    });
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) setSesi(JSON.parse(saved) as OpenResult);
    } catch {
      /* abaikan */
    }
  }, []);

  const muatState = useCallback(async (docId: number) => {
    const res = await apiGet<StateResult>(`/api/scan2/state/${docId}`);
    if (res.ok) setSt(res.data);
  }, []);

  useEffect(() => {
    if (!sesi) return;
    void muatState(sesi.docId);
    const t = setInterval(() => void muatState(sesi.docId), 30000);
    return () => clearInterval(t);
  }, [sesi, muatState]);

  useEffect(() => {
    if (!sesi) return;
    const focus = () => inputRef.current?.focus();
    focus();
    const t = setInterval(focus, 2000);
    return () => clearInterval(t);
  }, [sesi]);

  const mulai = async () => {
    if (!expedisiId) return;
    setBusy(true);
    const res = await apiPost<OpenResult>('/api/scan2/open', {
      expedisiId,
      areaId,
      basketCode: basketInput.trim() || null,
    });
    setBusy(false);
    if (!res.ok) {
      toast('error', res.error);
      return;
    }
    setSesi(res.data);
    try {
      localStorage.setItem(KEY, JSON.stringify(res.data));
    } catch {
      /* abaikan */
    }
    if (res.data.ocsWarning) toast('warning', `OCS: ${res.data.ocsWarning}`);
    else toast('success', `Basket ${res.data.basket.code} siap. Dokumen OCS ${res.data.ocsDocNo ?? '-'}.`);
    setBasketInput('');
  };

  const tutupSesi = () => {
    setSesi(null);
    setSt(null);
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* abaikan */
    }
  };

  const kirim = async (raw: string) => {
    const resi = raw.trim().toUpperCase();
    if (!resi || !sesi) return;
    setValue('');

    const res = await sendOrQueue<Scan2Result>('scan2', '/api/scan2/scan', { docId: sesi.docId, resi }, resi);

    if (res.queued) {
      setFeed({ tone: 'double', text: `${resi} masuk antrean — jaringan sedang putus.` });
      playForTone('success');
      vibrate(40);
      return;
    }
    if (res.error || !res.data) {
      setFeed({ tone: 'failed', text: res.error ?? 'Gagal.' });
      playForTone('failed');
      vibrate([120, 60, 120]);
      return;
    }
    const data = res.data;
    setFeed({ tone: data.tone, text: data.message });
    playForTone(data.tone);
    vibrate(data.tone === 'success' ? 40 : [120, 60, 120]);
    void muatState(sesi.docId);
  };

  const sinkron = async () => {
    if (!sesi) return;
    setBusy(true);
    const res = await apiPost<{ sent: number; error: string | null }>('/api/scan2/sync', { docId: sesi.docId });
    setBusy(false);
    if (!res.ok) toast('error', res.error);
    else if (res.data.error) toast('warning', `Belum terkirim: ${res.data.error}`);
    else toast('success', `${res.data.sent} scan tersinkron ke OCS.`);
    void muatState(sesi.docId);
  };

  const submit = async () => {
    if (!sesi) return;
    if (!confirm(`Submit manifest basket ${sesi.basket.code} ke OCS?`)) return;
    setBusy(true);
    const res = await apiPost<{ submitted: boolean; queued: boolean; error: string | null; totalValid: number }>(
      '/api/scan2/submit',
      { docId: sesi.docId },
    );
    setBusy(false);
    if (!res.ok) {
      toast('error', res.error);
      return;
    }
    if (res.data.submitted) {
      toast('success', `Basket ${sesi.basket.code} terkirim ke OCS (${res.data.totalValid} resi).`);
      tutupSesi();
    } else {
      toast('warning', `Masuk antrean kirim: ${res.data.error ?? 'menunggu jaringan'}. Data aman, akan dikirim otomatis.`);
      void muatState(sesi.docId);
    }
  };

  /* ---------------- Tahap 1: buka sesi ---------------- */
  if (!sesi) {
    return (
      <div style={{ display: 'grid', gap: 'var(--gap)' }}>
        <h1 className="page-title">Scan 2 — Manifest</h1>
        <p style={{ color: 'var(--ink-label)', fontSize: 13, marginTop: -6 }}>
          Pilih ekspedisi keranjang final, lalu sistem membuat nomor basket + QR untuk ditempel. Hasil scan di
          sini yang dikirim ke OCS.
        </p>

        <div className="card" style={{ display: 'grid', gap: 12, maxWidth: 520 }}>
          <div>
            <label className="field-label" htmlFor="exp">
              Ekspedisi
            </label>
            <select
              id="exp"
              className="select-field"
              value={expedisiId}
              onChange={(e) => setExpedisiId(Number(e.target.value))}
            >
              {expedisiList.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.code} — {e.name} (OCS: {e.ocsShipper})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="field-label" htmlFor="area">
              Area
            </label>
            <select id="area" className="select-field" value={areaId} onChange={(e) => setAreaId(e.target.value)}>
              {AREAS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="field-label" htmlFor="bkt">
              Basket (kosongkan untuk membuat baru)
            </label>
            <input
              id="bkt"
              className="input-field mono"
              value={basketInput}
              onChange={(e) => setBasketInput(e.target.value.toUpperCase())}
              placeholder="Scan QR basket yang sudah ada"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <button type="button" className="btn btn-primary" onClick={() => void mulai()} disabled={busy || !expedisiId}>
            {busy ? 'Menyiapkan…' : 'Mulai manifest'}
          </button>
        </div>
      </div>
    );
  }

  /* ---------------- Tahap 2: scan ---------------- */
  const feedClass = feed.tone === 'idle' ? 'scan-feed scan-feed-idle' : `scan-feed scan-feed-${feed.tone}`;
  const belumSinkron = st?.scans.filter((s) => s.valid && !s.syncedAt).length ?? 0;

  return (
    <div style={{ display: 'grid', gap: 'var(--gap)' }}>
      <h1 className="page-title">Scan 2 — {sesi.basket.code}</h1>

      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 12, color: 'var(--ink-label)' }}>
            {sesi.expedisi.code} · {sesi.basket.areaId} · OCS {st?.doc.ocsDocNo ?? sesi.ocsDocNo ?? '—'}
          </div>
          <div className="mono" style={{ fontSize: 18, fontWeight: 700 }}>
            {sesi.basket.code}
          </div>
        </div>
        <Link href={`/label/${sesi.basket.code}`} target="_blank" className="btn btn-secondary btn-sm">
          <IconPrint className="ico" /> Cetak label
        </Link>
        <button type="button" className="btn btn-ghost btn-sm" onClick={tutupSesi}>
          Ganti basket
        </button>
      </div>

      {st?.doc.lastError && (
        <div
          style={{
            background: 'var(--critical-bg)',
            color: 'var(--critical)',
            border: '1px solid var(--critical-border)',
            borderRadius: 'var(--r-md)',
            padding: '10px 14px',
            fontSize: 13,
          }}
        >
          <strong>Catatan OCS:</strong> {st.doc.lastError} — scan tetap tersimpan dan akan dikirim ulang otomatis.
        </div>
      )}

      <div className="kpi-grid">
        <div className="card">
          <div className="kpi-label">Valid</div>
          <div className="kpi-value" style={{ color: 'var(--positive)' }}>
            {fmtNumber(st?.totalValid ?? 0)}
          </div>
        </div>
        <div className="card">
          <div className="kpi-label">Ditolak</div>
          <div className="kpi-value" style={{ color: 'var(--negative)' }}>
            {fmtNumber(st?.totalNotValid ?? 0)}
          </div>
        </div>
        <div className="card">
          <div className="kpi-label">Belum tersinkron</div>
          <div className="kpi-value" style={{ color: belumSinkron ? 'var(--critical)' : 'var(--ink)' }}>
            {fmtNumber(belumSinkron)}
          </div>
        </div>
      </div>

      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <label className="field-label" htmlFor="scan2">
          Resi
        </label>
        <input
          id="scan2"
          ref={inputRef}
          className="input-field input-scan"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void kirim(value);
            }
          }}
          placeholder="SCAN DI SINI"
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
        <div className={feedClass} aria-live="polite">
          {feed.text}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary btn-block-sm" onClick={() => void sinkron()} disabled={busy}>
            Sinkron ke OCS
          </button>
          <button type="button" className="btn btn-primary btn-block-sm" onClick={() => void submit()} disabled={busy}>
            Selesai &amp; submit manifest
          </button>
        </div>
      </div>

      <div className="grid-card">
        <div className="grid-toolbar">
          <strong style={{ fontSize: 13 }}>Scan terakhir</strong>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-label)' }}>
            {fmtNumber(st?.scans.length ?? 0)} baris terbaru
          </span>
        </div>
        <div className="table-scroll">
          <table className="rtable">
            <colgroup>
              <col style={{ width: '34%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '14%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Resi</th>
                <th className="p2">Order ID</th>
                <th>Status</th>
                <th className="p3">OCS</th>
                <th>Jam</th>
              </tr>
            </thead>
            <tbody>
              {(st?.scans ?? []).map((s) => (
                <tr key={s.id}>
                  <td className="mono title" data-label="Resi">
                    {s.scanResult}
                  </td>
                  <td className="mono p2" data-label="Order ID">
                    {s.orderId || '—'}
                  </td>
                  <td data-label="Status">
                    <span className={`badge ${s.valid ? 'badge-positive' : 'badge-negative'}`}>
                      {s.valid ? 'Valid' : s.reason || 'Ditolak'}
                    </span>
                  </td>
                  <td className="p3" data-label="OCS">
                    <span className={`badge ${s.syncedAt ? 'badge-positive' : 'badge-critical'}`}>
                      {s.syncedAt ? 'Terkirim' : 'Menunggu'}
                    </span>
                  </td>
                  <td className="mono" data-label="Jam">
                    {fmtTime(s.manifestTime)}
                  </td>
                </tr>
              ))}
              {!st?.scans.length && (
                <tr>
                  <td colSpan={5} className="muted" data-label="Info">
                    Belum ada scan di basket ini.
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
