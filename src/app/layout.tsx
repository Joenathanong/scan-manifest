import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Scan Manifest IEG',
  description: 'Scan resi tahap 1 & manifest tahap 2 terhubung ke OCS',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
};

const themeInit = `
(function(){try{
  var t=localStorage.getItem('ieg-theme');
  if(t==='morning'||t==='evening')document.documentElement.dataset.theme=t;
}catch(e){}})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        {children}
      </body>
    </html>
  );
}
