import { handle, int, requireUser } from '@/lib/api';
import { syncDoc } from '@/server/manifest-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handle(async () => {
    await requireUser();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return syncDoc(int(body.docId, 'Dokumen'));
  });
}
