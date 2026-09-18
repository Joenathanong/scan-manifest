import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Monitor Gudang — IEG',
  // Layar TV tidak boleh ikut mode gelap/terang perangkat; tampilannya tetap.
  other: { 'color-scheme': 'dark' },
};

export default function TvLayout({ children }: { children: React.ReactNode }) {
  return <div className="tv-root">{children}</div>;
}
