import { handle, int, requireUser, str } from '@/lib/api';
import { scanSecond } from '@/server/manifest-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return scanSecond(user, int(body.docId, 'Dokumen'), str(body.resi, 'Resi', 64));
  });
}
