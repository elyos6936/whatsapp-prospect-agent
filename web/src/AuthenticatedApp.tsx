import { useCallback, useEffect, useState } from 'react';
import { AppHeader } from '@/components/layout/AppHeader';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { ChatWorkspace } from '@/components/chat/ChatWorkspace';
import { StrategyDock } from '@/components/chat/PlanPanel';
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
  deleteThread,
  fetchThreadCampaign,
  fetchThreads,
  renameThread,
  sendChatMessage,
  type AgentThreadSummary,
} from '@/lib/api';
import { extractPlanFromText, type AutomationVisualPlan } from '@/lib/automation-plan';
import type { OverlayView } from '@/lib/navigation';
import { AutomationPage } from '@/pages/AutomationPage';
import { OnboardingPage } from '@/pages/OnboardingPage';
import { SettingsPage } from '@/pages/SettingsPage';

const STRATEGY_OPEN_KEY = 'klanvio.strategyDockOpen';

function readStrategyOpenPref(): boolean {
  try {
    const v = localStorage.getItem(STRATEGY_OPEN_KEY);
    if (v === null) return true;
    return v === '1';
  } catch {
    return true;
  }
}

export default function AuthenticatedApp() {
  const { user, refreshUser } = useAuth();
  const [overlayView, setOverlayView] = useState<OverlayView>(null);
  const [collapsed, toggle] = useSidebarCollapsed();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [threads, setThreads] = useState<AgentThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [creatingThread, setCreatingThread] = useState(false);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [strategyPlan, setStrategyPlan] = useState<AutomationVisualPlan | null>(null);
  const [strategyOpen, setStrategyOpen] = useState(readStrategyOpenPref);

  const chatEnabled = overlayView == null && !!user?.whatsapp?.connected && activeThreadId != null;
  const { messages, loading, appendLocal, appendOptimisticUser, clear } =
    useMessages(chatEnabled, activeThreadId);
  const [isSending, setIsSending] = useState(false);

  const waConnected = user?.whatsapp?.connected ?? false;
  const [gateConfirmed, setGateConfirmed] = useState(false);
  const neverConnected = user?.whatsapp?.state === 'not_configured';

  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null;
  const showStrategyDock =
    overlayView == null && strategyOpen && strategyPlan != null && strategyPlan.nodes?.length > 0;

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

  const toggleStrategy = useCallback(() => {
    setStrategyOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STRATEGY_OPEN_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const openStrategy = useCallback((plan: AutomationVisualPlan) => {
    setStrategyPlan(plan);
    setStrategyOpen(true);
    try {
      localStorage.setItem(STRATEGY_OPEN_KEY, '1');
    } catch {
      /* ignore */
    }
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

  // Charger le plan depuis la campagne liée au fil
  useEffect(() => {
    if (activeThreadId == null) {
      setStrategyPlan(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        if (!activeThread?.automation_id) {
          if (!cancelled) setStrategyPlan(null);
          return;
        }
        const data = await fetchThreadCampaign(activeThreadId);
        const plan = (data.detail.automation.config as { visualPlan?: AutomationVisualPlan } | undefined)
          ?.visualPlan;
        if (!cancelled && plan?.nodes?.length) {
          setStrategyPlan(plan);
        }
      } catch {
        /* pas encore de campagne */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeThreadId, activeThread?.automation_id]);

  // Dès qu’un plan apparaît dans le chat → panneau droit
  useEffect(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.kind !== 'assistant') continue;
      const { plan } = extractPlanFromText(m.content);
      if (plan?.nodes?.length) {
        setStrategyPlan(plan);
        break;
      }
    }
  }, [messages]);

  const handleNewThread = useCallback(async () => {
    setCreatingThread(true);
    try {
      const thread = await createThread();
      await refreshThreads(thread.id);
      setOverlayView(null);
      setStrategyPlan(null);
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
    setStrategyPlan(null);
  }, []);

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
        setStrategyPlan(null);
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
        const { plan } = extractPlanFromText(result.reply);
        if (plan?.nodes?.length) {
          openStrategy(plan);
        }
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
    [activeThreadId, appendLocal, appendOptimisticUser, openStrategy, refreshUser, refreshThreads],
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
      {/* Gauche : historique des automatisations */}
      <AppSidebar
        collapsed={collapsed}
        onToggleCollapsed={toggle}
        threads={threads}
        activeThreadId={activeThreadId}
        onSelectThread={handleSelectThread}
        onNewThread={() => void handleNewThread()}
        onRenameThread={handleRenameThread}
        onDeleteThread={handleDeleteThread}
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
          hasStrategy={Boolean(strategyPlan?.nodes?.length)}
          strategyOpen={showStrategyDock}
          onGoToChat={() => setOverlayView(null)}
          onOpenSettings={() => setOverlayView('settings')}
          onOpenAutomation={() => setOverlayView('automation')}
          onOpenStats={
            activeThread?.automation_id ? () => setOverlayView('stats') : undefined
          }
          onToggleStrategy={
            strategyPlan?.nodes?.length
              ? () => {
                  if (strategyOpen) {
                    toggleStrategy();
                  } else {
                    openStrategy(strategyPlan);
                  }
                }
              : undefined
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
            onOpenPlan={openStrategy}
          />
        )}
      </div>

      {/* Droite : simulation conversation (masquable) */}
      {showStrategyDock && strategyPlan && (
        <>
          {/* Desktop : colonne fixe à droite */}
          <div className="sticky top-0 hidden h-full max-h-full w-[min(38vw,380px)] shrink-0 self-stretch lg:flex">
            <StrategyDock plan={strategyPlan} onClose={toggleStrategy} />
          </div>
          {/* Mobile / tablette : tiroir plein hauteur */}
          <div className="fixed inset-0 z-40 flex justify-end lg:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-black/35"
              aria-label="Fermer la simulation"
              onClick={toggleStrategy}
            />
            <div className="relative z-10 flex h-full w-[min(92vw,380px)] shadow-2xl">
              <StrategyDock plan={strategyPlan} onClose={toggleStrategy} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
