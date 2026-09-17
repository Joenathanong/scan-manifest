type P = { className?: string };

const base = 'ico';

function Svg({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      className={className ?? base}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconDashboard = (p: P) => (
  <Svg className={p.className}>
    <rect x="3" y="3" width="7" height="8" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="11" width="7" height="10" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
  </Svg>
);

export const IconScan1 = (p: P) => (
  <Svg className={p.className}>
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
    <path d="M3 12h18" />
  </Svg>
);

export const IconScan2 = (p: P) => (
  <Svg className={p.className}>
    <path d="M3 6h2v12H3zM7 6h1v12H7zM10 6h2v12h-2zM14 6h1v12h-1zM17 6h2v12h-2zM21 6h.5v12H21z" />
  </Svg>
);

export const IconBasket = (p: P) => (
  <Svg className={p.className}>
    <path d="M5 9h14l-1.2 9.2A2 2 0 0 1 15.8 20H8.2a2 2 0 0 1-2-1.8L5 9Z" />
    <path d="M9 9 12 3l3 6" />
  </Svg>
);

export const IconHistory = (p: P) => (
  <Svg className={p.className}>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v4h4" />
    <path d="M12 8v4l3 2" />
  </Svg>
);

export const IconUsers = (p: P) => (
  <Svg className={p.className}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 20a6 6 0 0 1 12 0" />
    <path d="M16.5 5.5a3 3 0 0 1 0 5.6M18 20a6 6 0 0 0-2-4.5" />
  </Svg>
);

export const IconTruck = (p: P) => (
  <Svg className={p.className}>
    <path d="M3 16V6h11v10" />
    <path d="M14 9h3.5l2.5 3v4H14" />
    <circle cx="7.5" cy="17.5" r="1.8" />
    <circle cx="16.5" cy="17.5" r="1.8" />
  </Svg>
);

export const IconSettings = (p: P) => (
  <Svg className={p.className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
  </Svg>
);

export const IconSun = (p: P) => (
  <Svg className={p.className}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
  </Svg>
);

export const IconMoon = (p: P) => (
  <Svg className={p.className}>
    <path d="M20 14.5A8.2 8.2 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z" />
  </Svg>
);

export const IconMenu = (p: P) => (
  <Svg className={p.className}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);

export const IconLogout = (p: P) => (
  <Svg className={p.className}>
    <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
    <path d="M10 8l-4 4 4 4M6 12h10" />
  </Svg>
);

export const IconCollapse = (p: P) => (
  <Svg className={p.className}>
    <path d="M14 7l-5 5 5 5" />
  </Svg>
);

export const IconExpand = (p: P) => (
  <Svg className={p.className}>
    <path d="M10 7l5 5-5 5" />
  </Svg>
);

export const IconPrint = (p: P) => (
  <Svg className={p.className}>
    <path d="M7 8V4h10v4" />
    <rect x="4" y="8" width="16" height="7" rx="2" />
    <path d="M7 15h10v5H7z" />
  </Svg>
);

export const IconKey = (p: P) => (
  <Svg className={p.className}>
    <circle cx="8" cy="12" r="3.5" />
    <path d="M11.5 12H20l1.5 1.5M17 12v3" />
  </Svg>
);
