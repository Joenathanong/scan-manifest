import { handle, requireAdmin } from '@/lib/api';
import * as ocs from '@/server/ocs-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  return handle(async () => {
    await requireAdmin();
    if (!ocs.ocsEnabled()) {
      return { ok: false, enabled: false, message: 'OCS dimatikan atau kredensial belum diisi.' };
    }
    const res = await ocs.ping();
    const baskets = await ocs.getBasketManifestList().catch(() => [] as string[]);
    return { ok: true, enabled: true, areas: res.areas, jumlahBasketOcs: baskets.length };
  });
}
