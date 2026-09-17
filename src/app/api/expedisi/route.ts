import { prisma } from '@/lib/db';
import { ApiError, handle, requireSupervisor, requireUser, optStr, str } from '@/lib/api';
import { isUniqueViolation } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    await requireUser();
    return prisma.expedisi.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    await requireSupervisor();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      return await prisma.expedisi.create({
        data: {
          code: str(body.code, 'Kode', 32).toUpperCase(),
          name: str(body.name, 'Nama', 80),
          ocsShipper: str(body.ocsShipper, 'Nama kurir di OCS', 40),
          prefixes: optStr(body.prefixes, 1000) ?? '',
          sortOrder: Number(body.sortOrder) || 0,
          active: body.active === false ? false : true,
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ApiError('Kode ekspedisi itu sudah ada.');
      throw e;
    }
  });
}
