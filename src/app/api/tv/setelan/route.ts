import { ApiError, handle, requireSupervisor } from '@/lib/api';
import {
  JEDA_MAKS_MENIT,
  JEDA_MIN_MENIT,
  bacaSnapshot,
  bangunSnapshot,
  intervalMenit,
  setIntervalMenit,
} from '@/server/tv-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  return handle(async () => {
    await requireSupervisor();
    const [menit, snap] = await Promise.all([intervalMenit(), bacaSnapshot()]);
    return {
      menit,
      min: JEDA_MIN_MENIT,
      maks: JEDA_MAKS_MENIT,
      terakhir: snap?.dibuatPada ?? null,
      ocsError: snap?.ocsError ?? null,
    };
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    await requireSupervisor();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    // Tarik sekarang juga, di luar jadwal.
    if (body.tarikSekarang === true) {
      const snap = await bangunSnapshot();
      return { menit: snap.intervalMenit, terakhir: snap.dibuatPada, ocsError: snap.ocsError };
    }

    const menit = Number(body.menit);
    if (!Number.isFinite(menit)) throw new ApiError('Isi berapa menit sekali datanya ditarik.');
    if (menit < JEDA_MIN_MENIT || menit > JEDA_MAKS_MENIT) {
      throw new ApiError(`Jeda penarikan harus antara ${JEDA_MIN_MENIT} dan ${JEDA_MAKS_MENIT} menit.`);
    }

    const tersimpan = await setIntervalMenit(menit);
    const snap = await bacaSnapshot();
    return { menit: tersimpan, terakhir: snap?.dibuatPada ?? null, ocsError: snap?.ocsError ?? null };
  });
}
