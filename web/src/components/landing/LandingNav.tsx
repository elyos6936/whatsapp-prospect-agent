import { useEffect, useState } from 'react';
import { KlanvioLogo } from '@/components/brand/KlanvioLogo';
import { cn } from '@/lib/utils';

type LandingNavProps = {
  onLogin: () => void;
  onRegister: () => void;
};

const LINKS = [
  { href: '#fonctionnalites', label: 'Fonctionnalités' },
  { href: '#comment', label: 'Comment ça marche' },
  { href: '#cas-usage', label: 'Cas d\'usage' },
  { href: '#faq', label: 'FAQ' },
];

export function LandingNav({ onLogin, onRegister }: LandingNavProps) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-all duration-300',
        scrolled
          ? 'border-b border-white/10 bg-bg-0/90 backdrop-blur-md'
          : 'bg-transparent',
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <a href="#" className="shrink-0">
          <KlanvioLogo variant="full" size="md" />
        </a>

        <nav className="hidden items-center gap-6 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm text-text-400 transition hover:text-text-100"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onLogin}
            className="rounded-xl px-3 py-2 text-sm text-text-300 transition hover:bg-bg-200 hover:text-text-100"
          >
            Se connecter
          </button>
          <button
            type="button"
            onClick={onRegister}
            className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark"
          >
            Commencer
          </button>
        </div>
      </div>
    </header>
  );
}
