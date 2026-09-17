'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPatch, apiPost, apiPut } from '@/lib/client';
import PasswordField from '@/components/PasswordField';
import { toast } from '@/components/Toast';
import { fmtDateTime } from '@/lib/date';

type User = {
  id: number;
  username: string;
  name: string;
  role: 'ADMIN' | 'SUPERVISOR' | 'OPERATOR';
  active: boolean;
  ocsUserCode: string | null;
  ocsUsername: string | null;
  ocsCompanyDb: string | null;
  adaPasswordOcs: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
};

const ROLES: User['role'][] = ['ADMIN', 'SUPERVISOR', 'OPERATOR'];

export default function UsersPage() {
  const [rows, setRows] = useState<User[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ username: '', name: '', role: 'OPERATOR' as User['role'], ocsUserCode: '', password: '' });
  const [passwordBaru, setPasswordBaru] = useState<{ username: string; password: string } | null>(null);
  const [ocsUntuk, setOcsUntuk] = useState<User | null>(null);
  const [ocsForm, setOcsForm] = useState({ ocsUsername: '', ocsPassword: '', ocsCompanyDb: '' });
  const [ocsPesan, setOcsPesan] = useState<{ ok: boolean; teks: string } | null>(null);
  const [ocsBusy, setOcsBusy] = useState(false);

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

  const bukaOcs = (u: User) => {
    setOcsUntuk(u);
    setOcsPesan(null);
    setOcsForm({
      ocsUsername: u.ocsUsername ?? '',
      ocsPassword: '',
      ocsCompanyDb: u.ocsCompanyDb ?? '',
    });
  };

  const simpanOcs = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ocsUntuk) return;
    setOcsBusy(true);
    setOcsPesan(null);
    const res = await apiPut(`/api/users/${ocsUntuk.id}/ocs`, ocsForm);
    setOcsBusy(false);
    if (!res.ok) {
      setOcsPesan({ ok: false, teks: res.error });
      return;
    }
    toast('success', ocsForm.ocsUsername ? `Akun OCS ${ocsForm.ocsUsername} tersimpan.` : 'Akun OCS dilepas.');
    setOcsForm((f) => ({ ...f, ocsPassword: '' }));
    await muat();
  };

  const tesOcs = async () => {
    if (!ocsUntuk) return;
    setOcsBusy(true);
    setOcsPesan(null);
    const res = await apiPost<{ ok: boolean; pesan: string }>(`/api/users/${ocsUntuk.id}/ocs`);
    setOcsBusy(false);
    setOcsPesan(res.ok ? { ok: res.data.ok, teks: res.data.pesan } : { ok: false, teks: res.error });
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
                <th>Akun OCS</th>
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
                  <td data-label="Akun OCS">
                    {u.ocsUsername ? (
                      <span className={`badge ${u.adaPasswordOcs ? 'badge-positive' : 'badge-critical'}`}>
                        {u.ocsUsername}
                      </span>
                    ) : (
                      <span className="badge badge-neutral">akun sistem</span>
                    )}
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
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => bukaOcs(u)}>
                        Akun OCS
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

      {ocsUntuk && (
        <form onSubmit={simpanOcs} className="card" style={{ display: 'grid', gap: 12, maxWidth: 560 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 14 }}>Akun OCS untuk {ocsUntuk.name}</strong>
            <span className="badge badge-brand">{ocsUntuk.username}</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ marginLeft: 'auto' }}
              onClick={() => setOcsUntuk(null)}
            >
              Tutup
            </button>
          </div>

          <p style={{ fontSize: 13, color: 'var(--ink-label)', margin: 0 }}>
            Diisi kalau operator ini punya akun OCS sendiri (mis. <strong>MANIFEST001</strong>). Manifest yang dia
            kerjakan akan dikirim ke OCS memakai akun itu, sehingga dokumennya tercatat atas namanya — bukan atas
            nama akun sistem. Dikosongkan berarti memakai akun sistem dari environment.
          </p>

          <div>
            <label className="field-label" htmlFor="ou">
              Username OCS
            </label>
            <input
              id="ou"
              className="input-field mono"
              value={ocsForm.ocsUsername}
              onChange={(e) => setOcsForm({ ...ocsForm, ocsUsername: e.target.value.toUpperCase().trim() })}
              placeholder="MANIFEST001"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <PasswordField
            label={ocsUntuk.adaPasswordOcs ? 'Password OCS (kosongkan bila tidak diubah)' : 'Password OCS'}
            name="ocs-password"
            autoComplete="new-password"
            value={ocsForm.ocsPassword}
            onChange={(v) => setOcsForm({ ...ocsForm, ocsPassword: v })}
          />

          <div>
            <label className="field-label" htmlFor="oc">
              Database OCS (kosong = ikut setelan server)
            </label>
            <input
              id="oc"
              className="input-field mono"
              value={ocsForm.ocsCompanyDb}
              onChange={(e) => setOcsForm({ ...ocsForm, ocsCompanyDb: e.target.value.trim() })}
              placeholder="EJI_WMS"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {ocsPesan && (
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                fontSize: 13,
                background: ocsPesan.ok ? 'var(--positive-bg)' : 'var(--negative-bg)',
                color: ocsPesan.ok ? 'var(--positive)' : 'var(--negative)',
                border: `1px solid ${ocsPesan.ok ? 'var(--positive-border)' : 'var(--negative-border)'}`,
              }}
            >
              {ocsPesan.teks}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="submit" className="btn btn-primary" disabled={ocsBusy}>
              {ocsBusy ? 'Menyimpan…' : 'Simpan akun OCS'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void tesOcs()}
              disabled={ocsBusy || !ocsUntuk.adaPasswordOcs}
            >
              Tes login ke OCS
            </button>
            {ocsUntuk.ocsUsername && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setOcsForm({ ocsUsername: '', ocsPassword: '', ocsCompanyDb: '' })}
                disabled={ocsBusy}
              >
                Kosongkan (pakai akun sistem)
              </button>
            )}
          </div>

          <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: 0 }}>
            Password disimpan terenkripsi AES-256-GCM di database dan tidak pernah dikirim balik ke browser.
            Tombol Tes login baru aktif setelah passwordnya tersimpan.
          </p>
        </form>
      )}
    </div>
  );
}
