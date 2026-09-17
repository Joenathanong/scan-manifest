/**
 * Klien API IEG OCS (ocs.iegsystem.id) untuk modul Manifest V2.
 *
 * Kontrak endpoint dibongkar langsung dari bundel `assets/manifest-v2-*.js`
 * pada 17 Sep 2026 — lihat docs/ocs-integration.md.
 *
 * Auth : POST /Auth/Login { username, password, companydb } -> { Token }
 *        Header berikutnya: Authorization: Bearer <Token>. JWT berlaku 24 jam.
 * Balasan backend dibungkus { statusCode, data, error }.
 */

export type OcsEnvelope<T> = { statusCode: number; data: T; error?: string | null };

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

const globalForOcs = globalThis as unknown as { __ocsToken?: Cached };

function cfg() {
  const baseUrl = (process.env.OCS_BASE_URL || 'https://ocs.iegsystem.id').replace(/\/+$/, '');
  const username = process.env.OCS_USERNAME || '';
  const password = process.env.OCS_PASSWORD || '';
  const companydb = process.env.OCS_COMPANYDB || '';
  const timeout = Number(process.env.OCS_TIMEOUT_MS || 30000);
  return { baseUrl, username, password, companydb, timeout };
}

export function ocsEnabled(): boolean {
  const { username, password, companydb } = cfg();
  return process.env.OCS_ENABLED !== 'false' && !!username && !!password && !!companydb;
}

async function rawFetch(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const { baseUrl } = cfg();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${baseUrl}${path}`, { ...init, signal: controller.signal, cache: 'no-store' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new OcsError(
      /abort/i.test(msg) ? `OCS tidak menjawab dalam ${Math.round(timeoutMs / 1000)} detik.` : `Tidak bisa menghubungi OCS: ${msg}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function login(): Promise<string> {
  const { username, password, companydb, timeout } = cfg();
  if (!username || !password || !companydb) {
    throw new OcsError('Kredensial OCS belum diisi (OCS_USERNAME / OCS_PASSWORD / OCS_COMPANYDB).', 500);
  }
  const res = await rawFetch(
    '/Auth/Login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, companydb }),
    },
    timeout,
  );
  const body = (await res.json().catch(() => null)) as { Token?: string; token?: string; error?: string } | null;
  const token = body?.Token || body?.token;
  if (!res.ok || !token) {
    throw new OcsError(body?.error || `Login OCS gagal (HTTP ${res.status}).`, res.status === 401 ? 401 : 502);
  }
  // JWT OCS berlaku 24 jam; disimpan 20 jam saja supaya tidak kadaluwarsa di tengah proses.
  globalForOcs.__ocsToken = { token, expiresAt: Date.now() + 20 * 3600 * 1000 };
  return token;
}

async function token(force = false): Promise<string> {
  const cached = globalForOcs.__ocsToken;
  if (!force && cached && cached.expiresAt > Date.now()) return cached.token;
  return login();
}

