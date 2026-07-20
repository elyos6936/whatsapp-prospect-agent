import { API_BASE_URL } from './config';
import type { ChatAttachment } from './chat-attachments';
import { emitAuthLogout, getStoredToken } from './auth-storage';

export type MessageKind = 'user' | 'assistant' | 'whatsapp-in' | 'whatsapp-out' | 'error';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  avatarUrl?: string;
  onboarding_completed: boolean;
  google_contacts_prompt_done?: boolean;
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
  const hasBody = init?.body != null;
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(raw)) {
      throw new ApiError(
        'Connexion au serveur interrompue. Réessayez — si le problème continue, vérifiez votre réseau.',
      );
    }
    throw new ApiError(raw || 'Erreur réseau.');
  }

  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    emitAuthLogout();
  }

  // 202 Accepted = traitement asynchrone (chat agent)
  if (!res.ok && res.status !== 202) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(
      res.status === 401 && !path.startsWith('/api/auth/')
        ? 'Session expirée. Reconnectez-vous.'
        : message,
      res.status,
    );
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

export async function fetchAgentHistory(threadId: number): Promise<ChatMessage[]> {
  const data = await request<{ messages: Array<{ id: number; role: string; content: string; created_at: string }> }>(
    `/api/history?thread_id=${threadId}`,
  );
  return (data.messages ?? []).map((m) => ({
    id: `agent-${m.id}`,
    kind: m.role === 'user' ? 'user' : m.content.startsWith('❌') ? 'error' : 'assistant',
    content: m.content,
    created_at: m.created_at,
    label: m.role === 'user' ? 'Vous' : 'Agent',
  }));
}

export async function fetchAgentMessagesSince(threadId: number, since: number): Promise<ChatMessage[]> {
  const data = await request<{ messages: Array<{ id: number; role: string; content: string; created_at: string }> }>(
    `/api/history/since?since=${since}&thread_id=${threadId}`,
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

export async function sendChatMessage(message: string, threadId: number): Promise<{
  id: number;
  reply: string;
  created_at: string;
  error?: boolean;
}> {
  const start = await request<{
    pending?: boolean;
    since_id?: number;
    id?: number;
    reply?: string;
    created_at?: string;
    error?: boolean;
  }>('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message, thread_id: threadId }),
  });

  if (!start.pending && start.reply != null && start.id != null) {
    return {
      id: start.id,
      reply: start.reply,
      created_at: start.created_at || new Date().toISOString(),
      error: start.error,
    };
  }

  const since = Number(start.since_id) || 0;
  // Jusqu'à 6 minutes — extraction de grands groupes + thinking
  const deadline = Date.now() + 360_000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    try {
      const msgs = await fetchAgentMessagesSince(threadId, since);
      const assistant = msgs.find((m) => m.kind === 'assistant' || m.kind === 'error');
      if (assistant) {
        const idNum = Number(String(assistant.id).replace(/\D/g, '')) || Date.now();
        const isTechError =
          assistant.kind === 'error' ||
          assistant.content.startsWith('❌') ||
          /failed to fetch|ECONNRESET|ECONNREFUSED|HTTP\s*\d{3}/i.test(assistant.content);
        return {
          id: idNum,
          reply: isTechError
            ? 'Je n’ai pas pu terminer. Réessayez — je suis prêt.'
            : assistant.content,
          created_at: assistant.created_at,
          error: false,
        };
      }
    } catch {
      /* poll continue */
    }
  }

  // Pas d'exception technique : message agent amical (le serveur peut encore finir)
  return {
    id: Date.now(),
    reply:
      'Je suis encore en train de récupérer les informations (groupe / contacts). Réessayez dans un instant — la liste apparaîtra dès qu’elle est prête.',
    created_at: new Date().toISOString(),
    error: false,
  };
}

export async function clearHistory(threadId: number): Promise<void> {
  await request(`/api/history?thread_id=${threadId}`, { method: 'DELETE' });
}

