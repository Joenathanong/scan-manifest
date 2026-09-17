import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

const N = 16384;
const KEYLEN = 32;

/** Hash password: scrypt bawaan node — tanpa bcrypt/argon2 (dependensi native gagal di Vercel). */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(plain.normalize('NFKC'), salt, KEYLEN, { N });
  return `scrypt$${N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  try {
    const [scheme, nRaw, saltRaw, keyRaw] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltRaw, 'base64');
    const expected = Buffer.from(keyRaw, 'base64');
    const got = scryptSync(plain.normalize('NFKC'), salt, expected.length, { N: Number(nRaw) || N });
    return got.length === expected.length && timingSafeEqual(got, expected);
  } catch {
    return false;
  }
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET belum diisi di environment');
  return s;
}

/** Token sesi stateless: base64url(payload).hmac */
export function signSession(payload: { uid: number; exp: number }): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function readSession(token: string | undefined): { uid: number; exp: number } | null {
  if (!token) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expect = createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as { uid: number; exp: number };
    if (!payload || typeof payload.uid !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ';
const DIGITS = '23456789';

/** Password sementara: 4 huruf + 4 angka, tanpa I/L/O/U/0/1 (akan dibacakan ke operator). */
export function tempPassword(): string {
  const pick = (src: string, n: number) =>
    Array.from({ length: n }, () => src[randomBytes(1)[0] % src.length]).join('');
  return pick(ALPHABET, 4) + pick(DIGITS, 4);
}

/* =========================================================================
   Rahasia yang HARUS bisa dibaca kembali (password akun OCS milik operator).
   Beda dari password aplikasi yang di-hash satu arah: password OCS perlu
   dikirim apa adanya ke /Auth/Login, jadi disimpan terenkripsi AES-256-GCM
   dengan kunci turunan SESSION_SECRET — bukan plaintext di database.
   ========================================================================= */

function kunciRahasia(): Buffer {
  return scryptSync(secret(), 'ieg-ocs-credential', 32);
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', kunciRahasia(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

/** null kalau kosong, rusak, atau SESSION_SECRET sudah berganti. */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  try {
    const [versi, ivRaw, tagRaw, dataRaw] = stored.split('.');
    if (versi !== 'v1') return null;
    const decipher = createDecipheriv('aes-256-gcm', kunciRahasia(), Buffer.from(ivRaw, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataRaw, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
