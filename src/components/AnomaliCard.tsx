'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '@/lib/client';
import { fmtDateTime, fmtNumber } from '@/lib/date';

type Jenis = 'SCAN1_TANPA_SCAN2' | 'SCAN2_TANPA_SCAN1' | 'BELUM_SAMPAI_OCS' | 'BASKET_MENGGANTUNG';

type Baris = {
  jenis: Jenis;
  resi: string;
  ekspedisi: string | null;
  basket: string | null;
  waktu: string;
  umurJam: number;
  operator: string;
  keterangan: string;
  itemId: number | null;
};

type Data = {
  batasJam: number;
  jumlah: {
    scan1TanpaScan2: number;
    scan2TanpaScan1: number;
    belumSampaiOcs: number;
    basketMenggantung: number;
    total: number;
  };
  baris: Baris[];
};

const LABEL: Record<Jenis, string> = {
  SCAN1_TANPA_SCAN2: 'Scan 1 tanpa scan 2',
  SCAN2_TANPA_SCAN1: 'Scan 2 tanpa scan 1',
  BELUM_SAMPAI_OCS: 'Belum sampai OCS',
  BASKET_MENGGANTUNG: 'Basket belum disubmit',
};

const WARNA: Record<Jenis, string> = {
  SCAN1_TANPA_SCAN2: 'badge-critical',
  SCAN2_TANPA_SCAN1: 'badge-negative',
  BELUM_SAMPAI_OCS: 'badge-negative',
  BASKET_MENGGANTUNG: 'badge-informative',
};

