import { ApiError, handle, requireUser } from '@/lib/api';
import { getOrCreateSession, statusSesi, submitEkspedisi, submitSemua } from '@/server/scan-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Submit serah terima Scan 1.
 *
 *   { semua: true }              -> submit seluruh ekspedisi yang masih ada sisanya
 *   { expedisiId: 3 }            -> submit satu ekspedisi
 *   { expedisiId: null }         -> submit kelompok "BELUM DIKENALI"
 *
 * Tidak menyentuh OCS dan tidak membentuk basket — hanya mengunci hitungan.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const sesi = await getOrCreateSession(user.id);

    if (body.semua === true) {
      const hasil = await submitSemua(user, sesi.id);
      if (!hasil.length) throw new ApiError('Tidak ada resi yang menunggu serah terima.', 409);
      return { batch: hasil, status: await statusSesi(user) };
    }

    if (!('expedisiId' in body)) {
      throw new ApiError('Pilih ekspedisi yang mau diserahterimakan, atau tekan Submit semua.');
    }

    const mentah = body.expedisiId;
    const expedisiId = mentah === null || mentah === '' ? null : Number(mentah);
    if (expedisiId !== null && !Number.isInteger(expedisiId)) {
      throw new ApiError('Ekspedisi tidak dikenali.');
    }

    const satu = await submitEkspedisi(user, sesi.id, expedisiId);
    if (!satu) throw new ApiError('Tidak ada resi yang menunggu serah terima untuk ekspedisi ini.', 409);
    return { batch: [satu], status: await statusSesi(user) };
  });
}
