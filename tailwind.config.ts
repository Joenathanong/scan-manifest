import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['selector', '[data-theme="evening"]'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    screens: { sm: '480px', md: '768px', lg: '1024px', xl: '1280px', '2xl': '1600px' },
    extend: {
      colors: {
        canvas: 'var(--bg-canvas)',
        surface: 'var(--bg-surface)',
        'surface-alt': 'var(--bg-surface-alt)',
        sunken: 'var(--bg-sunken)',
        ink: 'var(--ink)',
        label: 'var(--ink-label)',
        muted: 'var(--ink-muted)',
        primary: {
          DEFAULT: 'var(--primary)',
          solid: 'var(--primary-solid)',
          hover: 'var(--primary-hover)',
          subtle: 'var(--primary-subtle)',
          'subtle-fg': 'var(--primary-subtle-fg)',
        },
        positive: 'var(--positive)',
        critical: 'var(--critical)',
        negative: 'var(--negative)',
        informative: 'var(--informative)',
        neutral: 'var(--neutral)',
        c1: 'var(--c1)', c2: 'var(--c2)', c3: 'var(--c3)',
        c4: 'var(--c4)', c5: 'var(--c5)', c6: 'var(--c6)',
      },
      borderColor: {
        DEFAULT: 'var(--border)',
        subtle: 'var(--border-subtle)',
        strong: 'var(--border-strong)',
      },
      borderRadius: { card: '12px', control: '8px', grid: '4px' },
      boxShadow: { e0: 'var(--shadow-0)', e1: 'var(--shadow-1)', e2: 'var(--shadow-2)' },
      zIndex: {
        sticky: '10', topbar: '30', sidebar: '40', backdrop: '50',
        drawer: '60', modal: '70', toast: '80', tooltip: '90',
      },
      fontFamily: { sans: 'var(--font-sans)', mono: 'var(--font-mono)' },
    },
  },
  plugins: [],
};
export default config;
