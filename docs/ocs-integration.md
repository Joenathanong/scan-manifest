# Integrasi OCS — Manifest V2

Dibongkar langsung dari bundel `https://ocs.iegsystem.id/assets/manifest-v2-*.js`
pada **17 September 2026**. Kalau OCS diperbarui, periksa ulang berkas ini dulu
sebelum menyalahkan aplikasi.

## 1. Autentikasi

```
POST /Auth/Login
body: { "username": "...", "password": "...", "companydb": "EJI_WMS" }
->    { "Token": "<JWT>" }
```

- Permintaan berikutnya: `Authorization: Bearer <Token>`.
- JWT berlaku **24 jam** (`exp = iat + 86400`). Aplikasi menyimpan token 20 jam
  saja supaya tidak kadaluwarsa di tengah proses manifest.
- Saat 401, aplikasi login ulang **sekali** lalu mengulang permintaannya.
- Balasan backend dibungkus `{ statusCode, data, error }`. Klien menerima dua
  bentuk (dengan dan tanpa bungkus) supaya tidak rapuh.

## 2. Endpoint yang dipakai

| Endpoint | Method | Kegunaan |
|---|---|---|
| `/Fulfillment/OrderNotManifestedV2?shipper=&areaId=&basketId=&isProcessing=&docId=` | GET | Membuka / melanjutkan dokumen manifest. Balasan: `DocId, DocNo, BasketId, AreaId, StartDate, UserCode, Items[], Valid[], NotValid[]` |
| `/Fulfillment/CheckInvalidManifest?scan=&shippingProvider=` | GET | Menanyakan resi yang tidak ada di `Items`. Balasan berupa string `OK#<OrderId>#<TrackingNumber>` atau alasan penolakan |
| `/Fulfillment/SaveTemporaryManifestV2?shipper=&basketId=&areaId=&docId=` | POST | Auto-save. Body array scan, **maksimal 100 baris per kiriman** |
| `/Fulfillment/SubmitManifestV2?shipper=&basketId=&areaId=&docId=` | POST | Submit final, menutup dokumen di OCS |
| `/Fulfillment/CheckManifestInBasket?docId=` | GET | Memeriksa isi basket di OCS |
| `/Fulfillment/GetBasketManifestStillProcessing` | GET | Dokumen yang masih menggantung |
| `/Fulfillment/GetHistoryBasketManifestList?basketId=` | GET | Riwayat manifest per basket |
| `/MasterData/GetAreaList` | GET | Daftar area |
| `/MasterData/GetBasketManifestList` | GET | Daftar basket yang pernah dipakai (teks bebas) |
| `/MasterData/GetAllUsername` | GET | Daftar user; operator manifest berawalan `MANIFEST` |

`shipper` yang mengandung `&` (mis. `J&T`) di aplikasi OCS di-`replace` jadi
`%26`. Klien kita memakai `encodeURIComponent`, hasilnya sama-sama aman.

## 3. Bentuk baris scan

Valid:

```json
{ "ScanResult": "JX1234567890", "ManifestTime": "2026-09-17T03:12:44.120Z",
  "OrderId": "SO-00012345", "TrackingNumber": "JX1234567890", "ShippingProvider": "J&T" }
```

Ditolak:

```json
{ "ScanResult": "JX1234567890", "ManifestTime": "...",
  "Reason": "Double", "ShippingProvider": "J&T" }
```

Alasan penolakan yang dikenal OCS (dari berkas suara di bundelnya):
`Double`, `Cancelled`, `In Cancel`, `Resi Not Found`, `Shipped`,
`Wrong Shipper`, `Bypass Not Verified`.

## 4. Daftar nilai dari OCS (17 Sep 2026)

- **Kurir**: `J&T`, `SPX`, `GTL`, `JNE`, `NinjaVan`, `LEX`, `SiCepat`, `IDX`,
  `Anteraja`, `Blitz`, `Gojek`, `Grab`
- **Area**: `Makassar`, `Medan`, `Pusat`, `Surabaya`, `Yogyakarta`
- **Basket**: teks bebas, sudah ada ±4.009 nilai berbeda di OCS. Karena bebas,
  nomor basket buatan aplikasi ini (`JNT-20260917-001`) bisa langsung dipakai
  sebagai `basketId` OCS.

## 5. Cara aplikasi ini memakainya

1. **Scan 1** tidak memanggil OCS sama sekali — murni menghitung resi masuk.
   Kalau pola nomor yang discan tidak cocok dengan prefix ekspedisi mana pun
   (biasanya karena yang ditembak barcode ORDER ID), nomornya dicari di tabel
   lokal `OrderLookup`. Tabel itu diisi dari daftar `Items` yang sudah diambil
   Scan 2 saat membuka dokumen, jadi tetap **nol panggilan OCS** di Scan 1.
