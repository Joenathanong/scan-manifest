import { prisma } from '@/lib/db';
import { encryptSecret, decryptSecret } from '@/lib/crypto';
import { ApiError, handle, optStr, requireAdmin, writeAudit } from '@/lib/api';
import { tesAkun } from '@/server/ocs-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

type UserOcs = {
  id: number;
  username: string;
  ocsUsername: string | null;
  ocsPasswordEnc: string | null;
  ocsCompanyDb: string | null;
};

async function ambil(id: number): Promise<UserOcs> {
  const user = (await prisma.user.findUnique({
    where: { id },
    select: { id: true, username: true, ocsUsername: true, ocsPasswordEnc: true, ocsCompanyDb: true },
  })) as UserOcs | null;
  if (!user) throw new ApiError('Pengguna tidak ditemukan.', 404);
  return user;
}

/** Simpan / kosongkan akun OCS milik satu pengguna. Password TIDAK pernah dikembalikan. */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const user = await ambil(Number(id));

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const ocsUsername = optStr(body.ocsUsername, 64);
    const ocsPassword = optStr(body.ocsPassword, 128);
    const ocsCompanyDb = optStr(body.ocsCompanyDb, 64);

    // Username kosong = lepaskan akun OCS, kembali memakai akun sistem.
    if (!ocsUsername) {
      await prisma.user.update({
        where: { id: user.id },
        data: { ocsUsername: null, ocsPasswordEnc: null, ocsCompanyDb: null, ocsUserCode: null },
      });
      await writeAudit(admin.id, 'CLEAR_OCS_ACCOUNT', 'User', user.id);
      return { ocsUsername: null, adaPassword: false, ocsCompanyDb: null };
    }

    // Password boleh dikosongkan saat hanya mengubah username/database.
    if (!ocsPassword && !user.ocsPasswordEnc) {
      throw new ApiError('Password OCS wajib diisi saat pertama kali menyimpan akun ini.');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        ocsUsername,
        ocsUserCode: ocsUsername,
        ocsCompanyDb: ocsCompanyDb || process.env.OCS_COMPANYDB || null,
        ...(ocsPassword ? { ocsPasswordEnc: encryptSecret(ocsPassword) } : {}),
      },
    });
    // Sengaja tidak mencatat nilai apa pun dari password ke audit.
    await writeAudit(admin.id, 'SET_OCS_ACCOUNT', 'User', user.id, { ocsUsername, ganti: !!ocsPassword });

    return {
      ocsUsername,
      adaPassword: true,
      ocsCompanyDb: ocsCompanyDb || process.env.OCS_COMPANYDB || null,
    };
  });
}

/** Tes login akun OCS pengguna ini ke OCS sungguhan. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await ctx.params;
    const user = await ambil(Number(id));

    if (!user.ocsUsername || !user.ocsPasswordEnc) {
      throw new ApiError('Pengguna ini belum punya akun OCS sendiri.');
    }
    const password = decryptSecret(user.ocsPasswordEnc);
    if (!password) {
      throw new ApiError('Password OCS tersimpan tidak bisa dibuka — SESSION_SECRET mungkin berganti. Isi ulang.');
    }

    return tesAkun({
      username: user.ocsUsername,
      password,
      companydb: user.ocsCompanyDb || process.env.OCS_COMPANYDB || '',
    });
  });
}
