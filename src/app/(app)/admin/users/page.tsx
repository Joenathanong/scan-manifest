'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '@/lib/client';
import { toast } from '@/components/Toast';
import { fmtDateTime } from '@/lib/date';

type User = {
  id: number;
  username: string;
  name: string;
  role: 'ADMIN' | 'SUPERVISOR' | 'OPERATOR';
  active: boolean;
  ocsUserCode: string | null;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
};

const ROLES: User['role'][] = ['ADMIN', 'SUPERVISOR', 'OPERATOR'];

export default function UsersPage() {
  const [rows, setRows] = useState<User[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ username: '', name: '', role: 'OPERATOR' as User['role'], ocsUserCode: '', password: '' });
  const [passwordBaru, setPasswordBaru] = useState<{ username: string; password: string } | null>(null);

  const muat = useCallback(async () => {
    const res = await apiGet<User[]>('/api/users');
    if (res.ok) setRows(res.data);
    else toast('error', res.error);
  }, []);

  useEffect(() => {
    void muat();
  }, [muat]);

  const tambah = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await apiPost<{ username: string; passwordSementara: string }>('/api/users', form);
    setBusy(false);
    if (!res.ok) {
      toast('error', res.error);
      return;
    }
    setPasswordBaru({ username: res.data.username, password: res.data.passwordSementara });
    setForm({ username: '', name: '', role: 'OPERATOR', ocsUserCode: '', password: '' });
    void muat();
  };

  const ubah = async (id: number, patch: Partial<User>) => {
    const res = await apiPatch(`/api/users/${id}`, patch);
    if (!res.ok) toast('error', res.error);
    else {
      toast('success', 'Tersimpan.');
      void muat();
    }
  };

  const reset = async (u: User) => {
    if (!confirm(`Reset password ${u.username}?`)) return;
    const res = await apiPost<{ username: string; passwordSementara: string }>(`/api/users/${u.id}/password`);
    if (!res.ok) toast('error', res.error);
    else setPasswordBaru({ username: res.data.username, password: res.data.passwordSementara });
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--gap)' }}>
      <h1 className="page-title">Pengguna</h1>

      {passwordBaru && (
        <div
          className="card"
          style={{ borderColor: 'var(--positive-border)', background: 'var(--positive-bg)', color: 'var(--positive)' }}
        >
          <div style={{ fontSize: 13 }}>
            Password sementara untuk <strong>{passwordBaru.username}</strong> — catat / bacakan sekarang, tidak akan
            ditampilkan lagi:
          </div>
          <div className="mono" style={{ fontSize: 26, fontWeight: 800, letterSpacing: '.12em', margin: '6px 0' }}>
            {passwordBaru.password}
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPasswordBaru(null)}>
            Sudah dicatat
          </button>
        </div>
      )}

      <form onSubmit={tambah} className="card" style={{ display: 'grid', gap: 10 }}>
        <strong style={{ fontSize: 14 }}>Tambah pengguna</strong>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
          <div>
            <label className="field-label" htmlFor="un">Username</label>
            <input id="un" className="input-field" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required autoCapitalize="none" />
          </div>
          <div>
            <label className="field-label" htmlFor="nm">Nama</label>
            <input id="nm" className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="field-label" htmlFor="rl">Role</label>
            <select id="rl" className="select-field" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as User['role'] })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="oc">Kode user OCS (opsional)</label>
            <input id="oc" className="input-field" value={form.ocsUserCode} onChange={(e) => setForm({ ...form, ocsUserCode: e.target.value })} placeholder="MANIFEST001" />
          </div>
          <div>
            <label className="field-label" htmlFor="pw">Password awal (opsional)</label>
            <input id="pw" className="input-field" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Kosong = dibuatkan otomatis" />
          </div>
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy} style={{ justifySelf: 'start' }}>
          {busy ? 'Menyimpan…' : 'Tambah pengguna'}
        </button>
      </form>

      <div className="grid-card">
        <div className="grid-toolbar">
          <strong style={{ fontSize: 13 }}>Daftar pengguna</strong>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-label)' }}>{rows.length} entries</span>
        </div>
        <div className="table-scroll">
          <table className="rtable">
            <thead>
              <tr>
                <th>Username</th>
                <th>Nama</th>
                <th>Role</th>
                <th>Aktif</th>
                <th className="p3">Login terakhir</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td className="mono title" data-label="Username">{u.username}</td>
                  <td data-label="Nama">{u.name}</td>
                  <td data-label="Role">
                    <select
                      className="select-field"
                      style={{ height: 30, fontSize: 12 }}
                      value={u.role}
                      onChange={(e) => void ubah(u.id, { role: e.target.value as User['role'] })}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </td>
                  <td data-label="Aktif">
                    <span className={`badge ${u.active ? 'badge-positive' : 'badge-neutral'}`}>
                      {u.active ? 'Aktif' : 'Non-aktif'}
                    </span>
                  </td>
                  <td className="mono p3" data-label="Login terakhir">
                    {u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : '—'}
                  </td>
                  <td data-label="Aksi">
                    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void ubah(u.id, { active: !u.active })}>
                        {u.active ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void reset(u)}>
                        Reset password
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid-foot">
          <span>Pengguna tidak pernah dihapus — hanya dinonaktifkan, supaya riwayat scan tetap bisa ditelusuri.</span>
        </div>
      </div>
    </div>
  );
}
