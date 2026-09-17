import { prisma } from '@/lib/db';
import { hashPassword, tempPassword } from '@/lib/crypto';
import { ApiError, handle, requireAdmin, writeAudit } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reset password: menghasilkan password sementara yang dibacakan ke operator. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const user = await prisma.user.findUnique({ where: { id: Number(id) } });
    if (!user) throw new ApiError('Pengguna tidak ditemukan.', 404);

    const password = tempPassword();
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(password), mustChangePassword: true },
    });
    await writeAudit(admin.id, 'RESET_PASSWORD', 'User', user.id);
    return { username: user.username, passwordSementara: password };
  });
}
