/**
 * Atur / periksa password pengguna langsung dari terminal.
 * Dipakai kalau operator terkunci, atau untuk memastikan masalahnya
 * ada di password yang tersimpan atau di kolom isian browser.
 *
 *   node --env-file=.env tools/set-password.mjs admin RahasiaBaru1
 *   node --env-file=.env tools/set-password.mjs admin RahasiaBaru1 --paksa-ganti
 *   node --env-file=.env tools/set-password.mjs --cek admin RahasiaBaru1
 */
import { PrismaClient } from '@prisma/client';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 16384;

function hashPassword(plain) {
  const salt = randomBytes(16);
  const key = scryptSync(plain.normalize('NFKC'), salt, 32, { N });
  return `scrypt$${N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function verifyPassword(plain, stored) {
  try {
    const [scheme, nRaw, saltRaw, keyRaw] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltRaw, 'base64');
    const expected = Buffer.from(keyRaw, 'base64');
    const got = scryptSync(plain.normalize('NFKC'), salt, expected.length, { N: Number(nRaw) || N });
    return got.length === expected.length && timingSafeEqual(got, expected);
  } catch {
    return false;
  }
}

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const cek = args[0] === '--cek';
const list = args[0] === '--daftar';
const rest = cek ? args.slice(1) : args;
const username = (rest[0] || '').toLowerCase();
const password = rest[1];
const paksaGanti = rest.includes('--paksa-ganti');

try {
  if (list) {
    const users = await prisma.user.findMany({
      orderBy: { username: 'asc' },
      select: { id: true, username: true, name: true, role: true, active: true, mustChangePassword: true },
    });
    console.table(users);
    process.exit(0);
  }

  if (!username || !password) {
    console.error('Pemakaian:');
    console.error('  node --env-file=.env tools/set-password.mjs <username> <password baru> [--paksa-ganti]');
    console.error('  node --env-file=.env tools/set-password.mjs --cek <username> <password>');
    console.error('  node --env-file=.env tools/set-password.mjs --daftar');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    console.error(`User "${username}" tidak ada. Lihat daftarnya: --daftar`);
    process.exit(1);
  }

  if (cek) {
    const cocok = verifyPassword(password, user.passwordHash);
    console.log(`Password untuk ${username}: ${cocok ? 'COCOK' : 'TIDAK COCOK'}`);
    console.log(`  aktif              : ${user.active}`);
    console.log(`  wajib ganti sandi  : ${user.mustChangePassword}`);
    console.log(`  panjang hash       : ${user.passwordHash.length} karakter (harusnya 82)`);
    process.exit(cocok ? 0 : 2);
  }

  if (password.length < 6) {
    console.error('Password baru minimal 6 karakter.');
    process.exit(1);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hashPassword(password), mustChangePassword: paksaGanti, active: true },
  });
  console.log(`Password ${username} diperbarui.`);
  console.log(`  wajib ganti saat login berikutnya: ${paksaGanti}`);
} finally {
  await prisma.$disconnect();
}
