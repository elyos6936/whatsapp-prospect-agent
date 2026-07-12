import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { saveOnboarding, ApiError } from '@/lib/api';
import { KlanvioLogo } from '@/components/brand/KlanvioLogo';
import { cn } from '@/lib/utils';

const SECTORS = [
  'E-commerce',
  'Coaching & Formation',
  'Agence & Services',
  'Immobilier',
  'Restauration & Local',
  'Autre',
] as const;

const GOALS = [
  'Prospecter de nouveaux clients',
  'Relancer et convertir mes leads',
  'Répondre automatiquement 24/7',
  'Animer mes groupes WhatsApp',
] as const;

const TARGETS = ['Particuliers (B2C)', 'Entreprises (B2B)', 'Les deux', 'Autre'] as const;

const VOLUMES = ['< 20', '20-50', '50-200', '200+', 'Je ne sais pas encore'] as const;

type Step = 0 | 1 | 2 | 3 | 4;

export function OnboardingPage() {
  const { user, refreshUser } = useAuth();
  const [step, setStep] = useState<Step>(0);
  const [sector, setSector] = useState('');
  const [sectorOther, setSectorOther] = useState('');
  const [goals, setGoals] = useState<string[]>([]);
  const [goalOther, setGoalOther] = useState('');
  const [target, setTarget] = useState('');
  const [targetOther, setTargetOther] = useState('');
  const [volume, setVolume] = useState('');
  const [offer, setOffer] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const toggleGoal = (g: string) => {
    setGoals((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));
  };

  const canNext = (): boolean => {
    if (step === 0) return !!sector && (sector !== 'Autre' || sectorOther.trim().length > 0);
    if (step === 1) return goals.length > 0 || goalOther.trim().length > 0;
    if (step === 2) return !!target && (target !== 'Autre' || targetOther.trim().length > 0);
    if (step === 3) return !!volume;
    if (step === 4) return offer.trim().length > 2;
    return false;
  };

  const handleFinish = async () => {
    setError('');
    setBusy(true);
    try {
      const answers = {
        sector: sector === 'Autre' ? sectorOther.trim() : sector,
        goals: [...goals, ...(goalOther.trim() ? [goalOther.trim()] : [])],
        target: target === 'Autre' ? targetOther.trim() : target,
        volume,
      };
      await saveOnboarding({
        answers,
        business_offer: offer.trim(),
        business_owner_name: user?.name,
      });
      await refreshUser();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur enregistrement');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-bg-0 px-4 py-10">
      <div className="w-full max-w-lg animate-fade-in">
        <div className="mb-6 flex justify-center">
          <KlanvioLogo variant="full" size="lg" />
        </div>

        {step === 0 && (
          <div>
            <h1 className="text-xl font-medium text-text-100">
              Bonjour {user?.name || ''} 👋
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-text-400">
              Bienvenue sur <strong className="text-text-100">Klanvio</strong>, l&apos;outil qui
              automatise votre prospection WhatsApp à 100&nbsp;%.
              <br />
              Quelques questions pour personnaliser votre expérience.
            </p>
          </div>
        )}

        <div className="mt-8 space-y-4">
          {step === 0 && (
            <>
              <p className="text-sm font-medium text-text-200">Quel est votre secteur d&apos;activité ?</p>
              <div className="flex flex-wrap gap-2">
                {SECTORS.map((s) => (
                  <ChoiceChip key={s} selected={sector === s} onClick={() => setSector(s)} label={s} />
                ))}
              </div>
              {sector === 'Autre' && (
                <input
                  value={sectorOther}
                  onChange={(e) => setSectorOther(e.target.value)}
                  placeholder="Précisez…"
                  className="w-full rounded-xl border border-white/10 bg-bg-100 px-3 py-2 text-sm text-text-100 outline-none focus:border-brand"
                />
              )}
            </>
          )}

          {step === 1 && (
            <>
              <p className="text-sm font-medium text-text-200">
                Qu&apos;est-ce que vous voulez faire avec Klanvio ? (plusieurs choix possibles)
              </p>
              <div className="flex flex-wrap gap-2">
                {GOALS.map((g) => (
                  <ChoiceChip
                    key={g}
                    selected={goals.includes(g)}
                    onClick={() => toggleGoal(g)}
                    label={g}
                  />
                ))}
              </div>
              <input
                value={goalOther}
                onChange={(e) => setGoalOther(e.target.value)}
                placeholder="Autre objectif…"
                className="w-full rounded-xl border border-white/10 bg-bg-100 px-3 py-2 text-sm text-text-100 outline-none focus:border-brand"
              />
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-sm font-medium text-text-200">Qui est votre cible ?</p>
              <div className="flex flex-wrap gap-2">
                {TARGETS.map((t) => (
                  <ChoiceChip key={t} selected={target === t} onClick={() => setTarget(t)} label={t} />
                ))}
              </div>
              {target === 'Autre' && (
                <input
                  value={targetOther}
                  onChange={(e) => setTargetOther(e.target.value)}
                  placeholder="Précisez…"
                  className="w-full rounded-xl border border-white/10 bg-bg-100 px-3 py-2 text-sm text-text-100 outline-none focus:border-brand"
                />
              )}
            </>
          )}

          {step === 3 && (
            <>
              <p className="text-sm font-medium text-text-200">
                Combien de messages souhaitez-vous envoyer par jour ?
              </p>
              <div className="flex flex-wrap gap-2">
                {VOLUMES.map((v) => (
                  <ChoiceChip key={v} selected={volume === v} onClick={() => setVolume(v)} label={v} />
                ))}
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <p className="text-sm font-medium text-text-200">
                Décrivez votre offre principale en une phrase
              </p>
              <textarea
                value={offer}
                onChange={(e) => setOffer(e.target.value)}
                rows={3}
                placeholder="Ex : Je vends des formations en marketing digital pour entrepreneurs…"
                className="w-full resize-none rounded-xl border border-white/10 bg-bg-100 px-3 py-2 text-sm text-text-100 outline-none focus:border-brand"
              />
            </>
          )}
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <div className="mt-8 flex justify-between gap-3">
          {step > 0 ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s - 1) as Step)}
              className="rounded-xl border border-white/10 px-4 py-2 text-sm text-text-400 hover:bg-bg-100"
            >
              Retour
            </button>
          ) : (
            <span />
          )}
          {step < 4 ? (
            <button
              type="button"
              disabled={!canNext()}
              onClick={() => setStep((s) => (s + 1) as Step)}
              className="rounded-xl bg-brand px-6 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              Continuer
            </button>
          ) : (
            <button
              type="button"
              disabled={!canNext() || busy}
              onClick={() => void handleFinish()}
              className="rounded-xl bg-brand px-6 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {busy ? 'Enregistrement…' : 'Terminer'}
            </button>
          )}
        </div>

        <div className="mt-6 flex justify-center gap-1">
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className={cn(
                'h-1.5 w-6 rounded-full',
                i <= step ? 'bg-brand' : 'bg-bg-300',
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ChoiceChip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1.5 text-sm transition',
        selected
          ? 'border-brand bg-brand-muted text-brand'
          : 'border-white/10 text-text-400 hover:border-white/20 hover:text-text-200',
      )}
    >
      {label}
    </button>
  );
}
