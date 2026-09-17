'use client';

/**
 * Antrean scan di PERANGKAT (PDT / PC).
 *
 * Aturan yang dipegang berkas ini:
 *  - Scan TIDAK PERNAH hilang. Kalau jaringan putus, scan masuk IndexedDB.
 *  - Begitu jaringan kembali (event `online`, atau pemeriksaan berkala),
 *    antrean dikirim ulang otomatis, berurutan, satu per satu.
 *  - Hasil pengiriman yang ditolak server (mis. resi dobel) tidak dibuang
 *    diam-diam — masuk daftar "laporan" supaya operator/supervisor melihatnya.
 */

export type QueueKind = 'scan1' | 'scan2';

export type QueueRow = {
  id: number;
  kind: QueueKind;
  url: string;
  payload: Record<string, unknown>;
  label: string;
  createdAt: number;
  tries: number;
  lastError?: string;
};

export type QueueReport = {
  id: number;
  label: string;
  ok: boolean;
  message: string;
  at: number;
};

const DB_NAME = 'scan-manifest';
const DB_VERSION = 1;
const STORE_QUEUE = 'queue';
const STORE_REPORT = 'reports';

type State = { pending: number; reports: QueueReport[]; online: boolean; flushing: boolean };

let state: State = { pending: 0, reports: [], online: true, flushing: false };
const listeners = new Set<(s: State) => void>();

// Cadangan kalau IndexedDB diblokir (mode privat / kebijakan perangkat).
let memQueue: QueueRow[] = [];
let memReports: QueueReport[] = [];
let memSeq = 1;
let useMemory = false;

function emit() {
  const snapshot = { ...state, reports: [...state.reports] };
  listeners.forEach((l) => l(snapshot));
}

