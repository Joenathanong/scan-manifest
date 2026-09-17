import { handle, requireUser } from '@/lib/api';
import { daftarBasketTersedia } from '@/server/manifest-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handle(async () => {
    await requireUser();
    const url = new URL(req.url);
    const expedisiId = Number(url.searchParams.get('expedisi'));
    if (!Number.isFinite(expedisiId) || expedisiId <= 0) return { tanggal: '', rows: [] };
    return daftarBasketTersedia({ expedisiId, tanggal: url.searchParams.get('tanggal') || undefined });
  });
}
