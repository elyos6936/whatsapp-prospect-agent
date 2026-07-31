import { useCallback, useEffect, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Brain, Check, Plus, X } from 'lucide-react';
import {
  createCampaignMemoryApi,
  fetchCampaignMemories,
  setThreadCampaignMemoryApi,
  type CampaignMemoryDto,
  type CampaignMemoryEmojiLevel,
  type CampaignMemoryFormality,
  type CampaignMemoryInput,
  type CampaignMemoryTone,
} from '@/lib/api';
import { cn } from '@/lib/utils';

const TONES: { id: CampaignMemoryTone; label: string }[] = [
  { id: 'direct', label: 'Direct' },
  { id: 'chaleureux', label: 'Chaleureux' },
  { id: 'pro', label: 'Pro' },
  { id: 'decontracte', label: 'Décontracté' },
];

type Draft = {
  name: string;
  ownerName: string;
  introFormula: string;
  tone: CampaignMemoryTone;
  toneNote: string;
  formality: CampaignMemoryFormality;
  stickersEnabled: boolean;
  emojiLevel: CampaignMemoryEmojiLevel;
  sendWindowStart: number;
  sendWindowEnd: number;
};

function emptyDraft(opts?: { ownerName?: string; name?: string }): Draft {
  return {
    name: opts?.name ?? '',
    ownerName: opts?.ownerName ?? '',
    introFormula: '',
    tone: 'pro',
    toneNote: '',
    formality: 'vous',
    stickersEnabled: false,
    emojiLevel: 'none',
    sendWindowStart: 9,
    sendWindowEnd: 18,
  };
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="mb-1 block text-[11px] font-medium text-text-400">{children}</label>;
}

function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'w-full rounded-lg border border-black/10 bg-bg-0 px-3 py-2 text-sm text-text-100 outline-none transition placeholder:text-text-500 focus:border-brand/40',
        props.className,
      )}
    />
  );
}

type ThreadMemoryModalProps = {
  open: boolean;
  threadId: number;
  threadTitle?: string | null;
  linkedMemoryId?: number | null;
  onClose: () => void;
  onLinked: () => void | Promise<void>;
};

