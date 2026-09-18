import { after } from 'next/server';
import { ApiError, handle } from '@/lib/api';
import { bangunSnapshot, snapshotUntukTampil } from '@/server/tv-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * SENGAJA TANPA LOGIN — layar TV di gudang tidak punya orang yang mengetik
 * password. Yang keluar dari sini hanya angka ringkasan: tidak ada nomor resi,
 * nama pelanggan, alamat, atau apa pun yang bisa dipakai di luar ruangan itu.
 *
 * Kalau tetap ingin dikunci, isi TV_TOKEN di env; halaman TV lalu dibuka
 * dengan /tv?key=<token>.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const token = process.env.TV_TOKEN;
    if (token) {
      const url = new URL(req.url);
      if (url.searchParams.get('key') !== token) throw new ApiError('Tidak diizinkan.', 401);
    }

    const { snap, perluSegarkan } = await snapshotUntukTampil();

    // Penyegaran dijalankan SESUDAH balasan terkirim: TV selalu dapat angka
    // seketika dari snapshot, dan OCS ditanya di belakang layar.
    if (perluSegarkan) after(() => bangunSnapshot().catch(() => undefined));

    return snap;
  });
}
