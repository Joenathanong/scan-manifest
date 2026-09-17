import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { prisma } from './db';
import { readSession, signSession } from './crypto';
import type { Role } from '@prisma/client';

export const COOKIE = 'scan_manifest_session';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type SessionUser = {
  id: number;
  username: string;
  name: string;
  role: Role;
  mustChangePassword: boolean;
  ocsUserCode: string | null;
};

export async function setSessionCookie(userId: number) {
  const hours = Number(process.env.SESSION_HOURS || 12);
  const exp = Date.now() + hours * 3600 * 1000;
  const jar = await cookies();
  jar.set(COOKIE, signSession({ uid: userId, exp }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(exp),
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}

/** null kalau belum login / user dinonaktifkan. Dicek setiap request. */
export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const payload = readSession(jar.get(COOKIE)?.value);
  if (!payload) return null;
  const user = await prisma.user.findUnique({
    where: { id: payload.uid },
    select: {
      id: true,
      username: true,
      name: true,
      role: true,
      active: true,
      mustChangePassword: true,
      ocsUserCode: true,
    },
  });
  if (!user || !user.active) return null;
  const { active: _active, ...rest } = user;
  return rest;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new ApiError('Sesi berakhir, silakan masuk lagi.', 401);
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== 'ADMIN') throw new ApiError('Hanya admin yang boleh melakukan ini.', 403);
  return user;
}

export async function requireSupervisor(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role === 'OPERATOR') throw new ApiError('Butuh hak supervisor.', 403);
  return user;
}

/** Bungkus handler: error jadi JSON rapi, bukan stack trace. */
export function handle<T>(fn: () => Promise<T>) {
  return fn()
    .then((data) => NextResponse.json({ ok: true, data }))
    .catch((e: unknown) => {
      const status = e instanceof ApiError ? e.status : 500;
      const message = e instanceof Error ? e.message : 'Terjadi kesalahan.';
      if (status >= 500) console.error('[api]', e);
      return NextResponse.json({ ok: false, error: message }, { status });
    });
}

export async function writeAudit(
  userId: number | null,
  action: string,
  entity: string,
  entityId: string | number,
  detail?: unknown,
) {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        entity,
        entityId: String(entityId),
        detail: (detail ?? undefined) as never,
      },
    });
  } catch (e) {
    console.error('[audit]', e);
  }
}

export function str(v: unknown, field: string, max = 191): string {
  if (typeof v !== 'string' || !v.trim()) throw new ApiError(`${field} wajib diisi.`);
  const s = v.trim();
  if (s.length > max) throw new ApiError(`${field} terlalu panjang (maks ${max}).`);
  return s;
}

export function optStr(v: unknown, max = 191): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  return v.trim().slice(0, max);
}

export function int(v: unknown, field: string): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) throw new ApiError(`${field} tidak valid.`);
  return Math.trunc(n);
}
