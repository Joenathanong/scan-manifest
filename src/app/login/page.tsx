'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiPost } from '@/lib/client';
import PasswordField from '@/components/PasswordField';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await apiPost<{ mustChangePassword: boolean }>('/api/auth/login', { username, password });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.replace(res.data.mustChangePassword ? '/ganti-password' : '/dashboard');
    router.refresh();
  };

  return (
    <div
      style={{
        height: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 16,
        background: 'var(--bg-canvas)',
        overflowY: 'auto',
      }}
    >
      <form onSubmit={submit} className="card" style={{ width: 'min(100%, 380px)', display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            aria-hidden
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: 'var(--grad-brand)',
              display: 'grid',
              placeItems: 'center',
              color: '#fff',
              fontWeight: 700,
            }}
          >
            IEG
          </span>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Scan Manifest</div>
            <div style={{ fontSize: 12, color: 'var(--ink-label)' }}>Eka Jaya International</div>
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="u">
            Username
          </label>
          <input
            id="u"
            className="input-field"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            autoFocus
          />
        </div>

        <PasswordField
          label="Password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
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
          {busy ? 'Memeriksa…' : 'Masuk'}
        </button>
      </form>
    </div>
  );
}
