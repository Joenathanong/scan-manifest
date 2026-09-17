import { prisma } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/crypto';
import { ApiError, handle, requireUser, str, writeAudit } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const lama = str(body.lama, 'Password lama', 128);
    const baru = str(body.baru, 'Password baru', 128);
    if (baru.length < 6) throw new ApiError('Password baru minimal 6 karakter.');

    const user = await prisma.user.findUnique({ where: { id: me.id } });
    if (!user || !verifyPassword(lama, user.passwordHash)) throw new ApiError('Password lama salah.');

    await prisma.user.update({
      where: { id: me.id },
      data: { passwordHash: hashPassword(baru), mustChangePassword: false },
    });
    await writeAudit(me.id, 'CHANGE_PASSWORD', 'User', me.id);
    return { ok: true };
  });
}
