import { handle, requireUser } from '@/lib/api';
import { tutupSesi } from '@/server/scan-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  return handle(async () => tutupSesi(await requireUser()));
}
