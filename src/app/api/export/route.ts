import { currentUser } from '@/lib/api';
import { buildScanWorkbook, namaBerkas, type ExportFilter } from '@/server/export-service';
import { todayISO } from '@/lib/date';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Unduh hasil scan sebagai .xlsx.
 * Dipanggil lewat <a href> biasa, jadi balasannya berkas — bukan JSON.
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response('Silakan masuk dulu.', { status: 401 });

  const url = new URL(req.url);
  const filter: ExportFilter = {
    dari: url.searchParams.get('dari') || todayISO(),
    sampai: url.searchParams.get('sampai') || url.searchParams.get('dari') || todayISO(),
    status: url.searchParams.get('status'),
    expedisiId: url.searchParams.get('expedisi') ? Number(url.searchParams.get('expedisi')) : null,
    cari: url.searchParams.get('cari'),
  };

  try {
    const { buffer } = await buildScanWorkbook(filter);
    return new Response(buffer as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${namaBerkas(filter)}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    console.error('[export]', e);
    return new Response(`Gagal membuat berkas Excel: ${e instanceof Error ? e.message : 'tidak diketahui'}`, {
      status: 500,
    });
  }
}
