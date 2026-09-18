import { prisma, isUniqueViolation, nextSeq, withRetry } from '@/lib/db';
import { ApiError, writeAudit, type SessionUser } from '@/lib/api';
import { cleanResi, detectExpedisi, parsePrefixes } from '@/lib/resi';
import { compactDate, dateOnly, todayISO } from '@/lib/date';
import { lupakan, memo } from '@/lib/cache';

export type ScanTone = 'success' | 'double' | 'failed';

export type Scan1Result = {
  status: 'OK' | 'DOUBLE' | 'REJECT';
  tone: ScanTone;
  message: string;
  resi: string;
  expedisi: string | null;
  itemId?: number;
  totalHariIni: number;
};

/** Buang cache sesi milik operator — dipanggil saat batch dibuka/ditutup. */
export function lupakanSesi(userId: number) {
  lupakan(`sesi:${userId}:`, true);
}

/**
 * Sesi scan pertama: satu per operator per hari, dibuat diam-diam.
 *
 * Id-nya ditahan 60 detik. Sesi hanya berubah saat batch dibuka atau ditutup,
 * dan keduanya sudah memanggil lupakanSesi(), jadi tidak ada gunanya menanyakan
 * ulang ke TiDB pada setiap scan.
 */
export function idSesiCepat(userId: number, iso = todayISO()): Promise<number> {
  return memo(`sesi:${userId}:${iso}`, 60, async () => (await getOrCreateSession(userId, iso)).id);
}

export async function getOrCreateSession(userId: number, iso = todayISO()) {
  const date = dateOnly(iso);
  const existing = await prisma.scanSession.findFirst({
    where: { userId, date, closedAt: null },
    orderBy: { id: 'desc' },
  });
  if (existing) return existing;

  const seq = await nextSeq(`session:${iso}`);
  const code = `S-${compactDate(iso)}-${String(seq).padStart(3, '0')}`;
  try {
    return await prisma.scanSession.create({ data: { code, date, seq, userId } });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const again = await prisma.scanSession.findFirst({
        where: { userId, date, closedAt: null },
        orderBy: { id: 'desc' },
      });
      if (again) return again;
    }
    throw e;
  }
}

/** Buang cache aturan prefix — dipanggil setelah ekspedisi diubah admin. */
export function lupakanAturanEkspedisi() {
  lupakan('expedisi:rules');
}

function expedisiRules() {
  // Master ekspedisi nyaris tidak pernah berubah saat operasional berjalan,
  // tapi tanpa cache ia dibaca ulang pada setiap scan.
  return memo('expedisi:rules', 300, bacaExpedisiRules);
}

async function bacaExpedisiRules() {
  const list = await prisma.expedisi.findMany({
    where: { active: true },
    select: { id: true, code: true, prefixes: true },
  });
  type Row = { id: number; code: string; prefixes: string };
  const rows = list as Row[];
  return {
    rules: rows.map((e) => ({ code: e.code, prefixes: parsePrefixes(e.prefixes) })),
    byCode: new Map<string, number>(rows.map((e) => [e.code, e.id])),
  };
}

/**
 * SCAN 1 — hanya resi. Tidak ada basket, tidak ada barcode.
 * Resi masuk dengan status AWAITING_PICKUP.
 */
