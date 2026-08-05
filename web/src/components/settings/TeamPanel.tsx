import { useCallback, useEffect, useState } from 'react';
import { Loader2, Mail, Trash2, UserPlus, Users } from 'lucide-react';
import {
  cancelTeamInvite,
  fetchTeamOverview,
  inviteTeamMember,
  removeTeamMember,
  updateTeamMemberRole,
  type TeamInviteRole,
  type TeamOverview,
} from '@/lib/api';
import { cn } from '@/lib/utils';

function roleLabel(role: string): string {
  if (role === 'owner') return 'Propriétaire';
  if (role === 'admin') return 'Admin';
  return 'Membre';
}

export function TeamPanel() {
  const [data, setData] = useState<TeamOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamInviteRole>('member');
  const [busy, setBusy] = useState(false);
  const [fb, setFb] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const overview = await fetchTeamOverview();
      setData(overview);
    } catch (err) {
      setFb({
        type: 'err',
        text: err instanceof Error ? err.message : 'Impossible de charger l’équipe.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const canManage =
    data?.workspace.role === 'owner' || data?.workspace.role === 'admin';
  const isOwner = data?.workspace.role === 'owner';
  const maxInvites = data?.limits.maxInvites;
  const usedInvites = data?.limits.usedInvites ?? 0;
  const atLimit = maxInvites != null && usedInvites >= maxInvites;

  const handleInvite = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setFb(null);
    try {
      await inviteTeamMember({ email: email.trim(), role });
      setEmail('');
      setFb({ type: 'ok', text: 'Invitation envoyée par email.' });
      await load();
    } catch (err) {
      setFb({
        type: 'err',
        text: err instanceof Error ? err.message : 'Échec de l’invitation.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCancelInvite = async (inviteId: number) => {
    setBusy(true);
    setFb(null);
    try {
      await cancelTeamInvite(inviteId);
      setFb({ type: 'ok', text: 'Invitation annulée.' });
      await load();
    } catch (err) {
      setFb({
        type: 'err',
        text: err instanceof Error ? err.message : 'Impossible d’annuler.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (userId: number) => {
    if (!confirm('Retirer ce membre de l’équipe ?')) return;
    setBusy(true);
    setFb(null);
    try {
      await removeTeamMember(userId);
      setFb({ type: 'ok', text: 'Membre retiré.' });
      await load();
    } catch (err) {
      setFb({
        type: 'err',
        text: err instanceof Error ? err.message : 'Impossible de retirer ce membre.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRoleChange = async (userId: number, nextRole: TeamInviteRole) => {
    setBusy(true);
    setFb(null);
    try {
      await updateTeamMemberRole(userId, nextRole);
      setFb({ type: 'ok', text: 'Rôle mis à jour.' });
      await load();
    } catch (err) {
      setFb({
        type: 'err',
        text: err instanceof Error ? err.message : 'Impossible de modifier le rôle.',
      });
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return <div className="panel h-48 animate-pulse" />;
  }

  return (
    <div className="panel p-6">
      <div className="mb-1 flex items-center gap-2">
        <Users className="h-4 w-4 text-brand" />
        <h2 className="text-sm font-semibold text-text-100">Équipe</h2>
      </div>
      <p className="mb-5 text-xs text-text-400">
        Partagez votre espace Klanvio : campagnes, contacts, WhatsApp et intégrations communs.
        {maxInvites != null
          ? ` Votre palier permet ${maxInvites} invité${maxInvites > 1 ? 's' : ''} (propriétaire inclus : ${maxInvites + 1} personnes).`
          : ' Votre palier Business permet un nombre illimité de membres.'}
      </p>

      {fb && (
        <p
          className={cn(
            'mb-4 text-sm',
            fb.type === 'ok' ? 'text-emerald-400' : 'text-red-400',
          )}
        >
          {fb.text}
        </p>
      )}

      <div className="mb-6 rounded-xl border border-black/10 bg-bg-100/60 p-4">
                <p className="text-xs font-medium text-text-300">
          {data?.workspace.workspaceName || 'Mon équipe'}
        </p>
        <p className="mt-1 text-xs text-text-500">
          {maxInvites == null
            ? `${data?.limits.totalMembers ?? 0} membre${(data?.limits.totalMembers ?? 0) > 1 ? 's' : ''}`
            : `${usedInvites} / ${maxInvites} invité${maxInvites > 1 ? 's' : ''} utilisé${usedInvites > 1 ? 's' : ''}`}
        </p>
      </div>

      <div className="mb-6 space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-400">
          Membres
        </h3>
        <ul className="divide-y divide-black/5 rounded-xl border border-black/10">
          {(data?.members ?? []).map((m) => (
            <li
              key={m.userId}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-text-100">
                  {m.name || m.email}
                </p>
                <p className="truncate text-xs text-text-500">{m.email}</p>
              </div>
              <div className="flex items-center gap-2">
                {isOwner && m.role !== 'owner' ? (
                  <select
                    value={m.role === 'admin' ? 'admin' : 'member'}
                    disabled={busy}
                    onChange={(e) =>
                      void handleRoleChange(m.userId, e.target.value as TeamInviteRole)
                    }
                    className="rounded-lg border border-black/10 bg-bg-0 px-2 py-1 text-xs text-text-200"
                  >
                    <option value="member">Membre</option>
                    <option value="admin">Admin</option>
                  </select>
                ) : (
                  <span className="rounded-full bg-bg-200 px-2.5 py-0.5 text-xs text-text-400">
                    {roleLabel(m.role)}
                  </span>
                )}
                {canManage && m.role !== 'owner' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleRemove(m.userId)}
                    className="rounded-lg p-1.5 text-text-500 hover:bg-red-500/10 hover:text-red-400"
                    title="Retirer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {(data?.invites?.length ?? 0) > 0 && (
        <div className="mb-6 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-400">
            Invitations en attente
          </h3>
          <ul className="divide-y divide-black/5 rounded-xl border border-black/10">
            {data!.invites.map((inv) => (
              <li
                key={inv.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-text-100">{inv.email}</p>
                  <p className="text-xs text-text-500">
                    {roleLabel(inv.role)} · expire le{' '}
                    {new Date(inv.expiresAt).toLocaleDateString('fr-FR')}
                  </p>
                </div>
                {canManage && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleCancelInvite(inv.id)}
                    className="text-xs text-red-400 hover:underline"
                  >
                    Annuler
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {canManage && (
        <div className="space-y-3 rounded-xl border border-dashed border-black/15 bg-bg-100/40 p-4">
          <h3 className="flex items-center gap-2 text-sm font-medium text-text-200">
            <UserPlus className="h-4 w-4" />
            Inviter un membre
          </h3>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Mail className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-text-500" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="collaborateur@exemple.com"
                disabled={busy || atLimit}
                className="w-full rounded-xl border border-black/10 bg-bg-0 py-2.5 pr-3 pl-10 text-sm text-text-100 outline-none focus:border-brand"
              />
            </div>
            <select
              value={role}
              disabled={busy || atLimit || !isOwner}
              onChange={(e) => setRole(e.target.value as TeamInviteRole)}
              className="rounded-xl border border-black/10 bg-bg-0 px-3 py-2.5 text-sm text-text-200"
            >
              <option value="member">Membre</option>
              <option value="admin">Admin</option>
            </select>
            <button
              type="button"
              disabled={busy || atLimit || !email.trim()}
              onClick={() => void handleInvite()}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Inviter
            </button>
          </div>
          {atLimit && (
            <p className="text-xs text-amber-500">
              Limite atteinte pour votre palier. Passez au palier supérieur pour inviter plus de
              membres.
            </p>
          )}
          {!isOwner && (
            <p className="text-xs text-text-500">
              Seul le propriétaire peut promouvoir un membre en admin.
            </p>
          )}
        </div>
      )}

      {!canManage && (
        <p className="text-xs text-text-500">
          Seuls le propriétaire et les admins peuvent gérer les invitations.
        </p>
      )}
    </div>
  );
}