export default function AnomaliCard({
  dari,
  sampai,
  expedisi,
}: {
  dari: string;
  sampai: string;
  expedisi?: string;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [batasJam, setBatasJam] = useState(12);
  const [saring, setSaring] = useState<Jenis | ''>('');
  const [loading, setLoading] = useState(true);

  const muat = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({
      dari,
      sampai,
      batasJam: String(batasJam),
      ...(expedisi ? { expedisi } : {}),
    });
    const res = await apiGet<Data>(`/api/anomali?${qs.toString()}`);
    setLoading(false);
    if (res.ok) setData(res.data);
  }, [dari, sampai, expedisi, batasJam]);

  useEffect(() => {
    void muat();
    const t = setInterval(muat, 60000);
    return () => clearInterval(t);
  }, [muat]);

  const baris = (data?.baris ?? []).filter((b) => !saring || b.jenis === saring);
  const total = data?.jumlah.total ?? 0;
  const bersih = !loading && total === 0;

  return (
    <div className="grid-card">
      <div className="grid-toolbar">
        <strong style={{ fontSize: 13 }}>Resi menggantung / tidak terproses</strong>
        <span className="muted" style={{ fontSize: 12 }}>
          alur scan 1 → scan 2 → OCS yang putus
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: 'var(--ink-label)' }} htmlFor="bj">
            Dianggap menggantung setelah
          </label>
          <select
            id="bj"
            className="select-field"
            style={{ width: 110, height: 30, fontSize: 12 }}
            value={batasJam}
            onChange={(e) => setBatasJam(Number(e.target.value))}
          >
            <option value={1}>1 jam</option>
            <option value={4}>4 jam</option>
            <option value={12}>12 jam</option>
            <option value={24}>1 hari</option>
            <option value={48}>2 hari</option>
          </select>
        </div>
      </div>

      <div style={{ padding: '10px 12px', display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
        <Tile
          label="Scan 1 tanpa scan 2"
          value={data?.jumlah.scan1TanpaScan2 ?? 0}
          aktif={saring === 'SCAN1_TANPA_SCAN2'}
          onClick={() => setSaring(saring === 'SCAN1_TANPA_SCAN2' ? '' : 'SCAN1_TANPA_SCAN2')}
          warna="var(--critical)"
        />
        <Tile
          label="Scan 2 tanpa scan 1"
          value={data?.jumlah.scan2TanpaScan1 ?? 0}
          aktif={saring === 'SCAN2_TANPA_SCAN1'}
          onClick={() => setSaring(saring === 'SCAN2_TANPA_SCAN1' ? '' : 'SCAN2_TANPA_SCAN1')}
          warna="var(--negative)"
        />
        <Tile
          label="Belum sampai OCS"
          value={data?.jumlah.belumSampaiOcs ?? 0}
          aktif={saring === 'BELUM_SAMPAI_OCS'}
          onClick={() => setSaring(saring === 'BELUM_SAMPAI_OCS' ? '' : 'BELUM_SAMPAI_OCS')}
          warna="var(--negative)"
        />
        <Tile
          label="Basket belum disubmit"
          value={data?.jumlah.basketMenggantung ?? 0}
          aktif={saring === 'BASKET_MENGGANTUNG'}
          onClick={() => setSaring(saring === 'BASKET_MENGGANTUNG' ? '' : 'BASKET_MENGGANTUNG')}
          warna="var(--informative)"
        />
      </div>

      {bersih ? (
        <div
          style={{
            margin: '0 12px 12px',
            padding: '12px 14px',
            borderRadius: 'var(--r-md)',
            background: 'var(--positive-bg)',
            color: 'var(--positive)',
            border: '1px solid var(--positive-border)',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Tidak ada resi menggantung. Semua yang discan tahap 1 sudah dimanifest dan terkirim ke OCS.
        </div>
      ) : (
        <>
          <div className="table-scroll">
            <table className="rtable">
              <colgroup>
                <col style={{ width: '20%' }} />
                <col style={{ width: '20%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '24%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Resi</th>
                  <th>Jenis</th>
                  <th>Ekspedisi</th>
                  <th className="p2">Basket</th>
                  <th className="n">Umur</th>
                  <th className="p3">Keterangan</th>
                </tr>
              </thead>
              <tbody>
                {baris.slice(0, 200).map((b, i) => (
                  <tr key={`${b.jenis}-${b.resi}-${i}`}>
                    <td className="mono title" data-label="Resi">
                      {b.resi}
                    </td>
                    <td data-label="Jenis">
                      <span className={`badge ${WARNA[b.jenis]}`}>{LABEL[b.jenis]}</span>
                    </td>
                    <td data-label="Ekspedisi">{b.ekspedisi ?? '—'}</td>
                    <td className="mono p2" data-label="Basket">
                      {b.basket ?? '—'}
                    </td>
                    <td className="n" data-label="Umur">
                      {b.umurJam < 24 ? `${b.umurJam} jam` : `${Math.round(b.umurJam / 24)} hari`}
                    </td>
                    <td className="p3" data-label="Keterangan" style={{ whiteSpace: 'normal' }}>
                      {b.keterangan}
                      <span className="muted"> · {fmtDateTime(b.waktu)} · {b.operator}</span>
                    </td>
                  </tr>
                ))}
                {!baris.length && (
                  <tr>
                    <td colSpan={6} className="muted" data-label="Info">
                      {loading ? 'Memuat…' : 'Tidak ada baris pada saringan ini.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="grid-foot">
            <span>
              {fmtNumber(baris.length)} dari {fmtNumber(total)} baris menggantung
              {baris.length > 200 ? ' (200 teratas ditampilkan)' : ''}
            </span>
            <Link href="/history" className="btn btn-ghost btn-sm">
              Telusuri di riwayat
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  aktif,
  onClick,
  warna,
}: {
  label: string;
  value: number;
  aktif: boolean;
  onClick: () => void;
  warna: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: 'left',
        padding: '10px 12px',
        borderRadius: 'var(--r-md)',
        border: `1px solid ${aktif ? 'var(--primary)' : 'var(--border)'}`,
        background: aktif ? 'var(--primary-subtle)' : 'var(--bg-surface)',
        cursor: 'pointer',
        minHeight: 'var(--tap)',
      }}
      aria-pressed={aktif}
    >
      <div style={{ fontSize: 12, color: 'var(--ink-label)' }}>{label}</div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color: value > 0 ? warna : 'var(--ink-muted)',
        }}
      >
        {fmtNumber(value)}
      </div>
    </button>
  );
}
