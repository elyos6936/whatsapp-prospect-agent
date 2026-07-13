import { useState } from 'react';
import { Check } from 'lucide-react';
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

const OTHER = 'Autre';

type Step = 0 | 1 | 2 | 3 | 4;

export function OnboardingPage() {
  const { user, refreshUser } = useAuth();
  const [step, setStep] = useState<Step>(0);
  const [sector, setSector] = useState('');
  const [sectorOther, setSectorOther] = useState('');
  const [goals, setGoals] = useState<string[]>([]);
  const [goalOtherOn, setGoalOtherOn] = useState(false);
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
    if (step === 0) return !!sector && (sector !== OTHER || sectorOther.trim().length > 0);
    if (step === 1)
      return goals.length > 0 || (goalOtherOn && goalOther.trim().length > 0);
    if (step === 2) return !!target && (target !== OTHER || targetOther.trim().length > 0);
    if (step === 3) return !!volume;
    if (step === 4) return offer.trim().length > 2;
    return false;
  };

  const handleFinish = async () => {
    setError('');
    setBusy(true);
    try {
      const answers = {
        sector: sector === OTHER ? sectorOther.trim() : sector,
        goals: [...goals, ...(goalOtherOn && goalOther.trim() ? [goalOther.trim()] : [])],
        target: target === OTHER ? targetOther.trim() : target,
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
            <ChoiceGroup label="Quel est votre secteur d'activité ?">
              {SECTORS.map((s) => (
                <OptionRow key={s} selected={sector === s} onClick={() => setSector(s)} label={s} />
              ))}
              {sector === OTHER && (
                <OtherInput
                  value={sectorOther}
                  onChange={setSectorOther}
                  placeholder="Précisez votre secteur…"
                />
              )}
            </ChoiceGroup>
          )}

          {step === 1 && (
            <ChoiceGroup label="Qu'est-ce que vous voulez faire avec Klanvio ?" hint="Plusieurs choix possibles">
              {GOALS.map((g) => (
                <OptionRow
                  key={g}
                  multi
                  selected={goals.includes(g)}
                  onClick={() => toggleGoal(g)}
                  label={g}
                />
              ))}
              <OptionRow
                multi
                selected={goalOtherOn}
                onClick={() => setGoalOtherOn((v) => !v)}
                label="Autre"
              />
              {goalOtherOn && (
                <OtherInput
                  value={goalOther}
                  onChange={setGoalOther}
                  placeholder="Précisez votre objectif…"
                />
              )}
            </ChoiceGroup>
          )}

          {step === 2 && (
            <ChoiceGroup label="Qui est votre cible ?">
              {TARGETS.map((t) => (
                <OptionRow key={t} selected={target === t} onClick={() => setTarget(t)} label={t} />
              ))}
              {target === OTHER && (
                <OtherInput
                  value={targetOther}
                  onChange={setTargetOther}
                  placeholder="Précisez votre cible…"
                />
              )}
            </ChoiceGroup>
          )}

          {step === 3 && (
            <ChoiceGroup label="Combien de messages souhaitez-vous envoyer par jour ?">
              {VOLUMES.map((v) => (
                <OptionRow key={v} selected={volume === v} onClick={() => setVolume(v)} label={v} />
              ))}
            </ChoiceGroup>
          )}

          {step === 4 && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-text-200">
                Décrivez votre offre principale en une phrase
              </p>
              <textarea
                value={offer}
                onChange={(e) => setOffer(e.target.value)}
                rows={3}
                placeholder="Ex : Je vends des formations en marketing digital pour entrepreneurs…"
                className="w-full resize-none rounded-xl border border-black/10 bg-bg-100 px-3 py-2 text-sm text-text-100 outline-none focus:border-brand"
              />
            </div>
          )}
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <div className="mt-8 flex justify-between gap-3">
          {step > 0 ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s - 1) as Step)}
              className="rounded-xl border border-black/10 px-4 py-2 text-sm text-text-400 hover:bg-bg-100"
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

function ChoiceGroup({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-text-200">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-text-500">{hint}</p>}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function OptionRow({
  label,
  selected,
  multi = false,
  onClick,
}: {
  label: string;
  selected: boolean;
  multi?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition',
        selected
          ? 'border-brand bg-brand-muted text-text-100'
          : 'border-black/10 bg-bg-100 text-text-300 hover:border-black/25 hover:text-text-100',
      )}
    >
      <span
        className={cn(
          'flex h-[18px] w-[18px] shrink-0 items-center justify-center border transition',
          multi ? 'rounded-[5px]' : 'rounded-full',
          selected ? 'border-brand bg-brand' : 'border-black/25',
        )}
      >
        {selected &&
          (multi ? (
            <Check className="h-3 w-3 text-white" strokeWidth={3} />
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-white" />
          ))}
      </span>
      <span className="flex-1">{label}</span>
    </button>
  );
}

function OtherInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-xl border border-black/10 bg-bg-100 px-4 py-3 text-sm text-text-100 outline-none focus:border-brand"
    />
  );
}
