import { API_BASE_URL } from './config';
import type { ChatAttachment } from './chat-attachments';

export type MessageKind = 'user' | 'assistant' | 'whatsapp-in' | 'whatsapp-out' | 'error';

export interface ChatMessage {
  id: string;
  kind: MessageKind;
  content: string;
  created_at: string;
  label?: string;
}

export interface HealthStatus {
  ok: boolean;
  openai: { configured: boolean };
  whatsapp: { connected: boolean; state: string; message: string };
  autoReply: boolean;
  outbound: { today: number; limit: number; bonus: number };
}

export interface AppSettings {
  openai: { configured: boolean; maskedKey: string };
  evolution: {
    configured: boolean;
    instanceName: string;
    maskedKey: string;
    baseUrl: string;
  };
  business: { ownerName: string; offer: string; price: string };
  autoReply: boolean;
}

class ApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function fetchHealth(): Promise<HealthStatus> {
  return request<HealthStatus>('/api/health');
}

export async function fetchSettings(): Promise<AppSettings> {
  return request<AppSettings>('/api/settings');
}

export async function fetchAgentHistory(): Promise<ChatMessage[]> {
  const data = await request<{ messages: Array<{ id: number; role: string; content: string; created_at: string }> }>(
    '/api/history',
  );
  return (data.messages ?? []).map((m) => ({
    id: `agent-${m.id}`,
    kind: m.role === 'user' ? 'user' : m.content.startsWith('❌') ? 'error' : 'assistant',
    content: m.content,
    created_at: m.created_at,
    label: m.role === 'user' ? 'Vous' : 'Agent',
  }));
}

export async function fetchAgentMessagesSince(since: number): Promise<ChatMessage[]> {
  const data = await request<{ messages: Array<{ id: number; role: string; content: string; created_at: string }> }>(
    `/api/history/since?since=${since}`,
  );
  return (data.messages ?? []).map((m) => ({
    id: `agent-${m.id}`,
    kind: m.role === 'user' ? 'user' : m.content.startsWith('❌') ? 'error' : 'assistant',
    content: m.content,
    created_at: m.created_at,
    label: m.role === 'user' ? 'Vous' : 'Agent',
  }));
}

export async function fetchWhatsAppMessagesSince(since: number): Promise<ChatMessage[]> {
  const data = await request<{
    messages: Array<{
      id: number;
      direction: string;
      body: string;
      sender_name: string | null;
      contact_phone: string;
      created_at: string;
    }>;
  }>(`/api/whatsapp?since=${since}`);

  return (data.messages ?? []).map((m) => {
    const isOut = m.direction === 'sortant';
    return {
      id: `wa-${m.id}`,
      kind: isOut ? 'whatsapp-out' : 'whatsapp-in',
      content: m.body,
      created_at: m.created_at,
      label: isOut
        ? 'WhatsApp · Envoyé'
        : `WhatsApp · ${m.sender_name || m.contact_phone}`,
    };
  });
}

export async function sendChatMessage(message: string): Promise<{
  id: number;
  reply: string;
  created_at: string;
  error?: boolean;
}> {
  return request('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

export async function clearHistory(): Promise<void> {
  await request('/api/history', { method: 'DELETE' });
}

export async function uploadChatFiles(files: File[]): Promise<ChatAttachment[]> {
  const results: ChatAttachment[] = [];

  for (const file of files) {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1] ?? '');
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

    const data = await request<{ url: string }>('/api/upload', {
      method: 'POST',
      body: JSON.stringify({ name: file.name, type: file.type, data: base64 }),
    });

    results.push({
      id: crypto.randomUUID(),
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      url: data.url,
    });
  }

  return results;
}

export async function saveOpenAiKey(apiKey: string): Promise<{ message: string }> {
  return request('/api/settings/openai', {
    method: 'POST',
    body: JSON.stringify({ apiKey }),
  });
}

export async function saveEvolutionSettings(body: {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
  webhookUrl?: string;
}): Promise<{ message: string; connected?: boolean }> {
  return request('/api/settings/evolution', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function testEvolution(): Promise<{ connected: boolean; message: string }> {
  return request('/api/settings/evolution/test', { method: 'POST' });
}

export async function saveBusinessProfile(body: {
  ownerName: string;
  offer: string;
  price: string;
}): Promise<{ message: string }> {
  return request('/api/settings/business', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function setAutoReply(enabled: boolean): Promise<void> {
  await request('/api/settings/auto-reply', {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  });
}

export async function resetOutboundQuota(): Promise<{ message: string; outbound: HealthStatus['outbound'] }> {
  return request('/api/settings/outbound-quota', {
    method: 'POST',
    body: JSON.stringify({ action: 'reset', extra: 20 }),
  });
}

export async function fetchEvolutionQr(): Promise<{
  connected: boolean;
  message: string;
  base64?: string;
  pairingCode?: string;
}> {
  return request('/api/evolution/instance/qr');
}

export async function rebootEvolutionInstance(): Promise<{ message: string }> {
  return request('/api/evolution/instance/restart', { method: 'POST' });
}

export async function evolutionApi<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>(path, init);
}

export interface AutomationSummary {
  id: number;
  name: string;
  type: string;
  status: string;
  summary?: string;
  created_at?: string;
  budget_fcfa?: number;
  stats?: Record<string, number | string>;
  config?: Record<string, unknown>;
}

export interface AutomationDetail {
  automation: AutomationSummary;
  targets?: Array<{ target_id: string; target_label?: string; status: string }>;
  logs?: Array<{ level: string; message: string; created_at: string }>;
}

export interface RoiDashboard {
  totals?: Record<string, number>;
  automations?: Array<{
    name: string;
    roiPercent?: number | null;
    costPerReply?: number | null;
  }>;
  abSummary?: unknown[];
}

export interface HandoffItem {
  id: number;
  contact_name?: string;
  contact_phone: string;
  reason: string;
  summary?: string;
  suggested_reply?: string;
}

export async function fetchAutomations(): Promise<AutomationSummary[]> {
  const data = await request<{ automations: AutomationSummary[] }>('/api/automations');
  return data.automations ?? [];
}

export async function fetchAutomationDetail(id: number): Promise<AutomationDetail> {
  return request<AutomationDetail>(`/api/automations/${id}`);
}

export async function updateAutomationStatus(
  id: number,
  status: string,
): Promise<{ automation: AutomationSummary }> {
  return request(`/api/automations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function reloadAutomationMembers(
  id: number,
): Promise<{ targetsAdded: number }> {
  return request(`/api/automations/${id}/reload-members`, { method: 'POST' });
}

export async function fetchRoiDashboard(): Promise<RoiDashboard> {
  return request<RoiDashboard>('/api/roi/dashboard');
}

export async function fetchHandoffs(): Promise<HandoffItem[]> {
  const data = await request<{ handoffs: HandoffItem[] }>('/api/handoffs');
  return data.handoffs ?? [];
}

export async function resolveHandoff(
  id: number,
  status: 'resolved' | 'dismissed',
): Promise<void> {
  await request(`/api/handoffs/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export { ApiError };
