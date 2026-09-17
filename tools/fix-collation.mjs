/**
 * TiDB: collation bawaan cluster bisa utf8mb4_bin (PEKA huruf besar-kecil).
 * Skrip ini MEMERIKSA dulu, baru mengubah kolom teks jadi utf8mb4_unicode_ci.
 * JANGAN memaksa convert kolom yang punya index -> error 8200.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const dbName = (process.env.DATABASE_URL || '').split('/').pop()?.split('?')[0] || 'scan_manifest';

const rows = await prisma.$queryRawUnsafe(
  `SELECT TABLE_NAME, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?`,
  dbName,
);

console.log(`Database: ${dbName}`);
for (const r of rows) console.log(` - ${r.TABLE_NAME}: ${r.TABLE_COLLATION}`);

const perluUbah = rows.filter((r) => String(r.TABLE_COLLATION || '').endsWith('_bin'));
if (!perluUbah.length) {
  console.log('\nSemua tabel sudah case-insensitive. Tidak ada yang diubah.');
} else {
  console.log(`\n${perluUbah.length} tabel masih *_bin. Menjalankan ALTER ...`);
  for (const r of perluUbah) {
    try {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE \`${r.TABLE_NAME}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      );
      console.log(`   OK  ${r.TABLE_NAME}`);
    } catch (e) {
      console.log(`   LEWAT ${r.TABLE_NAME}: ${e.message.split('\n')[0]}`);
    }
  }
}
await prisma.$disconnect();
