import { ApiError, handle } from '@/lib/api';
import { flushOutbox } from '@/server/manifest-service';

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
    return flushOutbox();
  });
}
