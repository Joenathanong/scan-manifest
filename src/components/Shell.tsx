'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiPost } from '@/lib/client';
import { ToastHost } from './Toast';
import SyncBanner from './SyncBanner';
import {
  IconBasket,
  IconCollapse,
  IconDashboard,
  IconExpand,
  IconHistory,
  IconLogout,
  IconMenu,
  IconMoon,
  IconScan1,
  IconScan2,
  IconSettings,
  IconSun,
  IconTruck,
  IconUsers,
} from './Icons';

export type ShellUser = {
  id: number;
  name: string;
  username: string;
  role: 'ADMIN' | 'SUPERVISOR' | 'OPERATOR';
};

type Item = {
  href: string;
  label: string;
  Icon: (p: { className?: string }) => React.JSX.Element;
  roles?: ShellUser['role'][];
};
type Group = { title: string; items: Item[] };

const MENU: Group[] = [
  {
    title: 'Operasional',
    items: [
      { href: '/dashboard', label: 'Dashboard', Icon: IconDashboard },
      { href: '/scan-1', label: 'Scan 1 — Resi', Icon: IconScan1 },
      { href: '/scan-2', label: 'Scan 2 — Manifest', Icon: IconScan2 },
      { href: '/basket', label: 'Basket', Icon: IconBasket },
    ],
  },
  {
    title: 'Laporan',
    items: [{ href: '/history', label: 'Riwayat Resi', Icon: IconHistory }],
  },
  {
    title: 'Admin',
    items: [
      { href: '/admin/users', label: 'Pengguna', Icon: IconUsers, roles: ['ADMIN'] },
      { href: '/admin/expedisi', label: 'Ekspedisi', Icon: IconTruck, roles: ['ADMIN', 'SUPERVISOR'] },
      { href: '/admin/settings', label: 'Setelan OCS', Icon: IconSettings, roles: ['ADMIN'] },
    ],
  },
];

type Mode = 'expanded' | 'rail' | 'drawer';

