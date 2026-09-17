import { prisma, isUniqueViolation } from '@/lib/db';
import { hashPassword, tempPassword } from '@/lib/crypto';
import { ApiError, handle, optStr, requireAdmin, str, writeAudit } from '@/lib/api';
import type { Role } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROLES: Role[] = ['ADMIN', 'SUPERVISOR', 'OPERATOR'];

export async function GET() {
  return handle(async () => {
    await requireAdmin();
    return prisma.user.findMany({
      orderBy: [{ active: 'desc' }, { username: 'asc' }],
      select: {
        id: true,
        username: true,
        name: true,
        role: true,
        active: true,
        ocsUserCode: true,
        mustChangePassword: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const admin = await requireAdmin();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const username = str(body.username, 'Username', 64).toLowerCase().replace(/\s+/g, '');
    const name = str(body.name, 'Nama', 120);
    const role = (typeof body.role === 'string' && ROLES.includes(body.role as Role) ? body.role : 'OPERATOR') as Role;
    const passwordInput = optStr(body.password, 128);
    const password = passwordInput && passwordInput.length >= 6 ? passwordInput : tempPassword();

    try {
      const user = await prisma.user.create({
        data: {
          username,
          name,
          role,
          passwordHash: hashPassword(password),
          mustChangePassword: true,
          ocsUserCode: optStr(body.ocsUserCode, 64),
        },
        select: { id: true, username: true, name: true, role: true, active: true },
      });
      await writeAudit(admin.id, 'CREATE_USER', 'User', user.id, { username, role });
      // Password sementara HANYA dikembalikan sekali, di sini, untuk dibacakan ke operator.
      return { ...user, passwordSementara: password };
    } catch (e) {
      if (isUniqueViolation(e)) throw new ApiError('Username itu sudah dipakai.');
      throw e;
    }
  });
}
