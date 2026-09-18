import { after } from 'next/server';
import { prisma } from '@/lib/db';
import { handle, requireUser, str } from '@/lib/api';
import { scanFirst } from '@/server/scan-service';
import { verifikasiTertunda } from '@/server/verify-service';
import { dateOnly, todayISO } from '@/lib/date';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Pemeriksaan latar belakang lewat after() ikut dihitung sebagai durasi fungsi.
export const maxDuration = 60;

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const hasil = await scanFirst(user, str(body.resi, 'Resi', 64));

    // Pemeriksaan ke OCS dijalankan SESUDAH balasan sampai ke operator, jadi
    // kecepatan scan tidak terpengaruh sama sekali. after() menjaga fungsi
    // tetap hidup sampai selesai — promise menggantung bisa dibekukan Vercel.
    after(() => verifikasiTertunda());

    return hasil;
  });
}

/** Daftar scan terakhir milik operator (untuk panel kanan halaman scan 1). */
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const url = new URL(req.url);
    const take = Math.min(Number(url.searchParams.get('take') || 25), 100);
    const iso = url.searchParams.get('tanggal') || todayISO();
    const date = dateOnly(iso);

    const [rows, totalSaya, totalHariIni] = await Promise.all([
      prisma.scanItem.findMany({
        where: { scan1ById: user.id, scanDate: date, status: { not: 'VOID' } },
        orderBy: { id: 'desc' },
        take,
        select: {
          id: true,
          resi: true,
          status: true,
          scan1At: true,
          expedisi: { select: { code: true } },
        },
      }),
      prisma.scanItem.count({ where: { scan1ById: user.id, scanDate: date, status: { not: 'VOID' } } }),
      prisma.scanItem.count({
        where: { scanDate: date, status: 'AWAITING_PICKUP', verifyState: { not: 'INVALID' } },
      }),
    ]);

    return { rows, totalSaya, totalHariIni, tanggal: iso };
  });
}
