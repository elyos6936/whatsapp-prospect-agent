import { useCallback, useEffect, useRef, useState } from 'react';
import { AppHeader } from '@/components/layout/AppHeader';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { ChatWorkspace } from '@/components/chat/ChatWorkspace';
import { ThreadMemoryModal } from '@/components/chat/ThreadMemoryModal';
import { ThreadStatsPage } from '@/components/chat/ThreadStatsPage';
import { ConnectWhatsAppGate } from '@/components/whatsapp/ConnectWhatsAppGate';
import { ConnectGoogleContactsGate } from '@/components/whatsapp/ConnectGoogleContactsGate';
import { useAuth } from '@/lib/auth';
import { useMessages } from '@/hooks/useMessages';
import { useSidebarCollapsed } from '@/hooks/useSidebarCollapsed';
import {
  buildUserMessageApiText,
  buildUserMessageDisplayText,
  type ChatAttachment,
} from '@/lib/chat-attachments';
import {
  createThread,
  deleteThread,
  fetchThreads,
  renameThread,
  sendChatMessage,
  type AgentThreadSummary,
} from '@/lib/api';
import type { OverlayView } from '@/lib/navigation';
import { OnboardingPage } from '@/pages/OnboardingPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { NewAutomationModal } from '@/components/ui/NewAutomationModal';

