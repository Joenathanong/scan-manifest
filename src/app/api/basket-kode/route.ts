import { handle, requireSupervisor } from '@/lib/api';
import { perbaikiKodeBasket } from '@/server/manifest-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST() {
  return handle(async () => perbaikiKodeBasket(await requireSupervisor()));
}
