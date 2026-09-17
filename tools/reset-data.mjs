/**
 * Kosongkan SELURUH data transaksi hasil uji coba di TiDB.
 *
 * YANG DIHAPUS : scan resi, sesi scan, basket, dokumen manifest, kandidat
 *                manifest, antrean outbox, nomor urut (counter), audit log.
 * YANG DISIMPAN: pengguna (beserta akun OCS-nya), master ekspedisi, setelan.
 *
 * Tabel dikosongkan dari anak ke induk supaya tidak ada baris yatim.
 * Nomor urut basket ikut dihapus, jadi penomoran mulai dari 001 lagi.
 *
 *   node --env-file=.env tools/reset-data.mjs              # hitung saja, tidak menghapus
 *   node --env-file=.env tools/reset-data.mjs --ya         # HAPUS
 *   node --env-file=.env tools/reset-data.mjs --ya --audit # sekalian hapus audit log
 *   node --env-file=.env tools/reset-data.mjs --ya --ekspedisi  # sekalian hapus master ekspedisi
 *
 * Setelah reset, jalankan `npm run db:seed` bila master ekspedisi ikut dihapus.
 */
import { PrismaClient } from '@prisma/client';
import readline from 'node:readline/promises';

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const jalankan = args.includes('--ya');
const ikutAudit = args.includes('--audit');
const ikutEkspedisi = args.includes('--ekspedisi');

const db = (process.env.DATABASE_URL || '').split('/').pop()?.split('?')[0] || '(tidak diketahui)';

async function hitung() {
  const [
    manifestScan,
    manifestCandidate,
    scanItem,
    manifestDoc,
    basket,
    scanSession,
    outbox,
    counter,
    audit,
    user,
    expedisi,
  ] = await Promise.all([
    prisma.manifestScan.count(),
    prisma.manifestCandidate.count(),
    prisma.scanItem.count(),
    prisma.manifestDoc.count(),
    prisma.basket.count(),
    prisma.scanSession.count(),
    prisma.ocsOutbox.count(),
    prisma.counter.count(),
    prisma.auditLog.count(),
    prisma.user.count(),
    prisma.expedisi.count(),
  ]);
  return {
    manifestScan,
    manifestCandidate,
    scanItem,
    manifestDoc,
    basket,
    scanSession,
    outbox,
    counter,
    audit,
    user,
    expedisi,
  };
}

const sebelum = await hitung();

console.log('');
console.log(`Database : ${db}`);
console.log('');
console.log('AKAN DIHAPUS');
console.log(`  scan resi (scan_items)        : ${sebelum.scanItem}`);
console.log(`  baris scan manifest           : ${sebelum.manifestScan}`);
console.log(`  kandidat manifest (cache OCS) : ${sebelum.manifestCandidate}`);
console.log(`  dokumen manifest              : ${sebelum.manifestDoc}`);
console.log(`  basket                        : ${sebelum.basket}`);
console.log(`  sesi scan tahap 1             : ${sebelum.scanSession}`);
console.log(`  antrean outbox ke OCS         : ${sebelum.outbox}`);
console.log(`  nomor urut (counter)          : ${sebelum.counter}`);
console.log(`  audit log                     : ${ikutAudit ? sebelum.audit : `${sebelum.audit} (DIPERTAHANKAN, pakai --audit untuk hapus)`}`);
console.log('');
console.log('AKAN DISIMPAN');
console.log(`  pengguna                      : ${sebelum.user}`);
console.log(`  master ekspedisi              : ${ikutEkspedisi ? `${sebelum.expedisi} (IKUT DIHAPUS karena --ekspedisi)` : sebelum.expedisi}`);
console.log('');

if (!jalankan) {
  console.log('Ini baru pratinjau. Tambahkan --ya untuk benar-benar menghapus:');
  console.log('  npm run db:reset-data -- --ya');
  console.log('');
  await prisma.$disconnect();
  process.exit(0);
}

// Konfirmasi ketik ulang nama database — penghapusan ini tidak bisa dibatalkan.
if (process.stdin.isTTY) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const jawab = await rl.question(`Ketik nama database "${db}" untuk melanjutkan: `);
  rl.close();
  if (jawab.trim() !== db) {
    console.log('Dibatalkan — tidak ada yang dihapus.');
    await prisma.$disconnect();
    process.exit(1);
  }
}

console.log('');
const langkah = [
  ['baris scan manifest', () => prisma.manifestScan.deleteMany({})],
  ['kandidat manifest', () => prisma.manifestCandidate.deleteMany({})],
  ['scan resi', () => prisma.scanItem.deleteMany({})],
  ['dokumen manifest', () => prisma.manifestDoc.deleteMany({})],
  ['basket', () => prisma.basket.deleteMany({})],
  ['sesi scan tahap 1', () => prisma.scanSession.deleteMany({})],
  ['antrean outbox', () => prisma.ocsOutbox.deleteMany({})],
  ['nomor urut', () => prisma.counter.deleteMany({})],
];
if (ikutAudit) langkah.push(['audit log', () => prisma.auditLog.deleteMany({})]);
if (ikutEkspedisi) langkah.push(['master ekspedisi', () => prisma.expedisi.deleteMany({})]);

for (const [nama, aksi] of langkah) {
  const { count } = await aksi();
  console.log(`  ${String(count).padStart(7)} ${nama} dihapus`);
}

const sesudah = await hitung();
console.log('');
console.log('SELESAI. Sisa isi database:');
console.log(`  pengguna         : ${sesudah.user}`);
console.log(`  master ekspedisi : ${sesudah.expedisi}`);
console.log(`  scan resi        : ${sesudah.scanItem}`);
console.log(`  basket           : ${sesudah.basket}`);
console.log(`  dokumen manifest : ${sesudah.manifestDoc}`);
console.log('');
if (sesudah.expedisi === 0) console.log('Master ekspedisi kosong — jalankan `npm run db:seed` sebelum dipakai lagi.');
console.log('Penomoran basket kembali mulai dari 001.');
console.log('');

await prisma.$disconnect();