export async function scanFirst(user: SessionUser, rawResi: string): Promise<Scan1Result> {
  const resi = cleanResi(rawResi);
  const iso = todayISO();

  if (resi.length < 6) {
    return {
      status: 'REJECT',
      tone: 'failed',
      message: 'Resi terlalu pendek — scan ulang.',
      resi,
      expedisi: null,
      totalHariIni: await countAwaitingToday(iso),
    };
  }

  // Empat hal ini tidak saling bergantung, jadi ditembak BERBARENGAN. Ini
  // bagian terpenting dari kecepatan scan: berurutan berarti membayar empat
  // perjalanan jaringan ke TiDB, berbarengan hanya membayar yang paling lambat.
  // Tiga di antaranya biasanya sudah ada di cache, jadi praktis yang tersisa
  // cuma pencarian resi.
  const [aturan, existing, sessionId, totalSebelum] = await Promise.all([
    expedisiRules(),
    prisma.scanItem.findUnique({
      where: { resiUnik: resi },
      include: {
        scan1By: { select: { name: true } },
        basket: { select: { code: true } },
        expedisi: { select: { code: true } },
      },
    }),
    idSesiCepat(user.id, iso),
    countAwaitingToday(iso),
  ]);

  const { rules, byCode } = aturan;
  const code = detectExpedisi(resi, rules);

  if (existing) {
    const when = existing.status === 'PICKUP' ? 'sudah dimanifest' : 'sudah discan';
    // Tidak ditunggu: penghitung duplikat hanya untuk laporan, tidak boleh
    // menahan balasan ke operator yang sedang memegang scanner.
    void catatDuplikat(user.id).catch(() => {});
    return {
      status: 'DOUBLE',
      tone: 'double',
      message: `${resi} ${when} oleh ${existing.scan1By.name}.`,
      resi,
      // Ekspedisi diambil dari baris yang sudah tersimpan; kalau baris lama
      // belum sempat dikenali, dicoba lagi dari pola resi supaya popup dobel
      // tidak menampilkan "BELUM DIKENALI" padahal ekspedisinya jelas.
      expedisi: (existing as { expedisi: { code: string } | null }).expedisi?.code ?? code,
      itemId: existing.id,
      totalHariIni: totalSebelum,
    };
  }

  const expedisiId = code ? byCode.get(code) ?? null : null;

  try {
    const item = await prisma.scanItem.create({
      data: {
        resi,
        resiUnik: resi,
        expedisiId,
        sessionId,
        scanDate: dateOnly(iso),
        status: 'AWAITING_PICKUP',
        scan1ById: user.id,
      },
    });
    return {
      status: 'OK',
      tone: 'success',
      message: code ? `${resi} tersimpan (${code}).` : `${resi} tersimpan — ekspedisi belum teridentifikasi.`,
      resi,
      expedisi: code,
      itemId: item.id,
      // Dihitung dari angka sebelum simpan + 1, bukan COUNT ulang. Menghemat
      // satu perjalanan lagi, dan angkanya persis sama.
      totalHariIni: totalSebelum + 1,
    };
  } catch (e) {
    if (isUniqueViolation(e)) {
      void catatDuplikat(user.id).catch(() => {});
      return {
        status: 'DOUBLE',
        tone: 'double',
        message: `${resi} baru saja discan di perangkat lain.`,
        resi,
        expedisi: code,
        totalHariIni: totalSebelum,
      };
    }
    throw e;
  }
}

/** Buka batch scan baru (mode desktop) — sesi lama milik operator ditutup. */
export async function bukaSesi(
  user: SessionUser,
  params: { shift?: string | null; operatorName?: string | null },
) {
  const iso = todayISO();
  const date = dateOnly(iso);

  lupakanSesi(user.id);
  await prisma.scanSession.updateMany({
    where: { userId: user.id, closedAt: null },
    data: { closedAt: new Date() },
  });

  const seq = await nextSeq(`session:${iso}`);
  const code = `S-${compactDate(iso)}-${String(seq).padStart(3, '0')}`;
  const baru = await prisma.scanSession.create({
    data: {
      code,
      date,
      seq,
      userId: user.id,
      operatorName: params.operatorName?.slice(0, 120) || user.name,
      shift: params.shift?.slice(0, 32) || null,
    },
  });
  lupakanSesi(user.id);
  return baru;
}

export async function tutupSesi(user: SessionUser) {
  lupakanSesi(user.id);
  const { count } = await prisma.scanSession.updateMany({
    where: { userId: user.id, closedAt: null },
    data: { closedAt: new Date() },
  });
  await writeAudit(user.id, 'CLOSE_SESSION', 'ScanSession', user.id, { jumlah: count });
  return { ditutup: count };
}

