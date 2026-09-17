import { prisma } from '@/lib/db';
import { handle, optStr, requireSupervisor, writeAudit } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireSupervisor();
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    // code TIDAK bisa diubah — kode dipakai di dalam nomor basket yang sudah tercetak.
    const updated = await prisma.expedisi.update({
      where: { id: Number(id) },
      data: {
        ...(body.name !== undefined ? { name: optStr(body.name, 80) ?? '' } : {}),
        ...(body.ocsShipper !== undefined ? { ocsShipper: optStr(body.ocsShipper, 40) ?? '' } : {}),
        ...(body.prefixes !== undefined ? { prefixes: optStr(body.prefixes, 1000) ?? '' } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: Number(body.sortOrder) || 0 } : {}),
        ...(body.active !== undefined ? { active: !!body.active } : {}),
      },
    });
    await writeAudit(user.id, 'UPDATE_EXPEDISI', 'Expedisi', updated.id, body);
    return updated;
  });
}
