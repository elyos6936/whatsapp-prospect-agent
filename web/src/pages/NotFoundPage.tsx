import { Link } from 'react-router-dom';
import { SeoHead } from '@/components/SeoHead';

export function NotFoundPage() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-[#f7f8fb] px-6 py-16 text-center text-text-100">
      <SeoHead
        title="Page introuvable | Klanvio"
        description="Cette page n’existe pas sur Klanvio."
        path="/"
        robots="noindex,follow"
        updateCanonical={false}
      />
      <h1 className="text-2xl font-semibold tracking-tight">Page introuvable</h1>
      <p className="mt-2 max-w-sm text-sm text-text-400">Cette URL n’existe pas sur Klanvio.</p>
      <Link
        to="/"
        className="mt-6 inline-flex h-10 items-center justify-center rounded-full bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark"
      >
        Retour à l’accueil
      </Link>
    </div>
  );
}
