'use client';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function request<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
      cache: 'no-store',
    });
    const body = (await res.json().catch(() => null)) as ApiResult<T> | null;
    if (!body) return { ok: false, error: `Balasan server tidak terbaca (HTTP ${res.status}).` };
    return body;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Tidak bisa menghubungi server.' };
  }
}

export function apiGet<T>(url: string) {
  return request<T>(url, { method: 'GET' });
}

export function apiPost<T>(url: string, body?: unknown) {
  return request<T>(url, { method: 'POST', body: JSON.stringify(body ?? {}) });
}

export function apiPatch<T>(url: string, body?: unknown) {
  return request<T>(url, { method: 'PATCH', body: JSON.stringify(body ?? {}) });
}

export function apiDelete<T>(url: string) {
  return request<T>(url, { method: 'DELETE' });
}
