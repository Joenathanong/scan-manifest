import QRCode from 'qrcode';
import { prisma } from '@/lib/db';
import { currentUser } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PNG QR untuk label keranjang — dicetak dari halaman /basket/<id>/label. */
export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const user = await currentUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const { code: raw } = await ctx.params;
  const code = decodeURIComponent(raw).toUpperCase();
  const basket = await prisma.basket.findUnique({ where: { code }, select: { id: true } });
  if (!basket) return new Response('Not found', { status: 404 });

  const png = await QRCode.toBuffer(code, {
    errorCorrectionLevel: 'M',
    margin: 1,
    scale: 8,
    color: { dark: '#000000', light: '#FFFFFF' },
  });

  return new Response(new Uint8Array(png), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=600' },
  });
}
