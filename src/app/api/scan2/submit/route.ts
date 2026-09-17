import { handle, int, requireUser } from '@/lib/api';
import { submitDoc } from '@/server/manifest-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return submitDoc(user, int(body.docId, 'Dokumen'));
  });
}
