import { handle, optStr, requireUser } from '@/lib/api';
import { bukaSesi, statusSesi } from '@/server/scan-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => statusSesi(await requireUser()));
}

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    await bukaSesi(user, {
      shift: optStr(body.shift, 32),
      operatorName: optStr(body.operatorName, 120),
    });
    return statusSesi(user);
  });
}
