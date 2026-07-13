import { KlanvioLogo } from '@/components/brand/KlanvioLogo';

const LINKS = [
  { href: '#fonctionnalites', label: 'Fonctionnalités' },
  { href: '#comment', label: 'Comment ça marche' },
  { href: '#cas-usage', label: 'Cas d\'usage' },
  { href: '#faq', label: 'FAQ' },
];

export function LandingFooter() {
  return (
    <footer className="border-t border-black/10 bg-bg-100 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-4 sm:flex-row sm:px-6">
        <KlanvioLogo variant="full" size="sm" />
        <nav className="flex flex-wrap justify-center gap-4">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-xs text-text-500 transition hover:text-text-300"
            >
              {l.label}
            </a>
          ))}
        </nav>
        <p className="text-xs text-text-500">© {new Date().getFullYear()} Klanvio</p>
      </div>
    </footer>
  );
}
