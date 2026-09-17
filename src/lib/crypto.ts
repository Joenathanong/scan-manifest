import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

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
