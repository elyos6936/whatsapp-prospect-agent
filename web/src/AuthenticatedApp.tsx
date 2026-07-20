import { useCallback, useEffect, useRef, useState } from 'react';
import { AppHeader } from '@/components/layout/AppHeader';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { ChatWorkspace } from '@/components/chat/ChatWorkspace';
import { StrategyDock } from '@/components/chat/PlanPanel';
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
  fetchThreadCampaign,
  fetchThreads,
  renameThread,
  sendChatMessage,
  type AgentThreadSummary,
} from '@/lib/api';
import { extractPlanFromText, type AutomationVisualPlan } from '@/lib/automation-plan';
import type { OverlayView } from '@/lib/navigation';
import { OnboardingPage } from '@/pages/OnboardingPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { NewAutomationModal } from '@/components/ui/NewAutomationModal';

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
  const activeThreadIdRef = useRef<number | null>(null);
  activeThreadIdRef.current = activeThreadId;
  const [creatingThread, setCreatingThread] = useState(false);
  const [newAutoModalOpen, setNewAutoModalOpen] = useState(false);
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
          setStrategyPlan({
            ...plan,
            automationId: plan.automationId ?? data.detail.automation.id,
          });
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

  const handleNewThread = useCallback(() => {
    setNewAutoModalOpen(true);
  }, []);

  const handleCreateThread = useCallback(
    async (title: string, description: string) => {
      setCreatingThread(true);
      try {
        const thread = await createThread(title, description);
        setNewAutoModalOpen(false);
        await refreshThreads(thread.id);
        setOverlayView(null);
        setStrategyPlan(null);
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
      setActiveThreadId(id);
      setOverlayView(null);
      setStrategyPlan(null);
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
        const { plan } = extractPlanFromText(result.reply);
        if (plan?.nodes?.length) {
          openStrategy(plan);
        }
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
    [activeThreadId, appendLocal, appendOptimisticUser, openStrategy, refreshUser, refreshThreads],
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
          hasStrategy={Boolean(strategyPlan?.nodes?.length)}
          strategyOpen={showStrategyDock}
          onGoToChat={() => setOverlayView(null)}
          onOpenSettings={() => setOverlayView('settings')}
          onCampaignStatusChange={() => void refreshThreads(activeThreadId)}
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
        {overlayView === 'stats' && activeThreadId != null && (
          <ThreadStatsPage threadId={activeThreadId} />
        )}

        {overlayView == null && (
          <ChatWorkspace
            key={activeThreadId ?? 'no-thread'}
            threadId={activeThreadId}
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
            <StrategyDock
              plan={strategyPlan}
              onClose={toggleStrategy}
              onLaunched={(message) => {
                appendLocal({
                  id: `sim-launch-${Date.now()}`,
                  kind: 'assistant',
                  content: `✅ ${message}`,
                  created_at: new Date().toISOString(),
                  label: 'Agent',
                });
                void refreshThreads(activeThreadId);
              }}
            />
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
              <StrategyDock
                plan={strategyPlan}
                onClose={toggleStrategy}
                onLaunched={(message) => {
                  appendLocal({
                    id: `sim-launch-${Date.now()}`,
                    kind: 'assistant',
                    content: `✅ ${message}`,
                    created_at: new Date().toISOString(),
                    label: 'Agent',
                  });
                  void refreshThreads(activeThreadId);
                }}
              />
            </div>
          </div>
        </>
      )}
    </div>

    <NewAutomationModal
      open={newAutoModalOpen}
      busy={creatingThread}
      onCancel={() => !creatingThread && setNewAutoModalOpen(false)}
      onConfirm={(title, description) => void handleCreateThread(title, description)}
    />
    </>
  );
}
