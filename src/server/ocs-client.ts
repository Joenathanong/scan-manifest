/**
 * Klien API IEG OCS (ocs.iegsystem.id) untuk modul Manifest V2.
 *
 * Kontrak endpoint dibongkar langsung dari bundel `assets/manifest-v2-*.js`
 * pada 17 Sep 2026 — lihat docs/ocs-integration.md.
 *
 * Auth : POST /Auth/Login { username, password, companydb } -> { Token }
 *        Header berikutnya: Authorization: Bearer <Token>. JWT berlaku 24 jam.
 * Balasan backend dibungkus { statusCode, data, error }.
 *
 * SATU KLIEN, BANYAK AKUN. Setiap fungsi menerima `cred` opsional: kalau diisi,
 * permintaan dijalankan atas nama akun OCS operator (mis. MANIFEST001) sehingga
 * dokumen manifest tercatat atas namanya. Kalau kosong, dipakai akun sistem
 * dari environment. Token di-cache per akun, bukan global.
 */

export type OcsEnvelope<T> = { statusCode: number; data: T; error?: string | null };

export type Kredensial = { username: string; password: string; companydb: string; label?: string };

export type OcsOrderItem = {
  OrderId: string;
  TrackingNumber: string;
  [k: string]: unknown;
};

export type OcsDoc = {
  DocId: number;
  DocNo: string;
  BasketId: string;
  AreaId: string;
  StartDate: string;
  UserCode: string;
  Items: OcsOrderItem[];
  Valid?: OcsScanPayload[];
  NotValid?: OcsInvalidPayload[];
};

export type OcsScanPayload = {
  ScanResult: string;
  ManifestTime: string;
  OrderId: string;
  TrackingNumber: string;
  ShippingProvider: string;
};

export type OcsInvalidPayload = {
  ScanResult: string;
  ManifestTime: string;
  Reason: string;
  ShippingProvider: string;
};

export class OcsError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

type Cached = { token: string; expiresAt: number };

const globalForOcs = globalThis as unknown as { __ocsTokens?: Map<string, Cached> };
const cacheToken = (globalForOcs.__ocsTokens ??= new Map<string, Cached>());

function baseUrl(): string {
  return (process.env.OCS_BASE_URL || 'https://ocs.iegsystem.id').replace(/\/+$/, '');
}

function timeoutMs(): number {
  return Number(process.env.OCS_TIMEOUT_MS || 30000);
}

/** Akun sistem dari environment — dipakai kalau operator belum punya akun OCS sendiri. */
export function kredensialSistem(): Kredensial | null {
  const username = process.env.OCS_USERNAME || '';
  const password = process.env.OCS_PASSWORD || '';
  const companydb = process.env.OCS_COMPANYDB || '';
  if (!username || !password || !companydb) return null;
  return { username, password, companydb, label: `${username} (akun sistem)` };
}

export function ocsEnabled(): boolean {
  return process.env.OCS_ENABLED !== 'false' && !!kredensialSistem();
}

function pakai(cred?: Kredensial | null): Kredensial {
  const dipakai = cred ?? kredensialSistem();
  if (!dipakai) {
    throw new OcsError('Kredensial OCS belum diisi (OCS_USERNAME / OCS_PASSWORD / OCS_COMPANYDB).', 500);
  }
  return dipakai;
}

function kunciCache(cred: Kredensial): string {
  return `${cred.companydb}::${cred.username}`;
}