/** Sesi aktif + seluruh angka yang dipakai layar desktop. */
export async function statusSesi(user: SessionUser, take = 300) {
  const iso = todayISO();
  const sesi = await prisma.scanSession.findFirst({
    where: { userId: user.id, closedAt: null },
    orderBy: { id: 'desc' },
  });

  if (!sesi) {
    return {
      sesi: null,
      rows: [],
      total: 0,
      dupCount: 0,
      jenisEkspedisi: [] as string[],
      totalHariIni: await countAwaitingToday(iso),
      tanggal: iso,
    };
  }

  type Row = {
    id: number;
    resi: string;
    status: string;
    scan1At: Date;
    expedisi: { code: string; name: string } | null;
  };

  const [rows, total] = await Promise.all([
    prisma.scanItem.findMany({
      where: { sessionId: sesi.id, status: { not: 'VOID' } },
      orderBy: { id: 'desc' },
      take,
      select: {
        id: true,
        resi: true,
        status: true,
        scan1At: true,
        expedisi: { select: { code: true, name: true } },
      },
    }),
    prisma.scanItem.count({ where: { sessionId: sesi.id, status: { not: 'VOID' } } }),
  ]);

  const daftar = rows as Row[];
  const jenis = [...new Set(daftar.map((r) => r.expedisi?.code ?? 'LAINNYA'))];

  return {
    sesi: {
      id: sesi.id,
      code: sesi.code,
      operatorName: sesi.operatorName ?? user.name,
      shift: sesi.shift,
      mulai: sesi.createdAt.toISOString(),
      dupCount: sesi.dupCount,
    },
    rows: daftar.map((r) => ({
      id: r.id,
      resi: r.resi,
      status: r.status,
      jam: r.scan1At.toISOString(),
      ekspedisi: r.expedisi?.code ?? null,
      ekspedisiNama: r.expedisi?.name ?? null,
    })),
    total,
    dupCount: sesi.dupCount,
    jenisEkspedisi: jenis,
    totalHariIni: await countAwaitingToday(iso),
    tanggal: iso,
  };
}

export function countAwaitingToday(iso = todayISO()) {
  return prisma.scanItem.count({
    where: { scanDate: dateOnly(iso), status: 'AWAITING_PICKUP' },
  });
}

/** Tambah hitungan duplikat pada sesi yang sedang terbuka. Gagal di sini tidak boleh menghentikan scan. */
async function catatDuplikat(userId: number) {
  try {
    const sesi = await prisma.scanSession.findFirst({
      where: { userId, closedAt: null },
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    if (sesi) await prisma.scanSession.update({ where: { id: sesi.id }, data: { dupCount: { increment: 1 } } });
  } catch {
    /* abaikan */
  }
}

export async function voidItem(user: SessionUser, itemId: number, reason: string) {
  const item = await prisma.scanItem.findUnique({ where: { id: itemId } });
  if (!item) throw new ApiError('Resi tidak ditemukan.', 404);
  if (item.status === 'VOID') throw new ApiError('Resi ini sudah dibatalkan.');
  if (item.status === 'PICKUP' && user.role === 'OPERATOR') {
    throw new ApiError('Resi sudah dimanifest — hanya supervisor/admin yang boleh membatalkan.', 403);
  }

  // Baris TIDAK dihapus. resiUnik dikosongkan supaya resi bisa discan ulang.
  await withRetry(() =>
    prisma.scanItem.update({
      where: { id: itemId },
      data: {
        status: 'VOID',
        resiUnik: null,
        voidedAt: new Date(),
        voidedById: user.id,
        voidReason: reason.slice(0, 180),
      },
    }),
  );
  await writeAudit(user.id, 'VOID_ITEM', 'ScanItem', itemId, { resi: item.resi, reason });
  return { ok: true };
}
