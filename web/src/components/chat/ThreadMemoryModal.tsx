import { useCallback, useEffect, useState } from 'react';
import { Brain, Check, Pencil, Plus, X } from 'lucide-react';
import {
  createCampaignMemoryApi,
  fetchCampaignMemories,
  setThreadCampaignMemoryApi,
  updateCampaignMemoryApi,
  type CampaignMemoryDto,
  type CampaignMemoryInput,
} from '@/lib/api';
import { cn } from '@/lib/utils';

const FALLBACK_TEMPLATE = [
  '- Je me présente comme [prénom], [rôle] de [entreprise].',
  '- Ton professionnel, clair et rassurant.',
  '- Je vouvoie les interlocuteurs.',
  "- Pas d'emojis dans les messages.",
  '- Pas de stickers dans les conversations.',
  "- J'envoie uniquement entre 9h et 18h.",
  '- Produit / service : [décrire ce que tu proposes et à qui ça s\'adresse].',
  '- Prix / tarifs : [indiquer les prix en FCFA].',
  '- Objectif des conversations : [RDV, vente, support, envoi de lien…].',
  '- Lien utile à envoyer si besoin : [URL].',
  '- Infos complémentaires : [avantages, zones, délais, FAQ…].',
].join('\n');

function previewLine(instructions: string): string {
  const line =
    instructions
      .split('\n')
      .map((l) => l.replace(/^\s*[-•*]\s*/, '').trim())
      .find((l) => l.length > 0) ?? '';
  return line.slice(0, 80) || 'Instructions';
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
  const [template, setTemplate] = useState(FALLBACK_TEMPLATE);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchCampaignMemories();
      setMemories(res.memories);
      setMax(res.max);
      if (res.prefill?.template?.trim()) setTemplate(res.prefill.template);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger les mémoires.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setCreating(false);
    setEditingId(null);
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
    setName(`${base} ${nextId}`);
    setInstructions(template || FALLBACK_TEMPLATE);
    setEditingId(null);
    setCreating(true);
    setError('');
  }

  function startEdit(m: CampaignMemoryDto) {
    setName(m.name);
    setInstructions(m.instructions || '');
    setEditingId(m.id);
    setCreating(false);
    setError('');
  }

  function backToList() {
    setCreating(false);
    setEditingId(null);
    setError('');
  }

  async function saveCreate() {
    if (name.trim().length < 2) {
      setError('Donne un nom à la mémoire (min. 2 caractères).');
      return;
    }
    if (instructions.trim().length < 10) {
      setError('Ajoute des instructions pour l’agent.');
      return;
    }
    setBusy(true);
    setError('');
    const body: CampaignMemoryInput = {
      name: name.trim(),
      instructions: instructions.replace(/\r\n/g, '\n').trim(),
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

  async function saveEdit() {
    if (editingId == null) return;
    if (name.trim().length < 2) {
      setError('Donne un nom à la mémoire (min. 2 caractères).');
      return;
    }
    if (instructions.trim().length < 10) {
      setError('Ajoute des instructions pour l’agent.');
      return;
    }
    setBusy(true);
    setError('');
    const body: CampaignMemoryInput = {
      name: name.trim(),
      instructions: instructions.replace(/\r\n/g, '\n').trim(),
    };
    try {
      await updateCampaignMemoryApi(editingId, body);
      await onLinked();
      await load();
      backToList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mise à jour impossible.');
    } finally {
      setBusy(false);
    }
  }

  const linked = memories.find((m) => m.id === linkedMemoryId) ?? null;
  const formMode = creating || editingId != null;

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
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="thread-memory-title" className="text-sm font-semibold text-text-100">
                Mémoire de cette automatisation
              </h2>
              {!loading ? (
                <span
                  className={cn(
                    'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold tabular-nums',
                    memories.length >= max
                      ? 'bg-amber-500/15 text-amber-800'
                      : 'bg-brand/10 text-brand',
                  )}
                  title={`${memories.length} mémoire${memories.length === 1 ? '' : 's'} créée${memories.length === 1 ? '' : 's'} sur ${max} maximum`}
                >
                  {memories.length}/{max}
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-[12px] leading-relaxed text-text-400">
              {loading
                ? 'Chargement des mémoires…'
                : `${memories.length} créée${memories.length === 1 ? '' : 's'} · ${Math.max(0, max - memories.length)} disponible${max - memories.length === 1 ? '' : 's'} (max ${max}). Choisis, crée ou modifie une mémoire.`}
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
          ) : formMode ? (
            <div className="space-y-3">
              <p className="text-xs font-medium text-text-300">
                {editingId != null
                  ? 'Modifier la mémoire'
                  : `Nouvelle mémoire (${memories.length + 1}/${max})`}
              </p>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-text-400">Nom</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex. Support chaleureux"
                  maxLength={80}
                  className="w-full rounded-lg border border-black/10 bg-bg-0 px-3 py-2 text-sm text-text-100 outline-none focus:border-brand/40"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-text-400">
                  Instructions
                </label>
                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  rows={12}
                  className="w-full resize-y rounded-xl border border-black/10 bg-bg-0 px-3 py-2.5 text-[13px] leading-relaxed text-text-100 outline-none focus:border-brand/40"
                  placeholder={FALLBACK_TEMPLATE}
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={backToList}
                  className="rounded-xl border border-black/10 px-3 py-2 text-sm text-text-400 transition hover:bg-bg-200"
                >
                  Retour
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void (editingId != null ? saveEdit() : saveCreate())}
                  className="flex-1 rounded-xl bg-brand px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  {busy
                    ? 'Enregistrement…'
                    : editingId != null
                      ? 'Enregistrer'
                      : 'Créer et connecter'}
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
              {linked ? (
                <div className="mb-3 flex items-center gap-2 rounded-xl border border-brand/25 bg-brand/5 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text-100">{linked.name}</p>
                    <p className="truncate text-[11px] text-text-500">
                      {previewLine(linked.instructions)}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => startEdit(linked)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-brand/30 bg-bg-0 px-2.5 py-1.5 text-xs font-semibold text-brand transition hover:bg-brand/10 disabled:opacity-50"
                  >
                    <Pencil className="h-3 w-3" />
                    Modifier
                  </button>
                </div>
              ) : null}

              <ul className="divide-y divide-black/5 rounded-xl border border-black/10 bg-bg-100/60">
                {memories.map((m) => {
                  const selected = linkedMemoryId === m.id;
                  return (
                    <li key={m.id} className="flex items-stretch">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void selectMemory(m.id)}
                        className={cn(
                          'flex min-w-0 flex-1 items-start gap-3 px-3.5 py-3 text-left transition hover:bg-bg-200/80 disabled:opacity-50',
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
                            {previewLine(m.instructions)}
                          </p>
                        </div>
                      </button>
                      <div className="flex items-center pr-2">
                        <button
                          type="button"
                          disabled={busy}
                          title="Modifier"
                          onClick={(e) => {
                            e.stopPropagation();
                            startEdit(m);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium text-text-400 transition hover:bg-bg-200 hover:text-brand disabled:opacity-50"
                        >
                          <Pencil className="h-3 w-3" />
                          Modifier
                        </button>
                      </div>
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
                {memories.length >= max
                  ? `Limite atteinte (${memories.length}/${max})`
                  : `Créer une nouvelle mémoire (${memories.length}/${max})`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
