import { clearSessionCookie, currentUser, handle, writeAudit } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  return handle(async () => {
    const user = await currentUser();
    await clearSessionCookie();
    if (user) await writeAudit(user.id, 'LOGOUT', 'User', user.id);
    return { ok: true };
  });
}
