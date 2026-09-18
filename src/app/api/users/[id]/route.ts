import { prisma } from '@/lib/db';
import { ApiError, handle, optStr, requireAdmin, writeAudit, lupakanUser } from '@/lib/api';
import type { Role } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROLES: Role[] = ['ADMIN', 'SUPERVISOR', 'OPERATOR'];

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const userId = Number(id);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw new ApiError('Pengguna tidak ditemukan.', 404);

    const turningOff = body.active === false || (typeof body.role === 'string' && body.role !== 'ADMIN');
    if (target.id === admin.id && turningOff) {
      throw new ApiError('Anda tidak bisa menonaktifkan atau menurunkan akun sendiri.');
    }
    if (target.role === 'ADMIN' && turningOff) {
      const adminAktif = await prisma.user.count({ where: { role: 'ADMIN', active: true } });
      if (adminAktif <= 1) throw new ApiError('Ini admin aktif terakhir — tidak boleh dinonaktifkan.');
    }

    lupakanUser(Number(id));
    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(body.name !== undefined ? { name: optStr(body.name, 120) ?? target.name } : {}),
        ...(typeof body.role === 'string' && ROLES.includes(body.role as Role) ? { role: body.role as Role } : {}),
        ...(body.active !== undefined ? { active: !!body.active } : {}),
        ...(body.ocsUserCode !== undefined ? { ocsUserCode: optStr(body.ocsUserCode, 64) } : {}),
      },
      select: { id: true, username: true, name: true, role: true, active: true, ocsUserCode: true },
    });
    await writeAudit(admin.id, 'UPDATE_USER', 'User', userId, body);
    return updated;
  });
}
