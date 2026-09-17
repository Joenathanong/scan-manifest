'use client';

/** Nada scan dibangkitkan sendiri lewat WebAudio — tidak ada file mp3 yang perlu diunduh. */
let ctx: AudioContext | null = null;

function tone(freq: number, ms: number, delay = 0, type: OscillatorType = 'sine', gain = 0.09) {
  try {
    if (typeof window === 'undefined') return;
    if (!ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    const start = ctx.currentTime + delay / 1000;
    const osc = ctx.createOscillator();
    const vol = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    vol.gain.setValueAtTime(gain, start);
    vol.gain.exponentialRampToValueAtTime(0.0001, start + ms / 1000);
    osc.connect(vol).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + ms / 1000);
  } catch {
    /* perangkat tanpa audio: diamkan */
  }
}

export function playSuccess() {
  tone(1180, 90);
}

export function playDouble() {
  tone(700, 120);
  tone(700, 120, 160);
}

export function playFailed() {
  tone(300, 260, 0, 'square', 0.07);
}

export function playForTone(t: 'success' | 'double' | 'failed') {
  if (t === 'success') playSuccess();
  else if (t === 'double') playDouble();
  else playFailed();
}

export function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* abaikan */
  }
}
