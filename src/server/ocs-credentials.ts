import { prisma } from '@/lib/db';
import { decryptSecret } from '@/lib/crypto';
import { kredensialSistem, type Kredensial } from './ocs-client';

/**
 * Akun OCS yang dipakai untuk bertindak atas nama satu pengguna aplikasi.
 *
 * Urutan: akun OCS milik pengguna -> akun sistem dari environment.
 * Dokumen manifest di OCS tercatat atas nama akun yang dipakai, jadi mengisi
 * akun per operator membuat jejaknya benar (MANIFEST001, bukan ADMIN).
 */
export async function kredensialUntukUser(userId: number | null | undefined): Promise<Kredensial | null> {
  if (!userId) return kredensialSistem();

  const user = (await prisma.user.findUnique({
    where: { id: userId },
    select: { ocsUsername: true, ocsPasswordEnc: true, ocsCompanyDb: true },
  })) as { ocsUsername: string | null; ocsPasswordEnc: string | null; ocsCompanyDb: string | null } | null;

  if (!user?.ocsUsername || !user.ocsPasswordEnc) return kredensialSistem();

  const password = decryptSecret(user.ocsPasswordEnc);
  if (!password) {
    // Biasanya karena SESSION_SECRET berganti — jangan sampai manifest berhenti.
    console.error(`[ocs] password OCS user ${userId} tidak bisa dibuka, memakai akun sistem`);
    return kredensialSistem();
  }

  const companydb = user.ocsCompanyDb || process.env.OCS_COMPANYDB || '';
  if (!companydb) return kredensialSistem();

  return {
    username: user.ocsUsername,
    password,
    companydb,
    label: `${user.ocsUsername} (akun operator)`,
  };
}
