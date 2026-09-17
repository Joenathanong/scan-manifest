'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiPost } from '@/lib/client';
import { toast } from '@/components/Toast';

export default function GantiPasswordPage() {
  const router = useRouter();
  const [lama, setLama] = useState('');
  const [baru, setBaru] = useState('');
  const [ulang, setUlang] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (baru !== ulang) {
      toast('error', 'Password baru dan ulangannya tidak sama.');
      return;
    }
    setBusy(true);
    const res = await apiPost('/api/auth/password', { lama, baru });
    setBusy(false);
    if (!res.ok) {
      toast('error', res.error);
      return;
    }
    toast('success', 'Password diperbarui.');
    router.replace('/dashboard');
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--gap)' }}>
      <h1 className="page-title">Ganti Password</h1>
      <form onSubmit={submit} className="card" style={{ display: 'grid', gap: 12, maxWidth: 420 }}>
        <div>
          <label className="field-label" htmlFor="l">Password lama</label>
          <input id="l" type="password" className="input-field" value={lama} onChange={(e) => setLama(e.target.value)} required />
        </div>
        <div>
          <label className="field-label" htmlFor="b">Password baru</label>
          <input id="b" type="password" className="input-field" value={baru} onChange={(e) => setBaru(e.target.value)} required minLength={6} />
        </div>
        <div>
          <label className="field-label" htmlFor="u">Ulangi password baru</label>
          <input id="u" type="password" className="input-field" value={ulang} onChange={(e) => setUlang(e.target.value)} required minLength={6} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Menyimpan…' : 'Simpan'}
        </button>
      </form>
    </div>
  );
}
