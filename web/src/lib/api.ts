import { API_BASE_URL } from './config';
import type { ChatAttachment } from './chat-attachments';
import { emitAuthLogout, getStoredToken } from './auth-storage';

export type MessageKind = 'user' | 'assistant' | 'whatsapp-in' | 'whatsapp-out' | 'error';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  onboarding_completed: boolean;
  business: { ownerName: string; offer: string; price: string };
  whatsapp?: { connected: boolean; state: string; message: string };
}

export interface MeResponse extends AuthUser {
  whatsapp: { connected: boolean; state: string; message: string };
}

export interface ChatMessage {
  id: string;
  kind: MessageKind;
  content: string;
  created_at: string;
  label?: string;
  /** Ordre d'arrivée côté client. Sert de clé de tri fiable (indépendante du fuseau). */
  seq?: number;
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
  const token = getStoredToken();
  // N'ajouter Content-Type: application/json que s'il y a réellement un corps.
  // Sinon Fastify essaie de parser un body JSON vide (ex. DELETE) et renvoie
  // un 400 « Bad Request ».
  const hasBody = init?.body != null;
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  // Un 401 sur login/register = mauvais identifiants, PAS une session expirée :
  // on laisse remonter le message réel du serveur (ex. « Email ou mot de passe incorrect. »).
  const isAuthEndpoint = path.startsWith('/api/auth/');

  if (res.status === 401 && !isAuthEndpoint) {
    emitAuthLogout();
    throw new ApiError('Session expirée. Reconnectez-vous.', 401);
  }

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

export async function fetchEvolutionState(): Promise<{
  connected: boolean;
  state: string;
  message: string;
}> {
  return request('/api/evolution/instance/state');
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

// --- Constructeur d'automatisation (page Automatisation → Manuel) ---
export interface BuilderMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export async function fetchBuilderHistory(): Promise<BuilderMessage[]> {
  const data = await request<{ messages: BuilderMessage[] }>('/api/automations/builder/history');
  return data.messages ?? [];
}

export async function sendBuilderMessage(message: string): Promise<{
  id: number;
  reply: string;
  created_at: string;
  error?: boolean;
}> {
  return request('/api/automations/builder/chat', {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

export async function clearBuilderHistory(): Promise<void> {
  await request('/api/automations/builder/history', { method: 'DELETE' });
}

// --- Envois programmés (sous-section « Automatique ») ---
export interface ScheduledMessageItem {
  id: number;
  recipient: string;
  recipient_label: string | null;
  message: string;
  send_at: string;
  status: string;
  error: string | null;
  created_at: string;
  sent_at: string | null;
}

export async function fetchScheduledMessages(): Promise<ScheduledMessageItem[]> {
  const data = await request<{ messages: ScheduledMessageItem[] }>('/api/scheduled');
  return data.messages ?? [];
}

export async function cancelScheduledMessage(id: number): Promise<void> {
  await request(`/api/scheduled/${id}`, { method: 'DELETE' });
}

// --- Stats d'une automatisation ---
export interface AutomationStats {
  automation: {
    id: number;
    name: string;
    type: string;
    status: string;
    mode: string | null;
    origin: string;
  };
  stats: {
    targetsTotal: number;
    contacted: number;
    pending: number;
    replied: number;
    interested: number;
    stopped: number;
    messagesSent: number;
    messagesHandled: number;
    responseRatePercent: number | null;
    conversions: number;
    lastActionAt: string | null;
    report: string | null;
  };
  today: { date: string; incoming: number; outgoing: number } | null;
}

export async function fetchAutomationStats(id: number): Promise<AutomationStats> {
  return request<AutomationStats>(`/api/automations/${id}/stats`);
}

export async function registerUser(input: {
  email: string;
  password: string;
  name: string;
}): Promise<{ token: string; user: AuthUser }> {
  return request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function loginUser(input: {
  email: string;
  password: string;
}): Promise<{ token: string; user: AuthUser }> {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function fetchMe(): Promise<MeResponse> {
  return request<MeResponse>('/api/me');
}

export async function saveOnboarding(input: {
  answers: Record<string, unknown>;
  business_owner_name?: string;
  business_offer?: string;
  business_price?: string;
}): Promise<{ ok: boolean; user: AuthUser }> {
  return request('/api/onboarding', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export { ApiError };
