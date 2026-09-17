import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { currentUser } from '@/lib/api';
import { fmtDate, fmtDateTime } from '@/lib/date';
import PrintButton from './PrintButton';

export const dynamic = 'force-dynamic';

/** Label keranjang untuk printer termal 58mm. Halaman ini di luar shell. */
export default async function LabelPage({ params }: { params: Promise<{ code: string }> }) {
  const user = await currentUser();
  if (!user) redirect('/login');

  const { code: raw } = await params;
  const code = decodeURIComponent(raw).toUpperCase();
  const basket = await prisma.basket.findUnique({
    where: { code },
    include: { expedisi: true, _count: { select: { items: true } } },
  });
  if (!basket) notFound();

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: 'var(--bg-canvas)',
        display: 'grid',
        placeItems: 'start center',
        padding: 16,
        overflowY: 'auto',
      }}
    >
      <div style={{ display: 'grid', gap: 12, justifyItems: 'center' }}>
        <div
          className="label-sheet"
          style={{
            width: '52mm',
            background: '#fff',
            color: '#000',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '4mm',
            textAlign: 'center',
            fontFamily: 'var(--font-sans)',
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em' }}>IEG · MANIFEST</div>
          <div style={{ fontSize: 22, fontWeight: 800, margin: '2mm 0' }}>{basket.expedisi.code}</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/label/${encodeURIComponent(basket.code)}`}
            alt={`QR ${basket.code}`}
            style={{ width: '40mm', height: '40mm', display: 'block', margin: '0 auto' }}
          />
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, marginTop: '2mm' }}>
            {basket.code}
          </div>
          <div style={{ fontSize: 10, marginTop: '1mm' }}>
            {basket.areaId} · {fmtDate(basket.date)}
          </div>
          <div style={{ fontSize: 10 }}>{basket.expedisi.name}</div>
        </div>

        <div className="card no-print" style={{ width: 'min(92vw, 360px)', display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 13 }}>
            <strong>{basket.code}</strong> · {basket._count.items} resi · dibuat {fmtDateTime(basket.createdAt)}
          </div>
          <PrintButton />
          <p className="muted" style={{ fontSize: 12 }}>
            Ukuran kertas diatur 58mm. Di Chrome pilih <em>Margins: None</em> dan matikan header/footer supaya QR
            tidak terpotong.
          </p>
        </div>
      </div>
    </div>
  );
}
