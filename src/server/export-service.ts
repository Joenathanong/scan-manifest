import ExcelJS from 'exceljs';
import { prisma } from '@/lib/db';
import { dateOnly, fmtDate, fmtDateTime, isoFromDate } from '@/lib/date';
import { cleanResi } from '@/lib/resi';
import type { Prisma } from '@prisma/client';
import { cariAnomali, LABEL_ANOMALI } from './anomali-service';

export type ExportFilter = {
  dari: string;
  sampai: string;
  status?: string | null;
  expedisiId?: number | null;
  cari?: string | null;
};

const LABEL_STATUS: Record<string, string> = {
  AWAITING_PICKUP: 'Awaiting to shipment',
  PICKUP: 'Awaiting to pickup',
  VOID: 'Dibatalkan',
};

const LABEL_OCS: Record<string, string> = {
  NONE: '—',
  PENDING: 'Menunggu kirim',
  SENT: 'Terkirim',
  FAILED: 'Gagal',
  INVALID: 'Ditolak OCS',
};

const HEAD_BG = 'FFEEF2FF';
const HEAD_FG = 'FF4338CA';
const BORDER = 'FFE5E7EF';

function styleHeader(sheet: ExcelJS.Worksheet, lebar: number[]) {
  const head = sheet.getRow(1);
  head.height = 22;
  head.eachCell((cell) => {
    cell.font = { bold: true, size: 10, color: { argb: HEAD_FG }, name: 'Calibri' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_BG } };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFA8B2BD' } } };
  });
  lebar.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: lebar.length },
  };
}

function styleBody(sheet: ExcelJS.Worksheet) {
  sheet.eachRow((row, nomor) => {
    if (nomor === 1) return;
    row.height = 16;
    row.eachCell((cell) => {
      cell.font = { size: 10, name: 'Calibri' };
      cell.border = { bottom: { style: 'hair', color: { argb: BORDER } } };
      cell.alignment = { vertical: 'middle' };
    });
  });
}

