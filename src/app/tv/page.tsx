'use client';

import { useCallback, useEffect, useState } from 'react';
import { fmtNumber, fmtTime } from '@/lib/date';

/**
 * Dashboard TV — dibuka tanpa login, dipasang di layar besar gudang.
 *
 * Dirancang untuk dibaca dari seberang ruangan: empat angka raksasa, tanpa
 * navigasi, tanpa tombol. Angkanya datang dari snapshot yang sudah jadi, jadi
 * layar tidak pernah menunggu OCS.
 */

type Snapshot = {
  tanggal: string;
  orderPicked: number;
  awaitingShipment: number;
  awaitingPickup: number;
  inTransit: number;
  perEkspedisi: { code: string; awaitingShipment: number; awaitingPickup: number }[];
  ocsAktif: boolean;
  ocsError: string | null;
  dibuatPada: string;
  intervalMenit: number;
};

const JEDA_MS = 20000;

export default function TvPage() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [jam, setJam] = useState('');
  const [putus, setPutus] = useState(false);

  const muat = useCallback(async () => {
    try {
      const key = new URLSearchParams(window.location.search).get('key');
      const res = await fetch(`/api/tv${key ? `?key=${encodeURIComponent(key)}` : ''}`, { cache: 'no-store' });
      const body = (await res.json()) as { ok: boolean; data?: Snapshot };
      if (body.ok && body.data) {
        setSnap(body.data);
        setPutus(false);
      } else {
        setPutus(true);
      }
    } catch {
      // Jaringan gudang putus sebentar: angka terakhir DIBIARKAN di layar,
      // hanya diberi penanda. Layar kosong lebih buruk daripada angka lama.
      setPutus(true);
    }
  }, []);

  useEffect(() => {
    void muat();
    const t = setInterval(muat, JEDA_MS);
    return () => clearInterval(t);
  }, [muat]);

  useEffect(() => {
    const tik = () =>
      setJam(
        new Intl.DateTimeFormat('id-ID', {
          timeZone: 'Asia/Jakarta',
          weekday: 'long',
          day: '2-digit',
          month: 'long',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }).format(new Date()),
      );
    tik();
    const t = setInterval(tik, 1000);
    return () => clearInterval(t);
  }, []);

  const kartu = [
    { label: 'Order Picked', nilai: snap?.orderPicked ?? 0, warna: 'ungu', ket: 'Sudah dipicking di OCS hari ini' },
    { label: 'Awaiting to Shipment', nilai: snap?.awaitingShipment ?? 0, warna: 'kuning', ket: 'Sudah discan, menunggu manifest' },
    { label: 'Awaiting to Pickup', nilai: snap?.awaitingPickup ?? 0, warna: 'hijau', ket: 'Sudah dimanifest, menunggu kurir' },
    { label: 'In Transit', nilai: snap?.inTransit ?? 0, warna: 'biru', ket: 'Sudah dibawa kurir' },
  ];

  return (
    <div className="tv-wrap">
      <header className="tv-top">
        <span className="tv-brand">IEG OPERASIONAL — Monitor Gudang</span>
        <span className="tv-spacer" />
        {putus && <span className="tv-pil tv-pil-merah">Jaringan terputus</span>}
        {snap?.ocsError && !putus && <span className="tv-pil tv-pil-kuning">OCS bermasalah</span>}
        <span className="tv-jam">{jam}</span>
      </header>

      <main className="tv-grid">
        {kartu.map((k) => (
          <section className="tv-kartu" data-warna={k.warna} key={k.label}>
            <div className="tv-label">{k.label}</div>
            <div className="tv-angka">{fmtNumber(k.nilai)}</div>
            <div className="tv-ket">{k.ket}</div>
          </section>
        ))}
      </main>

      {!!snap?.perEkspedisi.length && (
        <section className="tv-tabel-bungkus">
          <table className="tv-tabel">
            <thead>
              <tr>
                <th>Jasa Kirim</th>
                <th>Awaiting to Shipment</th>
                <th>Awaiting to Pickup</th>
              </tr>
            </thead>
            <tbody>
              {snap.perEkspedisi.slice(0, 8).map((r) => (
                <tr key={r.code}>
                  <td>{r.code}</td>
                  <td>{fmtNumber(r.awaitingShipment)}</td>
                  <td>{fmtNumber(r.awaitingPickup)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <footer className="tv-kaki">
        {snap ? `Diperbarui ${fmtTime(snap.dibuatPada)} · data OCS ditarik tiap ${snap.intervalMenit} menit` : 'Memuat…'}
        {snap?.ocsError ? ` · ${snap.ocsError}` : ''}
      </footer>
    </div>
  );
}
