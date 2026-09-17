import { handle, int, optStr, requireUser, str } from '@/lib/api';
import { openDoc } from '@/server/manifest-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return openDoc(user, {
      expedisiId: int(body.expedisiId, 'Ekspedisi'),
      areaId: str(body.areaId, 'Area', 40),
      basketCode: optStr(body.basketCode, 48),
      note: optStr(body.note, 200),
    });
  });
}
