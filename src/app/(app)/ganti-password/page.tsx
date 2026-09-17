'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiPost } from '@/lib/client';
import { toast } from '@/components/Toast';
import PasswordField from '@/components/PasswordField';

export default function GantiPasswordPage() {
  const router = useRouter();
  const [lama, setLama] = useState('');
  const [baru, setBaru] = useState('');
  const [ulang, setUlang] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (baru !== ulang) {
      setError('Password baru dan ulangannya tidak sama.');
      return;
    }
    if (baru.length < 6) {
      setError('Password baru minimal 6 karakter.');
      return;
    }
    if (baru === lama) {
      setError('Password baru tidak boleh sama dengan yang lama.');
      return;
    }

    setBusy(true);
    const res = await apiPost('/api/auth/password', { lama, baru });
    setBusy(false);

    if (!res.ok) {
      setError(res.error);
      return;
    }
    toast('success', 'Password diperbarui.');
    router.replace('/dashboard');
    router.refresh();
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--gap)' }}>
      <h1 className="page-title">Ganti Password</h1>

      <form onSubmit={submit} className="card" style={{ display: 'grid', gap: 12, maxWidth: 420 }}>
        <p style={{ fontSize: 13, color: 'var(--ink-label)', margin: 0 }}>
          Isi password yang Anda pakai untuk masuk barusan sebagai <strong>password lama</strong>. Tekan ikon mata
          untuk memastikan yang terketik sudah benar — browser kadang mengisi kolom ini sendiri.
        </p>

        <PasswordField
          label="Password lama"
          name="current-password"
          autoComplete="current-password"
          value={lama}
          onChange={setLama}
          autoFocus
        />
        <PasswordField
          label="Password baru"
          name="new-password"
          autoComplete="new-password"
          value={baru}
          onChange={setBaru}
          minLength={6}
          placeholder="Minimal 6 karakter"
        />
        <PasswordField
          label="Ulangi password baru"
          name="confirm-password"
          autoComplete="new-password"
          value={ulang}
          onChange={setUlang}
          minLength={6}
        />

        {error && (
          <div
            style={{
              background: 'var(--negative-bg)',
              color: 'var(--negative)',
              border: '1px solid var(--negative-border)',
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Menyimpan…' : 'Simpan password baru'}
        </button>

        <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: 0 }}>
          Lupa password lama? Minta admin membuka <strong>Admin &gt; Pengguna</strong> lalu menekan{' '}
          <strong>Reset password</strong> — password sementara akan ditampilkan sekali di layar admin.
        </p>
      </form>
    </div>
  );
}
