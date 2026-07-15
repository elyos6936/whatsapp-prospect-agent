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
 * Gère UNIQUEMENT la conversation avec l'Agent pour un fil donné.
 */
export function useMessages(enabled: boolean, threadId: number | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastAgentId = useRef(0);
  const seenIds = useRef(new Set<string>());
  const seqCounter = useRef(0);

  const loadHistory = useCallback(async () => {
    if (threadId == null) {
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const agentMsgs = await fetchAgentHistory(threadId);
      seenIds.current.clear();
      lastAgentId.current = 0;
      seqCounter.current = 0;

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
      setError(err instanceof Error ? err.message : 'Impossible de charger');
    } finally {
      setLoading(false);
    }
  }, [threadId]);

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
    seenIds.current.clear();
    lastAgentId.current = 0;
    seqCounter.current = 0;
    setMessages([]);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void loadHistory();
  }, [enabled, loadHistory]);

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
