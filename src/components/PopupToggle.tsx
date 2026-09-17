'use client';

import { usePopupAktif } from '@/lib/scan-prefs';
import { IconFlash, IconFlashOff } from './Icons';

/**
 * Nyala/matikan popup layar penuh setelah scan. Setelannya per perangkat,
 * jadi PC gudang yang dilihat dari jauh bisa menyalakannya sementara PDT di
 * tangan operator boleh mematikannya.
 */
export default function PopupToggle({ ringkas = false }: { ringkas?: boolean }) {
  const [aktif, setAktif] = usePopupAktif();

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button
        type="button"
        className="icon-btn"
        onClick={() => setAktif(!aktif)}
        aria-pressed={aktif}
        aria-label={aktif ? 'Matikan popup hasil scan' : 'Nyalakan popup hasil scan'}
        title={
          aktif
            ? 'Popup hasil scan MENYALA — layar penuh hijau/merah setiap scan'
            : 'Popup hasil scan MATI — klik untuk menyalakan'
        }
      >
        {aktif ? <IconFlash className="ico" /> : <IconFlashOff className="ico" />}
      </button>
      {!ringkas && (
        <span style={{ fontSize: 12, color: 'var(--ink-label, #64748b)' }}>
          Popup {aktif ? 'menyala' : 'mati'}
        </span>
      )}
    </span>
  );
}
