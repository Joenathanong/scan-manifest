/**
 * Tes koneksi OCS dari mesin yang punya akses ke ocs.iegsystem.id.
 * Jalankan dari terminal biasa (bukan container Claude):  npm run ocs:test
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
const body = await login.json();
const token = body.Token || body.token;
if (!token) {
  console.error('Login gagal:', login.status, body);
  process.exit(1);
}
console.log('Login OK. Token', String(token).slice(0, 24) + '...');

async function get(path) {
  const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text.slice(0, 300) };
  }
}

const area = await get('/MasterData/GetAreaList');
console.log('GetAreaList ->', area.status, JSON.stringify(area.body).slice(0, 200));

const basket = await get('/MasterData/GetBasketManifestList');
const list = basket.body?.data ?? basket.body;
console.log('GetBasketManifestList ->', basket.status, Array.isArray(list) ? `${list.length} basket` : list);

const shipper = process.argv[2];
if (shipper) {
  const notMan = await get(`/Fulfillment/OrderNotManifested?shippingProvider=${encodeURIComponent(shipper)}&isAll=false`);
  const d = notMan.body?.data ?? notMan.body;
  console.log(`OrderNotManifested(${shipper}) ->`, notMan.status, Array.isArray(d) ? `${d.length} order` : d);
}
