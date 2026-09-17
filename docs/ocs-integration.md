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

1. **Scan 1** tidak menyentuh OCS sama sekali — murni menghitung resi masuk.
2. **Scan 2** membuka dokumen (`OrderNotManifestedV2`), menyalin `Items` ke
   tabel `ManifestCandidate` supaya validasi tiap scan cukup satu query
   berindeks, persis pola aplikasi OCS sendiri.
3. Resi yang tidak ada di kandidat ditanyakan ke `CheckInvalidManifest`.
4. Tiap 50 scan dan tiap kali tombol Sinkron ditekan:
   `SaveTemporaryManifestV2` per 100 baris.
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