export function subscribeQueue(fn: (s: State) => void): () => void {
  listeners.add(fn);
  fn({ ...state, reports: [...state.reports] });
  return () => {
    listeners.delete(fn);
  };
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_QUEUE)) {
          db.createObjectStore(STORE_QUEUE, { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains(STORE_REPORT)) {
          db.createObjectStore(STORE_REPORT, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
  const db = await openDb();
  if (!db) {
    useMemory = true;
    return null;
  }
  return new Promise<T | null>((resolve) => {
    try {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function allRows(): Promise<QueueRow[]> {
  if (useMemory) return [...memQueue];
  const rows = await tx<QueueRow[]>(STORE_QUEUE, 'readonly', (s) => s.getAll());
  if (rows === null) return [...memQueue];
  return rows.sort((a, b) => a.id - b.id);
}

async function allReports(): Promise<QueueReport[]> {
  if (useMemory) return [...memReports];
  const rows = await tx<QueueReport[]>(STORE_REPORT, 'readonly', (s) => s.getAll());
  if (rows === null) return [...memReports];
  return rows.sort((a, b) => b.id - a.id).slice(0, 50);
}

async function refresh() {
  const [rows, reports] = await Promise.all([allRows(), allReports()]);
  state = { ...state, pending: rows.length, reports };
  emit();
}

export async function enqueue(kind: QueueKind, url: string, payload: Record<string, unknown>, label: string) {
  const row: Omit<QueueRow, 'id'> & { id?: number } = {
    kind,
    url,
    payload,
    label,
    createdAt: Date.now(),
    tries: 0,
  };
  if (useMemory) {
    memQueue.push({ ...(row as QueueRow), id: memSeq++ });
  } else {
    const res = await tx<number>(STORE_QUEUE, 'readwrite', (s) => s.add(row));
    if (res === null) {
      useMemory = true;
      memQueue.push({ ...(row as QueueRow), id: memSeq++ });
    }
  }
  await refresh();
}

async function removeRow(id: number) {
  if (useMemory) {
    memQueue = memQueue.filter((r) => r.id !== id);
    return;
  }
  await tx(STORE_QUEUE, 'readwrite', (s) => s.delete(id));
}

async function bumpRow(row: QueueRow, error: string) {
  const next = { ...row, tries: row.tries + 1, lastError: error };
  if (useMemory) {
    memQueue = memQueue.map((r) => (r.id === row.id ? next : r));
    return;
  }
  await tx(STORE_QUEUE, 'readwrite', (s) => s.put(next));
}

async function addReport(label: string, ok: boolean, message: string) {
  const rep = { label, ok, message, at: Date.now() };
  if (useMemory) {
    memReports = [{ ...rep, id: memSeq++ }, ...memReports].slice(0, 50);
    return;
  }
  const res = await tx<number>(STORE_REPORT, 'readwrite', (s) => s.add(rep));
  if (res === null) memReports = [{ ...rep, id: memSeq++ }, ...memReports].slice(0, 50);
}

export async function clearReports() {
  if (useMemory) memReports = [];
  else await tx(STORE_REPORT, 'readwrite', (s) => s.clear());
  await refresh();
}

/** Buang seluruh antrean — hanya dipakai lewat tombol sadar di halaman Setelan. */
export async function clearQueue() {
  if (useMemory) memQueue = [];
  else await tx(STORE_QUEUE, 'readwrite', (s) => s.clear());
  await refresh();
}

let flushing = false;

/**
 * Kirim antrean. Berhenti begitu ada kegagalan JARINGAN supaya urutan scan
 * terjaga; kegagalan bisnis (resi dobel, dsb) dicatat lalu antrean lanjut.
 */
export async function flushQueue(): Promise<{ sent: number; left: number }> {
  if (flushing || typeof navigator === 'undefined' || !navigator.onLine) {
    const rows = await allRows();
    return { sent: 0, left: rows.length };
  }
  flushing = true;
  state = { ...state, flushing: true };
  emit();

  let sent = 0;
  try {
    const rows = await allRows();
    for (const row of rows) {
      let res: Response;
      try {
        res = await fetch(row.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(row.payload),
          cache: 'no-store',
        });
      } catch (e) {
        await bumpRow(row, e instanceof Error ? e.message : 'Jaringan putus');
        break; // jaringan mati lagi — sisanya menunggu
      }

      if (res.status >= 500 || res.status === 0) {
        await bumpRow(row, `Server balas ${res.status}`);
        break;
      }

      const body = (await res.json().catch(() => null)) as
        | { ok: boolean; data?: { message?: string; status?: string }; error?: string }
        | null;

      if (body?.ok) {
        sent += 1;
        const st = body.data?.status;
        if (st && st !== 'OK') {
          await addReport(row.label, false, body.data?.message || `Ditolak: ${st}`);
        }
      } else {
        await addReport(row.label, false, body?.error || `Gagal (HTTP ${res.status})`);
      }
      await removeRow(row.id);
    }
  } finally {
    flushing = false;
    state = { ...state, flushing: false };
    await refresh();
  }

  const left = (await allRows()).length;
  return { sent, left };
}

let started = false;

/** Dipanggil sekali dari shell. Memasang pendengar online/offline + timer. */
export function startQueueWatcher() {
  if (started || typeof window === 'undefined') return;
  started = true;
  state = { ...state, online: navigator.onLine };

  const onOnline = () => {
    state = { ...state, online: true };
    emit();
    void flushQueue();
  };
  const onOffline = () => {
    state = { ...state, online: false };
    emit();
  };

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flushQueue();
  });
  setInterval(() => {
    void flushQueue();
  }, 20000);

  void refresh();
  void flushQueue();
}

/**
 * Kirim satu scan. Kalau jaringan gagal, scan MASUK ANTREAN dan fungsi ini
 * mengembalikan status 'QUEUED' — bukan error. Halaman scan memakai hasil ini
 * untuk memberi nada & warna yang berbeda dari "berhasil".
 */
export async function sendOrQueue<T extends { status: string; message: string }>(
  kind: QueueKind,
  url: string,
  payload: Record<string, unknown>,
  label: string,
): Promise<{ queued: boolean; data?: T; error?: string }> {
  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('offline');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    if (res.status >= 500) throw new Error(`Server balas ${res.status}`);
    const body = (await res.json().catch(() => null)) as { ok: boolean; data?: T; error?: string } | null;
    if (!body) throw new Error('Balasan server tidak terbaca');
    if (!body.ok) return { queued: false, error: body.error || 'Ditolak server.' };
    return { queued: false, data: body.data };
  } catch {
    await enqueue(kind, url, payload, label);
    return { queued: true };
  }
}
