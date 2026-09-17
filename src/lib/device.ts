'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Perangkat apa yang sedang dipakai.
 *
 * PDT Zebra TC21/TC22/TC26 mendarat di lebar CSS 360px dan layarnya sentuh;
 * PC gudang lebar dan pakai mouse. Dua ciri itu yang dipakai — bukan user
 * agent, karena PDT Zebra menyebut dirinya Android biasa dan browser di PC
 * bisa dipalsukan.
 *
 * Hasilnya menentukan menu mana yang tampil:
 *   pdt     -> "Scan 1 — PDT" saja
 *   desktop -> "Scan 1 — Desktop" saja
 *
 * Bisa dipaksa lewat Admin > Setelan kalau ada perangkat yang salah terbaca.
 */
export type JenisPerangkat = 'pdt' | 'desktop';
export type ModePerangkat = 'auto' | JenisPerangkat;

const KUNCI = 'ieg-perangkat';

export function deteksiPerangkat(): JenisPerangkat {
  if (typeof window === 'undefined') return 'desktop';
  try {
    const sentuh = window.matchMedia('(pointer: coarse)').matches;
    const sempit = window.matchMedia('(max-width: 1023.98px)').matches;
    const sangatSempit = window.matchMedia('(max-width: 767.98px)').matches;

    // Layar kecil = PDT/HP apa pun jenis penunjuknya (PDT lanskap 640x360 ikut di sini).
    if (sangatSempit) return 'pdt';
    // Tablet/PDT besar: hanya dianggap PDT kalau memang layar sentuh.
    if (sempit && sentuh) return 'pdt';
    return 'desktop';
  } catch {
    return 'desktop';
  }
}

export function bacaMode(): ModePerangkat {
  if (typeof window === 'undefined') return 'auto';
  try {
    const v = localStorage.getItem(KUNCI);
    return v === 'pdt' || v === 'desktop' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function simpanMode(mode: ModePerangkat) {
  try {
    if (mode === 'auto') localStorage.removeItem(KUNCI);
    else localStorage.setItem(KUNCI, mode);
  } catch {
    /* abaikan */
  }
  window.dispatchEvent(new Event('ieg-perangkat-berubah'));
}

/** null selama render pertama di server — pemanggil menunggu sampai terisi. */
export function usePerangkat(): { jenis: JenisPerangkat | null; mode: ModePerangkat; setMode: (m: ModePerangkat) => void } {
  const [jenis, setJenis] = useState<JenisPerangkat | null>(null);
  const [mode, setModeState] = useState<ModePerangkat>('auto');

  const hitung = useCallback(() => {
    const m = bacaMode();
    setModeState(m);
    setJenis(m === 'auto' ? deteksiPerangkat() : m);
  }, []);

  useEffect(() => {
    hitung();
    const mqSempit = window.matchMedia('(max-width: 1023.98px)');
    const mqSentuh = window.matchMedia('(pointer: coarse)');
    mqSempit.addEventListener('change', hitung);
    mqSentuh.addEventListener('change', hitung);
    window.addEventListener('ieg-perangkat-berubah', hitung);
    return () => {
      mqSempit.removeEventListener('change', hitung);
      mqSentuh.removeEventListener('change', hitung);
      window.removeEventListener('ieg-perangkat-berubah', hitung);
    };
  }, [hitung]);

  const setMode = useCallback(
    (m: ModePerangkat) => {
      simpanMode(m);
      hitung();
    },
    [hitung],
  );

  return { jenis, mode, setMode };
}