2. **Scan 2** membuka dokumen (`OrderNotManifestedV2`), menyalin `Items` ke
   tabel `ManifestCandidate` supaya validasi tiap scan cukup satu query
   berindeks, persis pola aplikasi OCS sendiri.
3. Resi yang tidak ada di kandidat ditanyakan ke `CheckInvalidManifest`.
4. `SaveTemporaryManifestV2` per 100 baris, dipicu tiap 8 detik ATAU tiap 20
   scan tertunda (mana yang lebih dulu), dijalankan lewat `after()` Next.js
   sesudah balasan dikirim ke operator.
5. Tombol Selesai: sinkron dulu, lalu `SubmitManifestV2` dengan SELURUH baris
   valid dokumen itu.
6. **Setiap kegagalan jaringan tidak pernah membatalkan scan.** Scan sudah
   tersimpan di TiDB; pengirimannya masuk `OcsOutbox` dan diulang oleh cron
   `/api/cron/flush-outbox` (tiap 10 menit) atau tombol "Kirim ulang".

## 6. Catatan lingkungan

- `ocs.iegsystem.id` **diblokir** dari container Claude dan dari device_bash.
  Verifikasi akhir harus dijalankan dari mesin user: `npm run ocs:test`.
- Di browser OCS sendiri, `fetch`/XHR dari devtools menggantung karena service
  worker Workbox — itu masalah browser, bukan API-nya.

## 7. Penarikan daftar order berkala — BELUM diaktifkan

`OrderNotManifestedV2` adalah satu-satunya endpoint yang mengembalikan
pasangan `OrderId` ↔ `TrackingNumber` untuk satu kurir sekaligus. Menariknya
secara berkala akan membuat `OrderLookup` lengkap sejak awal hari, bukan
menunggu Scan 2 membuka dokumen pertama.

**Belum dipakai karena satu hal yang belum terjawab:** endpoint itu juga yang
dipakai OCS untuk MEMBUKA dokumen manifest, dan balasannya berisi `DocId`.
Kalau setiap pemanggilan membuat dokumen baru, penarikan berkala akan
meninggalkan dokumen menggantung di OCS setiap kali jalan.

Jalankan ini dari PC yang punya akses ke OCS untuk memastikan:

```
npm run ocs:orders            # kurir J&T, area Pusat
npm run ocs:orders -- SiCepat
```

Skrip itu menghitung dokumen menggantung sebelum dan sesudah pemanggilan, lalu
menyimpulkan aman atau tidak. Baru setelah hasilnya AMAN, penarikan berkala
layak dibuat.

## 8. Pemeriksaan resi Scan 1 ke OCS

Resi yang polanya tidak dikenali dulu tetap masuk hitungan *awaiting to
shipment*, termasuk salah tembak barcode. Sekarang baris seperti itu ditandai
`verifyState = PENDING` dan diperiksa ke OCS **sesudah** balasan scan dikirim —
lewat `after()` Next.js, jadi kecepatan scan tidak terpengaruh sama sekali.

`CheckInvalidManifest` butuh nama kurir, padahal kurir resi inilah yang tidak
diketahui. Jadi kurir dicoba satu per satu, dan yang dibaca adalah BEDA alasan
penolakannya:

| Jawaban OCS | Artinya | Putusan |
|---|---|---|
| `OK#<OrderId>#<Tracking>` | Resi ada, kurirnya ketemu | `VALID`, ekspedisi ikut terisi |
| Alasan selain "not found" (`Wrong Shipper`, `Cancelled`, `Shipped`, …) | Resi ADA, cuma tidak bisa dimanifest | `VALID`, alasannya dicatat |
| SEMUA kurir bilang "not found" | Resi memang tidak ada | `INVALID` — tidak ikut dihitung |
| Error jaringan / OCS mati | Belum ketahuan | `SKIP`, dicoba lagi (maks 3×) |

Putusan `INVALID` sengaja dibuat paling sulit dicapai: satu jawaban selain "not
found", atau satu error jaringan saja, sudah membatalkan vonis. Lebih baik
menghitung resi palsu daripada membuang resi asli.

Setelan lewat env:

| Env | Bawaan | Guna |
|---|---|---|
| `OCS_VERIFY_SCAN1` | `true` | `false` mematikan pemeriksaan |
| `OCS_VERIFY_BATCH` | `3` | Resi per putaran |
| `OCS_VERIFY_MAKS_KURIR` | `12` | Kurir yang dicoba per resi |
| `OCS_VERIFY_BUDGET_MS` | `8000` | Jatah waktu sekali putaran |

Antreannya dikerjakan dari tiga tempat: `after()` tiap scan, `after()` pada
lonceng status (tiap 30 detik selama ada halaman terbuka), dan cron harian
untuk sisa terakhir.

## 9. OData /odata/DTO_Orders — dashboard TV

Dibongkar dari lalu lintas halaman `ocs.iegsystem.id/orders-v1` pada
**18 September 2026**. Halaman itu memanggil:

