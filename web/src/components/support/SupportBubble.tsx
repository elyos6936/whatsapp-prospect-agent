import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Home, ImagePlus, MessageCircle, MessagesSquare, Send, X } from 'lucide-react';
import {
  fetchMySupportTicket,
  fetchSupportThread,
  sendSupportChat,
  uploadChatFiles,
  type SupportMessageDto,
  type SupportTicketDto,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { API_BASE_URL, PROD_API_URL } from '@/lib/config';
import { cn } from '@/lib/utils';

type View = 'home' | 'messages' | 'chat' | 'faq';
type MsgTab = 'open' | 'done';

const FAQS = [
  {
    q: 'Puis-je utiliser mon WhatsApp personnel ?',
    a: 'Oui. Vous connectez votre numéro via QR code, comme sur WhatsApp Web. Votre compte reste le vôtre.',
  },
  {
    q: 'Vais-je me faire bloquer ?',
    a: "Klanvio intègre des règles anti-blocage : rythme d'envoi maîtrisé, refus des actions risquées, arrêt intelligent des conversations.",
  },
  {
    q: "L'IA répond-elle toute seule à tout le monde ?",
    a: 'Non. Elle répond uniquement aux prospects contactés pendant vos campagnes, ou aux clients qui écrivent le message-clé que vous avez défini.',
  },
  {
    q: "Limites de l'essai gratuit ?",
    a: "3 jours, 50 conversations à vie, et 1 extraction de groupe WhatsApp par jour. L'équipe est réservée à l'abonnement.",
  },
] as const;

function mediaUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = (API_BASE_URL || PROD_API_URL).replace(/\/$/, '');
  return url.startsWith('/') ? `${base}${url}` : `${base}/${url}`;
}

function firstName(name: string | undefined, email: string | undefined): string {
  const n = (name || '').trim();
  if (n) return n.split(/\s+/)[0] ?? n;
  const e = (email || '').split('@')[0] || 'there';
  return e.charAt(0).toUpperCase() + e.slice(1);
}

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return 'à l’instant';
    if (diff < 3_600_000) return `il y a ${Math.floor(diff / 60_000)} min`;
    return d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function SupportFab({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={open ? 'Fermer le support' : 'Ouvrir le support'}
      onClick={onToggle}
      className={cn(
        'fixed bottom-4 right-4 z-[60] flex h-14 w-14 items-center justify-center rounded-full',
        'bg-brand text-white shadow-[0_12px_28px_-8px_rgba(32,87,206,0.55)]',
        'transition hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring',
        'sm:bottom-5 sm:right-5',
      )}
    >
      {open ? <X className="h-6 w-6" strokeWidth={2.25} /> : <MessagesSquare className="h-6 w-6" strokeWidth={2.1} />}
    </button>
  );
}

