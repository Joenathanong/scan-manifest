'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '@/lib/client';
import { toast } from '@/components/Toast';

type Expedisi = {
  id: number;
  code: string;
  name: string;
  ocsShipper: string;
  ocsPrefix: string | null;
  prefixes: string;
  active: boolean;
  sortOrder: number;
};

/** Nilai kurir yang dikenal OCS (dibaca dari shippingProviderList Manifest V2). */
const OCS_SHIPPERS = [
  'J&T', 'SPX', 'GTL', 'JNE', 'NinjaVan', 'LEX', 'SiCepat',
  'IDX', 'Anteraja', 'Blitz', 'Gojek', 'Grab',
];

export default function ExpedisiPage() {
  const [rows, setRows] = useState<Expedisi[]>([]);
  const [draft, setDraft] = useState<Record<number, Partial<Expedisi>>>({});
  const [form, setForm] = useState({ code: '', name: '', ocsShipper: 'J&T', ocsPrefix: '', prefixes: '' });
  const [busy, setBusy] = useState(false);

  const muat = useCallback(async () => {
    const res = await apiGet<Expedisi[]>('/api/expedisi');
    if (res.ok) setRows(res.data);
    else toast('error', res.error);
  }, []);

  useEffect(() => {
    void muat();
  }, [muat]);

  const tambah = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await apiPost('/api/expedisi', form);
    setBusy(false);
    if (!res.ok) {
      toast('error', res.error);
      return;
    }
    toast('success', 'Ekspedisi ditambahkan.');
    setForm({ code: '', name: '', ocsShipper: 'J&T', ocsPrefix: '', prefixes: '' });
    void muat();
  };

  const simpan = async (row: Expedisi) => {
    const patch = draft[row.id];
    if (!patch) return;
    const res = await apiPatch(`/api/expedisi/${row.id}`, patch);
    if (!res.ok) toast('error', res.error);
    else {
      toast('success', `${row.code} tersimpan.`);
      setDraft((d) => {
        const next = { ...d };
        delete next[row.id];
        return next;
      });
      void muat();
    }
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--gap)' }}>
      <h1 className="page-title">Ekspedisi</h1>
      <p style={{ color: 'var(--ink-label)', fontSize: 13, marginTop: -6 }}>
        Prefix resi dipakai untuk menebak ekspedisi saat scan tahap 1. Nama kurir OCS harus persis sama dengan
        pilihan di Manifest V2. <strong>Awalan OCS</strong> maksimal 3 huruf dan harus unik — kolom basketId di OCS
        hanya <code>varchar(10)</code>, jadi kode basket dibentuk <code>&lt;awalan&gt;&lt;dd&gt;&lt;MM&gt;&lt;urut&gt;</code>,
        contoh <code>JNT1709001</code>.
      </p>

      <form onSubmit={tambah} className="card" style={{ display: 'grid', gap: 10 }}>
        <strong style={{ fontSize: 14 }}>Tambah ekspedisi</strong>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
          <div>
            <label className="field-label" htmlFor="c">Kode (dipakai di nomor basket)</label>
            <input id="c" className="input-field mono" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} required placeholder="JNT" />
          </div>
          <div>
            <label className="field-label" htmlFor="n">Nama</label>
            <input id="n" className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="J&T Express" />
          </div>
          <div>
            <label className="field-label" htmlFor="o">Nama kurir di OCS</label>
            <select id="o" className="select-field" value={form.ocsShipper} onChange={(e) => setForm({ ...form, ocsShipper: e.target.value })}>
              {OCS_SHIPPERS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="ap">Awalan OCS (maks 3 huruf)</label>
            <input id="ap" className="input-field mono" maxLength={3} value={form.ocsPrefix} onChange={(e) => setForm({ ...form, ocsPrefix: e.target.value.toUpperCase().slice(0, 3) })} placeholder="JNT" />
          </div>
          <div>
            <label className="field-label" htmlFor="p">Prefix resi (pisahkan koma)</label>
            <input id="p" className="input-field mono" value={form.prefixes} onChange={(e) => setForm({ ...form, prefixes: e.target.value.toUpperCase() })} placeholder="JP, JX, JD" />
          </div>
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy} style={{ justifySelf: 'start' }}>
          {busy ? 'Menyimpan…' : 'Tambah'}
        </button>
      </form>

      <div className="grid-card">
        <div className="grid-toolbar">
          <strong style={{ fontSize: 13 }}>Daftar ekspedisi</strong>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-label)' }}>{rows.length} entries</span>
        </div>
        <div className="table-scroll">
          <table className="rtable">
            <thead>
              <tr>
                <th>Kode</th>
                <th>Nama</th>
                <th>Kurir OCS</th>
                <th>Awalan OCS</th>
                <th className="p2">Prefix resi</th>
                <th>Aktif</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const d = draft[r.id] ?? {};
                const patch = (p: Partial<Expedisi>) => setDraft((x) => ({ ...x, [r.id]: { ...x[r.id], ...p } }));
                return (
                  <tr key={r.id}>
                    <td className="mono title" data-label="Kode">{r.code}</td>
                    <td data-label="Nama">
                      <input
                        className="input-field"
                        style={{ height: 30, fontSize: 12 }}
                        value={d.name ?? r.name}
                        onChange={(e) => patch({ name: e.target.value })}
                      />
                    </td>
                    <td data-label="Kurir OCS">
                      <select
                        className="select-field"
                        style={{ height: 30, fontSize: 12 }}
                        value={d.ocsShipper ?? r.ocsShipper}
                        onChange={(e) => patch({ ocsShipper: e.target.value })}
                      >
                        {OCS_SHIPPERS.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                    <td data-label="Awalan OCS">
                      <input
                        className="input-field mono"
                        style={{ height: 30, fontSize: 12 }}
                        maxLength={3}
                        value={d.ocsPrefix ?? r.ocsPrefix ?? r.code.slice(0, 3)}
                        onChange={(e) => patch({ ocsPrefix: e.target.value.toUpperCase().slice(0, 3) })}
                      />
                    </td>
                    <td className="p2" data-label="Prefix resi">
                      <input
                        className="input-field mono"
                        style={{ height: 30, fontSize: 12 }}
                        value={d.prefixes ?? r.prefixes}
                        onChange={(e) => patch({ prefixes: e.target.value.toUpperCase() })}
                      />
                    </td>
                    <td data-label="Aktif">
                      <span className={`badge ${r.active ? 'badge-positive' : 'badge-neutral'}`}>
                        {r.active ? 'Aktif' : 'Non-aktif'}
                      </span>
                    </td>
                    <td data-label="Aksi">
                      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void simpan(r)} disabled={!draft[r.id]}>
                          Simpan
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={async () => {
                            const res = await apiPatch(`/api/expedisi/${r.id}`, { active: !r.active });
                            if (res.ok) void muat();
                            else toast('error', res.error);
                          }}
                        >
                          {r.active ? 'Nonaktifkan' : 'Aktifkan'}
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="grid-foot">
          <span>Kode ekspedisi tidak bisa diubah — kode itu sudah tercetak di nomor basket.</span>
        </div>
      </div>
    </div>
  );
}
