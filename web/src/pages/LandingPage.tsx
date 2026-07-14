import { useState } from 'react';
import {
  ArrowRight,
  Check,
  Menu,
  MessageCircle,
  Shield,
  Sparkles,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { KlanvioLogo } from '@/components/brand/KlanvioLogo';
import { cn } from '@/lib/utils';

type LandingPageProps = {
  onLogin: () => void;
  onRegister: () => void;
};

const FEATURES = [
  {
    title: 'Groupes',
    lead: 'Créez, gérez et animez vos groupes sans jamais y toucher.',
    items: [
      'Créer et supprimer des groupes',
      'Ajouter, retirer, promouvoir des membres',
      'Modifier nom, description, photo, annonces',
      'Gérer invitations et liens de partage',
    ],
  },
  {
    title: 'Messages & médias',
    lead: 'Tous les formats, programmables, interactifs.',
    items: [
      'Texte, images, vidéos, documents, vocaux, stickers',
      "Programmation d'envoi à l'heure choisie",
      'Sondages et listes interactives',
      'Réactions emoji automatiques',
    ],
  },
  {
    title: 'Statuts',
    lead: 'Restez visible en permanence, sans y penser.',
    items: [
      'Publication automatique texte, image, vidéo, audio',
      'Programmation à l’avance sur plusieurs jours',
      'Rotation intelligente des contenus',
      'Analyse des vues et interactions',
    ],
  },
  {
    title: 'Prospection & closing',
    lead: 'Un commercial WhatsApp autonome qui vend pour vous.',
    items: [
      'Extraction illimitée de contacts de groupes',
      'Campagnes de prospection multi-listes',
      'Relances automatiques intelligentes',
      'Closing e-commerce avec envoi du lien de paiement',
    ],
  },
  {
    title: 'Contacts',
    lead: 'Ciblez juste, filtrez large, protégez vos données.',
    items: [
      'Vérification WhatsApp des numéros en masse',
      'Récupération des profils (dont profils Business)',
      'Gestion de la confidentialité',
      'Blocage et déblocage automatisés',
    ],
  },
  {
    title: 'Anti-blocage & outils',
    lead: 'La protection intégrée qui garde votre compte en vie.',
    items: [
      "Rythme d'envoi adaptatif selon les signaux",
      'Présence active (« en train d’écrire »)',
      'Historique de conversations et recherche',
      'Seuil de risque jamais dépassé',
    ],
  },
] as const;

const COMPARE_ROWS = [
  ['Réponses automatiques', true, true],
  ['Extraction illimitée de contacts de groupes', false, true],
  ['Gestion complète de groupes', false, true],
  ['Publication de statuts', false, true],
  ['Prospection listes et groupes entiers', 'limité', true],
  ['Closing e-commerce automatique', false, true],
  ['Protection anti-blocage intégrée', false, true],
  ['Instructions en langage naturel', false, true],
] as const;

const PRICE_FEATURES = [
  'Extraction illimitée de groupes',
  'Prospection multi-groupes en parallèle',
  'Closing e-commerce automatique',
  'Relances intelligentes',
  'Publication de statuts programmée',
  'Gestion complète de groupes',
  'Messages programmés à l’avance',
  'Sondages & listes interactives',
  'Vérification WhatsApp illimitée',
  'Réponses par mots-clés',
  'Vocaux, images, vidéos, stickers',
  'Protection anti-blocage intégrée',
  'Bilan quotidien automatique',
  'Rapports & statistiques détaillés',
  'Instructions en langage naturel',
  'Support prioritaire',
] as const;

function CellMark({ value }: { value: boolean | 'limité' }) {
  if (value === true) return <span className="font-semibold text-emerald-600">✓</span>;
  if (value === 'limité') return <span className="text-xs font-medium text-amber-600">limité</span>;
  return <span className="text-text-500">✕</span>;
}

export function LandingPage({ onLogin, onRegister }: LandingPageProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const scrollTo = (id: string) => {
    setMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-full overflow-x-hidden bg-[#f7f8fb] text-text-100">
      <header className="sticky top-0 z-50 border-b border-black/[0.06] bg-[#f7f8fb]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <KlanvioLogo variant="full" size="md" />
          <nav className="hidden items-center gap-8 text-sm font-medium text-text-300 md:flex">
            <button type="button" onClick={() => scrollTo('features')} className="hover:text-text-100">
              Fonctionnalités
            </button>
            <button type="button" onClick={() => scrollTo('how')} className="hover:text-text-100">
              Comment ça marche
            </button>
            <button type="button" onClick={() => scrollTo('compare')} className="hover:text-text-100">
              Comparatif
            </button>
            <button type="button" onClick={() => scrollTo('pricing')} className="hover:text-text-100">
              Tarif
            </button>
          </nav>
          <div className="hidden items-center gap-2 sm:flex">
            <button
              type="button"
              onClick={onLogin}
              className="rounded-xl border border-black/10 bg-white px-4 py-2 text-sm font-medium text-text-200 transition hover:bg-bg-200"
            >
              Connexion
            </button>
            <button
              type="button"
              onClick={onRegister}
              className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark"
            >
              Essai gratuit
            </button>
          </div>
          <button
            type="button"
            className="rounded-lg p-2 text-text-400 md:hidden"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Menu"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {menuOpen && (
          <div className="border-t border-black/[0.06] bg-white px-4 py-4 md:hidden">
            <div className="flex flex-col gap-3 text-sm font-medium text-text-300">
              {[
                ['features', 'Fonctionnalités'],
                ['how', 'Comment ça marche'],
                ['compare', 'Comparatif'],
                ['pricing', 'Tarif'],
              ].map(([id, label]) => (
                <button key={id} type="button" onClick={() => scrollTo(id)} className="text-left">
                  {label}
                </button>
              ))}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={onLogin}
                  className="flex-1 rounded-xl border border-black/10 px-3 py-2.5"
                >
                  Connexion
                </button>
                <button
                  type="button"
                  onClick={onRegister}
                  className="flex-1 rounded-xl bg-brand px-3 py-2.5 font-semibold text-white"
                >
                  Essai gratuit
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      <main>
        {/* HERO */}
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(32,87,206,0.14),transparent_55%),radial-gradient(ellipse_at_bottom_left,rgba(15,76,58,0.08),transparent_50%)]" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-2 lg:gap-14 lg:pb-24 lg:pt-20">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-brand-border bg-brand-muted px-3 py-1 text-xs font-semibold text-brand">
                <Sparkles className="h-3.5 w-3.5" />
                Nouveau · Sans API Meta
              </span>
              <h1 className="mt-5 font-serif text-[2.15rem] font-medium leading-[1.12] tracking-tight text-text-100 sm:text-5xl lg:text-[3.25rem]">
                Le seul agent IA qui automatise{' '}
                <span className="text-brand">tout WhatsApp</span>, pas juste vos réponses
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-text-400 sm:text-lg">
                Les autres outils se contentent de répondre aux messages. Klanvio prospecte, relance,
                close vos ventes, gère vos groupes et publie vos statuts — comme un vrai commercial
                WhatsApp, 24h/24.
              </p>
              <div className="mt-5 flex gap-3 rounded-2xl border border-brand-border/60 bg-white/80 p-3.5 text-sm text-text-300 shadow-sm backdrop-blur">
                <Users className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
                <p>
                  <strong className="font-semibold text-text-100">Extractions illimitées</strong> de
                  contacts dans n’importe quel groupe WhatsApp — même ceux où vous n’êtes pas admin.
                </p>
              </div>
              <div className="mt-7 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={onRegister}
                  className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-brand-dark"
                >
                  Essayer gratuitement 7 jours
                  <ArrowRight className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => scrollTo('how')}
                  className="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-white px-5 py-3.5 text-sm font-medium text-text-200 transition hover:bg-bg-200"
                >
                  Voir la démo
                </button>
              </div>
              <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-text-400">
                {['Toutes fonctions incluses', '15€/mois illimité', 'Sans engagement'].map((t) => (
                  <span key={t} className="inline-flex items-center gap-1.5">
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                    {t}
                  </span>
                ))}
              </div>
            </div>

            {/* Product mock */}
            <div className="relative mx-auto w-full max-w-lg lg:max-w-none">
              <div className="overflow-hidden rounded-2xl border border-[#1E2530] bg-[#0B0F14] text-[#E5E9EF] shadow-[0_30px_60px_-20px_rgba(32,87,206,0.35)]">
                <div className="grid sm:grid-cols-[140px_1fr]">
                  <aside className="hidden border-r border-[#1E2530] bg-[#0A0E13] p-4 sm:block">
                    <div className="mb-6 flex items-center gap-2 px-1">
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-xs font-bold text-white">
                        K
                      </span>
                      <span className="text-sm font-semibold">Klanvio</span>
                    </div>
                    <div className="space-y-1 text-xs text-[#8A94A3]">
                      <div className="flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-2 text-white">
                        <MessageCircle className="h-3.5 w-3.5" /> Chat
                      </div>
                      <div className="flex items-center gap-2 px-2.5 py-2">
                        <Zap className="h-3.5 w-3.5" /> Automatisation
                      </div>
                      <div className="flex items-center gap-2 px-2.5 py-2">
                        <Shield className="h-3.5 w-3.5" /> Réglages
                      </div>
                    </div>
                  </aside>
                  <div className="flex min-h-[420px] flex-col">
                    <div className="border-b border-[#1E2530] px-4 py-3 text-xs text-[#8A94A3]">
                      Agent WhatsApp · en ligne
                    </div>
                    <div className="flex-1 space-y-3 overflow-hidden p-4 text-[13px] leading-relaxed">
                      <div className="ml-auto max-w-[92%] rounded-2xl rounded-br-md bg-[#1F2937] px-3.5 py-2.5">
                        Extrais les contacts du groupe « Formation IA Cotonou » et lance une
                        prospection sur ceux qui n’ont pas encore acheté.
                      </div>
                      <div className="max-w-[95%] rounded-2xl rounded-bl-md bg-[#151b24] px-3.5 py-2.5 ring-1 ring-white/5">
                        <div className="mb-1 text-[11px] font-medium text-brand">✦ Klanvio</div>
                        <strong>J’ai trouvé 247 membres. 189 n’ont pas acheté votre formation.</strong>
                        <br />
                        <br />
                        Deux questions avant de lancer :<br />• Quel message d’accroche ?<br />•
                        Rythme : prudent (50/jour) ou standard (150/jour) ?
                      </div>
                      <div className="ml-auto max-w-[80%] rounded-2xl rounded-br-md bg-[#1F2937] px-3.5 py-2.5">
                        Génère les 3 messages, rythme prudent.
                      </div>
                      <div className="max-w-[95%] rounded-2xl rounded-bl-md bg-[#151b24] px-3.5 py-2.5 ring-1 ring-white/5">
                        <div className="mb-1 text-[11px] font-medium text-brand">✦ Klanvio</div>
                        <strong>Campagne lancée.</strong> Bilan chaque soir à 20h.
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-400">
                            ✓ Contacts extraits
                          </span>
                          <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 text-[10px] text-cyan-300">
                            ✓ Campagne active
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="m-3 flex items-center gap-2 rounded-xl border border-[#1E2530] bg-[#10151C] px-3 py-2.5 text-xs text-[#8A94A3]">
                      <span className="text-lg leading-none">+</span>
                      <span className="flex-1">Donnez une instruction à l’agent…</span>
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-white">
                        ↑
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* STATS */}
        <section className="border-y border-black/[0.06] bg-white">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 py-10 sm:grid-cols-4 sm:px-6 sm:py-12">
            {[
              ['2 400+', 'utilisateurs actifs'],
              ['1,8 M', 'messages traités'],
              ['24h/24', 'présence commerciale'],
              ['30 sec', 'installation QR code'],
            ].map(([n, l]) => (
              <div key={l} className="text-center">
                <div className="font-serif text-3xl font-medium text-text-100 sm:text-4xl">{n}</div>
                <div className="mt-1 text-xs text-text-500 sm:text-sm">{l}</div>
              </div>
            ))}
          </div>
        </section>

        {/* HOW */}
        <section id="how" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <p className="text-xs font-semibold tracking-[0.14em] text-brand">SIMPLICITÉ RADICALE</p>
          <h2 className="mt-3 font-serif text-3xl font-medium tracking-tight sm:text-4xl">
            Aussi simple qu’une conversation
          </h2>
          <p className="mt-3 max-w-2xl text-text-400">
            Là où les autres outils demandent des heures de configuration, Klanvio comprend vos
            instructions en français. Trois étapes, c’est tout.
          </p>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              {
                n: '1',
                t: 'Scannez le QR code',
                d: 'Comme WhatsApp Web. Aucune API, aucun développeur, aucun compte Meta. Prêt en 30 secondes.',
                tag: '⏱ 30 secondes',
              },
              {
                n: '2',
                t: 'Donnez une instruction en français',
                d: '« Extrais les contacts de ce groupe », « lance une campagne », « publie ce statut ». L’agent comprend.',
                tag: '💬 Langage naturel',
              },
              {
                n: '3',
                t: 'L’agent exécute et rapporte',
                d: 'Extraction, prospection, closing, publication — en autonomie, avec un bilan quotidien.',
                tag: '📊 Bilan quotidien',
              },
            ].map((s) => (
              <article key={s.n} className="rounded-2xl border border-black/[0.06] bg-white p-6 shadow-sm">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
                  {s.n}
                </div>
                <h3 className="mt-4 text-lg font-semibold text-text-100">{s.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-text-400">{s.d}</p>
                <p className="mt-4 text-xs font-medium text-brand">{s.tag}</p>
              </article>
            ))}
          </div>
          <p className="mt-8 rounded-2xl border border-black/[0.06] bg-white px-5 py-4 text-sm text-text-400">
            Chez les concurrents :{' '}
            <strong className="text-text-200">flux, webhooks, API Meta</strong> — plusieurs jours.
            Chez Klanvio : <strong className="text-text-200">une phrase</strong>.
          </p>
        </section>

        {/* COMPARE */}
        <section id="compare" className="bg-white py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <p className="text-xs font-semibold tracking-[0.14em] text-brand">LA VRAIE DIFFÉRENCE</p>
            <h2 className="mt-3 max-w-3xl font-serif text-3xl font-medium tracking-tight sm:text-4xl">
              Répondre à un message ≠ gérer tout votre WhatsApp
            </h2>
            <p className="mt-3 max-w-2xl text-text-400">
              Les concurrents utilisent l’API Meta, qui bloque groupes et statuts. Klanvio, non.
            </p>
            <div className="mt-8 overflow-x-auto rounded-2xl border border-black/[0.08]">
              <table className="min-w-[640px] w-full text-left text-sm">
                <thead className="bg-bg-100 text-text-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Fonctionnalité</th>
                    <th className="px-4 py-3 font-medium">Wati / Wazzap / Wassenger</th>
                    <th className="px-4 py-3 font-medium text-brand">Klanvio</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARE_ROWS.map(([label, other, ours]) => (
                    <tr key={label} className="border-t border-black/[0.06]">
                      <td className="px-4 py-3 text-text-300">{label}</td>
                      <td className="px-4 py-3">
                        <CellMark value={other} />
                      </td>
                      <td className="px-4 py-3">
                        <CellMark value={ours} />
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-black/[0.06] bg-bg-100/60">
                    <td className="px-4 py-3 font-medium text-text-200">Tarif</td>
                    <td className="px-4 py-3 text-text-400">40€ à 400€+/mois</td>
                    <td className="px-4 py-3 font-semibold text-brand">15€/mois illimité</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* FEATURES */}
        <section id="features" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <h2 className="font-serif text-3xl font-medium tracking-tight sm:text-4xl">
            Tout ce que Klanvio automatise
          </h2>
          <p className="mt-3 max-w-2xl text-text-400">
            Six domaines, un seul agent, zéro intervention manuelle.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <article
                key={f.title}
                className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm sm:p-6"
              >
                <h3 className="text-lg font-semibold text-text-100">{f.title}</h3>
                <p className="mt-1 text-sm text-text-400">{f.lead}</p>
                <ul className="mt-4 space-y-2">
                  {f.items.map((item) => (
                    <li key={item} className="flex gap-2 text-sm text-text-300">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          <div className="mt-8 flex gap-4 rounded-2xl bg-[#0f1a2e] p-6 text-white sm:p-8">
            <Shield className="mt-1 h-7 w-7 shrink-0 text-emerald-400" />
            <div>
              <h3 className="text-lg font-semibold sm:text-xl">
                Un expert WhatsApp qui protège votre compte pendant qu’il vend pour vous
              </h3>
              <p className="mt-2 text-sm text-white/70 sm:text-base">
                Rythme maîtrisé, arrêt intelligent des conversations, seuil de risque jamais dépassé.
              </p>
            </div>
          </div>
        </section>

        {/* PRICING */}
        <section id="pricing" className="bg-white py-16 sm:py-20">
          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
            <p className="text-xs font-semibold tracking-[0.14em] text-brand">
              TARIF UNIQUE · TOUT INCLUS
            </p>
            <h2 className="mt-3 font-serif text-3xl font-medium tracking-tight sm:text-4xl">
              Toute cette puissance, un seul prix
            </h2>
            <p className="mt-3 text-text-400">
              Aucun crédit, aucun frais par message, aucune fonction verrouillée.
            </p>
            <div className="mt-8 rounded-3xl border border-brand-border bg-[#f7f8fb] p-6 sm:p-10">
              <div className="flex items-end justify-center gap-1">
                <span className="font-serif text-6xl font-medium text-text-100">15€</span>
                <span className="mb-2 text-text-400">/mois</span>
              </div>
              <p className="mt-2 text-sm text-text-500">Illimité · résiliable en un clic</p>
              <div className="mt-8 grid gap-2 text-left sm:grid-cols-2">
                {PRICE_FEATURES.map((f) => (
                  <div key={f} className="flex items-start gap-2 text-sm text-text-300">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
                    {f}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={onRegister}
                className={cn(
                  'mt-8 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3.5',
                  'text-sm font-semibold text-white transition hover:bg-brand-dark sm:w-auto sm:px-8',
                )}
              >
                Commencer mon essai gratuit de 7 jours
                <ArrowRight className="h-4 w-4" />
              </button>
              <p className="mt-3 text-xs text-text-500">
                Sans carte bancaire · connexion QR code en 30 secondes
              </p>
            </div>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-20">
          <div className="rounded-3xl bg-brand px-6 py-12 text-center text-white sm:px-10 sm:py-16">
            <h2 className="font-serif text-3xl font-medium tracking-tight sm:text-4xl">
              Prêt à laisser Klanvio automatiser tout votre WhatsApp ?
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-white/80">
              Prospection, closing, groupes, statuts, anti-blocage. Connectez, laissez l’agent
              travailler.
            </p>
            <button
              type="button"
              onClick={onRegister}
              className="mt-8 inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3.5 text-sm font-semibold text-brand transition hover:bg-bg-100"
            >
              Commencer gratuitement
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </section>
      </main>

      <footer className="border-t border-black/[0.06] bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-text-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>© 2026 Klanvio. Tous droits réservés.</div>
          <div className="flex gap-5">
            <span>Mentions légales</span>
            <span>Confidentialité</span>
            <span>Contact</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