export default function AuthenticatedApp() {
  const { user, refreshUser } = useAuth();
  const [overlayView, setOverlayView] = useState<OverlayView>(null);
  const [collapsed, toggle] = useSidebarCollapsed();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [threads, setThreads] = useState<AgentThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const activeThreadIdRef = useRef<number | null>(null);
  activeThreadIdRef.current = activeThreadId;
  const [creatingThread, setCreatingThread] = useState(false);
  const [newAutoModalOpen, setNewAutoModalOpen] = useState(false);
  const [memoryModalOpen, setMemoryModalOpen] = useState(false);
  const [threadsLoading, setThreadsLoading] = useState(true);

  const chatEnabled = overlayView == null && !!user?.whatsapp?.connected && activeThreadId != null;
  const { messages, loading, appendLocal, appendOptimisticUser, clear } =
    useMessages(chatEnabled, activeThreadId);
  const [isSending, setIsSending] = useState(false);

  const waConnected = user?.whatsapp?.connected ?? false;
  const [gateConfirmed, setGateConfirmed] = useState(false);
  const neverConnected = user?.whatsapp?.state === 'not_configured';

  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null;

  // Retour OAuth Typeform → ouvrir Réglages / Intégrations
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('settings') === 'integrations') {
        setOverlayView('settings');
      }
    } catch {
      /* ignore */
    }
  }, []);

  const refreshThreads = useCallback(async (preferId?: number | null) => {
    const list = await fetchThreads();
    setThreads(list);
    setActiveThreadId((prev) => {
      if (preferId != null && list.some((t) => t.id === preferId)) return preferId;
      if (prev != null && list.some((t) => t.id === prev)) return prev;
      return list[0]?.id ?? null;
    });
    return list;
  }, []);

  useEffect(() => {
    if (!user) return;
    const id = setInterval(() => void refreshUser(), 30_000);
    return () => clearInterval(id);
  }, [user, refreshUser]);

  useEffect(() => {
    if (waConnected) {
      setGateConfirmed(false);
      return;
    }
    if (neverConnected) {
      setGateConfirmed(true);
      return;
    }
    const t = setTimeout(() => setGateConfirmed(true), 45_000);
    return () => clearTimeout(t);
  }, [waConnected, neverConnected]);

  useEffect(() => {
    if (!user?.onboarding_completed || !waConnected) return;
    let cancelled = false;
    setThreadsLoading(true);
    void refreshThreads()
      .catch(() => {
        if (!cancelled) setThreads([]);
      })
      .finally(() => {
        if (!cancelled) setThreadsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.onboarding_completed, waConnected, refreshThreads]);

  const handleNewThread = useCallback(() => {
    setNewAutoModalOpen(true);
  }, []);

  const handleCreateThread = useCallback(
    async (title: string, description: string, purpose: 'prospection' | 'support') => {
      setCreatingThread(true);
      try {
        const thread = await createThread(title, description, purpose);
        setNewAutoModalOpen(false);
        await refreshThreads(thread.id);
        setOverlayView(null);
        clear();
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Erreur');
      } finally {
        setCreatingThread(false);
      }
    },
    [clear, refreshThreads],
  );

  const handleSelectThread = useCallback(
    (id: number) => {
      if (id === activeThreadId) {
        setOverlayView(null);
        return;
      }
      // Vide immédiatement l'UI du fil précédent (évite de coller le chat A sur B)
      clear();
      setIsSending(false);
      setMemoryModalOpen(false);
      setActiveThreadId(id);
      setOverlayView(null);
    },
    [activeThreadId, clear],
  );

  const handleRenameThread = useCallback(
    async (id: number, title: string) => {
      try {
        await renameThread(id, title);
        await refreshThreads(id);
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Impossible de renommer.');
      }
    },
    [refreshThreads],
  );

  const handleDeleteThread = useCallback(
    async (id: number) => {
      try {
        await deleteThread(id);
        const list = await refreshThreads();
        if (!list.length) {
          const created = await createThread();
          await refreshThreads(created.id);
        }
        setOverlayView(null);
        clear();
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Impossible de supprimer.');
      }
    },
    [clear, refreshThreads],
  );

  const handleSend = useCallback(
    async (text: string, attachments: ChatAttachment[] = []) => {
      if (activeThreadId == null) return;
      const threadIdAtSend = activeThreadId;
      const displayText = buildUserMessageDisplayText(text, attachments);
      const apiText = buildUserMessageApiText(text, attachments);
      if (!apiText.trim()) return;

      appendOptimisticUser(displayText, apiText);

      setIsSending(true);
      try {
        const result = await sendChatMessage(apiText, threadIdAtSend);
        // Ne pas coller la réponse sur un autre fil si l'utilisateur a changé d'automatisation
        if (activeThreadIdRef.current !== threadIdAtSend) return;
        appendLocal({
          id: `agent-${result.id}`,
          kind: result.error ? 'error' : 'assistant',
          content: result.reply,
          created_at: result.created_at,
          label: 'Agent',
        });
        void refreshUser();
        void refreshThreads(threadIdAtSend);
      } catch (err) {
        if (activeThreadIdRef.current !== threadIdAtSend) return;
        const raw = err instanceof Error ? err.message : 'Erreur réseau';
        const friendly =
          /failed to fetch|network|timeout|prend plus|ECONN|HTTP/i.test(raw)
            ? 'Je n’ai pas pu terminer à temps. Réessayez — je suis prêt.'
            : raw.replace(/^❌\s*/, '');
        appendLocal({
          id: `agent-soft-${Date.now()}`,
          kind: 'assistant',
          content: friendly,
          created_at: new Date().toISOString(),
          label: 'Agent',
        });
      } finally {
        if (activeThreadIdRef.current === threadIdAtSend) {
          setIsSending(false);
        }
      }
    },
    [activeThreadId, appendLocal, appendOptimisticUser, refreshUser, refreshThreads],
  );

  if (!user) return null;

  if (!user.onboarding_completed) {
    return <OnboardingPage />;
  }

  if (!waConnected && gateConfirmed) {
    return <ConnectWhatsAppGate />;
  }

  if (waConnected && !user.google_contacts_prompt_done) {
    return <ConnectGoogleContactsGate />;
  }

  return (
    <>
    <div className="flex h-full max-w-[100vw] overflow-hidden bg-bg-0">
      {/* Gauche : historique des automatisations */}
      <AppSidebar
        collapsed={collapsed}
        onToggleCollapsed={toggle}
        threads={threads}
        activeThreadId={activeThreadId}
        onSelectThread={handleSelectThread}
        onNewThread={handleNewThread}
        onRenameThread={handleRenameThread}
        onDeleteThread={handleDeleteThread}
        onCampaignStatusChange={() => void refreshThreads(activeThreadId)}
        creatingThread={creatingThread}
        waConnected={waConnected}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />

      {/* Centre : chat (+ overlays) */}
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          overlayView={overlayView}
          threadTitle={activeThread?.title ?? 'Automatisation'}
          hasCampaign={Boolean(activeThread?.automation_id)}
          automationId={activeThread?.automation_id ?? null}
          campaignStatus={activeThread?.automation_status ?? null}
          outreachLevel={user?.outreach_level ?? null}
          memoryLinked={Boolean(activeThread?.campaign_memory_id)}
          memoryName={activeThread?.campaign_memory_name ?? null}
          onGoToChat={() => setOverlayView(null)}
          onOpenSettings={() => setOverlayView('settings')}
          onOpenMemory={
            activeThreadId != null ? () => setMemoryModalOpen(true) : undefined
          }
          onCampaignStatusChange={() => void refreshThreads(activeThreadId)}
          onOpenStats={
            activeThread?.automation_id ? () => setOverlayView('stats') : undefined
          }
          onOpenMobileNav={() => setMobileNavOpen(true)}
        />

        {overlayView === 'settings' && <SettingsPage />}
        {overlayView === 'stats' && activeThreadId != null && (
          <ThreadStatsPage threadId={activeThreadId} />
        )}

        {overlayView == null && (
          <ChatWorkspace
            key={activeThreadId ?? 'no-thread'}
            threadId={activeThreadId}
            threadPurpose={activeThread?.purpose ?? null}
            messages={messages}
            messagesLoading={loading || threadsLoading}
            isSending={isSending}
            onSend={handleSend}
            isFreshSession={messages.length === 0 && !loading && !threadsLoading}
            onOpenMemory={
              activeThreadId != null ? () => setMemoryModalOpen(true) : undefined
            }
            memoryLinked={Boolean(activeThread?.campaign_memory_id)}
            memoryName={activeThread?.campaign_memory_name ?? null}
          />
        )}
      </div>
    </div>

    <NewAutomationModal
      open={newAutoModalOpen}
      busy={creatingThread}
      onCancel={() => !creatingThread && setNewAutoModalOpen(false)}
      onConfirm={(title, description, purpose) =>
        void handleCreateThread(title, description, purpose)
      }
    />

    {activeThreadId != null && (
      <ThreadMemoryModal
        open={memoryModalOpen}
        threadId={activeThreadId}
        threadTitle={activeThread?.title}
        linkedMemoryId={activeThread?.campaign_memory_id ?? null}
        onClose={() => setMemoryModalOpen(false)}
        onLinked={() => refreshThreads(activeThreadId)}
      />
    )}
    </>
  );
}
