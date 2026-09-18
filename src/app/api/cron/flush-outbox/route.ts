import { ApiError, handle } from '@/lib/api';
import { flushOutbox } from '@/server/manifest-service';
import { verifikasiTertunda } from '@/server/verify-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Dipanggil cron Vercel. Dilindungi CRON_SECRET (header Authorization atau ?key=). */
export async function GET(req: Request) {
  return handle(async () => {
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const url = new URL(req.url);
      const header = req.headers.get('authorization') || '';
      const ok = header === `Bearer ${secret}` || url.searchParams.get('key') === secret;
      if (!ok) throw new ApiError('Tidak diizinkan.', 401);
    }
    const outbox = await flushOutbox();

    // Sekalian bereskan sisa antrean pemeriksaan resi. Saat operator berhenti
    // menembak, tidak ada lagi permintaan scan yang memicu after(), jadi sisa
    // terakhir setiap batch diselesaikan di sini.
    let diperiksa = 0;
    let invalid = 0;
    for (let putaran = 0; putaran < 20; putaran++) {
      const satu = await verifikasiTertunda(true);
      if (!satu.diperiksa) break;
      diperiksa += satu.diperiksa;
      invalid += satu.invalid;
    }

    return { ...outbox, verifikasi: { diperiksa, invalid } };
  });
}
