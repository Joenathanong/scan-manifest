'use client';

import { useCallback, useEffect, useState } from 'react';

/** Setelan tampilan saat scan yang disimpan per perangkat (localStorage). */
const KUNCI_POPUP = 'ieg-scan-popup';
const EVENT = 'ieg-scan-popup-berubah';

export function popupAktif(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    // Bawaan menyala — operator gudang melihat layar dari jarak beberapa meter.
    return localStorage.getItem(KUNCI_POPUP) !== '0';
  } catch {
    return true;
  }
}

export function setPopupAktif(v: boolean) {
  try {
    localStorage.setItem(KUNCI_POPUP, v ? '1' : '0');
  } catch {
    /* penyimpanan diblokir: setelan hanya berlaku untuk sesi ini */
  }
  window.dispatchEvent(new Event(EVENT));
}

/**
 * Versi reaktif: ikut berubah kalau setelan diubah dari tempat lain
 * (mis. tombol di halaman scan vs. Admin > Setelan di tab yang sama).
 */
export function usePopupAktif(): [boolean, (v: boolean) => void] {
  const [aktif, setAktif] = useState(true);

  useEffect(() => {
    const baca = () => setAktif(popupAktif());
    baca();
    window.addEventListener(EVENT, baca);
    window.addEventListener('storage', baca);
    return () => {
      window.removeEventListener(EVENT, baca);
      window.removeEventListener('storage', baca);
    };
  }, []);

  const ubah = useCallback((v: boolean) => {
    setPopupAktif(v);
    setAktif(v);
  }, []);

  return [aktif, ubah];
}