export function SupportBubble() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('home');
  const [msgTab, setMsgTab] = useState<MsgTab>('open');
  const [tickets, setTickets] = useState<SupportTicketDto[]>([]);
  const [ticket, setTicket] = useState<SupportTicketDto | null>(null);
  const [messages, setMessages] = useState<SupportMessageDto[]>([]);
  const [draft, setDraft] = useState('');
  const [pendingImages, setPendingImages] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const name = firstName(user?.name, user?.email);

  const refreshThread = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSupportThread();
      setTicket(data.ticket);
      setMessages(data.messages);
      setTickets(data.tickets);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger le support');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refreshThread();
  }, [open, refreshThread]);

  useEffect(() => {
    if (view === 'chat') {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, view, busy]);

  const openTickets = tickets.filter((t) => t.status === 'open' || t.status === 'pending');
  const doneTickets = tickets.filter((t) => t.status === 'done');
  const list = msgTab === 'open' ? openTickets : doneTickets;

  async function openChat(existing?: SupportTicketDto) {
    setView('chat');
    setError(null);
    if (existing) {
      setLoading(true);
      try {
        const data = await fetchMySupportTicket(existing.id);
        setTicket(data.ticket);
        setMessages(data.messages);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erreur');
      } finally {
        setLoading(false);
      }
      return;
    }
    await refreshThread();
  }

  async function onSend() {
    const text = draft.trim();
    if ((!text && pendingImages.length === 0) || busy) return;
    setBusy(true);
    setError(null);
    try {
      let imageUrls: string[] = [];
      if (pendingImages.length) {
        const uploaded = await uploadChatFiles(pendingImages);
        imageUrls = uploaded.map((u) => u.url);
      }
      const result = await sendSupportChat({
        message: text || undefined,
        imageUrls,
        ticketId: ticket?.id,
      });
      setTicket(result.ticket);
      setMessages(result.messages);
      setDraft('');
      setPendingImages([]);
      setTickets((prev) => {
        const others = prev.filter((t) => t.id !== result.ticket.id);
        return [result.ticket, ...others];
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Envoi impossible');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SupportFab
        open={open}
        onToggle={() => {
          setOpen((v) => !v);
          if (!open) setView('home');
        }}
      />

      {open && (
        <div
          className={cn(
            'fixed bottom-[4.75rem] right-4 z-[60] flex w-[min(100vw-1.5rem,380px)] flex-col overflow-hidden',
            'rounded-2xl border border-black/10 bg-white shadow-[0_24px_64px_-24px_rgba(15,23,42,0.45)]',
            'sm:bottom-[5.25rem] sm:right-5',
            'h-[min(72vh,560px)]',
          )}
        >
          {view === 'home' && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="relative shrink-0 bg-gradient-to-b from-brand to-[#4b7fe0] px-5 pb-16 pt-5 text-white">
                <div className="flex items-center gap-2">
                  <img
                    src="https://www.klanvio.com/brand/logo-icon.png"
                    alt=""
                    className="h-7 w-7 rounded-lg bg-white/15 p-0.5"
                  />
                  <span className="text-sm font-semibold tracking-tight">Klanvio</span>
                </div>
                <div className="mt-5 flex -space-x-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-white/40 bg-white/20 text-sm font-bold">
                    L
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-white/40 bg-white/25 text-xs font-semibold">
                    KS
                  </div>
                </div>
                <h2 className="mt-4 text-xl font-semibold tracking-tight">Hi {name}</h2>
                <p className="mt-1 text-[15px] font-medium text-white/90">How can we help today?</p>
              </div>

              <div className="-mt-10 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 pb-3">
                <button
                  type="button"
                  onClick={() => void openChat()}
                  className="rounded-2xl border border-black/[0.06] bg-white px-4 py-3.5 text-left shadow-sm transition hover:border-brand-border"
                >
                  <p className="text-sm font-semibold text-text-100">Request a feature</p>
                  <p className="mt-0.5 text-xs text-text-500">What would you like to see next?</p>
                </button>
                <button
                  type="button"
                  onClick={() => setView('faq')}
                  className="rounded-2xl border border-black/[0.06] bg-white px-4 py-3.5 text-left shadow-sm transition hover:border-brand-border"
                >
                  <p className="text-sm font-semibold text-text-100">Search for help</p>
                  <p className="mt-0.5 text-xs text-text-500">FAQ Klanvio en quelques secondes</p>
                </button>
                <button
                  type="button"
                  onClick={() => void openChat()}
                  className="rounded-2xl border border-black/[0.06] bg-white px-4 py-3.5 text-left shadow-sm transition hover:border-brand-border"
                >
                  <p className="text-sm font-semibold text-text-100">Talk to Grace</p>
                  <p className="mt-0.5 text-xs text-text-500">Notre bot répond instantanément</p>
                </button>
              </div>
            </div>
          )}

          {view === 'faq' && (
            <div className="flex min-h-0 flex-1 flex-col">
              <header className="flex items-center gap-2 border-b border-black/[0.06] px-3 py-3">
                <button type="button" className="rounded-lg p-1.5 hover:bg-black/[0.04]" onClick={() => setView('home')}>
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <h3 className="flex-1 text-center text-sm font-semibold">Aide</h3>
                <span className="w-8" />
              </header>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                {FAQS.map((f) => (
                  <details key={f.q} className="rounded-xl border border-black/[0.06] bg-[#f7f8fb] px-3 py-2">
                    <summary className="cursor-pointer text-sm font-medium text-text-100">{f.q}</summary>
                    <p className="mt-1.5 text-xs leading-relaxed text-text-400">{f.a}</p>
                  </details>
                ))}
                <button
                  type="button"
                  onClick={() => void openChat()}
                  className="mt-2 w-full rounded-full bg-text-100 py-2.5 text-sm font-semibold text-white"
                >
                  Toujours besoin d’aide ? Écrire à Grace
                </button>
              </div>
            </div>
          )}

          {view === 'messages' && (
            <div className="flex min-h-0 flex-1 flex-col">
              <header className="border-b border-black/[0.06] px-3 pt-3">
                <div className="flex items-center justify-between px-1 pb-2">
                  <h3 className="flex-1 text-center text-sm font-semibold">Messages</h3>
                  <button type="button" className="rounded-lg p-1 hover:bg-black/[0.04]" onClick={() => setOpen(false)}>
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex gap-4 px-2">
                  {(['open', 'done'] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setMsgTab(tab)}
                      className={cn(
                        'pb-2 text-sm font-medium',
                        msgTab === tab
                          ? 'border-b-2 border-text-100 text-text-100'
                          : 'text-text-500',
                      )}
                    >
                      {tab === 'open' ? 'Open' : 'Done'}
                    </button>
                  ))}
                </div>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {loading && <p className="text-center text-xs text-text-500">Chargement…</p>}
                {!loading && list.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#eef1f6] text-text-400">
                      <MessageCircle className="h-7 w-7" />
                    </div>
                    <p className="text-sm font-semibold text-text-100">Messages</p>
                    <p className="mt-1 text-xs text-text-500">No messages yet</p>
                    <button
                      type="button"
                      onClick={() => void openChat()}
                      className="mt-6 inline-flex items-center gap-2 rounded-full bg-text-100 px-5 py-2.5 text-sm font-semibold text-white"
                    >
                      Send us a message
                      <Send className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                {!loading &&
                  list.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => void openChat(t)}
                      className="mb-2 w-full rounded-xl border border-black/[0.06] px-3 py-3 text-left hover:border-brand-border"
                    >
                      <p className="truncate text-sm font-semibold text-text-100">{t.subject}</p>
                      <p className="mt-0.5 truncate text-xs text-text-500">
                        {t.summary || formatWhen(t.last_message_at)}
                      </p>
                    </button>
                  ))}
              </div>
            </div>
          )}

          {view === 'chat' && (
            <div className="flex min-h-0 flex-1 flex-col">
              <header className="flex items-center gap-1 border-b border-black/[0.06] px-2 py-2.5">
                <button type="button" className="rounded-lg p-1.5 hover:bg-black/[0.04]" onClick={() => setView('messages')}>
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <div className="min-w-0 flex-1 text-center">
                  <p className="text-sm font-semibold text-text-100">Grace</p>
                  <p className="text-[11px] text-text-500">Our bot will reply instantly</p>
                </div>
                <button type="button" className="rounded-lg p-1.5 hover:bg-black/[0.04]" onClick={() => setOpen(false)}>
                  <X className="h-4 w-4" />
                </button>
              </header>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
                {messages.length === 0 && !loading && (
                  <div>
                    <p className="mb-1 text-[11px] font-medium text-text-500">Grace</p>
                    <div className="max-w-[90%] rounded-2xl bg-[#eef1f6] px-3.5 py-2.5 text-sm leading-relaxed text-text-100">
                      👋 Hi, I&apos;m Grace, your Klanvio AI assistant. I&apos;m here to help with your WhatsApp agent,
                      campaigns, and billing questions.
                    </div>
                    <p className="mt-1 text-[10px] text-text-500">a few seconds ago</p>
                  </div>
                )}
                {messages.map((m) => {
                  const mine = m.role === 'user';
                  const label =
                    m.role === 'user' ? 'You' : m.role === 'ops' ? 'Support' : m.role === 'system' ? 'System' : 'Grace';
                  return (
                    <div key={m.id} className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
                      {!mine && <p className="mb-1 text-[11px] font-medium text-text-500">{label}</p>}
                      <div
                        className={cn(
                          'max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
                          mine ? 'bg-brand text-white' : 'bg-[#eef1f6] text-text-100',
                        )}
                      >
                        {m.content}
                        {m.image_urls.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {m.image_urls.map((url) => (
                              <a key={url} href={mediaUrl(url)} target="_blank" rel="noreferrer">
                                <img
                                  src={mediaUrl(url)}
                                  alt=""
                                  className="h-20 w-20 rounded-lg object-cover"
                                />
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                      <p className="mt-1 text-[10px] text-text-500">{formatWhen(m.created_at)}</p>
                    </div>
                  );
                })}
                {busy && (
                  <p className="text-xs text-text-500">Grace écrit…</p>
                )}
                <div ref={bottomRef} />
              </div>

              {error && <p className="px-3 pb-1 text-xs text-red-600">{error}</p>}

              {pendingImages.length > 0 && (
                <div className="flex gap-2 overflow-x-auto px-3 pb-1">
                  {pendingImages.map((f, i) => (
                    <div key={`${f.name}-${i}`} className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border">
                      <img src={URL.createObjectURL(f)} alt="" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        className="absolute right-0.5 top-0.5 rounded bg-black/60 p-0.5 text-white"
                        onClick={() => setPendingImages((prev) => prev.filter((_, idx) => idx !== i))}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-end gap-1.5 border-t border-black/[0.06] p-2.5">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []).slice(0, 4);
                    if (files.length) setPendingImages((prev) => [...prev, ...files].slice(0, 4));
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  className="rounded-xl p-2 text-text-400 hover:bg-black/[0.04] hover:text-text-100"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                >
                  <ImagePlus className="h-5 w-5" />
                </button>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={1}
                  placeholder="Écrivez votre message…"
                  className="max-h-24 min-h-[40px] flex-1 resize-none rounded-xl border border-black/[0.08] bg-[#f7f8fb] px-3 py-2 text-sm outline-none focus:border-brand-border"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void onSend();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => void onSend()}
                  disabled={busy || (!draft.trim() && pendingImages.length === 0)}
                  className="rounded-xl bg-brand p-2.5 text-white disabled:opacity-40"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {(view === 'home' || view === 'messages' || view === 'faq') && (
            <nav className="mt-auto flex shrink-0 border-t border-black/[0.06] bg-white">
              <button
                type="button"
                onClick={() => setView('home')}
                className={cn(
                  'flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium',
                  view === 'home' || view === 'faq' ? 'text-text-100' : 'text-text-500',
                )}
              >
                <Home className="h-5 w-5" strokeWidth={view === 'home' || view === 'faq' ? 2.4 : 1.8} />
                Home
              </button>
              <button
                type="button"
                onClick={() => setView('messages')}
                className={cn(
                  'flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium',
                  view === 'messages' ? 'text-text-100' : 'text-text-500',
                )}
              >
                <MessageCircle className="h-5 w-5" strokeWidth={view === 'messages' ? 2.4 : 1.8} />
                Messages
              </button>
            </nav>
          )}
        </div>
      )}
    </>
  );
}
