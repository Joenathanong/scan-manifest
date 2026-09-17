import { handle, requireUser } from '@/lib/api';
import { flushOutbox } from '@/server/manifest-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Tombol "Kirim ulang sekarang" di banner status. */
export async function POST() {
  return handle(async () => {
    await requireUser();
    return flushOutbox(30);
  });
}
