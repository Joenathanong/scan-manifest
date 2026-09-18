'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '@/lib/client';
import { playForTone, vibrate } from '@/lib/audio';
import { sendOrQueue } from '@/lib/offline-queue';
import { toast } from '@/components/Toast';
import SoundToggle from '@/components/SoundToggle';
import PopupToggle from '@/components/PopupToggle';
import PerangkatHint from '@/components/PerangkatHint';
import ScanFlash, { kunciFlash, type FlashData } from '@/components/ScanFlash';
import { popupAktif } from '@/lib/scan-prefs';
import { fmtNumber, fmtTime } from '@/lib/date';
import { pesanTanpaResi } from '@/lib/teks';

type Scan1Result = {
  status: 'OK' | 'DOUBLE' | 'REJECT';
  tone: 'success' | 'double' | 'failed';
  message: string;
  resi: string;
  expedisi: string | null;
  orderId?: string;
  totalHariIni: number;
};

type BarisEkspedisi = { expedisiId: number | null; code: string; name: string; jumlah: number };
type BatchSubmit = { id: number; code: string; expedisiCode: string; jumlah: number; jam: string; oleh: string };
type StatusSesi = {
  ringkasan: BarisEkspedisi[];
  submits: BatchSubmit[];
  belumSubmit: number;
  verifikasi: { menunggu: number; tidakAda: number };
};

type Row = {
  id: number;
  resi: string;
  status: string;
  scan1At: string;
  expedisi: { code: string } | null;
};

type Feed = { tone: 'success' | 'double' | 'failed' | 'idle' | 'queued'; text: string; resi?: string };

