/**
 * HANYA untuk verifikasi tipe di container Claude.
 * Engine Prisma tidak bisa diunduh di sini (binaries.prisma.sh diblokir),
 * jadi `prisma generate` selalu gagal. Skrip ini membuat index.d.ts saja
 * supaya tsc & next build bisa jalan. Di mesin user, pakai `npm run db:generate`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getDMMF } = require('@prisma/internals');
const { dmmfToTypes, externalToInternalDmmf } = require('@prisma/client/generator-build');

const datamodel = fs.readFileSync('prisma/schema.prisma', 'utf8');
const doc = externalToInternalDmmf(await getDMMF({ datamodel }));
doc.mappings.modelOperations.forEach((op) => {
  op.plural ||= op.model[0].toLowerCase() + op.model.slice(1) + 's';
});

const dir = 'node_modules/.prisma/client';
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'index.d.ts'), dmmfToTypes(doc));
fs.writeFileSync(
  path.join(dir, 'index.js'),
  `class PrismaClientKnownRequestError extends Error { constructor(m, o={}) { super(m); this.code = o.code; } }
class PrismaClient { constructor() {} $connect(){} $disconnect(){} $on(){} $transaction(){} $queryRawUnsafe(){} $executeRawUnsafe(){} }
const Prisma = { PrismaClientKnownRequestError, PrismaClientValidationError: Error, Decimal: Number, JsonNull: null, DbNull: null };
module.exports = { PrismaClient, Prisma, PrismaClientKnownRequestError };
`,
);
// @prisma/client mengekspor ulang dari '.prisma/client/default' — arahkan ke index kita.
fs.writeFileSync(path.join(dir, 'default.d.ts'), "export * from './index'\n");
fs.writeFileSync(path.join(dir, 'default.js'), "module.exports = require('./index')\n");
fs.writeFileSync(path.join(dir, 'edge.d.ts'), "export * from './index'\n");
fs.writeFileSync(path.join(dir, 'edge.js'), "module.exports = require('./index')\n");
console.log('Tipe Prisma offline dibuat di', dir);
