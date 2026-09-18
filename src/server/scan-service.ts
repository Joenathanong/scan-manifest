import { prisma, isUniqueViolation, nextSeq, withRetry } from '@/lib/db';
import { ApiError, writeAudit, type SessionUser } from '@/lib/api';
import { cleanResi, detectExpedisi, parsePrefixes } from '@/lib/resi';
import { compactDate, dateOnly, todayISO } from '@/lib/date';
import { lupakan, memo } from '@/lib/cache';
import { cariOrder } from './order-lookup';
import { statusVerifikasi } from './verify-service';

export type ScanTone = 'success' | 'double' | 'failed';

export type Scan1Result = {
  status: 'OK' | 'DOUBLE' | 'REJECT';
  tone: ScanTone;
  message: string;
  resi: string;
  expedisi: string | null;
  /** Terisi kalau yang discan ternyata barcode order ID, bukan nomor resi. */
  orderId?: string;
  trackingNumber?: string;
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

  let expedisiId = code ? byCode.get(code) ?? null : null;
  let kode = code;
  let orderId: string | null = null;
  let tracking: string | null = null;

  // Pola nomornya tidak cocok dengan prefix ekspedisi mana pun — kemungkinan
  // besar yang ditembak barcode ORDER ID, bukan nomor resi. Coba pemetaan
  // order dari OCS sebelum menyerah dan menandainya "belum dikenali".
  if (!expedisiId) {
    const ketemu = await cariOrder(resi);
    if (ketemu) {
      orderId = ketemu.orderId;
      tracking = ketemu.trackingNumber;
      if (ketemu.expedisiId) {
        expedisiId = ketemu.expedisiId;
        kode = ketemu.expedisiCode ?? ketemu.shipper;
      }
    }
  }

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
        // Disimpan supaya Scan 2 mengenali paket ini walau nanti yang ditembak
        // identitasnya yang satunya lagi.
        ocsOrderId: orderId,
        ocsTracking: tracking,
        // Ekspedisi tidak terbaca dari pola nomor maupun pemetaan order ->
        // antrekan untuk diperiksa ke OCS setelah balasan ini terkirim.
        verifyState: expedisiId ? 'NONE' : 'PENDING',
      },
    });
    return {
      status: 'OK',
      tone: 'success',
      message: kode
        ? orderId
          ? `${resi} tersimpan (${kode}, order ID).`
          : `${resi} tersimpan (${kode}).`
        : `${resi} tersimpan — ekspedisi belum teridentifikasi.`,
      resi,
      expedisi: kode,
      orderId: orderId ?? undefined,
      trackingNumber: tracking ?? undefined,
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
        expedisi: kode,
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
      ringkasan: [] as BarisEkspedisi[],
      submits: [] as BatchSubmit[],
      verifikasi: await statusVerifikasi(dateOnly(iso)),
      belumSubmit: 0,
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

  const [rows, total, ringkasan, submits, verifikasi] = await Promise.all([
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
    prisma.scanItem.count({
      where: { sessionId: sesi.id, status: { not: 'VOID' }, verifyState: { not: 'INVALID' } },
    }),
    ringkasanEkspedisi(sesi.id),
    daftarSubmit(sesi.id),
    statusVerifikasi(dateOnly(iso)),
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
    ringkasan,
    submits,
    verifikasi,
    belumSubmit: ringkasan.reduce((n: number, r: BarisEkspedisi) => n + r.jumlah, 0),
    totalHariIni: await countAwaitingToday(iso),
    tanggal: iso,
  };
}

/**
 * Resi yang menunggu diproses hari ini.
 *
 * Yang sudah divonis TIDAK ADA di OCS tidak ikut dihitung — itu seluruh maksud
 * pemeriksaan latar belakang: angka di layar harus sama dengan barang fisik.
 */
export function countAwaitingToday(iso = todayISO()) {
  return prisma.scanItem.count({
    where: { scanDate: dateOnly(iso), status: 'AWAITING_PICKUP', verifyState: { not: 'INVALID' } },
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

/* ==================================================================
 * SUBMIT SCAN 1 — serah terima per jasa kirim
 *
 * Submit di sini TIDAK menyentuh OCS dan tidak membentuk basket. Ia hanya
 * mengunci hitungan: "sekian resi ekspedisi X sudah diserahterimakan jam
 * sekian oleh siapa". Basket final tetap dibentuk di Scan 2 seperti biasa.
 *
 * Resi yang sudah disubmit hilang dari panel total (sudah diserahkan) tapi
 * datanya utuh dan tetap muncul di daftar batch maupun laporan.
 * ================================================================== */

export type BarisEkspedisi = {
  expedisiId: number | null;
  code: string;
  name: string;
  jumlah: number;
};

export type BatchSubmit = {
  id: number;
  code: string;
  expedisiCode: string;
  jumlah: number;
  jam: string;
  oleh: string;
};

const BELUM_DIKENALI = 'BELUM DIKENALI';

/** Total per ekspedisi untuk batch yang sedang berjalan (yang belum disubmit). */
export async function ringkasanEkspedisi(sessionId: number): Promise<BarisEkspedisi[]> {
  type Baris = { expedisiId: number | null; code: string | null; name: string | null; jumlah: bigint | number };
  const rows = (await prisma.$queryRaw`
    SELECT e.id AS expedisiId, e.code AS code, e.name AS name, COUNT(*) AS jumlah
    FROM ScanItem i
    LEFT JOIN Expedisi e ON e.id = i.expedisiId
    WHERE i.sessionId = ${sessionId} AND i.submitId IS NULL
      AND i.status <> 'VOID' AND i.verifyState <> 'INVALID'
    GROUP BY e.id, e.code, e.name
    ORDER BY COUNT(*) DESC
  `) as Baris[];
  return rows.map((r) => ({
    expedisiId: r.expedisiId === null ? null : Number(r.expedisiId),
    code: r.code ?? BELUM_DIKENALI,
    name: r.name ?? 'Ekspedisi belum teridentifikasi',
    jumlah: Number(r.jumlah),
  }));
}

/** Batch serah terima yang sudah disubmit pada sesi ini. */
export async function daftarSubmit(sessionId: number): Promise<BatchSubmit[]> {
  type Row = {
    id: number;
    code: string;
    expedisiCode: string;
    jumlah: number;
    createdAt: Date;
    submittedById: number;
  };
  const rows = (await prisma.scanSubmit.findMany({
    where: { sessionId },
    orderBy: { id: 'desc' },
    take: 50,
  })) as Row[];
  if (!rows.length) return [];

  const nama = new Map<number, string>(
    (
      (await prisma.user.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.submittedById))] } },
        select: { id: true, name: true },
      })) as { id: number; name: string }[]
    ).map((u) => [u.id, u.name]),
  );

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    expedisiCode: r.expedisiCode,
    jumlah: r.jumlah,
    jam: r.createdAt.toISOString(),
    oleh: nama.get(r.submittedById) ?? '—',
  }));
}