export default function Scan1Page() {
  const [value, setValue] = useState('');
  const [feed, setFeed] = useState<Feed>({ tone: 'idle', text: 'Siap. Scan resi sekarang.' });
  const [rows, setRows] = useState<Row[]>([]);
  const [totalSaya, setTotalSaya] = useState(0);
  const [totalHariIni, setTotalHariIni] = useState(0);
  const [antreanLokal, setAntreanLokal] = useState<string[]>([]);
  const [flash, setFlash] = useState<FlashData | null>(null);
  const [sesi, setSesi] = useState<StatusSesi | null>(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Popup layar penuh hanya muncul kalau setelannya menyala di perangkat ini.
  const tampilkanFlash = useCallback(
    (tone: FlashData['tone'], ekspedisi: string, status: string, resi: string) => {
      if (!popupAktif()) return;
      setFlash({ tone, ekspedisi, status, resi, key: kunciFlash() });
    },
    [],
  );

  const muat = useCallback(async () => {
    const [daftar, status] = await Promise.all([
      apiGet<{ rows: Row[]; totalSaya: number; totalHariIni: number }>('/api/scan1?take=25'),
      apiGet<StatusSesi>('/api/sesi'),
    ]);
    if (daftar.ok) {
      setRows(daftar.data.rows);
      setTotalSaya(daftar.data.totalSaya);
      setTotalHariIni(daftar.data.totalHariIni);
    }
    if (status.ok) setSesi(status.data);
  }, []);

  useEffect(() => {
    void muat();
    const t = setInterval(muat, 30000);
    return () => clearInterval(t);
  }, [muat]);

  // Field scan tidak pernah di-disable & selalu kembali fokus (design-ocs §10.5).
  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    focus();
    const t = setInterval(focus, 2000);
    return () => clearInterval(t);
  }, []);

  const kirim = async (raw: string) => {
    const resi = raw.trim().toUpperCase();
    if (!resi) return;
    setValue('');

    // Dobel lokal: tertangkap walau jaringan mati.
    if (antreanLokal.includes(resi)) {
      setFeed({ tone: 'double', text: 'Sudah discan di perangkat ini.', resi });
      playForTone('double');
      vibrate([60, 60, 60]);
      // Ekspedisi diambil dari daftar scan yang sudah tampil, supaya dobel
      // lokal tetap menyebut nama ekspedisinya walau jaringan mati.
      tampilkanFlash(
        'double',
        rows.find((r) => r.resi === resi)?.expedisi?.code ?? 'DOBEL',
        'SUDAH DISCAN DI PERANGKAT INI',
        resi,
      );
      return;
    }

    const res = await sendOrQueue<Scan1Result>('scan1', '/api/scan1', { resi }, resi);

    if (res.queued) {
      setAntreanLokal((a) => [...a, resi]);
      setFeed({ tone: 'queued', text: 'Masuk antrean — jaringan sedang putus.', resi });
      playForTone('success');
      vibrate(40);
      tampilkanFlash('double', 'ANTREAN OFFLINE', 'TERSIMPAN — DIKIRIM SAAT JARINGAN KEMBALI', resi);
      return;
    }
    if (res.error || !res.data) {
      setFeed({ tone: 'failed', text: res.error ?? 'Gagal menyimpan.', resi });
      playForTone('failed');
      vibrate([120, 60, 120]);
      tampilkanFlash('failed', 'GAGAL', res.error ?? 'GAGAL MENYIMPAN', resi);
      return;
    }

    const data = res.data;
    setAntreanLokal((a) => [...a, resi]);
    setFeed({ tone: data.tone, text: pesanTanpaResi(data.message, data.resi), resi: data.resi });
    playForTone(data.tone);
    vibrate(data.tone === 'success' ? 40 : [120, 60, 120]);
    tampilkanFlash(
      data.tone,
      data.expedisi ?? 'BELUM DIKENALI',
      data.status === 'OK'
        ? 'BERHASIL — AWAITING TO SHIPMENT'
        : data.status === 'DOUBLE'
          ? 'SUDAH PERNAH DISCAN'
          : data.message,
      data.resi,
    );
    setTotalHariIni(data.totalHariIni);
    if (data.status === 'OK') {
      setTotalSaya((n) => n + 1);
      setRows((r) => [
        {
          id: Date.now(),
          resi: data.resi,
          status: 'AWAITING_PICKUP',
          scan1At: new Date().toISOString(),
          expedisi: data.expedisi ? { code: data.expedisi } : null,
        },
        ...r,
      ].slice(0, 25));
    }
  };

  const submit = async (baris: BarisEkspedisi | null) => {
    const label = baris ? `${baris.code} (${baris.jumlah} resi)` : 'SEMUA ekspedisi';
    if (!confirm(`Serahterimakan ${label}?\n\nDatanya tetap tersimpan dan tetap diproses di Scan 2 — yang dikunci hanya hitungannya.`)) return;
    setSubmitBusy(true);
    const res = await apiPost<{ batch: { code: string; expedisiCode: string; jumlah: number }[]; status: StatusSesi }>(
      '/api/scan1/submit',
      baris ? { expedisiId: baris.expedisiId } : { semua: true },
    );
    setSubmitBusy(false);
    if (!res.ok) {
      toast('error', res.error);
      return;
    }
    const total = res.data.batch.reduce((n, b) => n + b.jumlah, 0);
    toast('success', `${fmtNumber(total)} resi diserahterimakan (${res.data.batch.length} batch).`);
    setSesi(res.data.status);
  };

  const batalkan = async (id: number, resi: string) => {
    const res = await apiPost(`/api/items/${id}/void`, { alasan: 'Salah scan' });
    if (res.ok) {
      toast('success', `${resi} dibatalkan.`);
      setAntreanLokal((a) => a.filter((r) => r !== resi));
      void muat();
    } else {
      toast('error', res.error);
    }
  };

  const feedClass =
    feed.tone === 'idle'
      ? 'scan-feed scan-feed-idle'
      : feed.tone === 'queued'
        ? 'scan-feed scan-feed-double'
        : `scan-feed scan-feed-${feed.tone}`;

  return (
    <div style={{ display: 'grid', gap: 'var(--gap)' }}>
      <h1 className="page-title">Scan 1 — Resi Masuk</h1>
      <p style={{ color: 'var(--ink-label)', fontSize: 13, marginTop: -6 }}>
        Scan resi apa adanya. Keranjang belum dibentuk di tahap ini — penyortiran per ekspedisi dilakukan
        setelahnya, lalu diproses di Scan 2.
      </p>

      <div className="kpi-grid">
        <div className="card">
          <div className="kpi-label">Awaiting to shipment hari ini</div>
          <div className="kpi-value">{fmtNumber(totalHariIni)}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Scan saya hari ini</div>
          <div className="kpi-value">{fmtNumber(totalSaya)}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Tidak ada di OCS</div>
          <div
            className="kpi-value"
            style={{ color: sesi?.verifikasi.tidakAda ? 'var(--negative)' : 'var(--ink)' }}
          >
            {fmtNumber(sesi?.verifikasi.tidakAda ?? 0)}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>
            {sesi?.verifikasi.menunggu
              ? `${fmtNumber(sesi.verifikasi.menunggu)} sedang diperiksa`
              : 'tidak ikut dihitung'}
          </div>
        </div>
      </div>

      <PerangkatHint untuk="pdt" />

      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label className="field-label" htmlFor="scan" style={{ margin: 0 }}>
            Resi
          </label>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <SoundToggle ringkas />
            <PopupToggle ringkas />
          </span>
        </div>
        <input
          id="scan"
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
          inputMode="text"
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
        <div className={feedClass} aria-live="polite">
          {feed.resi && <span className="scan-feed-resi">{feed.resi}</span>}
          <span className={feed.resi ? 'scan-feed-ket' : undefined}>{feed.text}</span>
        </div>
      </div>

      <div className="grid-card">
        <div className="grid-toolbar">
          <strong style={{ fontSize: 13 }}>Total per jasa kirim</strong>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-label)' }}>
            {fmtNumber(sesi?.belumSubmit ?? 0)} belum diserahkan
          </span>
        </div>
        <div className="table-scroll">
          <table className="rtable">
            <colgroup>
              <col style={{ width: '44%' }} />
              <col style={{ width: '22%' }} />
              <col style={{ width: '34%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Jasa kirim</th>
                <th className="n">Jumlah</th>
                <th>Serah terima</th>
              </tr>
            </thead>
            <tbody>
              {(sesi?.ringkasan ?? []).map((r) => (
                <tr key={r.code}>
                  <td data-label="Jasa kirim">
                    <span className="badge badge-brand">{r.code}</span>
                  </td>
                  <td className="n title" data-label="Jumlah">
                    {fmtNumber(r.jumlah)}
                  </td>
                  <td data-label="Serah terima">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => void submit(r)}
                      disabled={submitBusy}
                    >
                      Submit
                    </button>
                  </td>
                </tr>
              ))}
              {!sesi?.ringkasan.length && (
                <tr>
                  <td colSpan={3} className="muted" data-label="Info">
                    Semua resi di batch ini sudah diserahterimakan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="grid-foot">
          <span className="muted" style={{ fontSize: 12 }}>
            Submit mengunci hitungan serah terima. Tidak mengirim ke OCS.
          </span>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void submit(null)}
            disabled={submitBusy || !sesi?.ringkasan.length}
          >
            {submitBusy ? 'Memproses…' : 'Submit semua'}
          </button>
        </div>
      </div>

      {!!sesi?.submits.length && (
        <div className="grid-card">
          <div className="grid-toolbar">
            <strong style={{ fontSize: 13 }}>Batch serah terima</strong>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-label)' }}>
              {fmtNumber(sesi.submits.length)} batch
            </span>
          </div>
          <div className="table-scroll">
            <table className="rtable">
              <thead>
                <tr>
                  <th>Kode</th>
                  <th>Jasa kirim</th>
                  <th className="n">Resi</th>
                  <th>Jam</th>
                </tr>
              </thead>
              <tbody>
                {sesi.submits.map((b) => (
                  <tr key={b.id}>
                    <td className="mono title" data-label="Kode">
                      {b.code}
                    </td>
                    <td data-label="Jasa kirim">
                      <span className="badge badge-neutral">{b.expedisiCode}</span>
                    </td>
                    <td className="n" data-label="Resi">
                      {fmtNumber(b.jumlah)}
                    </td>
                    <td className="mono" data-label="Jam">
                      {fmtTime(b.jam)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid-card">
        <div className="grid-toolbar">
          <strong style={{ fontSize: 13 }}>25 scan terakhir saya</strong>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-label)' }}>
            {fmtNumber(rows.length)} baris
          </span>
        </div>
        <div className="table-scroll">
          <table className="rtable">
            <colgroup>
              <col style={{ width: '46%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '18%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Resi</th>
                <th>Ekspedisi</th>
                <th>Jam</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted" data-label="Info">
                    Belum ada scan hari ini.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="mono title" data-label="Resi">
                    {r.resi}
                  </td>
                  <td data-label="Ekspedisi">
                    <span className={`badge ${r.expedisi ? 'badge-brand' : 'badge-neutral'}`}>
                      {r.expedisi?.code ?? 'BELUM DIKENALI'}
                    </span>
                  </td>
                  <td className="mono" data-label="Jam">
                    {fmtTime(r.scan1At)}
                  </td>
                  <td data-label="Aksi">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void batalkan(r.id, r.resi)}>
                      Batalkan
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ScanFlash data={flash} onSelesai={() => setFlash(null)} />
    </div>
  );
}
