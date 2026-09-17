import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'] });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

/**
 * TiDB gampang melempar write conflict pada baris yang sama (counter, dsb).
 * Pola: ulangi beberapa kali dengan jeda naik, jangan pakai interactive transaction.
 */
export async function withRetry<T>(fn: () => Promise<T>, times = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < times; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      const retryable = /write conflict|try again later|Deadlock|9007|8027|Lock wait/i.test(msg);
      if (!retryable) throw e;
      await new Promise((r) => setTimeout(r, 60 * (i + 1)));
    }
  }
  throw lastError;
}

/** Nomor urut tanpa interactive transaction (lihat woms/src/lib/numbering.ts). */
export async function nextSeq(key: string): Promise<number> {
  return withRetry(async () => {
    const existing = await prisma.counter.findUnique({ where: { key } });
    if (!existing) {
      try {
        await prisma.counter.create({ data: { key, value: 1 } });
        return 1;
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
      }
    }
    const updated = await prisma.counter.update({
      where: { key },
      data: { value: { increment: 1 } },
    });
    return updated.value;
  });
}
