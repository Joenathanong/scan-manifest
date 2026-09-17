import { handle, requireUser } from '@/lib/api';
import { cariAnomali } from '@/server/anomali-service';
import { todayISO } from '@/lib/date';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handle(async () => {
    await requireUser();
    const url = new URL(req.url);
    const dari = url.searchParams.get('dari') || todayISO();
    return cariAnomali({
      dari,
      sampai: url.searchParams.get('sampai') || dari,
      batasJam: url.searchParams.get('batasJam') ? Number(url.searchParams.get('batasJam')) : undefined,
      expedisiId: url.searchParams.get('expedisi') ? Number(url.searchParams.get('expedisi')) : null,
    });
  });
}
