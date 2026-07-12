import { useCallback, useState } from 'react';
import { AppHeader } from '@/components/layout/AppHeader';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { ChatWorkspace } from '@/components/chat/ChatWorkspace';
import { useHealth } from '@/hooks/useHealth';
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
import { SettingsPage } from '@/pages/SettingsPage';
import { WhatsAppConsolePage } from '@/pages/WhatsAppConsolePage';

export default function App() {
  const [mainView, setMainView] = useState<MainView>('chat');
  const [collapsed, toggle] = useSidebarCollapsed();
  const { health, refresh: refreshHealth } = useHealth();
  const chatEnabled = mainView === 'chat';
  const { messages, loading, appendLocal, clear, loadHistory, poll } = useMessages(chatEnabled);
  const [isSending, setIsSending] = useState(false);
  const [clearing, setClearing] = useState(false);

  const handleSend = useCallback(
    async (text: string, attachments: ChatAttachment[] = []) => {
      const displayText = buildUserMessageDisplayText(text, attachments);
      const apiText = buildUserMessageApiText(text, attachments);
      if (!apiText.trim()) return;

      const optimisticId = `local-${Date.now()}`;
      appendLocal({
        id: optimisticId,
        kind: 'user',
        content: displayText,
        created_at: new Date().toISOString(),
        label: 'Vous',
      });

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
        void poll();
        void refreshHealth();
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
    [appendLocal, poll, refreshHealth],
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

  return (
    <div className="flex h-full overflow-hidden bg-bg-0">
      <AppSidebar
        collapsed={collapsed}
        onToggleCollapsed={toggle}
        mainView={mainView}
        onNavigate={setMainView}
        health={health}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          mainView={mainView}
          onGoToChat={() => setMainView('chat')}
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

        {mainView === 'console' && <WhatsAppConsolePage />}
        {mainView === 'automation' && <AutomationPage />}
        {mainView === 'settings' && (
          <SettingsPage health={health} onRefreshHealth={() => void refreshHealth()} />
        )}
      </div>
    </div>
  );
}
