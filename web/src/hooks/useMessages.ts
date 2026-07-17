import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAgentHistory, type ChatMessage } from '@/lib/api';

function tsValue(created_at: string): number {
  return new Date(created_at.includes('T') ? created_at : created_at.replace(' ', 'T')).getTime();
}

function sortMessages(msgs: ChatMessage[]): ChatMessage[] {
  return [...msgs].sort((a, b) => {
    if (a.seq != null && b.seq != null && a.seq !== b.seq) return a.seq - b.seq;
    return tsValue(a.created_at) - tsValue(b.created_at);
  });
}

/** Horodatage local au même format que le backend (`YYYY-MM-DD HH:mm:ss`). */
function nowLocalTs(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Conversation agent isolée par fil / automatisation.
 * Changer de thread vide immédiatement l'UI puis charge l'historique du fil.
 */
export function useMessages(enabled: boolean, threadId: number | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastAgentId = useRef(0);
  const seenIds = useRef(new Set<string>());
  const seqCounter = useRef(0);
  /** Invalide les réponses async d'un ancien fil (évite de coller le chat A sur le fil B). */
  const loadGeneration = useRef(0);
  const activeThreadRef = useRef(threadId);

  const resetLocalState = useCallback(() => {
    seenIds.current.clear();
    lastAgentId.current = 0;
    seqCounter.current = 0;
    setMessages([]);
    setError(null);
  }, []);

  const loadHistory = useCallback(async () => {
    const gen = ++loadGeneration.current;
    activeThreadRef.current = threadId;

    if (threadId == null) {
      resetLocalState();
      setLoading(false);
      return;
    }

    // Vide tout de suite pour ne pas afficher le chat de l'autre automatisation
    resetLocalState();
    setLoading(true);

    try {
      const agentMsgs = await fetchAgentHistory(threadId);
      if (gen !== loadGeneration.current || activeThreadRef.current !== threadId) {
        return;
      }

      for (const m of agentMsgs) {
        seenIds.current.add(m.id);
        const num = parseInt(m.id.replace('agent-', ''), 10);
        if (!Number.isNaN(num)) lastAgentId.current = Math.max(lastAgentId.current, num);
      }

      const ordered = sortMessages(agentMsgs).map((m) => ({
        ...m,
        seq: (seqCounter.current += 1),
      }));
      setMessages(ordered);
      setError(null);
    } catch (err) {
      if (gen !== loadGeneration.current) return;
      setError(err instanceof Error ? err.message : 'Impossible de charger');
    } finally {
      if (gen === loadGeneration.current) setLoading(false);
    }
  }, [threadId, resetLocalState]);

  const appendLocal = useCallback((msg: ChatMessage) => {
    const agentMatch = msg.id.match(/^agent-(\d+)$/);
    if (agentMatch) {
      const num = parseInt(agentMatch[1], 10);
      if (!Number.isNaN(num)) lastAgentId.current = Math.max(lastAgentId.current, num);
    }
    seenIds.current.add(msg.id);
    const withSeq = { ...msg, seq: (seqCounter.current += 1) };
    setMessages((prev) =>
      prev.some((p) => p.id === msg.id) ? prev : sortMessages([...prev, withSeq]),
    );
  }, []);

  const appendOptimisticUser = useCallback((displayText: string, _apiText: string) => {
    const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    seenIds.current.add(id);
    const seq = (seqCounter.current += 1);
    setMessages((prev) =>
      sortMessages([
        ...prev,
        {
          id,
          kind: 'user',
          content: displayText,
          created_at: nowLocalTs(),
          label: 'Vous',
          seq,
        },
      ]),
    );
    return id;
  }, []);

  const clear = useCallback(() => {
    loadGeneration.current += 1;
    resetLocalState();
    setLoading(false);
  }, [resetLocalState]);

  useEffect(() => {
    if (!enabled) {
      // Fil désactivé (overlay / WhatsApp off) : ne pas coller d'anciens messages au retour
      if (threadId == null) {
        loadGeneration.current += 1;
        resetLocalState();
        setLoading(false);
      }
      return;
    }
    void loadHistory();
  }, [enabled, loadHistory, threadId, resetLocalState]);

  return {
    messages,
    loading,
    error,
    loadHistory,
    appendLocal,
    appendOptimisticUser,
    clear,
  };
}