/**
 * Submit satu ekspedisi. expedisiId null = kelompok "BELUM DIKENALI".
 *
 * Penguncian dilakukan dengan updateMany bersyarat submitId: null, jadi kalau
 * dua operator menekan Submit bersamaan yang kedua hanya mengunci sisanya —
 * tidak ada resi yang terhitung dua kali di dua batch berbeda.
 */
export async function submitEkspedisi(
  user: SessionUser,
  sessionId: number,
  expedisiId: number | null,
): Promise<{ code: string; expedisiCode: string; jumlah: number } | null> {
  const iso = todayISO();

  const ekspedisi = expedisiId
    ? ((await prisma.expedisi.findUnique({
        where: { id: expedisiId },
        select: { code: true },
      })) as { code: string } | null)
    : null;
  if (expedisiId && !ekspedisi) throw new ApiError('Ekspedisi tidak ditemukan.', 404);
  const expedisiCode = ekspedisi?.code ?? BELUM_DIKENALI;

  const seq = await nextSeq(`submit:${iso}`);
  const code = `SRH-${compactDate(iso)}-${String(seq).padStart(3, '0')}`;

  const submit = await prisma.scanSubmit.create({
    data: {
      code,
      sessionId,
      expedisiId,
      expedisiCode,
      jumlah: 0,
      date: dateOnly(iso),
      seq,
      submittedById: user.id,
    },
  });

  const { count } = await prisma.scanItem.updateMany({
    where: {
      sessionId,
      submitId: null,
      status: { not: 'VOID' },
      verifyState: { not: 'INVALID' },
      expedisiId: expedisiId ?? null,
    },
    data: { submitId: submit.id },
  });

  if (count === 0) {
    // Tidak ada yang terkunci — batalkan barisnya supaya tidak ada batch kosong.
    await prisma.scanSubmit.delete({ where: { id: submit.id } });
    return null;
  }

  await prisma.scanSubmit.update({ where: { id: submit.id }, data: { jumlah: count } });
  await writeAudit(user.id, 'SUBMIT_SCAN1', 'ScanSubmit', submit.id, { expedisiCode, jumlah: count });

  return { code, expedisiCode, jumlah: count };
}

/** Submit seluruh ekspedisi yang masih punya resi belum diserahterimakan. */
export async function submitSemua(
  user: SessionUser,
  sessionId: number,
): Promise<{ code: string; expedisiCode: string; jumlah: number }[]> {
  const ringkasan = await ringkasanEkspedisi(sessionId);
  const hasil: { code: string; expedisiCode: string; jumlah: number }[] = [];
  for (const baris of ringkasan) {
    const satu = await submitEkspedisi(user, sessionId, baris.expedisiId);
    if (satu) hasil.push(satu);
  }
  return hasil;
}
