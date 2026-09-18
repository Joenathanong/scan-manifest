/**
 * Periksa OData /odata/DTO_Orders — JALANKAN DARI PC, bukan dari container.
 *
 *   npm run ocs:odata
 *
 * Gunanya dua:
 *   1. Menampilkan NAMA KOLOM asli satu baris order. Dashboard TV mencari
 *      order berdasarkan nomor resi, dan nama kolomnya ditebak "TrackingNumber"
 *      dari API manifest. Kalau ternyata beda, isi OCS_ODATA_FIELD_RESI di .env
 *      dengan nama yang benar — kode tidak perlu diubah.
 *   2. Menunjukkan jumlah PICKED dan IN_TRANSIT hari ini, supaya angka di TV
 *      bisa dibandingkan langsung dengan OCS.
 */

const base = (process.env.OCS_BASE_URL || 'https://ocs.iegsystem.id').replace(/\/+$/, '');
const username = process.env.OCS_USERNAME;
const password = process.env.OCS_PASSWORD;
const companydb = process.env.OCS_COMPANYDB;

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

async function odata(query) {
  const qs = Object.entries(query)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const res = await fetch(`${base}/odata/DTO_Orders?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text.slice(0, 400) };
  }
}

const PICKED = 20013;
const IN_TRANSIT = 30000;

// Tengah malam WIB hari ini, dalam UTC.
const hariIni = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
const sejak = new Date(`${hariIni}T00:00:00+07:00`).toISOString();

console.log('');
console.log(`Tanggal WIB : ${hariIni}`);
console.log(`Filter sejak: ${sejak}`);
console.log('');

console.log('1. Satu baris contoh — untuk melihat nama kolom');
const contoh = await odata({ $top: '1' });
if (contoh.status !== 200) {
  console.log(`   GAGAL HTTP ${contoh.status}`);
  console.log(`   ${JSON.stringify(contoh.body).slice(0, 400)}`);
  console.log('');
  console.log('   Kalau 401: OData mungkin tidak menerima Bearer token yang sama.');
  console.log('   Kabari saja hasilnya, nanti kliennya disesuaikan.');
  process.exit(1);
}
const baris = Array.isArray(contoh.body?.value) ? contoh.body.value[0] : null;
if (!baris) {
  console.log('   Tidak ada baris order sama sekali.');
} else {
  const kolom = Object.keys(baris);
  console.log(`   ${kolom.length} kolom:`);
  console.log(`   ${kolom.join(', ')}`);
  console.log('');
  const tebakan = kolom.filter((k) => /track|resi|awb|waybill/i.test(k));
  console.log(`   Kandidat kolom nomor resi: ${tebakan.length ? tebakan.join(', ') : '(TIDAK ADA — laporkan daftar kolom di atas)'}`);
  if (tebakan.length && !tebakan.includes('TrackingNumber')) {
    console.log('');
    console.log(`   PERHATIAN: tebakan bawaan "TrackingNumber" TIDAK ada.`);
    console.log(`   Tambahkan ke .env:  OCS_ODATA_FIELD_RESI=${tebakan[0]}`);
  }
}

console.log('');
console.log('2. Jumlah per status hari ini');
for (const [nama, kode] of [['PICKED', PICKED], ['IN_TRANSIT', IN_TRANSIT]]) {
  const r = await odata({
    $filter: `StatusCode eq ${kode} and CreatedAt ge ${sejak}`,
    $top: '0',
    $count: 'true',
  });
  const n = r.body?.['@odata.count'];
  console.log(`   ${nama.padEnd(12)} : ${r.status === 200 ? n : `GAGAL HTTP ${r.status}`}`);
}

console.log('');
console.log('3. Uji pencarian gabungan nomor resi (dipakai untuk In Transit)');
const kolomResi = process.env.OCS_ODATA_FIELD_RESI || 'TrackingNumber';
const sample = await odata({ $filter: `StatusCode eq ${IN_TRANSIT}`, $top: '2', $select: kolomResi });
const contohResi = (sample.body?.value ?? []).map((v) => v[kolomResi]).filter(Boolean);
if (!contohResi.length) {
  console.log(`   Tidak dapat contoh resi dari kolom "${kolomResi}" — cek nama kolomnya di langkah 1.`);
} else {
  const cocok = contohResi.map((r) => `${kolomResi} eq '${String(r).replace(/'/g, "''")}'`).join(' or ');
  const uji = await odata({ $filter: `StatusCode eq ${IN_TRANSIT} and (${cocok})`, $top: '0', $count: 'true' });
  console.log(`   Contoh resi : ${contohResi.join(', ')}`);
  console.log(`   Hasil hitung: ${uji.body?.['@odata.count']} (harusnya ${contohResi.length})`);
  console.log(
    uji.body?.['@odata.count'] === contohResi.length
      ? '   AMAN — pencarian gabungan nomor resi berfungsi, dashboard TV siap.'
      : '   TIDAK COCOK — laporkan hasil ini.',
  );
}
console.log('');
