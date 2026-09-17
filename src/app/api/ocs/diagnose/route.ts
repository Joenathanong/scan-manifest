import { prisma } from '@/lib/db';
import { ApiError, handle, int, requireUser, str } from '@/lib/api';
import * as ocs from '@/server/ocs-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Diagnosa read-only — TIDAK membuat dokumen manifest di OCS. */
export async function POST(req: Request) {
  return handle(async () => {
    await requireUser();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const expedisi = await prisma.expedisi.findUnique({ where: { id: int(body.expedisiId, 'Ekspedisi') } });
    if (!expedisi) throw new ApiError('Ekspedisi tidak ditemukan.', 404);

    const areaId = str(body.areaId ?? 'Pusat', 'Area', 40);
    if (!ocs.ocsEnabled()) {
      return {
        shipper: expedisi.ocsShipper,
        areaId,
        langkah: [{ langkah: 'OCS', ok: false, pesan: 'OCS_ENABLED=false atau kredensial belum diisi.' }],
      };
    }

    return {
      shipper: expedisi.ocsShipper,
      areaId,
      langkah: await ocs.diagnosa({ shipper: expedisi.ocsShipper, areaId }),
    };
  });
}
