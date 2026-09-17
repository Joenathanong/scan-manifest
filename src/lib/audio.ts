'use client';

/**
 * Nada scan dibangkitkan sendiri lewat WebAudio — tidak ada berkas mp3 yang
 * perlu diunduh, jadi bunyinya keluar seketika walau jaringan gudang lambat.
 *
 * Tiga bunyi yang HARUS bisa dibedakan tanpa melihat layar:
 *   BERHASIL : naik, pendek dan bersih
 *   DOBEL    : dua nada sama, berulang
 *   GAGAL    : turun, kasar dan paling panjang
 *
 * Kenapa keras: gudang berisik. Semua bunyi lewat satu bus dengan compressor,
 * jadi amplitudonya bisa didorong tinggi tanpa pecah, dan frekuensinya dipilih
 * di rentang 1–3 kHz yang paling menembus kebisingan mesin.
 */

let ctx: AudioContext | null = null;
let bus: GainNode | null = null;
let muted = false;
let volume = 1;
let boost = false;
let paket = 'terang';
let terbaca = false;

/* ---------------- pilihan bunyi ---------------- */

type Nada = {
  freq: number;
  ms: number;
  delay?: number;
  type?: OscillatorType;
  gain?: number;
  /** Frekuensi akhir untuk nada meluncur (glide). */
  freqAkhir?: number;
};

export type PaketBunyi = {
  id: string;
  nama: string;
  ket: string;
  success: Nada[];
  double: Nada[];
  failed: Nada[];
};

export const PAKET_BUNYI: PaketBunyi[] = [
  {
    id: 'terang',
    nama: 'Terang',
    ket: 'Dua nada naik yang tegas. Serbaguna, cocok untuk gudang dengan kebisingan sedang.',
    success: [
      { freq: 1175, ms: 150, type: 'square', gain: 0.32 },
      { freq: 1175, ms: 150, type: 'triangle', gain: 0.26 },
      { freq: 1760, ms: 330, delay: 120, type: 'square', gain: 0.34 },
      { freq: 1760, ms: 330, delay: 120, type: 'triangle', gain: 0.28 },
    ],
    double: [
      { freq: 988, ms: 190, type: 'square', gain: 0.34 },
      { freq: 988, ms: 190, delay: 250, type: 'square', gain: 0.34 },
      { freq: 988, ms: 230, delay: 500, type: 'square', gain: 0.34 },
    ],
    failed: [
      { freq: 392, freqAkhir: 150, ms: 620, type: 'sawtooth', gain: 0.3 },
      { freq: 196, freqAkhir: 90, ms: 700, delay: 90, type: 'square', gain: 0.22 },
    ],
  },
  {
    id: 'kasir',
    nama: 'Beep kasir',
    ket: 'Satu beep tunggal panjang seperti scanner supermarket. Paling menembus, paling tidak membingungkan.',
    success: [{ freq: 2093, ms: 420, type: 'square', gain: 0.4 }],
    double: [
      { freq: 1046, ms: 220, type: 'square', gain: 0.38 },
      { freq: 1046, ms: 220, delay: 300, type: 'square', gain: 0.38 },
    ],
    failed: [
      { freq: 185, ms: 800, type: 'square', gain: 0.32 },
      { freq: 139, ms: 800, delay: 40, type: 'sawtooth', gain: 0.26 },
    ],
  },
  {
    id: 'lonceng',
    nama: 'Lonceng',
    ket: 'Denting bernada dengan ekor panjang. Paling enak didengar seharian, tetap terdengar di ruang tertutup.',
    success: [
      { freq: 1318, ms: 700, type: 'triangle', gain: 0.34 },
      { freq: 1975, ms: 620, delay: 40, type: 'sine', gain: 0.26 },
      { freq: 2637, ms: 540, delay: 80, type: 'sine', gain: 0.18 },
    ],
    double: [
      { freq: 1108, ms: 420, type: 'triangle', gain: 0.32 },
      { freq: 1108, ms: 520, delay: 330, type: 'triangle', gain: 0.32 },
    ],
    failed: [
      { freq: 277, ms: 900, type: 'triangle', gain: 0.32 },
      { freq: 233, ms: 900, delay: 30, type: 'sawtooth', gain: 0.24 },
      { freq: 116, ms: 900, delay: 60, type: 'square', gain: 0.2 },
    ],
  },
  {
    id: 'sirene',
    nama: 'Sirene',
    ket: 'Paling keras dan paling panjang. Untuk area forklift atau dekat mesin sortir.',
    success: [
      { freq: 1568, ms: 130, type: 'square', gain: 0.38 },
      { freq: 2349, ms: 130, delay: 140, type: 'square', gain: 0.38 },
      { freq: 1568, ms: 130, delay: 280, type: 'square', gain: 0.38 },
      { freq: 2349, ms: 300, delay: 420, type: 'square', gain: 0.4 },
    ],
    double: [
      { freq: 1318, freqAkhir: 880, ms: 300, type: 'square', gain: 0.36 },
      { freq: 1318, freqAkhir: 880, ms: 300, delay: 360, type: 'square', gain: 0.36 },
      { freq: 1318, freqAkhir: 880, ms: 340, delay: 720, type: 'square', gain: 0.36 },
    ],
    failed: [
      { freq: 660, freqAkhir: 440, ms: 420, type: 'sawtooth', gain: 0.34 },
      { freq: 440, freqAkhir: 660, ms: 420, delay: 440, type: 'sawtooth', gain: 0.34 },
      { freq: 660, freqAkhir: 200, ms: 520, delay: 880, type: 'sawtooth', gain: 0.34 },
      { freq: 160, ms: 1000, type: 'square', gain: 0.2 },
    ],
  },
];

