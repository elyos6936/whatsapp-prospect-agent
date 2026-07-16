import { useCallback, useEffect, useState } from 'react';
import { AppHeader } from '@/components/layout/AppHeader';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { ChatWorkspace } from '@/components/chat/ChatWorkspace';
import { PlanPanel } from '@/components/chat/PlanPanel';
import { ThreadStatsPage } from '@/components/chat/ThreadStatsPage';
import { ConnectWhatsAppGate } from '@/components/whatsapp/ConnectWhatsAppGate';
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
  fetchThreads,
  sendChatMessage,
  type AgentThreadSummary,
} from '@/lib/api';
import type { AutomationVisualPlan } from '@/lib/automation-plan';
import type { OverlayView } from '@/lib/navigation';
import { AutomationPage } from '@/pages/AutomationPage';
import { OnboardingPage } from '@/pages/OnboardingPage';
import { SettingsPage } from '@/pages/SettingsPage';

export default function AuthenticatedApp() {
  const { user, refreshUser } = useAuth();
  const [overlayView, setOverlayView] = useState<OverlayView>(null);
  const [collapsed, toggle] = useSidebarCollapsed();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [threads, setThreads] = useState<AgentThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [creatingThread, setCreatingThread] = useState(false);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [openPlan, setOpenPlan] = useState<AutomationVisualPlan | null>(null);

  const chatEnabled = overlayView == null && !!user?.whatsapp?.connected && activeThreadId != null;
  const { messages, loading, appendLocal, appendOptimisticUser, clear } =
    useMessages(chatEnabled, activeThreadId);
  const [isSending, setIsSending] = useState(false);

  const waConnected = user?.whatsapp?.connected ?? false;
  const [gateConfirmed, setGateConfirmed] = useState(false);
  const neverConnected = user?.whatsapp?.state === 'not_configured';

  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null;

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

  const handleNewThread = useCallback(async () => {
    setCreatingThread(true);
    try {
      const thread = await createThread();
      await refreshThreads(thread.id);
      setOverlayView(null);
      setOpenPlan(null);
      clear();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setCreatingThread(false);
    }
  }, [clear, refreshThreads]);

  const handleSelectThread = useCallback((id: number) => {
    setActiveThreadId(id);
    setOverlayView(null);
    setOpenPlan(null);
  }, []);

  const handleSend = useCallback(
    async (text: string, attachments: ChatAttachment[] = []) => {
      if (activeThreadId == null) return;
      const displayText = buildUserMessageDisplayText(text, attachments);
      const apiText = buildUserMessageApiText(text, attachments);
      if (!apiText.trim()) return;

      appendOptimisticUser(displayText, apiText);

      setIsSending(true);
      try {
        const result = await sendChatMessage(apiText, activeThreadId);
        appendLocal({
          id: `agent-${result.id}`,
          kind: result.error ? 'error' : 'assistant',
          content: result.reply,
          created_at: result.created_at,
          label: 'Agent',
        });
        void refreshUser();
        void refreshThreads(activeThreadId);
      } catch (err) {
        appendLocal({
          id: `err-${Date.now()}`,
          kind: 'error',
          content: `❌ ${err instanceof Error ? err.message : 'Erreur réseau'}`,
          created_at: new Date().toISOString(),
          label: 'Erreur',
        });
      } finally {
        setIsSending(false);
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

  return (
    <div className="flex h-full max-w-[100vw] overflow-hidden bg-bg-0">
      <AppSidebar
        collapsed={collapsed}
        onToggleCollapsed={toggle}
        threads={threads}
        activeThreadId={activeThreadId}
        onSelectThread={handleSelectThread}
        onNewThread={() => void handleNewThread()}
        creatingThread={creatingThread}
        waConnected={waConnected}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          overlayView={overlayView}
          threadTitle={activeThread?.title ?? 'Automatisation'}
          hasCampaign={Boolean(activeThread?.automation_id)}
          onGoToChat={() => setOverlayView(null)}
          onOpenSettings={() => setOverlayView('settings')}
          onOpenAutomation={() => setOverlayView('automation')}
          onOpenStats={
            activeThread?.automation_id ? () => setOverlayView('stats') : undefined
          }
          onOpenMobileNav={() => setMobileNavOpen(true)}
        />

        {overlayView === 'settings' && <SettingsPage />}
        {overlayView === 'automation' && <AutomationPage threadId={activeThreadId} />}
        {overlayView === 'stats' && activeThreadId != null && (
          <ThreadStatsPage threadId={activeThreadId} />
        )}

        {overlayView == null && (
          <ChatWorkspace
            messages={messages}
            messagesLoading={loading || threadsLoading}
            isSending={isSending}
            onSend={handleSend}
            isFreshSession={messages.length === 0 && !loading && !threadsLoading}
            onOpenPlan={setOpenPlan}
          />
        )}
      </div>

      {openPlan && <PlanPanel plan={openPlan} onClose={() => setOpenPlan(null)} />}
    </div>
  );
}