async function rawFetch(path: string, init: RequestInit): Promise<Response> {
  const batas = timeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), batas);
  try {
    return await fetch(`${baseUrl()}${path}`, { ...init, signal: controller.signal, cache: 'no-store' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new OcsError(
      /abort/i.test(msg)
        ? `OCS tidak menjawab dalam ${Math.round(batas / 1000)} detik.`
        : `Tidak bisa menghubungi OCS: ${msg}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function login(cred?: Kredensial | null): Promise<string> {
  const akun = pakai(cred);
  const res = await rawFetch('/Auth/Login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: akun.username,
      password: akun.password,
      companydb: akun.companydb,
    }),
  });

  const body = (await res.json().catch(() => null)) as { Token?: string; token?: string; error?: string } | null;
  const token = body?.Token || body?.token;
  if (!res.ok || !token) {
    throw new OcsError(
      `Login OCS gagal untuk ${akun.username}: ${body?.error || `HTTP ${res.status}`}`,
      res.status === 401 ? 401 : 502,
    );
  }
  // JWT OCS berlaku 24 jam; disimpan 20 jam saja supaya tidak kadaluwarsa di tengah proses.
  cacheToken.set(kunciCache(akun), { token, expiresAt: Date.now() + 20 * 3600 * 1000 });
  return token;
}

async function token(cred: Kredensial, force = false): Promise<string> {
  const ada = cacheToken.get(kunciCache(cred));
  if (!force && ada && ada.expiresAt > Date.now()) return ada.token;
  return login(cred);
}

async function call<T>(
  path: string,
  init: RequestInit = {},
  cred?: Kredensial | null,
  retryOn401 = true,
): Promise<T> {
  const akun = pakai(cred);
  const jwt = await token(akun);
  const res = await rawFetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
      ...(init.headers || {}),
    },
  });

  if (res.status === 401 && retryOn401) {
    cacheToken.delete(kunciCache(akun));
    await token(akun, true);
    return call<T>(path, init, akun, false);
  }

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  // Backend OCS membungkus balasan { statusCode, data, error }.
  if (body && typeof body === 'object' && 'statusCode' in (body as Record<string, unknown>)) {
    const env = body as OcsEnvelope<T>;
    if (env.statusCode !== 200) {
      throw new OcsError(
        `${env.error || pesanError(body) || 'permintaan ditolak'} (kode ${env.statusCode}) — ${path.split('?')[0]}`,
        502,
      );
    }
    return env.data;
  }

  if (!res.ok) {
    throw new OcsError(`OCS menolak: ${pesanError(body) || `HTTP ${res.status}`} — ${path.split('?')[0]}`, 502);
  }
  return body as T;
}

/**
 * Ambil pesan yang bisa dibaca manusia dari balasan error OCS.
 * Backend ASP.NET mengembalikan bentuk yang berbeda-beda: string polos,
 * { error }, { message }, { title }, atau ProblemDetails { errors: {...} }.
 * Tanpa fungsi ini semuanya tereduksi jadi "HTTP 400" yang tidak menolong.
 */
function pesanError(body: unknown): string {
  if (!body) return '';
  if (typeof body === 'string') return body.slice(0, 400).trim();
  if (typeof body !== 'object') return String(body).slice(0, 400);

  const b = body as Record<string, unknown>;
  const langsung = b.error ?? b.Error ?? b.message ?? b.Message ?? b.title ?? b.Title ?? b.detail ?? b.Detail;
  if (typeof langsung === 'string' && langsung.trim()) return langsung.slice(0, 400).trim();

  const errors = (b.errors ?? b.Errors) as Record<string, unknown> | undefined;
  if (errors && typeof errors === 'object') {
    const rinci = Object.entries(errors)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
      .join(' · ');
    if (rinci) return rinci.slice(0, 400);
  }

  try {
    return JSON.stringify(body).slice(0, 400);
  } catch {
    return '';
  }
}

const q = (v: string) => encodeURIComponent(v);

/**
 * Mulai / lanjutkan dokumen manifest untuk satu basket.
 * Mengembalikan DocId + daftar order yang BELUM dimanifest untuk kurir tsb.
 * CATATAN: basketId di OCS bertipe varchar(10) — lebih panjang ditolak 22001.
 */
export function startManifest(
  params: {
    shipper: string;
    areaId: string;
    basketId: string;
    isProcessing?: boolean;
    docId?: number | null;
  },
  cred?: Kredensial | null,
): Promise<OcsDoc> {
  const { shipper, areaId, basketId, isProcessing = false, docId } = params;
  const path =
    `/Fulfillment/OrderNotManifestedV2?shipper=${q(shipper)}&areaId=${q(areaId)}` +
    `&basketId=${q(basketId)}&isProcessing=${isProcessing}` +
    (docId ? `&docId=${docId}` : '');
  return call<OcsDoc>(path, { method: 'GET' }, cred);
}

/**
 * Resi tidak ada di daftar OrderNotManifested -> tanya OCS kenapa.
 * Balasan berbentuk string "OK#<OrderId>#<TrackingNumber>" atau alasan penolakan.
 */
export async function checkInvalidManifest(
  scan: string,
  shipper: string,
  cred?: Kredensial | null,
): Promise<{ ok: true; orderId: string; trackingNumber: string } | { ok: false; reason: string }> {
  const data = await call<string>(
    `/Fulfillment/CheckInvalidManifest?scan=${q(scan)}&shippingProvider=${q(shipper)}`,
    { method: 'GET' },
    cred,
  );
  const parts = String(data ?? '').split('#');
  if (parts[0] === 'OK') {
    return { ok: true, orderId: parts[1] || '', trackingNumber: parts[2] || scan };
  }
  return { ok: false, reason: String(data ?? 'Tidak diketahui').slice(0, 180) };
}

type DocKey = { shipper: string; basketId: string; areaId: string; docId: number };

function docQuery(k: DocKey): string {
  return `shipper=${q(k.shipper)}&basketId=${q(k.basketId)}&areaId=${q(k.areaId)}&docId=${k.docId}`;
}

/** Simpan sementara (auto-save). OCS menerima maksimal 100 baris sekali kirim. */
export async function saveTemporaryManifest(
  key: DocKey,
  rows: OcsScanPayload[],
  cred?: Kredensial | null,
): Promise<number> {
  let sent = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    await call<unknown>(
      `/Fulfillment/SaveTemporaryManifestV2?${docQuery(key)}`,
      { method: 'POST', body: JSON.stringify(chunk) },
      cred,
    );
    sent += chunk.length;
  }
  return sent;
}

/** Submit final — dokumen manifest ditutup di OCS. */
export function submitManifest(
  key: DocKey,
  rows: OcsScanPayload[],
  cred?: Kredensial | null,
): Promise<unknown> {
  return call<unknown>(
    `/Fulfillment/SubmitManifestV2?${docQuery(key)}`,
    { method: 'POST', body: JSON.stringify(rows) },
    cred,
  );
}

export function checkManifestInBasket(docId: number, cred?: Kredensial | null): Promise<unknown> {
  return call<unknown>(`/Fulfillment/CheckManifestInBasket?docId=${docId}`, { method: 'GET' }, cred);
}

export function getBasketManifestStillProcessing(cred?: Kredensial | null): Promise<unknown[]> {
  return call<unknown[]>('/Fulfillment/GetBasketManifestStillProcessing', { method: 'GET' }, cred);
}

export function getHistoryBasketManifestList(basketId: string, cred?: Kredensial | null): Promise<unknown[]> {
  return call<unknown[]>(
    `/Fulfillment/GetHistoryBasketManifestList?basketId=${q(basketId)}`,
    { method: 'GET' },
    cred,
  );
}

export function getAreaList(cred?: Kredensial | null): Promise<string[]> {
  return call<string[]>('/MasterData/GetAreaList', { method: 'GET' }, cred);
}

export function getBasketManifestList(cred?: Kredensial | null): Promise<string[]> {
  return call<string[]>('/MasterData/GetBasketManifestList', { method: 'GET' }, cred);
}

export function getAllUsername(cred?: Kredensial | null): Promise<{ UserCode: string }[]> {
  return call<{ UserCode: string }[]>('/MasterData/GetAllUsername', { method: 'GET' }, cred);
}

/** Daftar order belum dimanifest versi lama (GET, TIDAK membuat dokumen). */
export function orderNotManifested(shipper: string, cred?: Kredensial | null): Promise<unknown[]> {
  return call<unknown[]>(
    `/Fulfillment/OrderNotManifested?shippingProvider=${q(shipper)}&isAll=false`,
    { method: 'GET' },
    cred,
  );
}

/** Tes koneksi + kredensial (dipakai halaman Admin > Setelan). */
export async function ping(cred?: Kredensial | null): Promise<{ ok: boolean; areas: string[] }> {
  await login(cred);
  const areas = await getAreaList(cred);
  return { ok: true, areas: Array.isArray(areas) ? areas : [] };
}

/**
 * Tes satu akun OCS (dipakai tombol "Tes" di Admin > Pengguna).
 * Sekaligus memeriksa apakah UserCode-nya terdaftar sebagai operator manifest.
 */
export async function tesAkun(cred: Kredensial): Promise<{ ok: boolean; pesan: string }> {
  try {
    await login(cred);
    const users = await getAllUsername(cred).catch(() => [] as { UserCode: string }[]);
    const manifest = users.filter((u) => String(u.UserCode || '').startsWith('MANIFEST')).map((u) => u.UserCode);
    const terdaftar = manifest.some((u) => u.toUpperCase() === cred.username.toUpperCase());
    return {
      ok: true,
      pesan:
        `Login berhasil sebagai ${cred.username} (${cred.companydb}).` +
        (manifest.length
          ? terdaftar
            ? ' Terdaftar sebagai operator manifest di OCS.'
            : ` Catatan: akun ini tidak ada di daftar operator manifest OCS (${manifest.slice(0, 6).join(', ')}…).`
          : ''),
    };
  } catch (e) {
    return { ok: false, pesan: e instanceof Error ? e.message : 'Login gagal.' };
  }
}

export type LangkahDiagnosa = { langkah: string; ok: boolean; pesan: string };

/**
 * Diagnosa read-only: memeriksa tiap prasyarat yang bisa membuat
 * OrderNotManifestedV2 menolak, TANPA membuat dokumen manifest.
 */
export async function diagnosa(params: {
  shipper: string;
  areaId: string;
  cred?: Kredensial | null;
}): Promise<LangkahDiagnosa[]> {
  const { shipper, areaId, cred } = params;
  const hasil: LangkahDiagnosa[] = [];
  const catat = (langkah: string, ok: boolean, pesan: string) => hasil.push({ langkah, ok, pesan });
  const akun = cred ?? kredensialSistem();

  try {
    await login(akun);
    catat('Login OCS', true, `Berhasil sebagai ${akun?.username} / ${akun?.companydb}`);
  } catch (e) {
    catat('Login OCS', false, e instanceof Error ? e.message : 'gagal');
    return hasil;
  }

  try {
    const areas = await getAreaList(akun);
    const daftar = Array.isArray(areas) ? areas.map(String) : [];
    const cocok = daftar.includes(areaId);
    catat(
      `Area "${areaId}"`,
      cocok,
      cocok ? `Dikenal OCS. Semua area: ${daftar.join(', ')}` : `TIDAK ada di OCS. Yang dikenal: ${daftar.join(', ')}`,
    );
  } catch (e) {
    catat('Ambil daftar area', false, e instanceof Error ? e.message : 'gagal');
  }

  try {
    const orders = await orderNotManifested(shipper, akun);
    const jumlah = Array.isArray(orders) ? orders.length : 0;
    catat(
      `Kurir "${shipper}"`,
      true,
      jumlah > 0
        ? `Diterima OCS. ${jumlah} order belum dimanifest untuk kurir ini.`
        : 'Diterima OCS, tapi TIDAK ADA order yang menunggu dimanifest untuk kurir ini. Manifest atas kurir tanpa order biasanya ditolak.',
    );
  } catch (e) {
    catat(
      `Kurir "${shipper}"`,
      false,
      `${e instanceof Error ? e.message : 'gagal'} — nama kurir harus persis sama dengan pilihan di OCS Manifest V2.`,
    );
  }

  try {
    const baskets = await getBasketManifestList(akun);
    const daftar = (Array.isArray(baskets) ? baskets : []).map(String).filter(Boolean);
    if (!daftar.length) {
      catat('Basket di OCS', true, 'Tidak ada basket tercatat.');
    } else {
      const panjang = daftar.map((b) => b.length);
      const terpanjang = [...daftar].sort((a, b) => b.length - a.length).slice(0, 5);
      catat(
        'Basket di OCS',
        true,
        `${daftar.length} basket. Panjang ${Math.min(...panjang)}–${Math.max(...panjang)} karakter. ` +
          `Terpanjang: ${terpanjang.join(', ')}. Kolom basketId di OCS varchar(10).`,
      );
    }
  } catch (e) {
    catat('Basket di OCS', false, e instanceof Error ? e.message : 'gagal');
  }

  return hasil;
}

/* ==================================================================
 * OData /odata/DTO_Orders — dipakai dashboard TV.
 *
 * Dibongkar dari lalu lintas halaman ocs.iegsystem.id/orders-v1 pada
 * 18 September 2026. Halaman itu memanggil:
 *
 *   /odata/DTO_Orders?$orderby=CreatedAt desc&$top=25
 *     &$filter=(StatusCode eq 30000) and (CreatedAt ge 2026-09-16T17:00:00Z)
 *     &$count=true
 *
 * Jadi $filter, $top, $count, dan $orderby semuanya didukung. Dengan
 * $top=0&$count=true kita dapat jumlahnya saja tanpa menarik satu baris pun —
 * itu yang dipakai dashboard.
 * ================================================================== */

/** Kode status dari /MasterData/GetStatusList (18 Sep 2026). */
export const STATUS_OCS = {
  PICKED: 20013,
  PACKED: 20022,
  MANIFESTED: 20030,
  IN_TRANSIT: 30000,
} as const;

/**
 * Nama kolom nomor resi di DTO_Orders. Dibuat bisa disetel karena belum
 * terverifikasi langsung — jalankan `npm run ocs:odata` dari PC untuk melihat
 * daftar kolom aslinya, lalu sesuaikan kalau ternyata bukan TrackingNumber.
 */
export function kolomResiOdata(): string {
  return process.env.OCS_ODATA_FIELD_RESI || 'TrackingNumber';
}

export type OdataHasil<T> = { '@odata.count'?: number; value?: T[] };

export function odataOrders<T = Record<string, unknown>>(
  query: Record<string, string>,
  cred?: Kredensial | null,
): Promise<OdataHasil<T>> {
  const qs = Object.entries(query)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return call<OdataHasil<T>>(`/odata/DTO_Orders?${qs}`, { method: 'GET' }, cred);
}

/** Jumlah order yang cocok dengan filter, tanpa menarik barisnya. */
export async function hitungOrder(filter: string, cred?: Kredensial | null): Promise<number> {
  const hasil = await odataOrders({ $filter: filter, $top: '0', $count: 'true' }, cred);
  const n = hasil['@odata.count'];
  return Number.isFinite(Number(n)) ? Number(n) : 0;
}

/** Apostrof di literal string OData di-escape dengan menggandakannya. */
export function kutipOdata(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}
