/**
 * Buat / perbarui 10 operator manifest beserta akun OCS-nya.
 *
 *   node --env-file=.env tools/import-users.mjs            # pratinjau
 *   node --env-file=.env tools/import-users.mjs --ya       # tulis ke database
 *   node --env-file=.env tools/import-users.mjs --ya --reset-password
 *
 * Aman dijalankan berulang (upsert per username). Tanpa --reset-password,
 * pengguna yang sudah ada TIDAK diubah passwordnya — hanya nama, role, dan
 * akun OCS-nya yang disegarkan.
 *
 * Password OCS dienkripsi AES-256-GCM dengan kunci turunan SESSION_SECRET,
 * sama persis dengan src/lib/crypto.ts. Kalau SESSION_SECRET di server berbeda
 * dengan yang ada di .env ini, password OCS tidak akan bisa dibuka di sana —
 * jalankan skrip ini memakai .env yang SESSION_SECRET-nya sama dengan produksi.
 */
import { PrismaClient } from '@prisma/client';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const jalankan = args.includes('--ya');
const resetPassword = args.includes('--reset-password');

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.error('SESSION_SECRET belum diisi di .env — password OCS tidak bisa dienkripsi.');
  process.exit(1);
}

const N = 16384;

function hashPassword(plain) {
  const salt = randomBytes(16);
  const key = scryptSync(plain.normalize('NFKC'), salt, 32, { N });
  return `scrypt$${N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function encryptSecret(plain) {
  const kunci = scryptSync(SESSION_SECRET, 'ieg-ocs-credential', 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', kunci, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

const COMPANY_DB = process.env.OCS_COMPANYDB || 'EJI_WMS';

const DAFTAR = Array.from({ length: 10 }, (_, i) => {
  const nomor = String(i + 1).padStart(3, '0');
  return {
    username: `MANIFEST${nomor}`,
    name: `USER ${i + 1}`,
    role: 'OPERATOR',
    password: '12345',
    ocsUsername: `MANIFEST${nomor}`,
    ocsPassword: '12345',
  };
});

console.log('');
console.log(`Database  : ${(process.env.DATABASE_URL || '').split('/').pop()?.split('?')[0]}`);
console.log(`Company DB: ${COMPANY_DB}`);
console.log('');
console.table(
  DAFTAR.map((u) => ({
    username: u.username.toLowerCase(),
    nama: u.name,
    role: u.role,
    'akun OCS': u.ocsUsername,
  })),
);

if (!jalankan) {
  console.log('');
  console.log('Ini baru pratinjau. Untuk menulis ke database:');
  console.log('  npm run users:import -- --ya');
  console.log('  npm run users:import -- --ya --reset-password   (sekalian setel ulang password aplikasi)');
  console.log('');
  await prisma.$disconnect();
  process.exit(0);
}

console.log('');
let dibuat = 0;
let diperbarui = 0;

for (const u of DAFTAR) {
  const username = u.username.toLowerCase();
  const ada = await prisma.user.findUnique({ where: { username } });

  const akunOcs = {
    ocsUsername: u.ocsUsername,
    ocsUserCode: u.ocsUsername,
    ocsPasswordEnc: encryptSecret(u.ocsPassword),
    ocsCompanyDb: COMPANY_DB,
  };

  if (!ada) {
    await prisma.user.create({
      data: {
        username,
        name: u.name,
        role: u.role,
        active: true,
        // Password sudah ditentukan sendiri oleh admin, jadi tidak dipaksa ganti.
        mustChangePassword: false,
        passwordHash: hashPassword(u.password),
        ...akunOcs,
      },
    });
    dibuat += 1;
    console.log(`  BARU     ${username.padEnd(12)} ${u.name.padEnd(9)} OCS ${u.ocsUsername}`);
  } else {
    await prisma.user.update({
      where: { id: ada.id },
      data: {
        name: u.name,
        role: u.role,
        active: true,
        ...akunOcs,
        ...(resetPassword ? { passwordHash: hashPassword(u.password), mustChangePassword: false } : {}),
      },
    });
    diperbarui += 1;
    console.log(
      `  DIPERBARUI ${username.padEnd(10)} ${u.name.padEnd(9)} OCS ${u.ocsUsername}` +
        (resetPassword ? ' (password direset)' : ' (password lama dipertahankan)'),
    );
  }
}

const total = await prisma.user.count();
console.log('');
console.log(`SELESAI. ${dibuat} dibuat, ${diperbarui} diperbarui. Total pengguna sekarang: ${total}.`);
console.log('');
console.log('Login aplikasi : username manifest001 … manifest010, password 12345');
console.log('Akun OCS       : MANIFEST001 … MANIFEST010 (password tersimpan terenkripsi)');
console.log('Verifikasi     : Admin > Pengguna > Akun OCS > "Tes login ke OCS"');
console.log('');

await prisma.$disconnect();
