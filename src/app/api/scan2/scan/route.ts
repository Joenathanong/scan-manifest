import { after } from 'next/server';
import { handle, int, requireUser, str } from '@/lib/api';
import { scanSecond, sinkronBerkala } from '@/server/manifest-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const docId = int(body.docId, 'Dokumen');
    const hasil = await scanSecond(user, docId, str(body.resi, 'Resi', 64));

    // Pengiriman ke OCS dijalankan SETELAH balasan dikirim ke operator.
    // after() menjaga fungsi tetap hidup sampai selesai — kalau dilepas begitu
    // saja sebagai promise menggantung, Vercel bisa membekukan instance-nya
    // tepat setelah respons dan kiriman itu hilang diam-diam.
    if (hasil.status === 'OK') after(() => sinkronBerkala(docId));

    return hasil;
  });
}