export interface AgentThreadSummary {
  id: number;
  title: string;
  description?: string | null;
  automation_id: number | null;
  automation_status?: string | null;
  automation_name?: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchThreads(): Promise<AgentThreadSummary[]> {
  const data = await request<{ threads: AgentThreadSummary[] }>('/api/threads');
  return data.threads ?? [];
}

export async function createThread(
  title?: string,
  description?: string,
): Promise<AgentThreadSummary> {
  const data = await request<{ thread: AgentThreadSummary }>('/api/threads', {
    method: 'POST',
    body: JSON.stringify({
      title: title ?? 'Automatisation',
      description: description?.trim() || undefined,
    }),
  });
  return data.thread;
}

export async function renameThread(threadId: number, title: string): Promise<AgentThreadSummary> {
  const data = await request<{ thread: AgentThreadSummary }>(`/api/threads/${threadId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
  return data.thread;
}

export async function deleteThread(threadId: number): Promise<void> {
  await request(`/api/threads/${threadId}`, { method: 'DELETE' });
}

export async function fetchThreadCampaign(threadId: number): Promise<{
  detail: AutomationDetail;
  stats: Record<string, number | string | null>;
}> {
  return request(`/api/threads/${threadId}/campaign`);
}

/** Transcrit un enregistrement audio en texte (dictée vocale de l'input de chat). */
export async function transcribeChatAudio(blob: Blob): Promise<string> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  const data = await request<{ text: string }>('/api/chat/transcribe', {
    method: 'POST',
    body: JSON.stringify({ data: base64, mimetype: blob.type || 'audio/webm' }),
  });
  return data.text ?? '';
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

export type IntegrationStatus = {
  provider: string;
  connected: boolean;
  email: string | null;
  accountId: string | null;
  connectedAt: string | null;
  scopes: string | null;
};

export type TypeformFormSummary = {
  id: string;
  title: string;
  lastUpdatedAt?: string;
  createdAt?: string;
};

export async function fetchIntegrations(): Promise<{
  integrations: IntegrationStatus[];
  typeformConfigured: boolean;
  googleConfigured: boolean;
  googleContactsGranted?: boolean;
}> {
  return request('/api/integrations');
}

export async function startTypeformConnect(): Promise<{ url: string; redirectUri: string }> {
  return request('/api/integrations/typeform/connect');
}

export async function dismissGoogleContactsPrompt(): Promise<{
  ok: boolean;
  user: AuthUser;
}> {
  return request('/api/me/google-contacts-prompt-done', { method: 'POST' });
}

export async function startGoogleContactsConnect(): Promise<{
  url: string;
  redirectUri: string;
  purpose?: string;
}> {
  // Route dédiée (évite toute ambiguïté avec Sheets / query ?for=).
  return request('/api/integrations/google/contacts/connect');
}

export async function disconnectTypeform(): Promise<void> {
  await request('/api/integrations/typeform', { method: 'DELETE' });
}

export async function fetchTypeformForms(): Promise<{ forms: TypeformFormSummary[] }> {
  return request('/api/integrations/typeform/forms');
}

export type ConnectedSheetSummary = {
  spreadsheetId: string;
  title: string;
  addedAt: string;
};

export async function startGoogleConnect(): Promise<{ url: string; redirectUri: string }> {
  return request('/api/integrations/google/connect?for=sheets');
}

export async function disconnectGoogle(): Promise<void> {
  await request('/api/integrations/google', { method: 'DELETE' });
}

export async function disconnectGoogleContacts(): Promise<void> {
  await request('/api/integrations/google/contacts', { method: 'DELETE' });
}

export async function fetchGooglePickerToken(): Promise<{
  accessToken: string;
  expiresAt: string;
}> {
  return request('/api/integrations/google/picker-token');
}

export async function fetchGoogleSheets(): Promise<{
  sheets: ConnectedSheetSummary[];
  max: number;
}> {
  return request('/api/integrations/google/sheets');
}

export async function addGoogleSheets(
  sheets: Array<{ id: string; title: string }>,
): Promise<{
  added: number;
  total: number;
  sheets: ConnectedSheetSummary[];
  max: number;
}> {
  return request('/api/integrations/google/sheets', {
    method: 'POST',
    body: JSON.stringify({ sheets }),
  });
}

export async function removeGoogleSheet(spreadsheetId: string): Promise<{
  ok: boolean;
  sheets: ConnectedSheetSummary[];
  max: number;
}> {
  return request(`/api/integrations/google/sheets/${encodeURIComponent(spreadsheetId)}`, {
    method: 'DELETE',
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

export async function disconnectWhatsApp(): Promise<{ ok: boolean }> {
  return request('/api/evolution/instance/logout', { method: 'POST' });
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

/** Valide la simulation sans activer — demande confirmation d'activation. */
export async function validateSimulation(id: number): Promise<{
  ok: boolean;
  needsActivationConfirm: boolean;
  message: string;
  name?: string;
  status?: string;
}> {
  return request(`/api/automations/${id}/validate-simulation`, { method: 'POST' });
}

/** Active une automatisation (draft/pause → active). Utilisé par Lancer draft + « Oui, activer ». */
export async function validateSimulationAndLaunch(id: number): Promise<{
  ok: boolean;
  message: string;
  targetsAdded?: number;
  status?: string;
}> {
  return request(`/api/automations/${id}/activate`, { method: 'POST' });
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

export async function loginWithGoogle(accessToken: string): Promise<{ token: string; user: AuthUser }> {
  return request('/api/auth/google', {
    method: 'POST',
    body: JSON.stringify({ accessToken }),
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

export async function postSimulationPreview(input: {
  opener: string;
  history: Array<{ role: 'you' | 'prospect'; text: string }>;
  prospectMessage: string;
  guide?: string;
  offer?: string;
}): Promise<{
  reply: string;
  history: Array<{ role: 'you' | 'prospect'; text: string }>;
  done: boolean;
  feedbackPrompt: string | null;
}> {
  return request('/api/simulation/preview', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export { ApiError };
