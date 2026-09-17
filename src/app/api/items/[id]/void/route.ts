import { handle, requireUser, optStr } from '@/lib/api';
import { voidItem } from '@/server/scan-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return voidItem(user, Number(id), optStr(body.alasan) ?? 'Dibatalkan operator');
  });
}