function paketAktif(): PaketBunyi {
  return PAKET_BUNYI.find((p) => p.id === paket) ?? PAKET_BUNYI[0];
}

/* ---------------- mesin bunyi ---------------- */

function bacaSetelan() {
  if (terbaca || typeof window === 'undefined') return;
  terbaca = true;
  try {
    muted = localStorage.getItem('ieg-scan-mute') === '1';
    boost = localStorage.getItem('ieg-scan-boost') === '1';

    const p = localStorage.getItem('ieg-scan-paket');
    if (p && PAKET_BUNYI.some((x) => x.id === p)) paket = p;

    // HATI-HATI: Number(null) dan Number('') sama-sama 0, bukan NaN. Kalau
    // nilainya langsung dilempar ke Number(), perangkat yang belum pernah
    // menyentuh slider akan terbaca volume 0 alias bisu total.
    const mentah = localStorage.getItem('ieg-scan-volume');
    if (mentah !== null && mentah.trim() !== '') {
      const v = Number(mentah);
      if (Number.isFinite(v) && v > 0 && v <= 1) volume = v;
    }
  } catch {
    /* penyimpanan diblokir: pakai bawaan */
  }
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) {
      const Ctor =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Satu bus untuk semua nada: gain → compressor → speaker. Compressor-lah yang
 * membuat bunyi terdengar KERAS tanpa pecah — puncaknya ditahan, bagian
 * pelannya diangkat, jadi rata-rata dayanya jauh lebih tinggi daripada sekadar
 * menaikkan amplitudo.
 */
function busMaster(a: AudioContext): GainNode {
  if (bus && bus.context === a) return bus;
  const g = a.createGain();
  const comp = a.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 14;
  comp.ratio.value = 8;
  comp.attack.value = 0.002;
  comp.release.value = 0.14;
  g.connect(comp).connect(a.destination);
  bus = g;
  return g;
}

function mainkan(nada: Nada[]) {
  bacaSetelan();
  if (muted) return;
  const a = audio();
  if (!a) return;

  const keluaran = busMaster(a);
  keluaran.gain.value = volume * (boost ? 2.4 : 1.35);

  for (const n of nada) {
    try {
      const mulai = a.currentTime + (n.delay ?? 0) / 1000;
      const durasi = n.ms / 1000;
      const osc = a.createOscillator();
      const vol = a.createGain();

      osc.type = n.type ?? 'sine';
      osc.frequency.setValueAtTime(n.freq, mulai);
      if (n.freqAkhir) osc.frequency.exponentialRampToValueAtTime(n.freqAkhir, mulai + durasi);

      // Bentuk amplop: naik cepat, tahan sebagian besar durasi, baru meluruh.
      // Nada jadi terasa lebih panjang dan lebih penuh daripada langsung luruh.
      const puncak = Math.max(0.0001, n.gain ?? 0.3);
      const tahan = Math.max(0.02, durasi * 0.62);
      vol.gain.setValueAtTime(0.0001, mulai);
      vol.gain.exponentialRampToValueAtTime(puncak, mulai + 0.01);
      vol.gain.setValueAtTime(puncak, mulai + tahan);
      vol.gain.exponentialRampToValueAtTime(0.0001, mulai + durasi);

      osc.connect(vol).connect(keluaran);
      osc.start(mulai);
      osc.stop(mulai + durasi + 0.03);
    } catch {
      /* perangkat tanpa audio: diamkan */
    }
  }
}

/**
 * Chrome memblokir audio sampai ada interaksi pengguna.
 */
export function unlockAudio() {
  bacaSetelan();
  const a = audio();
  if (!a) return;
  if (a.state === 'running') return;
  try {
    const osc = a.createOscillator();
    const vol = a.createGain();
    vol.gain.value = 0.0001;
    osc.connect(vol).connect(a.destination);
    osc.start();
    osc.stop(a.currentTime + 0.01);
  } catch {
    /* abaikan */
  }
}

/**
 * Pasang pembuka audio sekali untuk seluruh aplikasi. Dipanggil dari shell,
 * bukan dari tombol suara saja — kalau operator langsung menembak barcode
 * tanpa pernah mengklik apa pun, bunyi scan pertama tetap keluar.
 *
 * Tidak memakai { once: true }: Chrome kadang menolak resume pada gestur
 * pertama, jadi listener baru dilepas setelah context benar-benar 'running'.
 */
export function pasangPembukaAudio(): () => void {
  if (typeof window === 'undefined') return () => {};
  const buka = () => {
    unlockAudio();
    if (ctx?.state === 'running') lepas();
  };
  const lepas = () => {
    window.removeEventListener('pointerdown', buka);
    window.removeEventListener('keydown', buka);
    window.removeEventListener('touchstart', buka);
  };
  window.addEventListener('pointerdown', buka);
  window.addEventListener('keydown', buka);
  window.addEventListener('touchstart', buka);
  return lepas;
}

/** Untuk panel diagnosa di Admin > Setelan. */
export function statusAudio(): 'belum-dibuka' | 'tertahan' | 'jalan' | 'tidak-didukung' {
  if (typeof window === 'undefined') return 'belum-dibuka';
  const Ctor =
    window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return 'tidak-didukung';
  if (!ctx) return 'belum-dibuka';
  return ctx.state === 'running' ? 'jalan' : 'tertahan';
}

export function playSuccess() {
  mainkan(paketAktif().success);
}

export function playDouble() {
  mainkan(paketAktif().double);
}

export function playFailed() {
  mainkan(paketAktif().failed);
}

export function playForTone(t: 'success' | 'double' | 'failed') {
  if (t === 'success') playSuccess();
  else if (t === 'double') playDouble();
  else playFailed();
}

/** Pratinjau satu paket tanpa mengubah setelan tersimpan. */
export function cobaPaket(id: string, t: 'success' | 'double' | 'failed' = 'success') {
  bacaSetelan();
  const sebelum = paket;
  paket = id;
  playForTone(t);
  paket = sebelum;
}

export function vibrate(pattern: number | number[]) {
  bacaSetelan();
  if (muted) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* abaikan */
  }
}

