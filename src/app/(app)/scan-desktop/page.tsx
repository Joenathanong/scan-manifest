'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '@/lib/client';
import { playForTone } from '@/lib/audio';
import { sendOrQueue } from '@/lib/offline-queue';
import { toast } from '@/components/Toast';
import { fmtDate, fmtDateTime, fmtNumber, fmtTime } from '@/lib/date';
import { pesanTanpaResi } from '@/lib/teks';
import SoundToggle from '@/components/SoundToggle';
import PopupToggle from '@/components/PopupToggle';
import PerangkatHint from '@/components/PerangkatHint';
import ScanFlash, { kunciFlash, type FlashData } from '@/components/ScanFlash';
import { popupAktif } from '@/lib/scan-prefs';

/**
 * Scan 1 versi desktop — tampilannya meniru Apps Script "Serah Terima Dispatch"
 * supaya operator yang sudah terbiasa tidak perlu belajar ulang. Datanya tetap
 * masuk ke TiDB lewat /api/scan1 yang sama dengan versi PDT, termasuk antrean
 * offline-nya.
 */

type Row = {
  id: number;
  resi: string;
  status: string;
  jam: string;
  ekspedisi: string | null;
  ekspedisiNama: string | null;
};

type BarisEkspedisi = { expedisiId: number | null; code: string; name: string; jumlah: number };
type BatchSubmit = { id: number; code: string; expedisiCode: string; jumlah: number; jam: string; oleh: string };

type Status = {
  sesi: { id: number; code: string; operatorName: string; shift: string | null; mulai: string; dupCount: number } | null;
  rows: Row[];
  total: number;
  dupCount: number;
  jenisEkspedisi: string[];
  totalHariIni: number;
  tanggal: string;
  ringkasan: BarisEkspedisi[];
  submits: BatchSubmit[];
  belumSubmit: number;
  verifikasi: { menunggu: number; tidakAda: number };
};

type Scan1Result = {
  status: 'OK' | 'DOUBLE' | 'REJECT';
  tone: 'success' | 'double' | 'failed';
  message: string;
  resi: string;
  expedisi: string | null;
  orderId?: string;
  totalHariIni: number;
};

const SHIFT = [
  'Shift Pagi (06:00 – 14:00)',
  'Shift Siang (14:00 – 22:00)',
  'Shift Malam (22:00 – 06:00)',
];

const WARNA_TAG = ['hijau', 'kuning', 'biru', 'abu'] as const;
function warnaEkspedisi(kode: string | null): string {
  if (!kode) return 'abu';
  let n = 0;
  for (const c of kode) n += c.charCodeAt(0);
  return WARNA_TAG[n % WARNA_TAG.length];
}

/**
 * Naikkan satu baris ringkasan di layar tanpa menunggu penyegaran dari server.
 *
 * Ekspedisi yang BELUM ada di daftar sengaja tidak ditambahkan sendiri di sini:
 * barisnya butuh expedisiId asli dari server, dan menebaknya berarti tombol
 * Submit baris itu bisa mengunci kelompok yang salah. Kalau begitu, pemanggil
 * menyegarkan dari server saja.
 */
function naikkanRingkasan(lama: BarisEkspedisi[], kode: string | null): BarisEkspedisi[] | null {
  const cari = kode ?? 'BELUM DIKENALI';
  if (!lama.some((r) => r.code === cari)) return null;
  return lama
    .map((r) => (r.code === cari ? { ...r, jumlah: r.jumlah + 1 } : r))
    .sort((a, b) => b.jumlah - a.jumlah);
}

