/** Bersihkan hasil scanner: buang spasi/enter/karakter kendali, jadikan huruf besar. */
export function cleanResi(raw: string): string {
  return (raw || '')
    .replace(/\s+/g, '')
    .replace(/[^A-Za-z0-9._/-]/g, '')
    .toUpperCase();
}

export type PrefixRule = { code: string; prefixes: string[] };

/** Tebak ekspedisi dari prefix resi. null = tidak dikenal (scan TETAP diterima). */
export function detectExpedisi(resi: string, rules: PrefixRule[]): string | null {
  const r = cleanResi(resi);
  let best: { code: string; len: number } | null = null;
  for (const rule of rules) {
    for (const p of rule.prefixes) {
      const pre = p.trim().toUpperCase();
      if (!pre) continue;
      if (r.startsWith(pre) && (!best || pre.length > best.len)) best = { code: rule.code, len: pre.length };
    }
  }
  return best ? best.code : null;
}

export function parsePrefixes(raw: string): string[] {
  return (raw || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}