/** Satu workbook: Resi (detail), Ringkasan, Basket, plus Filter yang dipakai. */
export async function buildScanWorkbook(filter: ExportFilter) {
  const { dari, sampai, status, expedisiId, cari } = filter;

  const where: Prisma.ScanItemWhereInput = cari
    ? { resi: { contains: cleanResi(cari) } }
    : {
        scanDate: { gte: dateOnly(dari), lte: dateOnly(sampai) },
        ...(status ? { status: status as Prisma.ScanItemWhereInput['status'] } : {}),
        ...(expedisiId ? { expedisiId } : {}),
      };

  type ItemRow = {
    id: number;
    resi: string;
    status: string;
    scanDate: Date;
    scan1At: Date;
    scan2At: Date | null;
    ocsState: string;
    ocsOrderId: string | null;
    ocsTracking: string | null;
    ocsReason: string | null;
    voidReason: string | null;
    expedisi: { code: string; name: string } | null;
    basket: { code: string } | null;
    session: { code: string } | null;
    scan1By: { name: string };
    scan2By: { name: string } | null;
  };

  const items = (await prisma.scanItem.findMany({
    where,
    orderBy: { id: 'asc' },
    take: 50000,
    select: {
      id: true,
      resi: true,
      status: true,
      scanDate: true,
      scan1At: true,
      scan2At: true,
      ocsState: true,
      ocsOrderId: true,
      ocsTracking: true,
      ocsReason: true,
      voidReason: true,
      expedisi: { select: { code: true, name: true } },
      basket: { select: { code: true } },
      session: { select: { code: true } },
      scan1By: { select: { name: true } },
      scan2By: { select: { name: true } },
    },
  })) as ItemRow[];

  type BasketRow = {
    code: string;
    areaId: string;
    status: string;
    date: Date;
    createdAt: Date;
    closedAt: Date | null;
    expedisi: { code: string; name: string };
    createdBy: { name: string };
    _count: { items: number };
    docs: { ocsDocNo: string | null; totalValid: number; totalNotValid: number; status: string; lastError: string | null }[];
  };

  const baskets = (await prisma.basket.findMany({
    where: { date: { gte: dateOnly(dari), lte: dateOnly(sampai) }, ...(expedisiId ? { expedisiId } : {}) },
    orderBy: { id: 'asc' },
    take: 5000,
    select: {
      code: true,
      areaId: true,
      status: true,
      date: true,
      createdAt: true,
      closedAt: true,
      expedisi: { select: { code: true, name: true } },
      createdBy: { select: { name: true } },
      _count: { select: { items: true } },
      docs: {
        orderBy: { id: 'desc' },
        take: 1,
        select: { ocsDocNo: true, totalValid: true, totalNotValid: true, status: true, lastError: true },
      },
    },
  })) as BasketRow[];

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Scan Manifest IEG';
  wb.created = new Date();

  /* ---------------- Sheet 1: Resi ---------------- */
  const sResi = wb.addWorksheet('Resi', { views: [{ state: 'frozen', ySplit: 1 }] });
  sResi.addRow([
    'No',
    'Resi',
    'Ekspedisi',
    'Status',
    'Basket',
    'Tanggal',
    'Scan 1',
    'Operator Scan 1',
    'Scan 2',
    'Operator Scan 2',
    'Status OCS',
    'Order ID OCS',
    'Tracking OCS',
    'Catatan',
    'Sesi Scan 1',
  ]);

  items.forEach((it, i) => {
    sResi.addRow([
      i + 1,
      it.resi,
      it.expedisi?.code ?? 'BELUM DIKENALI',
      LABEL_STATUS[it.status] ?? it.status,
      it.basket?.code ?? '',
      fmtDate(it.scanDate),
      fmtDateTime(it.scan1At),
      it.scan1By.name,
      it.scan2At ? fmtDateTime(it.scan2At) : '',
      it.scan2By?.name ?? '',
      LABEL_OCS[it.ocsState] ?? it.ocsState,
      it.ocsOrderId ?? '',
      it.ocsTracking ?? '',
      it.ocsReason ?? it.voidReason ?? '',
      it.session?.code ?? '',
    ]);
  });
  styleHeader(sResi, [6, 24, 16, 20, 22, 14, 20, 20, 20, 20, 16, 20, 22, 30, 16]);
  styleBody(sResi);
  sResi.getColumn(1).alignment = { horizontal: 'right' };
  sResi.getColumn(2).font = { name: 'Consolas', size: 10 };
  sResi.getColumn(5).font = { name: 'Consolas', size: 10 };

  /* ---------------- Sheet 2: Ringkasan ---------------- */
  const sRingkas = wb.addWorksheet('Ringkasan');
  sRingkas.addRow(['Tanggal', 'Awaiting to shipment', 'Awaiting to pickup', 'Dibatalkan', 'Total']);

  const perTanggal = new Map<string, { awaiting: number; pickup: number; void: number }>();
  const perExpedisi = new Map<string, { awaiting: number; pickup: number; void: number }>();
  for (const it of items) {
    const iso = isoFromDate(it.scanDate);
    const t = perTanggal.get(iso) ?? { awaiting: 0, pickup: 0, void: 0 };
    const kode = it.expedisi?.code ?? 'BELUM DIKENALI';
    const e = perExpedisi.get(kode) ?? { awaiting: 0, pickup: 0, void: 0 };
    const kolom = it.status === 'AWAITING_PICKUP' ? 'awaiting' : it.status === 'PICKUP' ? 'pickup' : 'void';
    t[kolom] += 1;
    e[kolom] += 1;
    perTanggal.set(iso, t);
    perExpedisi.set(kode, e);
  }

  [...perTanggal.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([iso, v]) =>
      sRingkas.addRow([fmtDate(`${iso}T00:00:00.000Z`), v.awaiting, v.pickup, v.void, v.awaiting + v.pickup + v.void]),
    );

  sRingkas.addRow([]);
  const barisJudul2 = sRingkas.addRow(['Ekspedisi', 'Awaiting to shipment', 'Awaiting to pickup', 'Dibatalkan', 'Total']);
  barisJudul2.eachCell((cell) => {
    cell.font = { bold: true, size: 10, color: { argb: HEAD_FG } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_BG } };
  });
  [...perExpedisi.entries()]
    .sort((a, b) => b[1].awaiting - a[1].awaiting)
    .forEach(([kode, v]) => sRingkas.addRow([kode, v.awaiting, v.pickup, v.void, v.awaiting + v.pickup + v.void]));

  styleHeader(sRingkas, [26, 22, 14, 14, 12]);
  sRingkas.autoFilter = undefined as unknown as ExcelJS.AutoFilter;

  /* ---------------- Sheet 3: Basket ---------------- */
  const sBasket = wb.addWorksheet('Basket');
  sBasket.addRow([
    'Kode Basket',
    'Ekspedisi',
    'Area',
    'Tanggal',
    'Status',
    'Jumlah Resi',
    'Dokumen OCS',
    'Valid',
    'Ditolak',
    'Status Dokumen',
    'Dibuat',
    'Ditutup',
    'Dibuat Oleh',
    'Masalah Terakhir',
  ]);
  baskets.forEach((b) => {
    const doc = b.docs[0];
    sBasket.addRow([
      b.code,
      b.expedisi.code,
      b.areaId,
      fmtDate(b.date),
      b.status,
      b._count.items,
      doc?.ocsDocNo ?? '',
      doc?.totalValid ?? 0,
      doc?.totalNotValid ?? 0,
      doc?.status ?? '',
      fmtDateTime(b.createdAt),
      b.closedAt ? fmtDateTime(b.closedAt) : '',
      b.createdBy.name,
      doc?.lastError ?? '',
    ]);
  });
  styleHeader(sBasket, [24, 14, 14, 14, 16, 13, 18, 10, 10, 18, 20, 20, 20, 40]);
  styleBody(sBasket);
  sBasket.getColumn(1).font = { name: 'Consolas', size: 10 };

  /* ---------------- Sheet 4: Menggantung ---------------- */
  const anomali = await cariAnomali({ dari, sampai, expedisiId: expedisiId ?? null, take: 5000 });
  const sGantung = wb.addWorksheet('Menggantung');
  sGantung.addRow(['Jenis', 'Resi', 'Ekspedisi', 'Basket', 'Waktu', 'Umur (jam)', 'Operator', 'Keterangan']);
  anomali.baris.forEach((b) => {
    sGantung.addRow([
      LABEL_ANOMALI[b.jenis],
      b.resi,
      b.ekspedisi ?? '',
      b.basket ?? '',
      fmtDateTime(b.waktu),
      b.umurJam,
      b.operator,
      b.keterangan,
    ]);
  });
  styleHeader(sGantung, [24, 24, 14, 22, 20, 12, 20, 46]);
  styleBody(sGantung);
  sGantung.getColumn(2).font = { name: 'Consolas', size: 10 };
  sGantung.getColumn(6).alignment = { horizontal: 'right' };

  /* ---------------- Sheet 5: Filter ---------------- */
  const sInfo = wb.addWorksheet('Filter');
  sInfo.addRow(['Keterangan', 'Nilai']);
  sInfo.addRow(['Dibuat', fmtDateTime(new Date())]);
  sInfo.addRow(['Dari tanggal', cari ? '(diabaikan, memakai pencarian resi)' : fmtDate(`${dari}T00:00:00.000Z`)]);
  sInfo.addRow(['Sampai tanggal', cari ? '(diabaikan, memakai pencarian resi)' : fmtDate(`${sampai}T00:00:00.000Z`)]);
  sInfo.addRow(['Status', status ? LABEL_STATUS[status] ?? status : 'Semua']);
  sInfo.addRow(['Ekspedisi', expedisiId ? String(expedisiId) : 'Semua']);
  sInfo.addRow(['Pencarian resi', cari ?? '—']);
  sInfo.addRow(['Jumlah baris resi', items.length]);
  sInfo.addRow(['Jumlah basket', baskets.length]);
  sInfo.addRow(['Resi menggantung', anomali.jumlah.total]);
  sInfo.addRow(['  scan 1 tanpa scan 2', anomali.jumlah.scan1TanpaScan2]);
  sInfo.addRow(['  scan 2 tanpa scan 1', anomali.jumlah.scan2TanpaScan1]);
  sInfo.addRow(['  belum sampai OCS', anomali.jumlah.belumSampaiOcs]);
  sInfo.addRow(['  basket belum disubmit', anomali.jumlah.basketMenggantung]);
  sInfo.addRow(['Batas "menggantung"', `${anomali.batasJam} jam`]);
  styleHeader(sInfo, [26, 46]);
  styleBody(sInfo);
  sInfo.autoFilter = undefined as unknown as ExcelJS.AutoFilter;

  const buffer = await wb.xlsx.writeBuffer();
  return { buffer, jumlahResi: items.length, jumlahBasket: baskets.length, jumlahGantung: anomali.jumlah.total };
}

export function namaBerkas(filter: ExportFilter) {
  if (filter.cari) return `scan-manifest_cari-${cleanResi(filter.cari)}.xlsx`;
  const sama = filter.dari === filter.sampai;
  const rentang = sama ? filter.dari : `${filter.dari}_sd_${filter.sampai}`;
  const status = filter.status ? `_${filter.status.toLowerCase()}` : '';
  return `scan-manifest_${rentang}${status}.xlsx`;
}
