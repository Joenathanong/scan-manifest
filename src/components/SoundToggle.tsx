'use client';

import { useEffect, useState } from 'react';
import {
  PAKET_BUNYI,
  cobaPaket,
  getPaket,
  getVolume,
  isBoost,
  isMuted,
  playFailed,
  playSuccess,
  setBoost,
  setMuted,
  setPaket,
  setVolume,
  statusAudio,
  unlockAudio,
} from '@/lib/audio';
import { IconSpeaker, IconSpeakerOff } from './Icons';

/**
 * Tombol suara untuk halaman scan. Mode ringkas hanya menampilkan tombol
 * nyala/mati; mode penuh (Admin > Setelan) menampilkan pilihan bunyi, volume,
 * penguat, dan tombol dengar.
 */
export default function SoundToggle({ ringkas = false }: { ringkas?: boolean }) {
  const [mati, setMati] = useState(false);
  const [vol, setVol] = useState(1);
  const [keras, setKeras] = useState(false);
  const [pilihan, setPilihan] = useState('terang');
  const [tertahan, setTertahan] = useState(false);

  useEffect(() => {
    setMati(isMuted());
    setVol(getVolume());
    setKeras(isBoost());
    setPilihan(getPaket());
    // Shell yang memasang pembuka audio global; di sini cukup menampilkan
    // kalau browser masih menahan bunyi supaya bisa dijelaskan ke operator.
    const cek = () => setTertahan(statusAudio() === 'tertahan');
    cek();
    const t = setInterval(cek, 2000);
    return () => clearInterval(t);
  }, []);

  const toggle = () => {
    const next = !mati;
    setMuted(next);
    setMati(next);
    if (!next) {
      unlockAudio();
      playSuccess();
    }
  };

  const aktif = PAKET_BUNYI.find((p) => p.id === pilihan) ?? PAKET_BUNYI[0];

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <button
        type="button"
        className="icon-btn"
        onClick={toggle}
        aria-pressed={!mati}
        aria-label={mati ? 'Nyalakan suara scan' : 'Matikan suara scan'}
        title={mati ? 'Suara scan MATI — klik untuk menyalakan' : 'Suara scan menyala'}
      >
        {mati ? <IconSpeakerOff className="ico" /> : <IconSpeaker className="ico" />}
      </button>

      {!ringkas && (
        <>
          <select
            className="select-field"
            style={{ width: 'auto', minWidth: 140, height: 34, padding: '0 10px', fontSize: 13 }}
            value={pilihan}
            onChange={(e) => {
              const id = e.target.value;
              setPilihan(id);
              setPaket(id);
              unlockAudio();
              if (!mati) cobaPaket(id, 'success');
            }}
            disabled={mati}
            aria-label="Pilihan bunyi scan"
          >
            {PAKET_BUNYI.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nama}
              </option>
            ))}
          </select>

          <input
            type="range"
            min={5}
            max={100}
            value={Math.round(vol * 100)}
            onChange={(e) => {
              const v = Number(e.target.value) / 100;
              setVol(v);
              setVolume(v);
            }}
            onMouseUp={() => !mati && playSuccess()}
            onTouchEnd={() => !mati && playSuccess()}
            style={{ width: 90 }}
            aria-label="Volume suara scan"
            disabled={mati}
          />

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
            <input
              type="checkbox"
              checked={keras}
              disabled={mati}
              onChange={(e) => {
                setKeras(e.target.checked);
                setBoost(e.target.checked);
                unlockAudio();
                if (!mati) playSuccess();
              }}
              style={{ width: 16, height: 16 }}
            />
            Ekstra keras
          </label>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              unlockAudio();
              playSuccess();
              setTimeout(playFailed, 900);
            }}
            disabled={mati}
            title="Dengarkan bunyi berhasil lalu bunyi gagal"
          >
            Tes bunyi
          </button>

          <span style={{ flexBasis: '100%', height: 0 }} />
          <span style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>{aktif.ket}</span>

          {tertahan && !mati && (
            <span style={{ fontSize: 11.5, color: 'var(--critical)' }}>
              Browser masih menahan bunyi — klik di mana saja sekali.
            </span>
          )}
        </>
      )}
    </span>
  );
}