export default function ScanDesktopPage() {
  const [st, setSt] = useState<Status | null>(null);
  const [nama, setNama] = useState('');
  const [shift, setShift] = useState(SHIFT[0]);
  const [busy, setBusy] = useState(false);
  const [nilai, setNilai] = useState('');
  const [feed, setFeed] = useState<{ nada: string; teks: string; resi?: string }>({
    nada: 'idle',
    teks: 'Siap. Scan barcode atau ketik nomor resi lalu tekan Enter.',
  });
  const [terakhir, setTerakhir] = useState<{ ekspedisi: string | null }>({ ekspedisi: null });
  const [cari, setCari] = useState('');
  const [hasilCari, setHasilCari] = useState<string | null>(null);
  const [jam, setJam] = useState('');
  const [flash, setFlash] = useState<FlashData | null>(null);
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
    const res = await apiGet<Status>('/api/sesi');
    if (res.ok) setSt(res.data);
  }, []);

  useEffect(() => {
    void muat();
    const t = setInterval(muat, 30000);
    return () => clearInterval(t);
  }, [muat]);

  useEffect(() => {
    const tik = () =>
      setJam(
        new Intl.DateTimeFormat('id-ID', {
          timeZone: 'Asia/Jakarta',
          weekday: 'short',
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }).format(new Date()),
      );
    tik();
    const t = setInterval(tik, 1000);
    return () => clearInterval(t);
  }, []);

  // Field scan tidak pernah di-disable dan selalu kembali fokus.
  useEffect(() => {
    if (!st?.sesi) return;
    const fokus = () => inputRef.current?.focus();
    fokus();
    const t = setInterval(fokus, 2000);
    return () => clearInterval(t);
  }, [st?.sesi]);

  const mulaiSesi = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await apiPost<Status>('/api/sesi', { shift, operatorName: nama.trim() || undefined });
    setBusy(false);
    if (!res.ok) {
      toast('error', res.error);
      return;
    }
    setSt(res.data);
    toast('success', `Batch ${res.data.sesi?.code ?? ''} dibuka.`);
  };

  const tutupSesi = async () => {
    if (!confirm('Tutup batch ini? Scan berikutnya harus membuka batch baru.')) return;
    setBusy(true);
    const res = await apiPost('/api/sesi/tutup');
    setBusy(false);
    if (!res.ok) {
      toast('error', res.error);
      return;
    }
    toast('success', 'Batch ditutup.');
    void muat();
  };

  const submit = async (baris: BarisEkspedisi | null) => {
    const label = baris ? `${baris.code} (${baris.jumlah} resi)` : 'SEMUA ekspedisi';
    if (!confirm(`Serahterimakan ${label}?\n\nResi yang sudah diserahterimakan tidak ikut terhitung lagi di panel ini, tapi datanya tetap tersimpan dan tetap diproses di Scan 2.`)) {
      return;
    }
    setSubmitBusy(true);
    const res = await apiPost<{ batch: { code: string; expedisiCode: string; jumlah: number }[]; status: Status }>(
      '/api/scan1/submit',
      baris ? { expedisiId: baris.expedisiId } : { semua: true },
    );
    setSubmitBusy(false);
    if (!res.ok) {
      toast('error', res.error);
      return;
    }
    const total = res.data.batch.reduce((n, b) => n + b.jumlah, 0);
    toast(
      'success',
      res.data.batch.length === 1
        ? `${res.data.batch[0].code} — ${res.data.batch[0].expedisiCode}, ${fmtNumber(total)} resi diserahterimakan.`
        : `${res.data.batch.length} batch dibuat, total ${fmtNumber(total)} resi diserahterimakan.`,
    );
    setSt(res.data.status);
  };

  const kirim = async (mentah: string) => {
    const resi = mentah.trim().toUpperCase();
    if (!resi) return;
    setNilai('');

    const res = await sendOrQueue<Scan1Result>('scan1', '/api/scan1', { resi }, resi);

    if (res.queued) {
      setFeed({ nada: 'double', teks: 'Masuk antrean — jaringan sedang putus.', resi });
      playForTone('success');
      tampilkanFlash('double', 'ANTREAN OFFLINE', 'TERSIMPAN — DIKIRIM SAAT JARINGAN KEMBALI', resi);
      return;
    }
    if (res.error || !res.data) {
      setFeed({ nada: 'failed', teks: res.error ?? 'Gagal menyimpan.', resi });
      playForTone('failed');
      tampilkanFlash('failed', 'GAGAL', res.error ?? 'GAGAL MENYIMPAN', resi);
      return;
    }

    const d = res.data;
    setFeed({ nada: d.tone, teks: pesanTanpaResi(d.message, d.resi), resi: d.resi });
    setTerakhir({ ekspedisi: d.expedisi });
    playForTone(d.tone);

    // Daftar diperbarui di layar TANPA menarik ulang seluruh batch dari server.
    // Dulu setiap scan memanggil /api/sesi lagi — empat query dan ratusan baris
    // dikirim ulang hanya untuk menambah satu baris. Penyegaran penuh tetap
    // jalan lewat timer 30 detik dan tombol "Muat ulang".
    if (d.status === 'OK') {
      // Ekspedisi baru muncul di batch ini -> ringkasannya harus datang dari
      // server supaya expedisiId-nya benar.
      if (st && !naikkanRingkasan(st.ringkasan, d.expedisi)) void muat();
      setSt((lama) =>
        lama
          ? {
              ...lama,
              total: lama.total + 1,
              totalHariIni: d.totalHariIni,
              jenisEkspedisi: d.expedisi && !lama.jenisEkspedisi.includes(d.expedisi)
                ? [...lama.jenisEkspedisi, d.expedisi]
                : lama.jenisEkspedisi,
              belumSubmit: lama.belumSubmit + 1,
              ringkasan: naikkanRingkasan(lama.ringkasan, d.expedisi) ?? lama.ringkasan,
              rows: [
                {
                  id: -Date.now(),
                  resi: d.resi,
                  status: 'AWAITING_PICKUP',
                  jam: new Date().toISOString(),
                  ekspedisi: d.expedisi,
                  ekspedisiNama: d.expedisi,
                },
                ...lama.rows,
              ],
            }
          : lama,
      );
    } else if (d.status === 'DOUBLE') {
      setSt((lama) => (lama ? { ...lama, dupCount: lama.dupCount + 1, totalHariIni: d.totalHariIni } : lama));
    }

    tampilkanFlash(
      d.tone,
      d.expedisi ?? 'BELUM DIKENALI',
      d.status === 'OK' ? 'BERHASIL — AWAITING TO SHIPMENT' : d.status === 'DOUBLE' ? 'SUDAH PERNAH DISCAN' : d.message,
      d.resi,
    );
  };

  const cariResi = async () => {
    const q = cari.trim().toUpperCase();
    if (!q) return;
    setHasilCari('Mencari…');
    const res = await apiGet<{ rows: { resi: string; status: string; basket: { code: string } | null; scanDate: string }[] }>(
      `/api/history?cari=${encodeURIComponent(q)}`,
    );
    if (!res.ok) {
      setHasilCari(res.error);
      return;
    }
    if (!res.data.rows.length) {
      setHasilCari(`${q} BELUM pernah discan.`);
      playForTone('failed');
      return;
    }
    const r = res.data.rows[0];
    const label =
      r.status === 'PICKUP'
        ? `sudah dimanifest — awaiting to pickup${r.basket ? ` di basket ${r.basket.code}` : ''}`
        : r.status === 'VOID'
          ? 'dibatalkan'
          : 'sudah discan — awaiting to shipment, menunggu Scan 2';
    setHasilCari(`${r.resi} — ${label} (${fmtDate(r.scanDate)}).`);
    playForTone('success');
  };

  /* ---------------- Tahap 1: buka batch ---------------- */
  if (!st?.sesi) {
    return (
      <div className="disp">
        <div className="disp-top">
          <span className="disp-brand">📦 Dashboard Scan Resi — Serah Terima</span>
          <span className="disp-spacer" />
          <span className="disp-jam">{jam}</span>
        </div>

        <div className="disp-body" style={{ placeItems: 'center', paddingTop: 40 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 40 }}>🚀</div>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--navy-ink)', margin: '6px 0 4px' }}>
              Mulai Sesi Scan
            </h1>
            <p style={{ color: 'var(--abu)', fontSize: 13 }}>
              Isi nama operator &amp; shift, lalu mulai batch baru.
            </p>
          </div>

          <form onSubmit={mulaiSesi} className="disp-card" style={{ width: 'min(100%, 380px)' }}>
            <div className="disp-card-head">
              <span className="disp-spacer" style={{ marginLeft: 0 }} />
              Data Operator
              <span className="disp-spacer" />
            </div>
            <div className="disp-card-body" style={{ display: 'grid', gap: 12 }}>
              <div>
                <div className="disp-mini-label" style={{ textAlign: 'center', marginBottom: 4 }}>
                  Nama Operator / Dispatch
                </div>
                <input
                  className="disp-scan-input"
                  style={{ height: 40, fontSize: 14, borderWidth: 1, borderColor: 'var(--biru)', paddingRight: 14 }}
                  value={nama}
                  onChange={(e) => setNama(e.target.value)}
                  placeholder="Contoh: Budi Santoso"
                  autoFocus
                />
              </div>
              <div>
                <div className="disp-mini-label" style={{ textAlign: 'center', marginBottom: 4 }}>
                  Shift
                </div>
                <select
                  className="disp-scan-input"
                  style={{ height: 40, fontSize: 14, borderWidth: 1, borderColor: 'var(--garis)', padding: '0 12px' }}
                  value={shift}
                  onChange={(e) => setShift(e.target.value)}
                >
                  {SHIFT.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className="disp-btn disp-btn-navy" style={{ height: 40 }} disabled={busy}>
                🚀 {busy ? 'Menyiapkan…' : 'Mulai Scan'}
              </button>
            </div>
          </form>

          <p style={{ color: 'var(--abu)', fontSize: 11.5 }}>
            Nama dikosongkan = memakai nama akun yang sedang login.
          </p>
        </div>
      </div>
    );
  }

  /* ---------------- Tahap 2: layar scan ---------------- */
  const sesi = st.sesi;
  const jenis = st.jenisEkspedisi;

  return (
    <div className="disp">
      <div className="disp-top">
        <span className="disp-brand">📦 Dashboard Scan Resi — Serah Terima</span>
        <span className="disp-spacer" />
        <Link href="/history" className="disp-pill">
          🔎 Pencarian
        </Link>
        <Link href="/dashboard" className="disp-pill">
          📊 Report
        </Link>
        <span className="disp-pill disp-pill-kuning">{fmtNumber(st.total)} BELUM DIMANIFEST</span>
        <span className="disp-jam">{jam}</span>
      </div>

      <div className="disp-meta">
        <span>
          Operator: <strong>{sesi.operatorName}</strong> · Shift: <strong>{sesi.shift ?? '—'}</strong> · Batch:{' '}
          <strong>{sesi.code}</strong> · Dimulai: <strong>{fmtDateTime(sesi.mulai)}</strong>
        </span>
        <span className="disp-spacer" />
        <Link href="/scan-2" className="disp-btn disp-btn-kuning">
          ➡️ Lanjut ke Scan 2
        </Link>
        <button type="button" className="disp-btn disp-btn-hijau" onClick={() => void muat()}>
          🔄 Muat ulang
        </button>
        <button type="button" className="disp-btn disp-btn-putih" onClick={() => void tutupSesi()} disabled={busy}>
          🏠 Tutup batch
        </button>
      </div>

      <div className="disp-body">
        <PerangkatHint untuk="desktop" />

        <div className="disp-kpi">
          <div className="disp-tile">
            <div className="disp-tile-label">Total resi terscan</div>
            <div className="disp-tile-angka">{fmtNumber(st.total)}</div>
            <div className="disp-tile-ket">Batch aktif</div>
            <span className="disp-chip" data-warna="hijau">
              {fmtNumber(st.total)} resi berhasil
            </span>
          </div>

          <div className="disp-tile" data-warna="hijau">
            <div className="disp-tile-label">Awaiting to shipment hari ini</div>
            <div className="disp-tile-angka">{fmtNumber(st.totalHariIni)}</div>
            <div className="disp-bar">
              <span
                style={{
                  width: `${st.totalHariIni ? Math.min(100, Math.round((st.total / st.totalHariIni) * 100)) : 0}%`,
                }}
              />
            </div>
            <div className="disp-tile-ket">
              {fmtNumber(st.total)} dari {fmtNumber(st.totalHariIni)} resi seluruh operator
            </div>
          </div>

          <div className="disp-tile" data-warna="oranye">
            <div className="disp-tile-label">Duplikat terdeteksi</div>
            <div className="disp-tile-angka">{fmtNumber(st.dupCount)}</div>
            <div className="disp-tile-ket">Resi yang discan 2×</div>
            <span className="disp-chip" data-warna={st.dupCount ? 'kuning' : 'hijau'}>
              {st.dupCount ? 'Perlu dicek' : 'Tidak ada'}
            </span>
          </div>

          <div className="disp-tile" data-warna="navy">
            <div className="disp-tile-label">Jenis jasa kirim</div>
            <div className="disp-tile-angka">{fmtNumber(jenis.length)}</div>
            <div className="disp-tile-ket">{jenis.slice(0, 4).join(', ') || '—'}</div>
            <span className="disp-chip">Batch ini</span>
          </div>

          <div className="disp-tile" data-warna={st.verifikasi.tidakAda ? 'merah' : 'hijau'}>
            <div className="disp-tile-label">Tidak ada di OCS</div>
            <div className="disp-tile-angka">{fmtNumber(st.verifikasi.tidakAda)}</div>
            <div className="disp-tile-ket">
              {st.verifikasi.menunggu
                ? `${fmtNumber(st.verifikasi.menunggu)} resi sedang diperiksa`
                : 'Semua resi sudah diperiksa'}
            </div>
            <span className="disp-chip" data-warna={st.verifikasi.tidakAda ? 'kuning' : 'hijau'}>
              {st.verifikasi.tidakAda ? 'Tidak ikut dihitung' : 'Bersih'}
            </span>
          </div>
        </div>

        <div className="disp-kolom">
          <div className="disp-card">
            <div className="disp-card-head">
              ⌨️ Scan Resi
              <span className="disp-spacer" />
              <span className="disp-badge">READY</span>
            </div>
            <div className="disp-card-body">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                <span className="disp-mini-label">Suara &amp; popup</span>
                <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                  <SoundToggle />
                  <PopupToggle ringkas />
                </span>
              </div>
              <div className="disp-scan-wrap">
                <input
                  ref={inputRef}
                  className="disp-scan-input"
                  value={nilai}
                  onChange={(e) => setNilai(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void kirim(nilai);
                    }
                  }}
                  placeholder="Scan barcode / ketik no. resi…"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  enterKeyHint="done"
                />
                <span>🔍</span>
              </div>

              <div className="disp-mini">
                <div>
                  <div className="disp-mini-label">🚚 Jasa kirim (otomatis)</div>
                  <div className="disp-mini-nilai">{terakhir.ekspedisi ?? '—'}</div>
                </div>
                <div>
                  <div className="disp-mini-label">👤 Operator</div>
                  <div className="disp-mini-nilai">{sesi.operatorName}</div>
                </div>
              </div>

              <div className="disp-feed" data-nada={feed.nada} aria-live="polite">
                {feed.resi && <div className="disp-feed-resi">{feed.resi}</div>}
                <div className={feed.resi ? 'disp-feed-ket' : undefined}>{feed.teks}</div>
              </div>

              <p className="disp-bantu">
                Jasa kirim terdeteksi otomatis dari nomor resi. Tekan <strong>Enter</strong> setelah scan. Resi masuk
                dengan status <strong>AWAITING TO SHIPMENT</strong> sampai diproses di Scan 2.
              </p>
            </div>
          </div>

          <div className="disp-card">
            <div className="disp-card-head">
              🕘 Scan Terbaru
              <span className="disp-spacer" />
              <span className="disp-badge">{fmtNumber(st.total)} RESI</span>
            </div>
            <div className="disp-list">
              {st.rows.slice(0, 50).map((r, i) => (
                <div className="disp-row" key={r.id}>
                  <span className="disp-no">{st.total - i}</span>
                  <span className="disp-resi">{r.resi}</span>
                  {i === 0 && (
                    <span className="disp-tag" data-warna="kuning">
                      BARU
                    </span>
                  )}
                  <span className="disp-spacer" style={{ marginLeft: 'auto' }} />
                  <span className="disp-tag" data-warna={warnaEkspedisi(r.ekspedisi)}>
                    {r.ekspedisiNama ?? r.ekspedisi ?? 'BELUM DIKENALI'}
                  </span>
                  <span className="disp-jam-kecil">{fmtTime(r.jam)}</span>
                </div>
              ))}
              {!st.rows.length && (
                <div className="disp-row" style={{ color: 'var(--abu)' }}>
                  Belum ada resi discan di batch ini.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="disp-kolom">
          <div className="disp-card">
            <div className="disp-card-head">
              🚚 Total per Jasa Kirim
              <span className="disp-spacer" />
              <span className="disp-badge">{fmtNumber(st.belumSubmit)} BELUM DISERAHKAN</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="disp-tabel">
                <thead>
                  <tr>
                    <th>Jasa Kirim</th>
                    <th style={{ width: 90 }}>Jumlah</th>
                    <th style={{ width: 130 }}>Serah Terima</th>
                  </tr>
                </thead>
                <tbody>
                  {st.ringkasan.map((r) => (
                    <tr key={r.code}>
                      <td>
                        <span className="disp-tag" data-warna={warnaEkspedisi(r.code)}>
                          {r.code}
                        </span>
                      </td>
                      <td style={{ fontWeight: 800, color: 'var(--navy)' }}>{fmtNumber(r.jumlah)}</td>
                      <td>
                        <button
                          type="button"
                          className="disp-btn disp-btn-putih"
                          style={{ height: 30, fontSize: 11.5 }}
                          onClick={() => void submit(r)}
                          disabled={submitBusy}
                        >
                          Submit
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!st.ringkasan.length && (
                    <tr>
                      <td colSpan={3} style={{ color: 'var(--abu)' }}>
                        Semua resi di batch ini sudah diserahterimakan.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="disp-card-body" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                className="disp-btn disp-btn-navy"
                style={{ height: 38 }}
                onClick={() => void submit(null)}
                disabled={submitBusy || !st.ringkasan.length}
              >
                ✅ {submitBusy ? 'Memproses…' : 'Submit semua jasa kirim'}
              </button>
              <span style={{ fontSize: 11.5, color: 'var(--abu)' }}>
                Submit hanya mengunci hitungan serah terima. Tidak mengirim apa pun ke OCS dan tidak membentuk
                basket — basket tetap dibuat di Scan 2.
              </span>
            </div>
          </div>

          <div className="disp-card">
            <div className="disp-card-head">
              📑 Batch Serah Terima
              <span className="disp-spacer" />
              <span className="disp-badge">{fmtNumber(st.submits.length)} BATCH</span>
            </div>
            <div className="disp-list">
              {st.submits.map((b) => (
                <div className="disp-row" key={b.id}>
                  <span className="disp-resi">{b.code}</span>
                  <span className="disp-tag" data-warna={warnaEkspedisi(b.expedisiCode)}>
                    {b.expedisiCode}
                  </span>
                  <span className="disp-spacer" style={{ marginLeft: 'auto' }} />
                  <span style={{ fontWeight: 800, color: 'var(--navy)' }}>{fmtNumber(b.jumlah)} resi</span>
                  <span className="disp-jam-kecil">
                    {fmtTime(b.jam)} · {b.oleh}
                  </span>
                </div>
              ))}
              {!st.submits.length && (
                <div className="disp-row" style={{ color: 'var(--abu)' }}>
                  Belum ada serah terima di batch ini.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="disp-card">
          <div className="disp-card-head">
            🔎 Cari No. Resi
            <span className="disp-spacer" />
            <span className="disp-badge">SEMUA BATCH</span>
          </div>
          <div className="disp-card-body">
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <input
                className="disp-scan-input"
                style={{ flex: 1, minWidth: 240, borderWidth: 1, borderColor: 'var(--garis)', paddingRight: 14 }}
                value={cari}
                onChange={(e) => setCari(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void cariResi();
                  }
                }}
                placeholder="Ketik / scan no. resi untuk cek sudah terscan atau belum…"
                autoComplete="off"
              />
              <button type="button" className="disp-btn disp-btn-kuning" style={{ height: 48, minWidth: 90 }} onClick={() => void cariResi()}>
                Cari
              </button>
            </div>
            {hasilCari && (
              <p style={{ marginTop: 10, fontSize: 13, fontWeight: 700, color: 'var(--navy-ink)' }}>{hasilCari}</p>
            )}
          </div>
        </div>

        <div className="disp-card">
          <div className="disp-card-head">
            📋 Daftar Resi Batch — {sesi.code}
            <span className="disp-spacer" />
            <span className="disp-badge">({fmtNumber(st.total)} RESI)</span>
          </div>
          <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
            <table className="disp-tabel">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>No</th>
                  <th style={{ width: 120 }}>Tanggal</th>
                  <th>No. Resi</th>
                  <th style={{ width: 200 }}>Jasa Kirim</th>
                  <th style={{ width: 130 }}>Jam Scan</th>
                </tr>
              </thead>
              <tbody>
                {st.rows.map((r, i) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 800, color: 'var(--navy)' }}>{st.total - i}</td>
                    <td>{fmtDate(r.jam)}</td>
                    <td className="disp-resi">{r.resi}</td>
                    <td>
                      <span className="disp-tag" data-warna={warnaEkspedisi(r.ekspedisi)}>
                        {r.ekspedisiNama ?? r.ekspedisi ?? 'BELUM DIKENALI'}
                      </span>
                    </td>
                    <td className="disp-jam-kecil">🕘 {fmtTime(r.jam)}</td>
                  </tr>
                ))}
                {!st.rows.length && (
                  <tr>
                    <td colSpan={5} style={{ color: 'var(--abu)' }}>
                      Belum ada resi di batch ini.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <ScanFlash data={flash} onSelesai={() => setFlash(null)} />
    </div>
  );
}