```
GET /odata/DTO_Orders
  ?$orderby=CreatedAt desc
  &$top=25
  &$filter=(StatusCode eq 30000) and (CreatedAt ge 2026-09-16T17:00:00Z)
  &$count=true
```

Jadi `$filter`, `$top`, `$count`, `$orderby`, dan `$select` semuanya didukung.
Dengan `$top=0&$count=true` kita dapat jumlahnya saja tanpa menarik satu baris
pun — itu yang dipakai dashboard TV.

### Kode status (`/MasterData/GetStatusList`, 18 Sep 2026)

| Kode | Nama | Dipakai untuk |
|---|---|---|
| 20013 | `PICKED` | kartu **Order Picked** |
| 20022 | `PACKED` | — |
| 20030 | `MANIFESTED` | — |
| 30000 | `IN_TRANSIT` | kartu **In Transit** |

Daftar lengkapnya: `NA(0)`, `UNPAID(10000)`, `IN_CANCEL(11000)`,
`CANCELLED(11100)`, `READY_TO_PROCESS(20000)`, `PROCESSED(20001)`,
`SCHEDULED(20002)`, `PICKLIST_ASSIGNED(20010)`, `PICKING(20011)`,
`PICKING_FAILED(20012)`, `PICKED(20013)`, `SORTING(20014)`,
`SORTING_FAILED(20015)`, `SORTED(20016)`, `PACKING(20020)`,
`PACKING_FAILED(20021)`, `PACKED(20022)`, `BYPASS(20023)`,
`MANIFESTED(20030)`, `IN_TRANSIT(30000)`, `SHIPPING_LOST(30200)`,
`SHIPPING_DAMAGED(30200)`, `SHIPPING_FAILED(30300)`, `RETRY_SHIP(31000)`,
`DELIVERED_TOCONFIRM(40000)`, `DELIVERED_CONFIRMED(41000)`,
`DELIVERED_RETURNED(42000)`, `COMPLETED(50000)`, `RETURN(70000)`,
`RETURN_RETURNED(71000)`, `RETURN_CONFIRMED(72000)`, `CANCELLED(90000)`.

### Yang BELUM terverifikasi

Nama kolom nomor resi di `DTO_Orders` ditebak `TrackingNumber` (mengikuti API
manifest) — belum dilihat langsung karena sesi browser terputus sebelum sempat.
Jalankan dari PC:

```
npm run ocs:odata
```

Skrip itu menampilkan daftar kolom asli, menandai kandidat kolom resi, dan
menguji pencarian gabungan `TrackingNumber eq 'A' or TrackingNumber eq 'B'`
yang dipakai kartu In Transit. Kalau nama kolomnya ternyata berbeda, cukup isi
`OCS_ODATA_FIELD_RESI=<nama kolom>` di `.env` — kodenya tidak perlu diubah.

### Cara dashboard TV memakainya

| Kartu | Sumber |
|---|---|
| Order Picked | OCS: `StatusCode eq 20013 and CreatedAt ge <tengah malam WIB>` |
| Awaiting to Shipment | TiDB: `ScanItem` `AWAITING_PICKUP`, bukan `INVALID` |
| Awaiting to Pickup | TiDB: `ScanItem` `PICKUP` |
| In Transit | OCS: `StatusCode eq 30000` DIBATASI pada resi yang ada di Awaiting to Pickup kita |

In Transit sengaja dibatasi pada resi kita sendiri: begitu status paket berubah
dari `IN_TRANSIT`, resi itu tidak lagi terhitung dan angkanya turun sendiri.

Hasilnya disimpan sebagai **satu** snapshot di tabel `Setting` (kunci
`tv:snapshot`) dan setiap penarikan **menimpanya utuh** — tidak menumpuk, tidak
ada angka lama yang ikut dijumlahkan. Itu memang yang dibutuhkan: status paket
di OCS berubah-ubah, jadi satu-satunya jawaban yang benar adalah hasil hitung
terakhir.

Snapshot dibangun ulang lewat `after()` kalau umurnya sudah melewati jeda yang
disetel. Jedanya disimpan di `Setting` kunci `tv:interval-menit` dan diubah
dari **Admin → Setelan → Dashboard TV** (1–120 menit, bawaan 5), jadi tidak
perlu deploy ulang. Layar TV tidak pernah menunggu OCS — ia hanya membaca
snapshot.

| Env | Bawaan | Guna |
|---|---|---|
| `TV_REFRESH_MENIT` | `5` | Jeda awal sebelum disetel dari menu Setelan |
| `TV_ODATA_CHUNK` | `50` | Resi per permintaan OData |
| `TV_ODATA_MAKS` | `40` | Batas permintaan per penyegaran |
| `TV_TOKEN` | kosong | Kalau diisi, TV dibuka dengan `/tv?key=<token>` |
| `OCS_ODATA_FIELD_RESI` | `TrackingNumber` | Nama kolom resi di DTO_Orders |