export function ThreadMemoryModal({
  open,
  threadId,
  threadTitle,
  linkedMemoryId,
  onClose,
  onLinked,
}: ThreadMemoryModalProps) {
  const [memories, setMemories] = useState<CampaignMemoryDto[]>([]);
  const [max, setMax] = useState(8);
  const [prefill, setPrefill] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchCampaignMemories();
      setMemories(res.memories);
      setMax(res.max);
      setPrefill(res.prefill?.ownerName ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger les mémoires.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setCreating(false);
    setError('');
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  async function selectMemory(id: number) {
    setBusy(true);
    setError('');
    try {
      await setThreadCampaignMemoryApi(threadId, id);
      await onLinked();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de lier la mémoire.');
    } finally {
      setBusy(false);
    }
  }

  function startCreate() {
    const base = (threadTitle || '').trim() || 'Mémoire';
    const nextId =
      memories.length === 0 ? 1 : Math.max(...memories.map((m) => m.id), 0) + 1;
    setDraft(emptyDraft({ ownerName: prefill, name: `${base} ${nextId}` }));
    setCreating(true);
    setError('');
  }

  async function saveCreate() {
    if (draft.name.trim().length < 2) {
      setError('Donne un nom à la mémoire (min. 2 caractères).');
      return;
    }
    setBusy(true);
    setError('');
    const body: CampaignMemoryInput = {
      name: draft.name.trim(),
      ownerName: draft.ownerName,
      introFormula: draft.introFormula,
      tone: draft.tone,
      toneNote: draft.toneNote,
      formality: draft.formality,
      stickersEnabled: draft.stickersEnabled,
      emojiLevel: draft.emojiLevel,
      sendWindowStart: draft.sendWindowStart,
      sendWindowEnd: draft.sendWindowEnd,
    };
    try {
      const created = await createCampaignMemoryApi(body);
      await setThreadCampaignMemoryApi(threadId, created.memory.id);
      await onLinked();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Création impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Fermer"
        disabled={busy}
        onClick={() => !busy && onClose()}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="thread-memory-title"
        className="relative z-10 flex max-h-[88vh] w-full max-w-lg flex-col rounded-t-2xl border border-black/10 bg-bg-0 shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-start gap-3 border-b border-black/[0.06] px-4 py-3.5 sm:px-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand/20 bg-brand/10 text-brand">
            <Brain className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="thread-memory-title" className="text-sm font-semibold text-text-100">
              Mémoire de cette automatisation
            </h2>
            <p className="mt-0.5 text-[12px] leading-relaxed text-text-400">
              Choisis ou crée une mémoire pour ce fil uniquement. Sans mémoire liée, l&apos;agent ne
              peut pas lancer la campagne.
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-400 transition hover:bg-bg-200 hover:text-text-200"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5 sm:px-5">
          {error ? <p className="mb-3 text-sm text-red-400">{error}</p> : null}

          {loading ? (
            <p className="py-8 text-center text-sm text-text-400">Chargement…</p>
          ) : creating ? (
            <div className="space-y-3">
              <p className="text-xs font-medium text-text-300">Nouvelle mémoire</p>
              <div>
                <FieldLabel>Nom</FieldLabel>
                <TextInput
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="Ex. Support chaleureux"
                  maxLength={80}
                />
              </div>
              <div>
                <FieldLabel>Présentation (prénom / nom)</FieldLabel>
                <TextInput
                  value={draft.ownerName}
                  onChange={(e) => setDraft((d) => ({ ...d, ownerName: e.target.value }))}
                  placeholder={prefill || 'Ex. Aïcha'}
                  maxLength={120}
                />
              </div>
              <div>
                <FieldLabel>Formule courte (optionnel)</FieldLabel>
                <TextInput
                  value={draft.introFormula}
                  onChange={(e) => setDraft((d) => ({ ...d, introFormula: e.target.value }))}
                  placeholder="Ex. je vous accompagne sur WhatsApp"
                  maxLength={280}
                />
              </div>
              <div>
                <FieldLabel>Ton</FieldLabel>
                <div className="flex flex-wrap gap-1.5">
                  {TONES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, tone: t.id }))}
                      className={cn(
                        'rounded-lg border px-2.5 py-1.5 text-xs transition',
                        draft.tone === t.id
                          ? 'border-brand bg-brand/10 text-brand'
                          : 'border-black/10 text-text-400 hover:border-black/20',
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <label className="inline-flex items-center gap-2 text-xs text-text-300">
                  <input
                    type="checkbox"
                    checked={draft.formality === 'tu'}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        formality: e.target.checked ? 'tu' : 'vous',
                      }))
                    }
                  />
                  Tutoiement
                </label>
                <label className="inline-flex items-center gap-2 text-xs text-text-300">
                  <input
                    type="checkbox"
                    checked={draft.stickersEnabled}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, stickersEnabled: e.target.checked }))
                    }
                  />
                  Stickers
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <FieldLabel>Début envoi</FieldLabel>
                  <TextInput
                    type="number"
                    min={0}
                    max={23}
                    value={draft.sendWindowStart}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        sendWindowStart: Number(e.target.value) || 0,
                      }))
                    }
                  />
                </div>
                <div>
                  <FieldLabel>Fin envoi</FieldLabel>
                  <TextInput
                    type="number"
                    min={0}
                    max={23}
                    value={draft.sendWindowEnd}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        sendWindowEnd: Number(e.target.value) || 0,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setCreating(false)}
                  className="rounded-xl border border-black/10 px-3 py-2 text-sm text-text-400 transition hover:bg-bg-200"
                >
                  Retour
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void saveCreate()}
                  className="flex-1 rounded-xl bg-brand px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? 'Enregistrement…' : 'Créer et connecter'}
                </button>
              </div>
            </div>
          ) : memories.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm text-text-400">Aucune mémoire enregistrée pour l&apos;instant.</p>
              <button
                type="button"
                disabled={busy}
                onClick={startCreate}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-sm font-medium text-white transition hover:opacity-90"
              >
                <Plus className="h-4 w-4" />
                Créer une mémoire
              </button>
            </div>
          ) : (
            <>
              <ul className="divide-y divide-black/5 rounded-xl border border-black/10 bg-bg-100/60">
                {memories.map((m) => {
                  const selected = linkedMemoryId === m.id;
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void selectMemory(m.id)}
                        className={cn(
                          'flex w-full items-start gap-3 px-3.5 py-3 text-left transition hover:bg-bg-200/80 disabled:opacity-50',
                          selected && 'bg-brand/5',
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium text-text-100">
                              {m.name}
                            </span>
                            {selected ? (
                              <span className="inline-flex items-center gap-0.5 rounded-md bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium text-brand">
                                <Check className="h-2.5 w-2.5" /> Connectée
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-0.5 truncate text-[11px] text-text-500">
                            {[
                              m.ownerName || null,
                              TONES.find((t) => t.id === m.tone)?.label,
                              `${m.sendWindowStart}h–${m.sendWindowEnd}h`,
                              m.stickersEnabled ? 'stickers' : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>

              <button
                type="button"
                disabled={busy || memories.length >= max}
                onClick={startCreate}
                className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-black/10 bg-bg-100 px-3 py-2.5 text-sm text-text-200 transition hover:border-brand/30 hover:text-brand disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                Créer une nouvelle mémoire
                {memories.length >= max ? ` (max ${max})` : null}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
