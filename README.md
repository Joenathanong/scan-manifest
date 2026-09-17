# Scan Manifest IEG

Aplikasi scan resi dua tahap yang terhubung ke **OCS Manifest V2**
(`ocs.iegsystem.id/manifest-v2`).

- **Scan 1 — Resi masuk.** Operator scan resi apa adanya. Tidak ada keranjang,
  tidak ada barcode. Resi tersimpan dengan status `awaiting to pickup`.
- **Sortir fisik** per ekspedisi terjadi di antara kedua tahap.
- **Scan 2 — Manifest.** Sistem membuat **basket final** (`JNT-20260917-001`)
  + label QR untuk printer termal, lalu resi discan masuk ke basket itu.
  Statusnya berubah jadi `pickup`, hilang dari daftar awaiting, dan datanya
  dikirim ke OCS.
- **Dashboard validasi** dengan filter tanggal: total awaiting to pickup,
  total pickup, rincian per tanggal dan per ekspedisi.

Stack: **Next.js 15 (App Router) · TypeScript · Tailwind 3 · Prisma 6 ·
TiDB Serverless · Vercel**. UI mengikuti `INV IEG/design-ocs.md` v3.1
(dua tema Morning/Evening, basis desain 360px untuk PDT Zebra).

---

## 1. Menyiapkan database

Connection string TiDB dari dashboard menunjuk database sistem `sys`, dan
`prisma db push` akan gagal `P3004`. Buat databasenya dulu:

```sql
CREATE DATABASE scan_manifest;
```

Lalu di `.env` pastikan bagian akhir URL-nya `/scan_manifest?sslaccept=strict`.

```bash
npm install
npm run db:push        # membuat 12 tabel
npm run db:generate
npm run db:collation   # memeriksa collation TiDB (lihat catatan di bawah)
npm run db:seed        # 12 ekspedisi + user admin
```

Seed mencetak password admin di terminal. Login pertama wajib menggantinya.
Untuk password awal sendiri: `SEED_ADMIN_PASSWORD=xxxx npm run db:seed`.

## 2. Menjalankan

```bash
npm run dev            # http://localhost:3000
npm run typecheck      # wajib hijau sebelum deploy
npm run build
```

Tes koneksi OCS dari mesin yang bisa membuka `ocs.iegsystem.id`:

```bash
npm run ocs:test          # login + ambil area + daftar basket
npm run ocs:test -- "J&T" # sekalian hitung order yang belum dimanifest
```

## 3. Deploy ke Vercel

1. Push repo ini ke GitHub, lalu Import di Vercel.
2. Isi Environment Variables (Production + Preview) sesuai `.env.example`:
   `DATABASE_URL`, `SESSION_SECRET`, `OCS_BASE_URL`, `OCS_USERNAME`,
   `OCS_PASSWORD`, `OCS_COMPANYDB`, `OCS_ENABLED`, `CRON_SECRET`.
3. Build Command sudah benar (`prisma generate && next build` lewat script
   `build`).
4. `vercel.json` memasang cron `/api/cron/flush-outbox` **sekali sehari 08.00 WIB**
   (`0 1 * * *` UTC) — paket Hobby Vercel memang hanya mengizinkan cron harian.
   Cron ini jaring pengaman terakhir, BUKAN pengirim utama: selama ada halaman
   aplikasi terbuka, `/api/sync-status` yang dipanggil lonceng status tiap 30
   detik ikut mengirim ulang antrean (throttle 20 detik). Jadi antrean tetap
   terkirim dalam hitungan detik, bukan menunggu besok.
5. Di TiDB Cloud, izinkan akses dari mana saja (`0.0.0.0/0`) atau daftarkan IP
   Vercel; tanpa itu koneksi dari fungsi serverless ditolak.

## 4. Ketahanan jaringan — yang dijanjikan aplikasi ini

Tidak ada satu pun scan yang boleh hilang. Ada **dua lapis antrean**:

