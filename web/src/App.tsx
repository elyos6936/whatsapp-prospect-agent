import { useCallback, useEffect, useState } from 'react';
import { AppHeader } from '@/components/layout/AppHeader';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { ChatWorkspace } from '@/components/chat/ChatWorkspace';
import { ConnectWhatsAppGate } from '@/components/whatsapp/ConnectWhatsAppGate';
import { useAuth } from '@/lib/auth';
import { useMessages } from '@/hooks/useMessages';
import { useSidebarCollapsed } from '@/hooks/useSidebarCollapsed';
import {
  buildUserMessageApiText,
  buildUserMessageDisplayText,
  type ChatAttachment,
} from '@/lib/chat-attachments';
import { clearHistory, sendChatMessage } from '@/lib/api';
import type { MainView } from '@/lib/navigation';
import { AutomationPage } from '@/pages/AutomationPage';
import { LandingPage } from '@/pages/LandingPage';
import { LoginPage } from '@/pages/LoginPage';
import { OnboardingPage } from '@/pages/OnboardingPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { SettingsPage } from '@/pages/SettingsPage';

type AuthScreen = 'landing' | 'login' | 'register';

export default function App() {
  const { user, loading: authLoading, refreshUser } = useAuth();
  const [authScreen, setAuthScreen] = useState<AuthScreen>('landing');
  const [mainView, setMainView] = useState<MainView>('chat');
  const [collapsed, toggle] = useSidebarCollapsed();
  const chatEnabled = mainView === 'chat' && !!user?.whatsapp?.connected;
  const { messages, loading, appendLocal, appendOptimisticUser, clear, loadHistory } =
    useMessages(chatEnabled);
  const [isSending, setIsSending] = useState(false);
  const [clearing, setClearing] = useState(false);

  const waConnected = user?.whatsapp?.connected ?? false;

  // Rafraîchir le statut WhatsApp toutes les 5s quand connecté à l'app
  useEffect(() => {
    if (!user) return;
    const id = setInterval(() => void refreshUser(), 5000);
    return () => clearInterval(id);
  }, [user, refreshUser]);

  const handleNavigate = useCallback(
    (view: MainView) => {
      if (!waConnected && view !== 'settings') return;
      setMainView(view);
    },
    [waConnected],
  );

  const handleSend = useCallback(
    async (text: string, attachments: ChatAttachment[] = []) => {
      const displayText = buildUserMessageDisplayText(text, attachments);
      const apiText = buildUserMessageApiText(text, attachments);
      if (!apiText.trim()) return;

      appendOptimisticUser(displayText, apiText);

      setIsSending(true);
      try {
        const result = await sendChatMessage(apiText);
        appendLocal({
          id: `agent-${result.id}`,
          kind: result.error ? 'error' : 'assistant',
          content: result.reply,
          created_at: result.created_at,
          label: 'Agent',
        });
        void refreshUser();
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
    [appendLocal, appendOptimisticUser, refreshUser],
  );

  const handleClearHistory = useCallback(async () => {
    if (!confirm("Effacer l'historique de conversation agent ?")) return;
    setClearing(true);
    try {
      await clearHistory();
      clear();
      await loadHistory();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setClearing(false);
    }
  }, [clear, loadHistory]);

  if (authLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-bg-0 text-sm text-text-500">
        Chargement…
      </div>
    );
  }

  if (!user) {
    if (authScreen === 'landing') {
      return (
        <LandingPage
          onLogin={() => setAuthScreen('login')}
          onRegister={() => setAuthScreen('register')}
        />
      );
    }
    return authScreen === 'login' ? (
      <LoginPage
        onGoRegister={() => setAuthScreen('register')}
        onGoBack={() => setAuthScreen('landing')}
      />
    ) : (
      <RegisterPage
        onGoLogin={() => setAuthScreen('login')}
        onGoBack={() => setAuthScreen('landing')}
      />
    );
  }

  if (!user.onboarding_completed) {
    return <OnboardingPage />;
  }

  if (!waConnected) {
    return <ConnectWhatsAppGate />;
  }

  return (
    <div className="flex h-full overflow-hidden bg-bg-0">
      <AppSidebar
        collapsed={collapsed}
        onToggleCollapsed={toggle}
        mainView={mainView}
        onNavigate={handleNavigate}
        waConnected={waConnected}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          mainView={mainView}
          onGoToChat={() => handleNavigate('chat')}
          onClearHistory={mainView === 'chat' ? handleClearHistory : undefined}
          clearing={clearing}
        />

        {mainView === 'chat' && (
          <ChatWorkspace
            messages={messages}
            messagesLoading={loading}
            isSending={isSending}
            onSend={handleSend}
            isFreshSession={messages.length === 0 && !loading}
          />
        )}

        {mainView === 'automation' && <AutomationPage />}
        {mainView === 'settings' && <SettingsPage />}
      </div>
    </div>
  );
}
