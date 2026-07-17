import { useState, type MouseEvent } from 'react';
import { Pause, Play } from 'lucide-react';
import { updateAutomationStatus, validateSimulationAndLaunch } from '@/lib/api';
import { cn } from '@/lib/utils';

type CampaignStatusToggleProps = {
  automationId: number;
  status: string;
  onUpdated?: () => void | Promise<void>;
  /** sm = icône seule (sidebar) ; md = bouton avec label */
  size?: 'sm' | 'md';
  className?: string;
};

/**
 * Active / met en pause une campagne (évite deux campagnes actives en parallèle).
 * Brouillon → lancement complet (bootstrap). Pause → reprise. Active → pause.
 */
export function CampaignStatusToggle({
  automationId,
  status,
  onUpdated,
  size = 'md',
  className,
}: CampaignStatusToggleProps) {
  const [busy, setBusy] = useState(false);

  if (status !== 'active' && status !== 'paused' && status !== 'draft') {
    return null;
  }

  const isActive = status === 'active';
  const label = isActive ? 'Désactiver' : status === 'draft' ? 'Lancer' : 'Réactiver';

  const handleClick = async (e?: MouseEvent) => {
    e?.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      if (isActive) {
        await updateAutomationStatus(automationId, 'paused');
      } else if (status === 'draft') {
        // Lancement complet : pause les autres actives + charge les cibles
        const result = await validateSimulationAndLaunch(automationId);
        if (result.message) {
          /* statut rafraîchi via onUpdated */
        }
      } else {
        await updateAutomationStatus(automationId, 'active');
      }
      await onUpdated?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Impossible de changer le statut.');
    } finally {
      setBusy(false);
    }
  };

  if (size === 'sm') {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={(e) => void handleClick(e)}
        title={
          isActive
            ? 'Désactiver la campagne (stoppe envois et réponses auto)'
            : 'Activer la campagne'
        }
        aria-label={label}
        className={cn(
          'rounded-md p-1 transition disabled:opacity-50',
          isActive
            ? 'text-amber-600 hover:bg-amber-500/15 hover:text-amber-700'
            : 'text-emerald-600 hover:bg-emerald-500/15 hover:text-emerald-700',
          className,
        )}
      >
        {isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void handleClick()}
      title={
        isActive
          ? 'Stoppe les envois et les réponses automatiques'
          : 'Relance les envois et les réponses automatiques'
      }
      className={cn(
        'inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold shadow-sm transition disabled:opacity-50',
        isActive
          ? 'border border-amber-500/40 bg-amber-500/15 text-amber-800 hover:bg-amber-500/25'
          : 'bg-brand text-white hover:bg-brand-dark',
        className,
      )}
    >
      {isActive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      {busy ? '…' : label}
    </button>
  );
}
