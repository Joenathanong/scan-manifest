import { handle, requireAdmin } from '@/lib/api';
import * as ocs from '@/server/ocs-client';
import { kredensialUntukUser } from '@/server/ocs-credentials';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  return handle(async () => {
    const me = await requireAdmin();
    if (!ocs.ocsEnabled()) {
      return { ok: false, enabled: false, message: 'OCS dimatikan atau kredensial belum diisi.' };
    }
    const cred = await kredensialUntukUser(me.id);
    const res = await ocs.ping(cred);
    const baskets = await ocs.getBasketManifestList(cred).catch(() => [] as string[]);
    return { ok: true, enabled: true, akun: cred?.label ?? null, areas: res.areas, jumlahBasketOcs: baskets.length };
  });
}