export default function Shell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mode, setMode] = useState<Mode>('expanded');
  const [theme, setTheme] = useState<'morning' | 'evening'>('morning');
  const burgerRef = useRef<HTMLButtonElement>(null);
  const sideRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  /* --- mode sidebar mengikuti lebar layar (§8) --- */
  useEffect(() => {
    const mqMobile = window.matchMedia('(max-width: 767.98px)');
    const mqDesk = window.matchMedia('(min-width: 1280px)');
    const apply = () => {
      if (mqMobile.matches) setMode('drawer');
      else if (!mqDesk.matches) setMode('rail');
      else setMode(collapsed ? 'rail' : 'expanded');
    };
    apply();
    mqMobile.addEventListener('change', apply);
    mqDesk.addEventListener('change', apply);
    return () => {
      mqMobile.removeEventListener('change', apply);
      mqDesk.removeEventListener('change', apply);
    };
  }, [collapsed]);

  /* drawer selalu mulai tertutup & tutup saat layar melebar */
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setDrawer(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('ieg-side');
      if (saved === 'rail') setCollapsed(true);
      const t = localStorage.getItem('ieg-theme');
      if (t === 'morning' || t === 'evening') setTheme(t);
      else setTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'evening' : 'morning');
    } catch {
      /* penyimpanan diblokir: pakai bawaan */
    }
  }, []);

  /* kunci gulir + jebak fokus saat drawer terbuka */
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    main.style.overflowY = drawer ? 'hidden' : 'auto';
    main.inert = drawer;
    if (drawer) sideRef.current?.querySelector<HTMLElement>('a,button')?.focus();
    else burgerRef.current?.focus({ preventScroll: true });
  }, [drawer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawer(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const toggleTheme = useCallback(() => {
    const next = theme === 'evening' ? 'morning' : 'evening';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('ieg-theme', next);
    } catch {
      /* abaikan */
    }
  }, [theme]);

  const toggleCollapse = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem('ieg-side', next ? 'rail' : 'expanded');
      } catch {
        /* abaikan */
      }
      return next;
    });
  }, []);

  const logout = useCallback(async () => {
    await apiPost('/api/auth/logout');
    router.replace('/login');
    router.refresh();
  }, [router]);

  const sideMode: 'rail' | 'expanded' = mode === 'rail' ? 'rail' : 'expanded';
  const currentTitle =
    MENU.flatMap((g) => g.items).find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))?.label ??
    'Scan Manifest';

  return (
    <div className="app-shell" data-drawer={drawer ? 'open' : 'closed'}>
      <nav
        ref={sideRef}
        className="app-side"
        data-mode={mode === 'drawer' ? 'expanded' : sideMode}
        aria-label="Menu utama"
        {...(mode === 'drawer' && drawer ? { role: 'dialog', 'aria-modal': true } : {})}
      >
        <div className="side-head">
          <span
            aria-hidden
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'var(--grad-brand)',
              display: 'grid',
              placeItems: 'center',
              color: '#fff',
              fontWeight: 700,
              fontSize: 13,
              flex: 'none',
            }}
          >
            IEG
          </span>
          <span className="brand-name" style={{ fontSize: 15, fontWeight: 700 }}>
            Scan Manifest
          </span>
        </div>

        <div className="side-nav">
          {MENU.map((group) => {
            const items = group.items.filter((i) => !i.roles || i.roles.includes(user.role));
            if (!items.length) return null;
            return (
              <div key={group.title}>
                <div className="nav-group">{group.title}</div>
                {items.map(({ href, label, Icon }) => {
                  const active = pathname === href || pathname.startsWith(`${href}/`);
                  return (
                    <Link
                      key={href}
                      href={href}
                      className={`nav-item${active ? ' is-active' : ''}`}
                      aria-current={active ? 'page' : undefined}
                      title={label}
                      onClick={() => setDrawer(false)}
                    >
                      <span className="nav-mark" />
                      <Icon className="ico" />
                      <span className="lbl">{label}</span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="side-foot">
          <div className="foot-text" style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user.name}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
              {user.username} · {user.role}
            </div>
          </div>
          <button
            type="button"
            className="icon-btn collapse-btn"
            style={{ width: 36, height: 36 }}
            onClick={toggleCollapse}
            disabled={mode === 'drawer'}
            aria-label={collapsed ? 'Lebarkan menu' : 'Ciutkan menu'}
            title={collapsed ? 'Lebarkan menu' : 'Ciutkan menu'}
          >
            {collapsed ? <IconExpand className="ico" /> : <IconCollapse className="ico" />}
          </button>
        </div>
      </nav>

      <div className="backdrop" onClick={() => setDrawer(false)} aria-hidden />

      <header className="app-top">
        <button
          ref={burgerRef}
          type="button"
          className="icon-btn"
          style={{ display: mode === 'drawer' ? 'inline-grid' : 'none' }}
          aria-expanded={drawer}
          aria-controls="side"
          aria-label="Buka menu"
          onClick={() => setDrawer((d) => !d)}
        >
          <IconMenu className="ico ico-lg" />
        </button>
        <span style={{ fontSize: 15, fontWeight: 600, flex: 1, minWidth: 0 }}>{currentTitle}</span>
        <button
          type="button"
          className="icon-btn"
          data-tone="brand"
          onClick={toggleTheme}
          aria-label={theme === 'evening' ? 'Ganti ke tema Morning' : 'Ganti ke tema Evening'}
          title={theme === 'evening' ? 'Tema Morning (terang)' : 'Tema Evening (gelap)'}
        >
          {theme === 'evening' ? <IconSun className="ico ico-lg" /> : <IconMoon className="ico ico-lg" />}
        </button>
        <button
          type="button"
          className="icon-btn"
          data-tone="danger"
          onClick={logout}
          aria-label="Keluar"
          title="Keluar"
        >
          <IconLogout className="ico ico-lg" />
        </button>
      </header>

      <main ref={mainRef} className="app-main" id="main">
        <div className="page">
          <SyncBanner />
          {children}
        </div>
      </main>

      <ToastHost />
    </div>
  );
}
