import { useCallback, useEffect, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Brain, Check, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import {
  createCampaignMemoryApi,
  deleteCampaignMemoryApi,
  fetchCampaignMemories,
  fetchThreads,
  setDefaultCampaignMemoryApi,
  updateCampaignMemoryApi,
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

/** Nom par défaut : titre d'automatisation + prochain n° (ex. « Test Enregistrement 1 »). */
function buildDefaultMemoryName(
  automTitle: string | null | undefined,
  memories: CampaignMemoryDto[],
): string {
  const base = (automTitle || '').trim() || 'Mémoire';
  const nextId =
    memories.length === 0 ? 1 : Math.max(...memories.map((m) => m.id), 0) + 1;
  return `${base} ${nextId}`;
}

function fromDto(m: CampaignMemoryDto): Draft {
  return {
    name: m.name,
    ownerName: m.ownerName,
    introFormula: m.introFormula,
    tone: m.tone,
    toneNote: m.toneNote,
    formality: m.formality,
    stickersEnabled: m.stickersEnabled,
    emojiLevel: m.emojiLevel,
    sendWindowStart: m.sendWindowStart,
    sendWindowEnd: m.sendWindowEnd,
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

export function CampaignMemoriesPanel() {
  const [memories, setMemories] = useState<CampaignMemoryDto[]>([]);
  const [max, setMax] = useState(8);
  const [prefill, setPrefill] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
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
    void load();
  }, [load]);

  async function startCreate() {
    setFlash('');
    setError('');
    let automTitle = '';
    try {
      const threads = await fetchThreads();
      const latest = threads[0];
      automTitle = latest?.automation_name?.trim() || latest?.title?.trim() || '';
    } catch {
      /* ignore */
    }
    setDraft(
      emptyDraft({
        ownerName: prefill,
        name: buildDefaultMemoryName(automTitle, memories),
      }),
    );
    setEditingId('new');
  }

  function startEdit(m: CampaignMemoryDto) {
    setDraft(fromDto(m));
    setEditingId(m.id);
    setFlash('');
    setError('');
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(emptyDraft({ ownerName: prefill }));
  }

  async function save() {
    if (draft.name.trim().length < 2) {
      setError('Donne un nom à la mémoire (min. 2 caractères).');
      return;
    }
    setBusy(true);
    setError('');
    setFlash('');
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
      if (editingId === 'new') {
        await createCampaignMemoryApi(body);
        setFlash('Mémoire créée.');
      } else if (typeof editingId === 'number') {
        await updateCampaignMemoryApi(editingId, body);
        setFlash('Mémoire mise à jour.');
      }
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enregistrement impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function makeDefault(id: number) {
    setBusy(true);
    setError('');
    try {
      await setDefaultCampaignMemoryApi(id);
      setFlash('Mémoire définie par défaut.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!window.confirm('Supprimer cette mémoire ?')) return;
    setBusy(true);
    setError('');
    try {
      await deleteCampaignMemoryApi(id);
      if (editingId === id) cancelEdit();
      setFlash('Mémoire supprimée.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Suppression impossible.');
    } finally {
      setBusy(false);
    }
  }

  const isFormOpen = editingId != null;

  return (
    <section className="rounded-2xl border border-black/10 bg-bg-100/80 p-4 sm:p-5">
      {!isFormOpen ? (
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand/20 bg-brand/10 text-brand">
            <Brain className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text-100">Mémoires de campagne</h2>
            <p className="mt-0.5 text-[12px] leading-relaxed text-text-400">
              Style commun aux campagnes entrantes et sortantes : présentation, ton, stickers,
              fenêtre d&apos;envoi. L&apos;agent utilise la mémoire par défaut et ne repose plus ces
              questions.
            </p>
          </div>
        </div>
      ) : null}

      {error ? <p className="mb-3 text-sm text-red-400">{error}</p> : null}
      {flash && !isFormOpen ? (
        <p className="mb-3 text-sm text-emerald-600">{flash}</p>
      ) : null}

      {loading ? (
        <p className="text-sm text-text-400">Chargement…</p>
      ) : isFormOpen ? (
        <div className="space-y-4 rounded-xl border border-black/10 bg-bg-0 p-3.5 sm:p-4">
          <p className="text-xs font-medium text-text-300">
            {editingId === 'new' ? 'Nouvelle mémoire' : 'Modifier la mémoire'}
          </p>

          <div>
            <FieldLabel>Nom</FieldLabel>
            <TextInput
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Ex. Test Enregistrement 1"
              maxLength={80}
            />
          </div>

          <div className="space-y-3 border-t border-black/5 pt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-500">
              Qui je suis
            </p>
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
          </div>

          <div className="space-y-3 border-t border-black/5 pt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-500">
              Style
            </p>
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
            <div>
              <FieldLabel>Note de ton (optionnel)</FieldLabel>
              <TextInput
                value={draft.toneNote}
                onChange={(e) => setDraft((d) => ({ ...d, toneNote: e.target.value }))}
                placeholder="Ex. clair et rassurant, sans jargon"
                maxLength={200}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <FieldLabel>Tutoiement</FieldLabel>
                <div className="flex gap-1.5">
                  {(
                    [
                      ['vous', 'Vous'],
                      ['tu', 'Tu'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, formality: id }))}
                      className={cn(
                        'flex-1 rounded-lg border px-2.5 py-1.5 text-xs transition',
                        draft.formality === id
                          ? 'border-brand bg-brand/10 text-brand'
                          : 'border-black/10 text-text-400',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <FieldLabel>Emojis</FieldLabel>
                <div className="flex gap-1.5">
                  {(
                    [
                      ['none', 'Aucun'],
                      ['sparse', 'Discret'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, emojiLevel: id }))}
                      className={cn(
                        'flex-1 rounded-lg border px-2.5 py-1.5 text-xs transition',
                        draft.emojiLevel === id
                          ? 'border-brand bg-brand/10 text-brand'
                          : 'border-black/10 text-text-400',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-text-200">
              <input
                type="checkbox"
                checked={draft.stickersEnabled}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, stickersEnabled: e.target.checked }))
                }
                className="rounded border-black/20"
              />
              Autoriser les stickers dans les conversations
            </label>
          </div>

          <div className="space-y-3 border-t border-black/5 pt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-500">
              Envoi
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>Début (h)</FieldLabel>
                <TextInput
                  type="number"
                  min={0}
                  max={23}
                  value={draft.sendWindowStart}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      sendWindowStart: Math.min(23, Math.max(0, Number(e.target.value) || 0)),
                    }))
                  }
                />
              </div>
              <div>
                <FieldLabel>Fin (h)</FieldLabel>
                <TextInput
                  type="number"
                  min={0}
                  max={23}
                  value={draft.sendWindowEnd}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      sendWindowEnd: Math.min(23, Math.max(0, Number(e.target.value) || 0)),
                    }))
                  }
                />
              </div>
            </div>
            <p className="text-[11px] text-text-500">
              Fenêtre d&apos;activité : {draft.sendWindowStart}h – {draft.sendWindowEnd}h
              (messages hors de cette plage reportés).
            </p>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-black/5 pt-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void save()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              Enregistrer
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={cancelEdit}
              className="rounded-xl border border-black/10 px-3.5 py-2 text-sm text-text-400 transition hover:bg-bg-200"
            >
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-black/5 rounded-xl border border-black/10 bg-bg-0">
            {memories.length === 0 ? (
              <li className="px-3.5 py-6 text-center text-sm text-text-400">
                Aucune mémoire pour l&apos;instant.
              </li>
            ) : (
              memories.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:flex-nowrap"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-text-100">{m.name}</span>
                      {m.isDefault ? (
                        <span className="inline-flex items-center gap-0.5 rounded-md bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium text-brand">
                          <Star className="h-2.5 w-2.5" /> Par défaut
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
                  <div className="flex shrink-0 items-center gap-1">
                    {!m.isDefault ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void makeDefault(m.id)}
                        className="rounded-lg px-2 py-1.5 text-[11px] text-text-400 transition hover:bg-bg-200 hover:text-text-200"
                        title="Définir par défaut"
                      >
                        Défaut
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => startEdit(m)}
                      className="rounded-lg p-1.5 text-text-400 transition hover:bg-bg-200 hover:text-text-200"
                      title="Modifier"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void remove(m.id)}
                      className="rounded-lg p-1.5 text-text-400 transition hover:bg-red-500/10 hover:text-red-400"
                      title="Supprimer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))
            )}
          </ul>

          <button
            type="button"
            disabled={busy || memories.length >= max}
            onClick={() => void startCreate()}
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-black/10 bg-bg-0 px-3 py-2 text-sm text-text-200 transition hover:border-brand/30 hover:text-brand disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Créer une mémoire
            {memories.length >= max ? ` (max ${max})` : null}
          </button>
        </>
      )}
    </section>
  );
}