/* ---------------- setelan bunyi ---------------- */

export function isMuted(): boolean {
  bacaSetelan();
  return muted;
}

export function setMuted(v: boolean) {
  bacaSetelan();
  muted = v;
  try {
    localStorage.setItem('ieg-scan-mute', v ? '1' : '0');
  } catch {
    /* abaikan */
  }
}

export function getVolume(): number {
  bacaSetelan();
  return volume;
}

export function setVolume(v: number) {
  bacaSetelan();
  // Minimal 0.05 supaya slider yang tergeser mentok tidak membuat bunyi hilang
  // tanpa penjelasan — untuk benar-benar membisukan ada tombol speaker.
  volume = v <= 0 ? 0.05 : Math.min(1, v);
  try {
    localStorage.setItem('ieg-scan-volume', String(volume));
  } catch {
    /* abaikan */
  }
}

export function isBoost(): boolean {
  bacaSetelan();
  return boost;
}

export function setBoost(v: boolean) {
  bacaSetelan();
  boost = v;
  try {
    localStorage.setItem('ieg-scan-boost', v ? '1' : '0');
  } catch {
    /* abaikan */
  }
}

export function getPaket(): string {
  bacaSetelan();
  return paket;
}

export function setPaket(id: string) {
  bacaSetelan();
  if (!PAKET_BUNYI.some((p) => p.id === id)) return;
  paket = id;
  try {
    localStorage.setItem('ieg-scan-paket', id);
  } catch {
    /* abaikan */
  }
}
