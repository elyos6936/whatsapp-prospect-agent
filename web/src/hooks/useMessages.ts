import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchAgentHistory,
  fetchWhatsAppMessagesSince,
  type ChatMessage,
} from '@/lib/api';

function tsValue(created_at: string): number {
  return new Date(created_at.includes('T') ? created_at : created_at.replace(' ', 'T')).getTime();
}

function sortMessages(msgs: ChatMessage[]): ChatMessage[] {
  return [...msgs].sort((a, b) => {
    // `seq` (ordre d'arrivée client) est la clé de tri fiable : les horodatages
    // serveur (locaux, sans fuseau) et optimistes ne sont pas comparables directement.
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

export function useMessages(enabled: boolean) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastAgentId = useRef(0);
  const lastWaId = useRef(0);
  const seenIds = useRef(new Set<string>());
  const pendingUser = useRef<string[]>([]);
  const seqCounter = useRef(0);

  const mergeNew = useCallback((incoming: ChatMessage[]) => {
    if (!incoming.length) return;
    // Réconciliation faite hors de l'updater setState (pas de mutation de ref dans un updater).
    const toAdd: ChatMessage[] = [];
    for (const m of incoming) {
      if (seenIds.current.has(m.id)) continue;
      if (m.kind === 'user') {
        const idx = pendingUser.current.indexOf(m.content.trim());
        if (idx !== -1) {
          // Le message optimiste local représente déjà celui-ci : on le fusionne.
          pendingUser.current.splice(idx, 1);
          seenIds.current.add(m.id);
          continue;
        }
      }
      seenIds.current.add(m.id);
      toAdd.push(m);
    }
    if (!toAdd.length) return;
    // Séquence attribuée à l'arrivée : ces messages viennent après ceux déjà affichés.
    const withSeq = toAdd.map((m) => ({ ...m, seq: (seqCounter.current += 1) }));
    setMessages((prev) => {
      const existing = new Set(prev.map((p) => p.id));
      const merged = [...prev];
      for (const m of withSeq) {
        if (!existing.has(m.id)) merged.push(m);
      }
      return sortMessages(merged);
    });
  }, []);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const agentMsgs = await fetchAgentHistory();
      seenIds.current.clear();
      pendingUser.current = [];
      lastAgentId.current = 0;
      lastWaId.current = 0;
      seqCounter.current = 0;

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

      // Tri chronologique initial (horodatages serveur homogènes), puis attribution
      // d'une séquence croissante qui deviendra la clé de tri stable.
      const ordered = sortMessages([...agentMsgs, ...waData]).map((m) => ({
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
  }, []);

  const poll = useCallback(async () => {
    if (!enabled) return;
    try {
      // La conversation agent n'est écrite QUE par notre propre POST /api/chat :
      // message optimiste + réponse du POST = état complet, aucun besoin de la
      // repoller (c'était l'unique source des doublons). On ne poll que WhatsApp,
      // qui provient de sources externes (webhooks / poller).
      const waNew = await fetchWhatsAppMessagesSince(lastWaId.current);
      for (const m of waNew) {
        const num = parseInt(m.id.replace('wa-', ''), 10);
        if (!Number.isNaN(num)) lastWaId.current = Math.max(lastWaId.current, num);
      }
      mergeNew(waNew);
    } catch {
      /* ignore poll errors */
    }
  }, [enabled, mergeNew]);

  const appendLocal = useCallback((msg: ChatMessage) => {
    const agentMatch = msg.id.match(/^agent-(\d+)$/);
    if (agentMatch) {
      const num = parseInt(agentMatch[1], 10);
      if (!Number.isNaN(num)) lastAgentId.current = Math.max(lastAgentId.current, num);
    }
    const waMatch = msg.id.match(/^wa-(\d+)$/);
    if (waMatch) {
      const num = parseInt(waMatch[1], 10);
      if (!Number.isNaN(num)) lastWaId.current = Math.max(lastWaId.current, num);
    }
    seenIds.current.add(msg.id);
    const withSeq = { ...msg, seq: (seqCounter.current += 1) };
    // Déduplication sur le tableau réel (robuste quel que soit l'ordre poll / append).
    setMessages((prev) =>
      prev.some((p) => p.id === msg.id) ? prev : sortMessages([...prev, withSeq]),
    );
  }, []);

  const appendOptimisticUser = useCallback((displayText: string, apiText: string) => {
    const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    seenIds.current.add(id);
    pendingUser.current.push(apiText.trim());
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
    pendingUser.current = [];
    lastAgentId.current = 0;
    lastWaId.current = 0;
    seqCounter.current = 0;
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

  return {
    messages,
    loading,
    error,
    loadHistory,
    appendLocal,
    appendOptimisticUser,
    clear,
    poll,
  };
}
