import { useCallback, useEffect, useState } from 'react';
import { evolutionApi, rebootEvolutionInstance } from '@/lib/api';
import { cn } from '@/lib/utils';

type ConsoleTab =
  | 'overview'
  | 'inbox'
  | 'chats'
  | 'contacts'
  | 'groups'
  | 'send'
  | 'status'
  | 'instance';

function fmtTime(isoOrTs: string | number | undefined): string {
  if (!isoOrTs) return '—';
  if (typeof isoOrTs === 'number') {
    return new Date(isoOrTs * 1000).toLocaleString('fr-FR');
  }
  const d = new Date(isoOrTs.includes('T') ? isoOrTs : isoOrTs.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? String(isoOrTs) : d.toLocaleString('fr-FR');
}

function Kpi({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-bg-100 p-4">
      <span className="text-xs text-text-500">{label}</span>
      <p className="mt-1 text-lg font-semibold text-text-100">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-text-500">{hint}</p>}
    </div>
  );
}

export function WhatsAppConsolePage() {
  const [tab, setTab] = useState<ConsoleTab>('overview');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [dashboard, setDashboard] = useState<Record<string, unknown> | null>(null);
  const [inboxSource, setInboxSource] = useState<'local' | 'live'>('local');
  const [inboxTodayOnly, setInboxTodayOnly] = useState(false);
  const [inboxMessages, setInboxMessages] = useState<Array<Record<string, unknown>>>([]);

  const [chats, setChats] = useState<Array<{ id: string; name?: string; type?: string; archive?: boolean }>>([]);
  const [chatDetail, setChatDetail] = useState<{
    id: string;
    name: string;
    messages: Array<Record<string, unknown>>;
  } | null>(null);

  const [contacts, setContacts] = useState<Array<{ id: string; name?: string }>>([]);
  const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [groupDetail, setGroupDetail] = useState<Record<string, unknown> | null>(null);

  const [sendChatId, setSendChatId] = useState('');
  const [sendMessage, setSendMessage] = useState('');
  const [sendFb, setSendFb] = useState('');

  const [statusText, setStatusText] = useState('');
  const [statusColor, setStatusColor] = useState('#228B22');
  const [statusFb, setStatusFb] = useState('');

  const [qrData, setQrData] = useState<{
    connected: boolean;
    message: string;
    base64?: string;
    pairingCode?: string;
  } | null>(null);

  const tabs: { id: ConsoleTab; label: string }[] = [
    { id: 'overview', label: 'Vue d\'ensemble' },
    { id: 'inbox', label: 'Inbox' },
    { id: 'chats', label: 'Chats' },
    { id: 'contacts', label: 'Contacts' },
    { id: 'groups', label: 'Groupes' },
    { id: 'send', label: 'Envoi' },
    { id: 'status', label: 'Statuts' },
    { id: 'instance', label: 'Instance' },
  ];

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await evolutionApi<Record<string, unknown>>('/api/evolution/dashboard');
      setDashboard(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadInbox = useCallback(async () => {
    setLoading(true);
    try {
      if (inboxSource === 'live') {
        const data = await evolutionApi<{ messages: Array<Record<string, unknown>> }>(
          '/api/evolution/inbox/live',
        );
        setInboxMessages(data.messages ?? []);
      } else {
        const q = inboxTodayOnly ? '?today=1&limit=200' : '?limit=200';
        const data = await evolutionApi<{ messages: Array<Record<string, unknown>> }>(
          `/api/evolution/inbox/local${q}`,
        );
        setInboxMessages(data.messages ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  }, [inboxSource, inboxTodayOnly]);

  const loadChats = useCallback(async () => {
    setLoading(true);
    try {
      const data = await evolutionApi<{ chats: typeof chats }>('/api/evolution/chats?count=150');
      setChats(data.chats ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  }, []);

  const openChatHistory = useCallback(async (chatId: string, name: string) => {
    setLoading(true);
    try {
      const data = await evolutionApi<{ messages: Array<Record<string, unknown>> }>(
        `/api/evolution/chat-history?chatId=${encodeURIComponent(chatId)}&count=60`,
      );
      setChatDetail({ id: chatId, name: name || chatId, messages: data.messages ?? [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadContacts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await evolutionApi<{ contacts: typeof contacts }>(
        '/api/evolution/contacts?count=200',
      );
      setContacts(data.contacts ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    try {
      const data = await evolutionApi<{ groups: typeof groups }>('/api/evolution/groups');
      setGroups(data.groups ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  }, []);

  const openGroupDetail = useCallback(async (groupId: string, name: string) => {
    setLoading(true);
    try {
      const data = await evolutionApi<{ group: Record<string, unknown> }>(
        `/api/evolution/groups/members?groupId=${encodeURIComponent(groupId)}`,
      );
      setGroupDetail({ ...data.group, _name: name, _id: groupId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadQr = useCallback(async () => {
    setLoading(true);
    try {
      const data = await evolutionApi<typeof qrData extends infer T ? NonNullable<T> : never>(
        '/api/evolution/instance/qr',
      );
      setQrData(data);
    } catch (err) {
      setQrData({ connected: false, message: err instanceof Error ? err.message : 'Erreur' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'overview') void loadDashboard();
    if (tab === 'inbox') void loadInbox();
    if (tab === 'chats') void loadChats();
    if (tab === 'contacts') void loadContacts();
    if (tab === 'groups') void loadGroups();
    if (tab === 'instance') void loadQr();
  }, [tab, loadDashboard, loadInbox, loadChats, loadContacts, loadGroups, loadQr]);

  const markRead = async (chatId: string) => {
    try {
      await evolutionApi('/api/evolution/read-chat', {
        method: 'POST',
        body: JSON.stringify({ chatId }),
      });
      alert('Chat marqué comme lu.');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erreur');
    }
  };

  const stats = (dashboard?.stats ?? {}) as Record<string, number>;
  const poll = (dashboard?.poll ?? {}) as Record<string, unknown>;
  const instance = (dashboard?.instance ?? {}) as Record<string, string>;

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <h1 className="font-serif text-2xl font-light text-text-100">Console WhatsApp</h1>
        <p className="mt-1 text-sm text-text-400">Inbox, chats, contacts, envoi et connexion Evolution API.</p>

        <div className="mt-4 flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition',
                tab === t.id
                  ? 'bg-brand-muted text-brand border border-brand-border'
                  : 'text-text-400 border border-white/10 hover:bg-bg-200',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        {loading && <p className="mt-4 text-sm text-text-500">Chargement…</p>}

        {tab === 'overview' && dashboard && (
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Kpi label="État instance" value={instance.state || '?'} hint={instance.message} />
            <Kpi
              label="Messages reçus"
              value={stats.totalIncoming ?? 0}
              hint={`${stats.incomingToday ?? 0} aujourd'hui`}
            />
            <Kpi
              label="Messages envoyés"
              value={stats.totalOutgoing ?? 0}
              hint={`${stats.outboundToday ?? 0}/${stats.outboundLimit ?? 30} quota jour`}
            />
            <Kpi
              label="Chats / contacts"
              value={stats.chatsCount ?? 0}
              hint={`${stats.contactsCount ?? 0} contacts · ${stats.groupsCount ?? 0} groupes`}
            />
            <Kpi
              label="Sync Evolution"
              value={poll.authorized ? 'OK' : 'Hors ligne'}
              hint={
                poll.lastIncomingAt
                  ? `Dernier entrant ${fmtTime(poll.lastIncomingAt as string)}`
                  : '—'
              }
            />
          </div>
        )}

        {tab === 'inbox' && (
          <div className="mt-6">
            <div className="mb-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setInboxSource('local')}
                className={cn(
                  'rounded-lg px-3 py-1 text-xs',
                  inboxSource === 'local' ? 'bg-brand-muted text-brand' : 'text-text-400',
                )}
              >
                SQLite
              </button>
              <button
                type="button"
                onClick={() => setInboxSource('live')}
                className={cn(
                  'rounded-lg px-3 py-1 text-xs',
                  inboxSource === 'live' ? 'bg-brand-muted text-brand' : 'text-text-400',
                )}
              >
                Evolution live
              </button>
              <button
                type="button"
                onClick={() => {
                  setInboxTodayOnly((v) => !v);
                  setTimeout(() => void loadInbox(), 0);
                }}
                className={cn(
                  'rounded-lg px-3 py-1 text-xs',
                  inboxTodayOnly ? 'bg-brand-muted text-brand' : 'text-text-400',
                )}
              >
                Aujourd&apos;hui
              </button>
              <button
                type="button"
                onClick={() => void loadInbox()}
                className="rounded-lg px-3 py-1 text-xs text-text-400 hover:bg-bg-200"
              >
                Actualiser
              </button>
            </div>
            <div className="space-y-3">
              {inboxMessages.length === 0 ? (
                <p className="text-sm text-text-500">Aucun message reçu.</p>
              ) : (
                inboxMessages.map((m, i) => {
                  const phone = String(m.contact_phone || m.chatId || '');
                  const display =
                    String(m.display || '') ||
                    (phone.endsWith('@c.us') ? '+' + phone.replace('@c.us', '') : phone);
                  const body = String(m.body || m.text || '');
                  return (
                    <article
                      key={String(m.id || i)}
                      className="rounded-xl border border-white/10 bg-bg-100 p-4"
                    >
                      <div className="flex justify-between gap-2 text-sm">
                        <strong className="text-text-200">{display}</strong>
                        <span className="text-text-500">{fmtTime(m.created_at as string)}</span>
                      </div>
                      <p className="mt-1 text-xs text-text-500">
                        {String(m.sender_name || m.senderName || '')}
                      </p>
                      <p className="mt-2 text-sm text-text-300">{body}</p>
                      {phone && (
                        <button
                          type="button"
                          onClick={() => void markRead(phone)}
                          className="mt-2 text-xs text-brand hover:underline"
                        >
                          Marquer lu
                        </button>
                      )}
                    </article>
                  );
                })
              )}
            </div>
          </div>
        )}

        {tab === 'chats' && (
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => void loadChats()}
                className="mb-2 text-xs text-brand hover:underline"
              >
                Actualiser
              </button>
              {chats.length === 0 ? (
                <p className="text-sm text-text-500">Aucun chat.</p>
              ) : (
                chats.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => void openChatHistory(c.id, c.name || c.id)}
                    className="flex w-full flex-col rounded-xl border border-white/10 bg-bg-100 px-4 py-3 text-left hover:border-brand-border"
                  >
                    <strong className="text-sm text-text-200">{c.name || c.id}</strong>
                    <span className="text-xs text-text-500">
                      {c.type}
                      {c.archive ? ' · archivé' : ''}
                    </span>
                  </button>
                ))
              )}
            </div>
            <div className="rounded-xl border border-white/10 bg-bg-100 p-4">
              {chatDetail ? (
                <>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="font-medium text-text-200">{chatDetail.name}</h3>
                    <button
                      type="button"
                      onClick={() => {
                        setSendChatId(chatDetail.id);
                        setTab('send');
                      }}
                      className="text-xs text-brand hover:underline"
                    >
                      Utiliser pour envoi
                    </button>
                  </div>
                  <div className="max-h-[400px] space-y-2 overflow-y-auto custom-scrollbar">
                    {chatDetail.messages.map((m, i) => (
                      <div
                        key={i}
                        className={cn(
                          'rounded-lg px-3 py-2 text-sm',
                          m.type === 'incoming' ? 'bg-bg-200' : 'bg-brand-muted',
                        )}
                      >
                        <p className="text-[10px] text-text-500">
                          {m.type === 'incoming' ? '←' : '→'} {String(m.senderName || '')} ·{' '}
                          {fmtTime(m.timestamp as number)}
                        </p>
                        <p className="text-text-300">{String(m.text)}</p>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-text-500">Sélectionnez un chat.</p>
              )}
            </div>
          </div>
        )}

        {tab === 'contacts' && (
          <div className="mt-6 space-y-3">
            <button
              type="button"
              onClick={() => void loadContacts()}
              className="text-xs text-brand hover:underline"
            >
              Actualiser
            </button>
            {contacts.length === 0 ? (
              <p className="text-sm text-text-500">Aucun contact.</p>
            ) : (
              contacts.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between rounded-xl border border-white/10 bg-bg-100 px-4 py-3"
                >
                  <div>
                    <strong className="text-sm text-text-200">{c.name || c.id}</strong>
                    <p className="text-xs text-text-500">{c.id}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSendChatId(c.id);
                      setTab('send');
                    }}
                    className="text-xs text-brand hover:underline"
                  >
                    Envoyer
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'groups' && (
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => void loadGroups()}
                className="mb-2 text-xs text-brand hover:underline"
              >
                Actualiser
              </button>
              {groups.length === 0 ? (
                <p className="text-sm text-text-500">Aucun groupe.</p>
              ) : (
                groups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => void openGroupDetail(g.id, g.name)}
                    className="flex w-full flex-col rounded-xl border border-white/10 bg-bg-100 px-4 py-3 text-left"
                  >
                    <strong className="text-sm text-text-200">{g.name}</strong>
                    <span className="text-xs text-text-500">{g.id}</span>
                  </button>
                ))
              )}
            </div>
            <div className="rounded-xl border border-white/10 bg-bg-100 p-4">
              {groupDetail ? (
                <>
                  <h3 className="font-medium text-text-200">
                    {String(groupDetail._name || groupDetail.subject || groupDetail._id)}
                  </h3>
                  <p className="text-xs text-text-500">{String(groupDetail.size ?? '?')} membres</p>
                  <ul className="mt-3 max-h-[300px] space-y-1 overflow-y-auto text-sm text-text-300">
                    {(
                      (groupDetail.participants as Array<{ name?: string; id: string; isAdmin?: boolean }>) ??
                      []
                    ).map((p) => (
                      <li key={p.id}>
                        {p.name || p.id}
                        {p.isAdmin ? ' (admin)' : ''}
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={() => {
                      setSendChatId(String(groupDetail._id));
                      setTab('send');
                    }}
                    className="mt-3 text-xs text-brand hover:underline"
                  >
                    Envoyer au groupe
                  </button>
                </>
              ) : (
                <p className="text-sm text-text-500">Sélectionnez un groupe.</p>
              )}
            </div>
          </div>
        )}

        {tab === 'send' && (
          <div className="mt-6 max-w-lg space-y-4 rounded-2xl border border-white/10 bg-bg-100 p-5">
            <label className="block text-xs text-text-400">
              Chat ID
              <input
                value={sendChatId}
                onChange={(e) => setSendChatId(e.target.value)}
                placeholder="229…@c.us ou …@g.us"
                className="mt-1 w-full rounded-xl border border-white/10 bg-bg-0 px-4 py-2.5 text-sm outline-none focus:border-brand"
              />
            </label>
            <label className="block text-xs text-text-400">
              Message
              <textarea
                value={sendMessage}
                onChange={(e) => setSendMessage(e.target.value)}
                rows={4}
                className="mt-1 w-full rounded-xl border border-white/10 bg-bg-0 px-4 py-2.5 text-sm outline-none focus:border-brand"
              />
            </label>
            <button
              type="button"
              className="rounded-xl bg-brand px-4 py-2 text-sm text-white hover:bg-brand-dark"
              onClick={async () => {
                if (!sendChatId.trim() || !sendMessage.trim()) {
                  setSendFb('Chat ID et message requis.');
                  return;
                }
                try {
                  const data = await evolutionApi<{ idMessage?: string }>(
                    '/api/evolution/send-message',
                    {
                      method: 'POST',
                      body: JSON.stringify({ chatId: sendChatId.trim(), message: sendMessage.trim() }),
                    },
                  );
                  setSendFb(`Envoyé · ${data.idMessage || ''}`);
                  setSendMessage('');
                } catch (err) {
                  setSendFb(err instanceof Error ? err.message : 'Erreur');
                }
              }}
            >
              Envoyer
            </button>
            {sendFb && <p className="text-sm text-text-400">{sendFb}</p>}
          </div>
        )}

        {tab === 'status' && (
          <div className="mt-6 max-w-lg space-y-4 rounded-2xl border border-white/10 bg-bg-100 p-5">
            <label className="block text-xs text-text-400">
              Texte du statut
              <textarea
                value={statusText}
                onChange={(e) => setStatusText(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-xl border border-white/10 bg-bg-0 px-4 py-2.5 text-sm outline-none focus:border-brand"
              />
            </label>
            <label className="block text-xs text-text-400">
              Couleur de fond
              <input
                type="text"
                value={statusColor}
                onChange={(e) => setStatusColor(e.target.value)}
                className="mt-1 w-full rounded-xl border border-white/10 bg-bg-0 px-4 py-2.5 text-sm outline-none focus:border-brand"
              />
            </label>
            <button
              type="button"
              className="rounded-xl bg-brand px-4 py-2 text-sm text-white hover:bg-brand-dark"
              onClick={async () => {
                if (!statusText.trim()) {
                  setStatusFb('Message requis.');
                  return;
                }
                try {
                  const data = await evolutionApi<{ audienceCount?: number }>(
                    '/api/evolution/send-status',
                    {
                      method: 'POST',
                      body: JSON.stringify({
                        message: statusText.trim(),
                        backgroundColor: statusColor.trim() || '#228B22',
                        font: 'SERIF',
                      }),
                    },
                  );
                  setStatusFb(`Statut publié · ${data.audienceCount ?? ''} contact(s)`);
                } catch (err) {
                  setStatusFb(err instanceof Error ? err.message : 'Erreur');
                }
              }}
            >
              Publier le statut
            </button>
            {statusFb && <p className="text-sm text-text-400">{statusFb}</p>}
          </div>
        )}

        {tab === 'instance' && (
          <div className="mt-6 max-w-md space-y-4 rounded-2xl border border-white/10 bg-bg-100 p-5">
            {qrData?.connected ? (
              <p className="text-sm text-emerald-400">{qrData.message || 'WhatsApp connecté.'}</p>
            ) : (
              <>
                {qrData?.base64 && (
                  <img
                    src={`data:image/png;base64,${qrData.base64}`}
                    alt="QR"
                    className="mx-auto max-w-[220px] rounded-xl"
                  />
                )}
                {qrData?.pairingCode && (
                  <p className="text-center text-sm">
                    Code : <strong>{qrData.pairingCode}</strong>
                  </p>
                )}
                <p className="text-center text-xs text-text-500">{qrData?.message}</p>
              </>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void loadQr()}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm hover:bg-bg-200"
              >
                Actualiser QR
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!confirm("Redémarrer l'instance ?")) return;
                  try {
                    await rebootEvolutionInstance();
                    void loadQr();
                  } catch (err) {
                    alert(err instanceof Error ? err.message : 'Erreur');
                  }
                }}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm hover:bg-bg-200"
              >
                Redémarrer
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
