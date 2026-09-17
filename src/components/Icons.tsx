type P = { className?: string };

const base = 'ico';

function Svg({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      className={className ?? base}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
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
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.8v2.1M12 19.1v2.1M2.8 12h2.1M19.1 12h2.1" />
    <path d="M5.4 5.4l1.5 1.5M17.1 17.1l1.5 1.5M18.6 5.4l-1.5 1.5M6.9 17.1l-1.5 1.5" />
  </Svg>
);

export const IconMoon = (p: P) => (
  <Svg className={p.className}>
    <path d="M20.6 14.1A8.9 8.9 0 0 1 9.9 3.4 8.6 8.6 0 1 0 20.6 14.1Z" />
  </Svg>
);

export const IconMenu = (p: P) => (
  <Svg className={p.className}>
    <path d="M4 7h16M4 12h16M4 17h11" />
  </Svg>
);

export const IconLogout = (p: P) => (
  <Svg className={p.className}>
    <path d="M10 4H6.6A2.6 2.6 0 0 0 4 6.6v10.8A2.6 2.6 0 0 0 6.6 20H10" />
    <path d="M15.6 8.4 19.2 12l-3.6 3.6" />
    <path d="M19.2 12H9.6" />
  </Svg>
);

export const IconCollapse = (p: P) => (
  <Svg className={p.className}>
    <path d="M14.5 6.8 9.3 12l5.2 5.2" />
  </Svg>
);

export const IconExpand = (p: P) => (
  <Svg className={p.className}>
    <path d="M9.5 6.8 14.7 12l-5.2 5.2" />
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

export const IconEye = (p: P) => (
  <Svg className={p.className}>
    <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);

export const IconEyeOff = (p: P) => (
  <Svg className={p.className}>
    <path d="M9.9 5.1A9.6 9.6 0 0 1 12 4.9c6 0 9.5 6.2 9.5 6.2a17 17 0 0 1-2.8 3.6" />
    <path d="M6.3 6.5A16.7 16.7 0 0 0 2.5 11.1s3.5 6.2 9.5 6.2a9.5 9.5 0 0 0 3.7-.7" />
    <path d="M10.1 10a2.8 2.8 0 0 0 3.9 3.9" />
    <path d="m4 4 16 16" />
  </Svg>
);

export const IconDownload = (p: P) => (
  <Svg className={p.className}>
    <path d="M12 3.5v11" />
    <path d="m7.6 10.4 4.4 4.4 4.4-4.4" />
    <path d="M4.5 16.5v1.4A2.6 2.6 0 0 0 7.1 20.5h9.8a2.6 2.6 0 0 0 2.6-2.6v-1.4" />
  </Svg>
);
