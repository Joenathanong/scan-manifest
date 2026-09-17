'use client';

import { useId, useState } from 'react';
import { IconEye, IconEyeOff } from './Icons';

/**
 * Kolom password dengan tombol lihat/sembunyi.
 *
 * `autoComplete` + `name` WAJIB diisi benar: tanpa itu browser dan password
 * manager mengisi sendiri kolom "password lama" dengan kredensial tersimpan,
 * dan operator tidak sadar kolomnya sudah terisi — itu penyebab klasik
 * "password lama salah terus".
 */
export default function PasswordField({
  label,
  value,
  onChange,
  name,
  autoComplete,
  autoFocus,
  minLength,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  name: string;
  autoComplete: 'current-password' | 'new-password';
  autoFocus?: boolean;
  minLength?: number;
  placeholder?: string;
}) {
  const id = useId();
  const [show, setShow] = useState(false);

  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          id={id}
          name={name}
          type={show ? 'text' : 'password'}
          className="input-field"
          style={{ paddingRight: 44 }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          minLength={minLength}
          placeholder={placeholder}
          required
        />
        <button
          type="button"
          className="icon-btn"
          style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)', width: 36, height: 36 }}
          onClick={() => setShow((v) => !v)}
          aria-label={show ? 'Sembunyikan password' : 'Lihat password'}
          title={show ? 'Sembunyikan password' : 'Lihat password'}
          tabIndex={-1}
        >
          {show ? <IconEyeOff className="ico" /> : <IconEye className="ico" />}
        </button>
      </div>
    </div>
  );
}
