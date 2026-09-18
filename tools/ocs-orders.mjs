/**
 * Periksa endpoint daftar order OCS — JALANKAN DARI PC, bukan dari container.
 *
 *   npm run ocs:orders
 *
 * Kenapa perlu: aplikasi ini mengisi tabel pemetaan order ID <-> resi dari
 * daftar Items yang SUDAH diambil saat Scan 2 membuka dokumen. Kalau nanti
 * penarikan berkala mau diaktifkan (memanggil OrderNotManifestedV2 sendiri
 * di luar proses manifest), harus dipastikan dulu satu hal:
 *
 *   APAKAH endpoint itu ikut MEMBUAT dokumen manifest baru di OCS?
 *
 * Kalau ya, penarikan berkala akan meninggalkan dokumen menggantung setiap
 * kali jalan — dan itu mengotori data OCS. Skrip ini memanggilnya satu kali
 * untuk SATU kurir, lalu melaporkan apa yang terjadi. TIDAK ada yang disubmit.
 */

const base = (process.env.OCS_BASE_URL || 'https://ocs.iegsystem.id').replace(/\/+$/, '');
const username = process.env.OCS_USERNAME;
const password = process.env.OCS_PASSWORD;
const companydb = process.env.OCS_COMPANYDB;
const shipper = process.argv[2] || 'J&T';
const areaId = process.argv[3] || 'Pusat';

if (!username || !password || !companydb) {
  console.error('OCS_USERNAME / OCS_PASSWORD / OCS_COMPANYDB belum diisi di .env');
  process.exit(1);
}

const login = await fetch(`${base}/Auth/Login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password, companydb }),
});
const bodyLogin = await login.json();
const token = bodyLogin.Token || bodyLogin.token;
if (!token) {
  console.error('Login gagal:', login.status, bodyLogin);
  process.exit(1);
}

async function get(path) {
  const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text.slice(0, 400) };
  }
}

function buka(v) {
  return v && typeof v === 'object' && 'data' in v ? v.data : v;
}

console.log('');
console.log(`Kurir : ${shipper}`);
console.log(`Area  : ${areaId}`);
console.log('');

console.log('1. Dokumen yang sedang menggantung SEBELUM dipanggil');
const sebelum = buka((await get('/Fulfillment/GetBasketManifestStillProcessing')).body);
const jumlahSebelum = Array.isArray(sebelum) ? sebelum.length : 0;
console.log(`   ${jumlahSebelum} dokumen`);

console.log('');
console.log('2. Panggil OrderNotManifestedV2 tanpa basketId');
const tanpaBasket = await get(
  `/Fulfillment/OrderNotManifestedV2?shipper=${encodeURIComponent(shipper)}&areaId=${encodeURIComponent(areaId)}&basketId=&isProcessing=false`,
);
const d1 = buka(tanpaBasket.body);
console.log(`   HTTP ${tanpaBasket.status}`);
if (d1 && typeof d1 === 'object') {
  console.log(`   DocId  : ${d1.DocId ?? '(tidak ada)'}`);
  console.log(`   DocNo  : ${d1.DocNo ?? '(tidak ada)'}`);
  console.log(`   Items  : ${Array.isArray(d1.Items) ? d1.Items.length : 0}`);
  if (Array.isArray(d1.Items) && d1.Items[0]) {
    console.log(`   Contoh : ${JSON.stringify(d1.Items[0])}`);
  }
} else {
  console.log(`   Balasan: ${JSON.stringify(d1).slice(0, 300)}`);
}

console.log('');
console.log('3. Dokumen yang menggantung SESUDAH dipanggil');
const sesudah = buka((await get('/Fulfillment/GetBasketManifestStillProcessing')).body);
const jumlahSesudah = Array.isArray(sesudah) ? sesudah.length : 0;
console.log(`   ${jumlahSesudah} dokumen`);

console.log('');
console.log('KESIMPULAN');
if (jumlahSesudah > jumlahSebelum) {
  console.log('  TIDAK AMAN untuk penarikan berkala.');
  console.log('  Memanggil endpoint ini MEMBUAT dokumen manifest baru di OCS.');
  console.log('  Biarkan pemetaan terisi dari Scan 2 saja (perilaku saat ini).');
  if (Array.isArray(sesudah)) {
    const baru = sesudah.slice(0, 3).map((x) => x.DocNo ?? x.DocId ?? x);
    console.log(`  Dokumen menggantung sekarang: ${JSON.stringify(baru)} ...`);
    console.log('  Bersihkan dokumen itu lewat menu manifest OCS.');
  }
} else if (d1 && Array.isArray(d1.Items) && d1.Items.length > 0) {
  console.log('  AMAN. Endpoint mengembalikan daftar order tanpa menambah dokumen menggantung.');
  console.log('  Penarikan berkala boleh diaktifkan.');
} else {
  console.log('  BELUM JELAS — tidak ada dokumen baru, tapi daftar Items juga kosong.');
  console.log('  Coba kurir lain, mis:  npm run ocs:orders -- SiCepat');
}
console.log('');
