import { PrismaClient } from '@prisma/client';
import { createHmac, randomBytes, scryptSync } from 'node:crypto';

const prisma = new PrismaClient();

function hashPassword(plain) {
  const N = 16384;
  const salt = randomBytes(16);
  const key = scryptSync(plain.normalize('NFKC'), salt, 32, { N });
  return `scrypt$${N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/**
 * Prefix di bawah ini hanya TEBAKAN untuk scan tahap 1 dan bisa diubah kapan saja
 * di menu Admin > Ekspedisi. Ekspedisi yang salah tebak otomatis dikoreksi saat
 * scan tahap 2 (mengikuti ekspedisi basket), jadi tidak ada risiko data salah.
 */
const EKSPEDISI = [
  { code: 'JNT', name: 'J&T Express', ocsShipper: 'J&T', prefixes: 'JP,JX,JD,JT', sortOrder: 1 },
  { code: 'SPX', name: 'Shopee Express', ocsShipper: 'SPX', prefixes: 'SPX,SPXID', sortOrder: 2 },
  { code: 'JNE', name: 'JNE', ocsShipper: 'JNE', prefixes: 'JNE,TLJ', sortOrder: 3 },
  { code: 'SICEPAT', name: 'SiCepat', ocsShipper: 'SiCepat', prefixes: '00,000', sortOrder: 4 },
  { code: 'ANTERAJA', name: 'AnterAja', ocsShipper: 'Anteraja', prefixes: '10,ANT', sortOrder: 5 },
  { code: 'NINJA', name: 'Ninja Xpress', ocsShipper: 'NinjaVan', prefixes: 'NV,NLID', sortOrder: 6 },
  { code: 'LEX', name: 'Lazada Express', ocsShipper: 'LEX', prefixes: 'LEX,LZD', sortOrder: 7 },
  { code: 'IDX', name: 'ID Express', ocsShipper: 'IDX', prefixes: 'IDX,TKP', sortOrder: 8 },
  { code: 'GTL', name: 'GTL', ocsShipper: 'GTL', prefixes: 'GTL', sortOrder: 9 },
  { code: 'BLITZ', name: 'Blitz Express', ocsShipper: 'Blitz', prefixes: 'BLZ', sortOrder: 10 },
  { code: 'GOJEK', name: 'Gojek Instant', ocsShipper: 'Gojek', prefixes: '', sortOrder: 11 },
  { code: 'GRAB', name: 'Grab Instant', ocsShipper: 'Grab', prefixes: '', sortOrder: 12 },
];

async function main() {
  for (const e of EKSPEDISI) {
    await prisma.expedisi.upsert({
      where: { code: e.code },
      update: { name: e.name, ocsShipper: e.ocsShipper, sortOrder: e.sortOrder },
      create: e,
    });
  }
  console.log(`Ekspedisi siap: ${EKSPEDISI.length} baris.`);

  const adminAda = await prisma.user.findUnique({ where: { username: 'admin' } });
  if (adminAda) {
    console.log('User admin sudah ada — dilewati.');
  } else {
    const password = process.env.SEED_ADMIN_PASSWORD || 'admin123';
    await prisma.user.create({
      data: {
        username: 'admin',
        name: 'Administrator',
        role: 'ADMIN',
        passwordHash: hashPassword(password),
        mustChangePassword: true,
      },
    });
    console.log('');
    console.log('  User admin dibuat.');
    console.log(`  username: admin`);
    console.log(`  password: ${password}`);
    console.log('  (wajib diganti saat login pertama)');
    console.log('');
  }

  void createHmac;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