async function call<T>(
  path: string,
  init: RequestInit = {},
  retryOn401 = true,
): Promise<T> {
  const { timeout } = cfg();
  const jwt = await token();
  const res = await rawFetch(
    path,
    {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
        ...(init.headers || {}),
      },
    },
    timeout,
  );

  if (res.status === 401 && retryOn401) {
    globalForOcs.__ocsToken = undefined;
    await token(true);
    return call<T>(path, init, false);
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
    const msg = pesanError(body) || `HTTP ${res.status}`;
    throw new OcsError(`OCS menolak: ${msg} — ${path.split('?')[0]}`, 502);
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
 */
export function startManifest(params: {
  shipper: string;
  areaId: string;
  basketId: string;
  isProcessing?: boolean;
  docId?: number | null;
}): Promise<OcsDoc> {
  const { shipper, areaId, basketId, isProcessing = false, docId } = params;
  const path =
    `/Fulfillment/OrderNotManifestedV2?shipper=${q(shipper)}&areaId=${q(areaId)}` +
    `&basketId=${q(basketId)}&isProcessing=${isProcessing}` +
    (docId ? `&docId=${docId}` : '');
  return call<OcsDoc>(path, { method: 'GET' });
}

/**
 * Resi tidak ada di daftar OrderNotManifested -> tanya OCS kenapa.
 * Balasan berbentuk string "OK#<OrderId>#<TrackingNumber>" atau alasan penolakan.
 */
export async function checkInvalidManifest(
  scan: string,
  shipper: string,
): Promise<{ ok: true; orderId: string; trackingNumber: string } | { ok: false; reason: string }> {
  const data = await call<string>(
    `/Fulfillment/CheckInvalidManifest?scan=${q(scan)}&shippingProvider=${q(shipper)}`,
    { method: 'GET' },
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
export async function saveTemporaryManifest(key: DocKey, rows: OcsScanPayload[]): Promise<number> {
  let sent = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    await call<unknown>(`/Fulfillment/SaveTemporaryManifestV2?${docQuery(key)}`, {
      method: 'POST',
      body: JSON.stringify(chunk),
    });
    sent += chunk.length;
  }
  return sent;
}

/** Submit final — dokumen manifest ditutup di OCS. */
export function submitManifest(key: DocKey, rows: OcsScanPayload[]): Promise<unknown> {
  return call<unknown>(`/Fulfillment/SubmitManifestV2?${docQuery(key)}`, {
    method: 'POST',
    body: JSON.stringify(rows),
  });
}

export function checkManifestInBasket(docId: number): Promise<unknown> {
  return call<unknown>(`/Fulfillment/CheckManifestInBasket?docId=${docId}`, { method: 'GET' });
}

export function getBasketManifestStillProcessing(): Promise<unknown[]> {
  return call<unknown[]>('/Fulfillment/GetBasketManifestStillProcessing', { method: 'GET' });
}

export function getHistoryBasketManifestList(basketId: string): Promise<unknown[]> {
  return call<unknown[]>(`/Fulfillment/GetHistoryBasketManifestList?basketId=${q(basketId)}`, {
    method: 'GET',
  });
}

export function getAreaList(): Promise<string[]> {
  return call<string[]>('/MasterData/GetAreaList', { method: 'GET' });
}

export function getBasketManifestList(): Promise<string[]> {
  return call<string[]>('/MasterData/GetBasketManifestList', { method: 'GET' });
}

/** Daftar order belum dimanifest versi lama (GET, TIDAK membuat dokumen). */
export function orderNotManifested(shipper: string): Promise<unknown[]> {
  return call<unknown[]>(
    `/Fulfillment/OrderNotManifested?shippingProvider=${q(shipper)}&isAll=false`,
    { method: 'GET' },
  );
}

/** Tes koneksi + kredensial (dipakai halaman Admin > Setelan). */
export async function ping(): Promise<{ ok: boolean; areas: string[] }> {
  await login();
  const areas = await getAreaList();
  return { ok: true, areas: Array.isArray(areas) ? areas : [] };
}

export type LangkahDiagnosa = { langkah: string; ok: boolean; pesan: string };

/**
 * Diagnosa read-only: memeriksa tiap prasyarat yang bisa membuat
 * OrderNotManifestedV2 menolak dengan 400, TANPA membuat dokumen manifest.
 */
export async function diagnosa(params: { shipper: string; areaId: string }): Promise<LangkahDiagnosa[]> {
  const hasil: LangkahDiagnosa[] = [];
  const catat = (langkah: string, ok: boolean, pesan: string) => hasil.push({ langkah, ok, pesan });

  try {
    await login();
    catat('Login OCS', true, `Berhasil sebagai ${process.env.OCS_USERNAME} / ${process.env.OCS_COMPANYDB}`);
  } catch (e) {
    catat('Login OCS', false, e instanceof Error ? e.message : 'gagal');
    return hasil;
  }

  try {
    const areas = await getAreaList();
    const daftar = Array.isArray(areas) ? areas.map(String) : [];
    const cocok = daftar.includes(params.areaId);
    catat(
      `Area "${params.areaId}"`,
      cocok,
      cocok ? `Dikenal OCS. Semua area: ${daftar.join(', ')}` : `TIDAK ada di OCS. Yang dikenal: ${daftar.join(', ')}`,
    );
  } catch (e) {
    catat('Ambil daftar area', false, e instanceof Error ? e.message : 'gagal');
  }

  try {
    const orders = await orderNotManifested(params.shipper);
    const jumlah = Array.isArray(orders) ? orders.length : 0;
    catat(
      `Kurir "${params.shipper}"`,
      true,
      jumlah > 0
        ? `Diterima OCS. ${jumlah} order belum dimanifest untuk kurir ini.`
        : 'Diterima OCS, tapi TIDAK ADA order yang menunggu dimanifest untuk kurir ini. Manifest atas kurir tanpa order biasanya ditolak.',
    );
  } catch (e) {
    catat(
      `Kurir "${params.shipper}"`,
      false,
      `${e instanceof Error ? e.message : 'gagal'} — nama kurir harus persis sama dengan pilihan di OCS Manifest V2.`,
    );
  }

  try {
    const baskets = await getBasketManifestList();
    catat('Daftar basket OCS', true, `${Array.isArray(baskets) ? baskets.length : 0} basket tercatat di OCS.`);
  } catch (e) {
    catat('Daftar basket OCS', false, e instanceof Error ? e.message : 'gagal');
  }

  return hasil;
}
