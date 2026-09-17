import { handle, int, optStr, requireSupervisor } from '@/lib/api';
import { cancelDoc } from '@/server/manifest-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireSupervisor();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return cancelDoc(user, int(body.docId, 'Dokumen'), optStr(body.alasan) ?? 'Dibatalkan supervisor');
  });
}
