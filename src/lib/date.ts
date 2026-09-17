const TZ = 'Asia/Jakarta';

/** "2026-09-17" untuk sekarang di WIB. */
export function todayISO(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Kolom @db.Date disimpan sebagai tengah malam UTC dari tanggal WIB-nya. */
export function dateOnly(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

export function isoFromDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function compactDate(iso: string): string {
  return iso.replace(/-/g, '');
}

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: TZ,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function fmtTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: TZ,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function fmtNumber(n: number | null | undefined): string {
  return new Intl.NumberFormat('id-ID').format(n ?? 0);
}
