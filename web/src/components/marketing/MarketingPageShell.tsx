import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { KlanvioLogo } from '@/components/brand/KlanvioLogo';
import { SeoHead, type SeoHeadProps } from '@/components/SeoHead';
import { cn } from '@/lib/utils';

type MarketingPageShellProps = {
  seo: SeoHeadProps;
  children: ReactNode;
  backTo?: string;
  backLabel?: string;
  className?: string;
  wide?: boolean;
};

/** Coquille commune pages marketing / légales : header, SEO, footer liens. */
export function MarketingPageShell({
  seo,
  children,
  backTo = '/',
  backLabel = 'Retour',
  className,
  wide = false,
}: MarketingPageShellProps) {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [pathname]);

  return (
    <div className={cn('flex min-h-full flex-col bg-[#f7f8fb] text-text-100', className)}>
      <SeoHead {...seo} />
      <header className="sticky top-0 z-40 border-b border-black/[0.06] bg-white/90 backdrop-blur-md">
        <div
          className={cn(
            'mx-auto flex h-14 items-center justify-between px-4 sm:px-6',
            wide ? 'max-w-5xl' : 'max-w-3xl',
          )}
        >
          <Link to="/" className="inline-flex items-center" aria-label="Klanvio — accueil">
            <KlanvioLogo variant="full" size="md" />
          </Link>
          <Link
            to={backTo}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-text-400 transition hover:text-text-100"
          >
            <ArrowLeft className="h-4 w-4" />
            {backLabel}
          </Link>
        </div>
      </header>

      <main
        className={cn(
          'mx-auto w-full flex-1 px-4 py-10 sm:px-6 sm:py-14',
          wide ? 'max-w-5xl' : 'max-w-3xl',
        )}
      >
        {children}
      </main>

      <footer className="border-t border-black/[0.06] bg-white">
        <div
          className={cn(
            'mx-auto flex flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-text-500 sm:px-6',
            wide ? 'max-w-5xl' : 'max-w-3xl',
          )}
        >
          <span>© {new Date().getFullYear()} Klanvio</span>
          <nav className="flex flex-wrap gap-4" aria-label="Liens légaux">
            <Link className="hover:text-text-200" to="/mentions">
              Mentions légales
            </Link>
            <Link className="hover:text-text-200" to="/confidentialite">
              Confidentialité
            </Link>
            <Link className="hover:text-text-200" to="/contact">
              Contact
            </Link>
            <Link className="hover:text-text-200" to="/integrations">
              Intégrations
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