| Lapis | Di mana | Kapan aktif | Pemulihan |
|---|---|---|---|
| Antrean perangkat | IndexedDB di PDT/PC | Jaringan ke server putus | Otomatis saat event `online`, saat tab kembali aktif, dan tiap 20 detik |
| Outbox server | Tabel `ocs_outbox` di TiDB | OCS tidak bisa dihubungi | Ikut terkirim tiap kali `/api/sync-status` dipanggil (tiap 30 detik dari halaman yang terbuka), tombol "Kirim ulang ke OCS", dan cron harian sebagai jaring terakhir |

Di setiap halaman ada **banner status**: jaringan putus, jumlah scan yang masih
menunggu di perangkat, dan jumlah data yang belum sama dengan OCS. Kalau scan
yang tertunda ternyata ditolak server saat dikirim ulang (mis. resi dobel),
penolakannya **ditampilkan**, tidak dibuang diam-diam.

Halaman **Admin > Setelan OCS** memperlihatkan angka lengkapnya: antrean
perangkat, antrean server, scan belum tersinkron, dan daftar dokumen manifest
yang bermasalah beserta pesan errornya.

## 5. Peta isi

```
prisma/schema.prisma          12 model, PK Int, @@index di semua kolom relasi (wajib TiDB)
src/lib/crypto.ts             scrypt + HMAC (tanpa bcrypt/argon2 — dependensi native gagal di Vercel)
src/lib/db.ts                 singleton Prisma, withRetry() write-conflict TiDB, nextSeq()
src/lib/api.ts                handle(), requireUser/requireAdmin, writeAudit, cookie sesi 12 jam
src/lib/offline-queue.ts      antrean scan di perangkat (IndexedDB) + auto-flush
src/server/ocs-client.ts      klien OCS (login, start, check, save, submit)
src/server/scan-service.ts    scan tahap 1, sesi harian, void
src/server/manifest-service.ts scan tahap 2, sinkron, submit, outbox
src/app/(app)/...             dashboard, scan-1, scan-2, basket, history, admin
src/app/label/[code]/         label QR 58mm untuk printer termal
docs/ocs-integration.md       kontrak endpoint OCS hasil pembongkaran
```

## 6. Keputusan yang jangan dibalik tanpa alasan

- **Resi unik dijaga DATABASE** lewat kolom `resiUnik` UNIQUE. Saat di-void,
  kolom itu dikosongkan (baris tidak dihapus) supaya resi bisa discan ulang.
- **Kode ekspedisi tidak bisa diubah** — kode itu bagian dari nomor basket yang
  sudah tercetak di label.
- **Tidak ada interactive transaction pada counter** (`nextSeq`): TiDB mudah
  melempar write conflict. Pola: findUnique → create (catch) → increment, 3x
  ulang.
- **Field scan tidak pernah di-`disabled`** — scanner keburu mengirim karakter
  dan scan hilang.
- **PK selalu `Int autoincrement`.** TiDB tidak bisa mengubah/menghapus primary
  key (clustered index); rancang sekali di awal.
- **Ekspedisi hasil tebakan prefix di scan 1 dikoreksi otomatis di scan 2**
  mengikuti ekspedisi basket, jadi prefix yang meleset tidak merusak data.

## 7. Jebakan TiDB yang sudah ditangani

1. `relationMode = "prisma"` → setiap kolom relasi punya `@@index`.
2. Collation cluster bisa `utf8mb4_bin` (peka huruf besar-kecil).
   `npm run db:collation` **memeriksa dulu**; memaksa CONVERT pada kolom
   berindeks menghasilkan error 8200.
3. Tidak ada scalar list di MySQL/TiDB — prefix ekspedisi disimpan sebagai teks
   dipisah koma.
4. VARCHAR bawaan Prisma hanya 191 → kolom panjang diberi `@db.VarChar(...)`
   atau `@db.Text`.
5. Password TiDB yang mengandung `@:/?#[]` harus di-URL-encode di
   `DATABASE_URL`.
