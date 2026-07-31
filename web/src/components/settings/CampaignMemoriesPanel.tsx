import { useCallback, useEffect, useState } from 'react';
import { Brain, Check, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import {
  createCampaignMemoryApi,
  deleteCampaignMemoryApi,
  fetchCampaignMemories,
  fetchThreads,
  setDefaultCampaignMemoryApi,
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
  return line.slice(0, 90) || 'Instructions vides';
}

function buildDefaultName(automTitle: string | null | undefined, memories: CampaignMemoryDto[]) {
  const base = (automTitle || '').trim() || 'Mémoire';
  const nextId =
    memories.length === 0 ? 1 : Math.max(...memories.map((m) => m.id), 0) + 1;
  return `${base} ${nextId}`;
}

export function CampaignMemoriesPanel() {
  const [memories, setMemories] = useState<CampaignMemoryDto[]>([]);
  const [max, setMax] = useState(8);
  const [template, setTemplate] = useState(FALLBACK_TEMPLATE);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
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
    setName(buildDefaultName(automTitle, memories));
    setInstructions(template || FALLBACK_TEMPLATE);
    setEditingId('new');
  }

  function startEdit(m: CampaignMemoryDto) {
    setName(m.name);
    setInstructions(m.instructions?.trim() ? m.instructions : template || FALLBACK_TEMPLATE);
    setEditingId(m.id);
    setFlash('');
    setError('');
  }

  function cancelEdit() {
    setEditingId(null);
    setName('');
    setInstructions('');
  }

  async function save() {
    if (name.trim().length < 2) {
      setError('Donne un nom à la mémoire (min. 2 caractères).');
      return;
    }
    if (instructions.trim().length < 10) {
      setError('Ajoute des instructions (phrases à tirets) pour l’agent.');
      return;
    }
    setBusy(true);
    setError('');
    setFlash('');
    const body: CampaignMemoryInput = {
      name: name.trim(),
      instructions: instructions.replace(/\r\n/g, '\n').trim(),
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
              Une case d&apos;instructions (phrases à tirets) : comportement de l&apos;agent,
              produits/services, prix, liens… Connecte une mémoire à chaque automatisation via le
              bouton <strong>Mémoire</strong> dans le chat.
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
        <div className="space-y-3">
          <p className="text-xs font-medium text-text-300">
            {editingId === 'new' ? 'Nouvelle mémoire' : 'Modifier la mémoire'}
          </p>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-text-400">Nom</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex. Support Automax"
              maxLength={80}
              className="w-full rounded-lg border border-black/10 bg-bg-0 px-3 py-2 text-sm text-text-100 outline-none transition placeholder:text-text-500 focus:border-brand/40"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-text-400">
              Instructions (une phrase par ligne, avec tiret)
            </label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={14}
              spellCheck
              className="w-full resize-y rounded-xl border border-black/10 bg-bg-0 px-3.5 py-3 font-sans text-[13px] leading-relaxed text-text-100 outline-none transition placeholder:text-text-500 focus:border-brand/40"
              placeholder={FALLBACK_TEMPLATE}
            />
            <p className="mt-1.5 text-[11px] leading-relaxed text-text-500">
              Modifie les phrases préremplies et ajoute tes infos produit. L&apos;agent s&apos;en
              sert pour ce fil uniquement — moins de questions avant le lancement.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => void save()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              {busy ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={cancelEdit}
              className="rounded-xl border border-black/10 bg-bg-0 px-3.5 py-2 text-sm text-text-300 transition hover:bg-bg-200"
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
                      {previewLine(m.instructions)}
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
            className={cn(
              'mt-3 inline-flex items-center gap-1.5 rounded-xl border border-black/10 bg-bg-0 px-3 py-2 text-sm text-text-200 transition hover:border-brand/30 hover:text-brand disabled:opacity-50',
            )}
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
