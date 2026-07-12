import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchAgentHistory,
  fetchAgentMessagesSince,
  fetchWhatsAppMessagesSince,
  type ChatMessage,
} from '@/lib/api';

function sortMessages(msgs: ChatMessage[]): ChatMessage[] {
  return [...msgs].sort((a, b) => {
    const ta = new Date(a.created_at.includes('T') ? a.created_at : a.created_at.replace(' ', 'T')).getTime();
    const tb = new Date(b.created_at.includes('T') ? b.created_at : b.created_at.replace(' ', 'T')).getTime();
    return ta - tb;
  });
}

export function useMessages(enabled: boolean) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastAgentId = useRef(0);
  const lastWaId = useRef(0);
  const seenIds = useRef(new Set<string>());

  const mergeNew = useCallback((incoming: ChatMessage[]) => {
    if (!incoming.length) return;
    setMessages((prev) => {
      const next = [...prev];
      for (const m of incoming) {
        if (seenIds.current.has(m.id)) continue;
        seenIds.current.add(m.id);
        next.push(m);
      }
      return sortMessages(next);
    });
  }, []);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const agentMsgs = await fetchAgentHistory();
      seenIds.current.clear();
      lastAgentId.current = 0;
      lastWaId.current = 0;

      for (const m of agentMsgs) {
        seenIds.current.add(m.id);
        const num = parseInt(m.id.replace('agent-', ''), 10);
        if (!Number.isNaN(num)) lastAgentId.current = Math.max(lastAgentId.current, num);
      }

      const waData = await fetchWhatsAppMessagesSince(0);
      for (const m of waData) {
        seenIds.current.add(m.id);
        const num = parseInt(m.id.replace('wa-', ''), 10);
        if (!Number.isNaN(num)) lastWaId.current = Math.max(lastWaId.current, num);
      }

      setMessages(sortMessages([...agentMsgs, ...waData]));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger');
    } finally {
      setLoading(false);
    }
  }, []);

  const poll = useCallback(async () => {
    if (!enabled) return;
    try {
      const [agentNew, waNew] = await Promise.all([
        fetchAgentMessagesSince(lastAgentId.current),
        fetchWhatsAppMessagesSince(lastWaId.current),
      ]);

      for (const m of agentNew) {
        const num = parseInt(m.id.replace('agent-', ''), 10);
        if (!Number.isNaN(num)) lastAgentId.current = Math.max(lastAgentId.current, num);
      }
      for (const m of waNew) {
        const num = parseInt(m.id.replace('wa-', ''), 10);
        if (!Number.isNaN(num)) lastWaId.current = Math.max(lastWaId.current, num);
      }

      mergeNew([...agentNew, ...waNew]);
    } catch {
      /* ignore poll errors */
    }
  }, [enabled, mergeNew]);

  const appendLocal = useCallback((msg: ChatMessage) => {
    seenIds.current.add(msg.id);
    setMessages((prev) => sortMessages([...prev, msg]));
  }, []);

  const clear = useCallback(() => {
    seenIds.current.clear();
    lastAgentId.current = 0;
    lastWaId.current = 0;
    setMessages([]);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void loadHistory();
  }, [enabled, loadHistory]);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => void poll(), 3000);
    return () => clearInterval(id);
  }, [enabled, poll]);

  return { messages, loading, error, loadHistory, appendLocal, clear, poll };
}
