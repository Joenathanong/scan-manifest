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
      throw new OcsError(env.error || `OCS menolak permintaan (kode ${env.statusCode}).`, 502);
    }
    return env.data;
  }

  if (!res.ok) {
    const msg = typeof body === 'string' && body ? body.slice(0, 300) : `HTTP ${res.status}`;
    throw new OcsError(`OCS menolak permintaan: ${msg}`, 502);
  }
  return body as T;
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

/** Tes koneksi + kredensial (dipakai halaman Admin > Setelan). */
export async function ping(): Promise<{ ok: boolean; areas: string[] }> {
  await login();
  const areas = await getAreaList();
  return { ok: true, areas: Array.isArray(areas) ? areas : [] };
}
