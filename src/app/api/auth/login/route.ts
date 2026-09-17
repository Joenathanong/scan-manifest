import { prisma } from '@/lib/db';
import { verifyPassword } from '@/lib/crypto';
import { ApiError, handle, setSessionCookie, str, writeAudit } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handle(async () => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const username = str(body.username, 'Username', 64).toLowerCase();
    const password = str(body.password, 'Password', 128);

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new ApiError('Username atau password salah.', 401);
    }
    if (!user.active) throw new ApiError('Akun ini dinonaktifkan. Hubungi admin.', 403);

    await setSessionCookie(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await writeAudit(user.id, 'LOGIN', 'User', user.id);

    return {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    };
  });
}
