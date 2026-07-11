/* ── API base (Netlify → Hostinger) ── */
function apiUrl(path) {
  const base = (window.KLANVIO_CONFIG?.apiUrl || "").replace(/\/$/, "");
  return `${base}${path}`;
}

/* ── Elements ── */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const messagesEl = $("#messages");
const formEl = $("#chat-form");
const inputEl = $("#message-input");
const sendBtn = $("#send-btn");

const openaiStatus = $("#openai-status");
const whatsappStatus = $("#whatsapp-status");
const openaiDetail = $("#openai-detail");
const whatsappDetail = $("#whatsapp-detail");
const cardOpenai = $("#card-openai");
const cardWhatsapp = $("#card-whatsapp");

const modalOverlay = $("#modal-overlay");
const connectBtn = $("#connect-btn");
const modalClose = $("#modal-close");
const clearBtn = $("#clear-btn");

const openaiKeyInput = $("#openai-key");
const saveOpenaiBtn = $("#save-openai");
const openaiFeedback = $("#openai-feedback");
const evoUrlInput = $("#evo-url");
const evoKeyInput = $("#evo-key");
const evoInstanceInput = $("#evo-instance");
const evoWebhookInput = $("#evo-webhook");
const saveEvoBtn = $("#save-evolution");
const testEvoBtn = $("#test-evolution");
const evoShowQrBtn = $("#evo-show-qr");
const evoQrPanel = $("#evo-qr-panel");
const evoQrOutput = $("#evo-qr-output");
const evoQrHint = $("#evo-qr-hint");
const evoFeedback = $("#evo-feedback");
const autoReplyToggle = $("#auto-reply-toggle");
const contactsListEl = $("#contacts-list");
const outboundQuotaEl = $("#outbound-quota");
const resetQuotaBtn = $("#reset-quota-btn");
const dailyBilanEl = $("#daily-bilan");
const refreshBilanBtn = $("#refresh-bilan");
const businessNameInput = $("#business-name");
const businessOfferInput = $("#business-offer");
const businessPriceInput = $("#business-price");
const saveBusinessBtn = $("#save-business");
const businessFeedback = $("#business-feedback");
const viewTeam = $("#view-team");
const viewWorkspace = $("#view-workspace");
const backTeamBtn = $("#back-team-btn");
const agentWhatsapp = $("#agent-whatsapp");
const agentWaDot = $("#agent-wa-dot");
const agentWaLabel = $("#agent-wa-label");
const appTitle = $("#app-title");
const appSubtitle = $("#app-subtitle");
const statusPills = $("#status-pills");

let sending = false;
let currentView = "team";
let workspaceReady = false;
let lastIncomingId = 0;
let lastWhatsAppId = 0;
let lastAgentMsgId = 0;
const seenIncomingIds = new Set();
const seenWhatsAppIds = new Set();
const seenAgentMsgIds = new Set();

const STATUS_LABELS = {
  nouveau: "Nouveau",
  en_conversation: "En cours",
  interesse: "Intéressé",
  stop: "STOP",
};

/* ── Utils ── */
function formatTime(iso) {
  if (!iso) return "";
  const normalized = iso.includes("T") ? iso : iso.replace(" ", "T");
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return iso.slice(11, 16) || iso;
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function setFeedback(el, text, type = "") {
  el.textContent = text;
  el.className = "form-feedback" + (type ? ` ${type}` : "");
}

function isNearBottom(el, threshold = 80) {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

function scrollToBottom(force = false) {
  if (force || isNearBottom(messagesEl)) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function appendMessageTo(container, { role, content, created_at, isError = false, isWhatsapp = false, isWhatsappOut = false, sender = "", forceScroll = false }) {
  if (!container) return;
  const div = document.createElement("div");
  if (isWhatsappOut) {
    div.className = "msg whatsapp-out";
  } else {
    div.className = `msg ${isWhatsapp ? "whatsapp-in" : role}`;
  }
  if (isError) div.classList.add("error");

  const label = isWhatsappOut
    ? "WhatsApp · Envoyé"
    : isWhatsapp
      ? `WhatsApp · ${sender || "Contact"}`
      : role === "user"
        ? "Vous"
        : "Agent";

  div.innerHTML = `
    <div class="meta">
      <span>${label}</span>
      <span>${formatTime(created_at)}</span>
    </div>
    <div class="body"></div>
  `;
  div.querySelector(".body").textContent = content;
  container.appendChild(div);
  const near =
    forceScroll ||
    role === "user" ||
    container.scrollHeight - container.scrollTop - container.clientHeight <= 80;
  if (near) container.scrollTop = container.scrollHeight;
}

function appendMessage(opts) {
  appendMessageTo(messagesEl, opts);
}

function showTypingIn(container, on, id = "typing-indicator") {
  if (!container) return;
  let el = container.querySelector(`#${id}`);
  if (on) {
    if (!el) {
      el = document.createElement("div");
      el.id = id;
      el.className = "typing";
      el.innerHTML = `L'agent réfléchit <span class="typing-dots"><span></span><span></span><span></span></span>`;
      container.appendChild(el);
    }
  } else if (el) {
    el.remove();
  }
  container.scrollTop = container.scrollHeight;
}

function showTyping(on) {
  showTypingIn(messagesEl, on, "typing-indicator");
}

function setStatusPill(el, state) {
  el.className = "status-pill " + state;
}

function setConnectionCard(card, state) {
  card.className = "connection-card " + state;
}

function setAgentWaStatus(state, label) {
  if (agentWaDot) {
    agentWaDot.className = "agent-dot " + (state === "connected" ? "on" : state === "pending" ? "wait" : "off");
  }
  if (agentWaLabel) agentWaLabel.textContent = label;
}

function updateStatusPillsVisibility() {
  if (!statusPills) return;
  statusPills.classList.toggle("hidden", currentView === "whatsapp");
}
window.updateStatusPillsVisibility = updateStatusPillsVisibility;

function showTeamView() {
  currentView = "team";
  window.currentView = currentView;
  updateStatusPillsVisibility();
  viewTeam?.classList.remove("hidden");
  viewWorkspace?.classList.add("hidden");
  backTeamBtn?.classList.add("hidden");
  clearBtn?.classList.add("hidden");
  if (appTitle) appTitle.textContent = "Agent Team";
  if (appSubtitle) appSubtitle.textContent = "Votre équipe d’agents IA";
  document.title = "Agent Team";
}

async function showWhatsAppWorkspace() {
  currentView = "whatsapp";
  window.currentView = currentView;
  updateStatusPillsVisibility();
  window.WhatsAppConsole?.switchWaMode?.("agent");
  viewTeam?.classList.add("hidden");
  viewWorkspace?.classList.remove("hidden");
  backTeamBtn?.classList.remove("hidden");
  clearBtn?.classList.remove("hidden");
  if (appTitle) appTitle.textContent = "WhatsApp";
  if (appSubtitle) appSubtitle.textContent = "Expert prospection, groupes & planification";
  document.title = "WhatsApp · Agent Team";

  if (!workspaceReady) {
    workspaceReady = true;
    await bootstrapWorkspace();
  }

  inputEl?.focus();
}

async function loadContacts() {
  if (!contactsListEl) return;
  try {
    const res = await fetch(apiUrl("/api/contacts"));
    if (!res.ok) return;
    const data = await res.json();
    const contacts = data.contacts ?? [];

    if (!contacts.length) {
      contactsListEl.innerHTML = '<p class="contacts-empty">Aucun contact enregistré.</p>';
      return;
    }

    contactsListEl.innerHTML = "";
    for (const c of contacts) {
      const item = document.createElement("div");
      item.className = `contact-item ${c.status}`;
      const label = c.name || c.display || c.phone;
      const auto = c.auto_reply ? " · auto" : "";
      item.innerHTML = `
        <div class="contact-top">
          <span class="contact-name"></span>
          <span class="contact-status ${c.status}"></span>
        </div>
        <div class="contact-meta"></div>
      `;
      item.querySelector(".contact-name").textContent = label;
      item.querySelector(".contact-status").textContent = STATUS_LABELS[c.status] || c.status;
      item.querySelector(".contact-meta").textContent = `${c.display || c.phone}${auto}`;
      item.addEventListener("click", () => {
        inputEl.value = `Montre-moi la conversation enregistrée avec ${c.display || c.phone}`;
        autoResize();
        inputEl.focus();
      });
      contactsListEl.appendChild(item);
    }
  } catch {
    /* ignore */
  }
}

async function loadDailyBilan() {
  if (!dailyBilanEl) return;
  try {
    const res = await fetch(apiUrl("/api/reports/daily"));
    if (!res.ok) return;
    const b = await res.json();
    const s = b.contactsByStatus || {};
    dailyBilanEl.innerHTML = `
      <div class="bilan-row"><span>Date</span><strong></strong></div>
      <div class="bilan-row"><span>Entrants</span><strong></strong></div>
      <div class="bilan-row"><span>Sortants</span><strong></strong></div>
      <div class="bilan-row"><span>Contacts actifs</span><strong></strong></div>
      <div class="bilan-pipeline">
        <span>Nouveau ${s.nouveau ?? 0}</span>
        <span>Conv. ${s.en_conversation ?? 0}</span>
        <span>Intéressé ${s.interesse ?? 0}</span>
        <span>STOP ${s.stop ?? 0}</span>
      </div>
    `;
    const vals = dailyBilanEl.querySelectorAll("strong");
    vals[0].textContent = b.date || "—";
    vals[1].textContent = String(b.incoming ?? 0);
    vals[2].textContent = String(b.outgoing ?? 0);
    vals[3].textContent = String(b.uniqueContacts ?? 0);
  } catch {
    dailyBilanEl.innerHTML = '<p class="contacts-empty">Bilan indisponible.</p>';
  }
}

/* ── API ── */
/** Étape 3 : les messages WhatsApp (entrants/sortants) s'affichent en temps réel dans le chat. */
async function pollWhatsApp() {
  try {
    const res = await fetch(apiUrl(`/api/whatsapp?since=${lastWhatsAppId}`));
    if (!res.ok) return;
    const data = await res.json();
    let added = 0;
    for (const m of data.messages ?? []) {
      if (seenWhatsAppIds.has(m.id)) continue;
      seenWhatsAppIds.add(m.id);
      lastWhatsAppId = Math.max(lastWhatsAppId, m.id);
      added++;

      const isOut = m.direction === "sortant";
      appendMessage({
        role: isOut ? "assistant" : "user",
        content: m.body,
        created_at: m.created_at,
        isWhatsapp: !isOut,
        isWhatsappOut: isOut,
        sender: m.sender_name || m.contact_phone,
        forceScroll: true,
      });
    }
    if (added > 0) {
      void loadDailyBilan();
      void loadContacts();
    }
  } catch {
    /* ignore */
  }
}

async function pollAgentHistory() {
  // Pendant un envoi manuel, la réponse est déjà affichée par sendMessage()
  if (sending) return;

  try {
    const res = await fetch(apiUrl(`/api/history/since?since=${lastAgentMsgId}`));
    if (!res.ok) return;
    const data = await res.json();

    for (const m of data.messages ?? []) {
      if (seenAgentMsgIds.has(m.id)) continue;
      seenAgentMsgIds.add(m.id);
      lastAgentMsgId = Math.max(lastAgentMsgId, m.id);

      appendMessage({
        role: m.role,
        content: m.content,
        created_at: m.created_at,
        isError: m.content.startsWith("❌"),
      });
    }
  } catch {
    /* ignore */
  }
}

async function pollIncoming() {
  await pollWhatsApp();
}

async function loadHistory() {
  const res = await fetch(apiUrl("/api/history"));
  if (!res.ok) throw new Error("Impossible de charger l'historique");
  const data = await res.json();
  messagesEl.innerHTML = "";

  if (!data.messages.length) {
    appendMessage({
      role: "assistant",
      content:
        "Bonjour ! Je suis votre agent WhatsApp.\n\n1. Connexions → OpenAI + Evolution API.\n2. Cliquez « Connecter WhatsApp (QR) » pour scanner le QR code.\n3. Ex. : « Liste mes groupes », « Envoie un message à +229… ».",
      created_at: new Date().toISOString(),
    });
    return;
  }

  for (const m of data.messages) {
    seenAgentMsgIds.add(m.id);
    lastAgentMsgId = Math.max(lastAgentMsgId, m.id);
    appendMessage({
      role: m.role,
      content: m.content,
      created_at: m.created_at,
      isError: m.content.startsWith("❌"),
    });
  }
  scrollToBottom(true);
}

async function refreshStatus() {
  try {
    const [healthRes, settingsRes] = await Promise.all([
      fetch(apiUrl("/api/health")),
      fetch(apiUrl("/api/settings")),
    ]);

    if (!healthRes.ok) throw new Error();

    const health = await healthRes.json();
    const settings = settingsRes.ok ? await settingsRes.json() : null;

    // OpenAI
    if (health.openai?.configured) {
      setStatusPill(openaiStatus, "connected");
      openaiDetail.textContent = settings?.openai?.maskedKey
        ? `Configuré (${settings.openai.maskedKey})`
        : "Configuré";
      setConnectionCard(cardOpenai, "connected");
    } else {
      setStatusPill(openaiStatus, "error");
      openaiDetail.textContent = "Non configuré — ajoutez votre clé";
      setConnectionCard(cardOpenai, "error");
    }

    // WhatsApp
    if (health.whatsapp?.connected) {
      setStatusPill(whatsappStatus, "connected");
      whatsappDetail.textContent = health.whatsapp.message || "Connecté";
      setConnectionCard(cardWhatsapp, "connected");
      setAgentWaStatus("connected", "Connecté · prêt");
    } else if (settings?.evolution?.configured) {
      setStatusPill(whatsappStatus, "pending");
      whatsappDetail.textContent = health.whatsapp?.message || "Configuré — en attente d'autorisation";
      setConnectionCard(cardWhatsapp, "error");
      setAgentWaStatus("pending", "En attente d'autorisation");
    } else {
      setStatusPill(whatsappStatus, "error");
      whatsappDetail.textContent = "Non connecté";
      setConnectionCard(cardWhatsapp, "error");
      setAgentWaStatus("error", "À configurer");
    }

    if (autoReplyToggle && typeof settings?.autoReply === "boolean") {
      autoReplyToggle.checked = settings.autoReply;
    } else if (autoReplyToggle && typeof health.autoReply === "boolean") {
      autoReplyToggle.checked = health.autoReply;
    }

    if (outboundQuotaEl && health.outbound) {
      const { today, limit, bonus } = health.outbound;
      outboundQuotaEl.textContent =
        bonus > 0 ? `${today}/${limit} (+${bonus} bonus)` : `${today}/${limit}`;
    }

    // Pré-remplir le modal
    if (settings?.evolution) {
      if (settings.evolution.baseUrl) evoUrlInput.value = settings.evolution.baseUrl;
      if (settings.evolution.instanceName) evoInstanceInput.value = settings.evolution.instanceName;
    }
    if (settings?.business) {
      if (businessNameInput) businessNameInput.value = settings.business.ownerName || "";
      if (businessOfferInput) businessOfferInput.value = settings.business.offer || "";
      if (businessPriceInput) businessPriceInput.value = settings.business.price || "";
    }

    await loadContacts();
    if (currentView === "whatsapp") await loadDailyBilan();
  } catch {
    setStatusPill(openaiStatus, "error");
    setStatusPill(whatsappStatus, "error");
    if (openaiDetail) openaiDetail.textContent = "Serveur hors ligne";
    if (whatsappDetail) whatsappDetail.textContent = "Serveur hors ligne";
    setAgentWaStatus("error", "Serveur hors ligne");
  }
}

async function sendMessage(text) {
  if (sending || !text.trim()) return;
  sending = true;
  sendBtn.disabled = true;

  appendMessage({ role: "user", content: text, created_at: new Date().toISOString(), forceScroll: true });
  inputEl.value = "";
  autoResize();
  showTyping(true);

  try {
    const res = await fetch(apiUrl("/api/chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });

    const data = await res.json();
    showTyping(false);

    // Marquer l'ID serveur comme déjà vu pour éviter le doublon via pollAgentHistory
    if (data.id) {
      seenAgentMsgIds.add(data.id);
      lastAgentMsgId = Math.max(lastAgentMsgId, data.id);
    } else {
      // Fallback : resync le curseur avec l'historique
      try {
        const hist = await fetch(apiUrl("/api/history"));
        if (hist.ok) {
          const h = await hist.json();
          for (const m of h.messages ?? []) {
            seenAgentMsgIds.add(m.id);
            lastAgentMsgId = Math.max(lastAgentMsgId, m.id);
          }
        }
      } catch { /* ignore */ }
    }

    appendMessage({
      role: "assistant",
      content: data.reply || data.error || "Erreur serveur",
      created_at: data.created_at || new Date().toISOString(),
      isError: Boolean(data.error) || String(data.reply || "").startsWith("❌"),
      forceScroll: true,
    });
  } catch (err) {
    showTyping(false);
    appendMessage({
      role: "assistant",
      content: `❌ Impossible de joindre le serveur : ${err.message}`,
      created_at: new Date().toISOString(),
      isError: true,
    });
  } finally {
    sending = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

/* ── Modal ── */
function openModal(tab = "openai") {
  modalOverlay.classList.remove("hidden");
  switchTab(tab);
}

function closeModal() {
  modalOverlay.classList.add("hidden");
}

function switchTab(name) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $$(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${name}`));
}

/* ── Settings handlers ── */
saveOpenaiBtn.addEventListener("click", async () => {
  const apiKey = openaiKeyInput.value.trim();
  if (!apiKey) {
    setFeedback(openaiFeedback, "Entrez votre clé API OpenAI.", "err");
    return;
  }

  saveOpenaiBtn.disabled = true;
  setFeedback(openaiFeedback, "Enregistrement…");

  try {
    const res = await fetch(apiUrl("/api/settings/openai"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }),
    });
    const data = await res.json();

    if (!res.ok) {
      setFeedback(openaiFeedback, data.error || "Erreur", "err");
    } else {
      setFeedback(openaiFeedback, data.message || "Enregistré !", "ok");
      openaiKeyInput.value = "";
      await refreshStatus();
    }
  } catch (err) {
    setFeedback(openaiFeedback, err.message, "err");
  } finally {
    saveOpenaiBtn.disabled = false;
  }
});

async function saveEvolutionApi() {
  const baseUrl = evoUrlInput.value.trim();
  const apiKey = evoKeyInput.value.trim();
  const instanceName = evoInstanceInput.value.trim();
  const webhookUrl = evoWebhookInput?.value?.trim() || "";

  if (!apiKey || !instanceName) {
    setFeedback(evoFeedback, "Clé API et nom d'instance sont requis.", "err");
    return null;
  }

  const res = await fetch(apiUrl("/api/settings/evolution"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseUrl, apiKey, instanceName, webhookUrl }),
  });
  return { res, data: await res.json() };
}

saveEvoBtn?.addEventListener("click", async () => {
  saveEvoBtn.disabled = true;
  setFeedback(evoFeedback, "Connexion en cours…");

  try {
    const { res, data } = await saveEvolutionApi();
    if (!res.ok) {
      setFeedback(evoFeedback, data.error || data.message || "Erreur", "err");
    } else if (data.connected) {
      setFeedback(evoFeedback, "✅ " + (data.message || "WhatsApp connecté !"), "ok");
      evoKeyInput.value = "";
      evoQrPanel?.classList.add("hidden");
      await refreshStatus();
    } else {
      setFeedback(evoFeedback, "Config enregistrée. Cliquez « Connecter WhatsApp (QR) » pour scanner.", "ok");
      await refreshStatus();
    }
  } catch (err) {
    setFeedback(evoFeedback, err.message, "err");
  } finally {
    saveEvoBtn.disabled = false;
  }
});

testEvoBtn?.addEventListener("click", async () => {
  testEvoBtn.disabled = true;
  setFeedback(evoFeedback, "Test en cours…");

  try {
    if (evoKeyInput.value.trim() && evoInstanceInput.value.trim()) {
      await saveEvolutionApi();
    }

    const res = await fetch(apiUrl("/api/settings/evolution/test"), { method: "POST" });
    const data = await res.json();

    if (data.connected) {
      setFeedback(evoFeedback, "✅ " + data.message, "ok");
      evoQrPanel?.classList.add("hidden");
    } else {
      setFeedback(evoFeedback, "⚠️ " + data.message + " — utilisez « Connecter WhatsApp (QR) ».", "err");
    }
    await refreshStatus();
  } catch (err) {
    setFeedback(evoFeedback, err.message, "err");
  } finally {
    testEvoBtn.disabled = false;
  }
});

async function showEvolutionQr() {
  evoQrPanel?.classList.remove("hidden");
  if (evoQrOutput) evoQrOutput.innerHTML = '<p class="contacts-empty">Chargement du QR…</p>';
  setFeedback(evoFeedback, "Génération du QR code…");

  try {
    if (evoKeyInput.value.trim() && evoInstanceInput.value.trim()) {
      await saveEvolutionApi();
    }

    const res = await fetch(apiUrl("/api/evolution/instance/qr"));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Impossible d'obtenir le QR code");

    if (window.WhatsAppConsole?.renderQrPanel) {
      window.WhatsAppConsole.renderQrPanel(evoQrOutput, data);
    }

    if (data.connected) {
      setFeedback(evoFeedback, "✅ " + (data.message || "WhatsApp déjà connecté"), "ok");
    } else {
      setFeedback(evoFeedback, "Scannez le QR avec WhatsApp → Appareils connectés.", "ok");
    }
    await refreshStatus();
  } catch (err) {
    setFeedback(evoFeedback, err.message, "err");
    if (evoQrOutput) evoQrOutput.innerHTML = "";
  }
}

evoShowQrBtn?.addEventListener("click", () => void showEvolutionQr());

saveBusinessBtn?.addEventListener("click", async () => {
  saveBusinessBtn.disabled = true;
  setFeedback(businessFeedback, "Enregistrement…");
  try {
    const res = await fetch(apiUrl("/api/settings/business"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ownerName: businessNameInput?.value?.trim() || "",
        offer: businessOfferInput?.value?.trim() || "",
        price: businessPriceInput?.value?.trim() || "",
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setFeedback(businessFeedback, data.error || "Erreur", "err");
    } else {
      setFeedback(businessFeedback, "✅ Profil business enregistré dans SQLite", "ok");
    }
  } catch (err) {
    setFeedback(businessFeedback, err.message, "err");
  } finally {
    saveBusinessBtn.disabled = false;
  }
});

refreshBilanBtn?.addEventListener("click", () => {
  void loadDailyBilan();
});

/* ── Events ── */
connectBtn.addEventListener("click", () => openModal("openai"));
modalClose.addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeModal();
});

agentWhatsapp?.addEventListener("click", () => {
  showWhatsAppWorkspace();
});

backTeamBtn?.addEventListener("click", () => {
  showTeamView();
});

$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

autoReplyToggle?.addEventListener("change", async () => {
  try {
    await fetch(apiUrl("/api/settings/auto-reply"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: autoReplyToggle.checked }),
    });
  } catch {
    autoReplyToggle.checked = !autoReplyToggle.checked;
  }
});

resetQuotaBtn?.addEventListener("click", async () => {
  if (!confirm("Débloquer les envois pour aujourd'hui ? (ajoute un bonus au quota journalier)")) return;
  resetQuotaBtn.disabled = true;
  try {
    const res = await fetch(apiUrl("/api/settings/outbound-quota"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset", extra: 20 }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur");
    if (outboundQuotaEl && data.outbound) {
      const { today, limit, bonus } = data.outbound;
      outboundQuotaEl.textContent =
        bonus > 0 ? `${today}/${limit} (+${bonus} bonus)` : `${today}/${limit}`;
    }
    alert(data.message || "Quota débloqué.");
  } catch (err) {
    alert(err instanceof Error ? err.message : "Impossible de réinitialiser le quota.");
  } finally {
    resetQuotaBtn.disabled = false;
  }
});

clearBtn.addEventListener("click", async () => {
  if (!confirm("Effacer toute la conversation ?")) return;
  await fetch(apiUrl("/api/history"), { method: "DELETE" });
  await loadHistory();
});

$$(".hints li").forEach((li) => {
  li.addEventListener("click", () => {
    const text = li.textContent.replace(/^«|»$/g, "").trim();
    inputEl.value = text;
    autoResize();
    inputEl.focus();
  });
});

formEl.addEventListener("submit", (e) => {
  e.preventDefault();
  sendMessage(inputEl.value);
});

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    formEl.requestSubmit();
  }
});

inputEl.addEventListener("input", autoResize);

function autoResize() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + "px";
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!modalOverlay.classList.contains("hidden")) {
      closeModal();
    } else if (currentView === "whatsapp") {
      showTeamView();
    }
  }
});

async function bootstrapWorkspace() {
  try {
    await loadHistory();
  } catch {
    appendMessage({
      role: "assistant",
      content: "Interface prête. Vous pouvez envoyer une instruction à l'agent WhatsApp.",
      created_at: new Date().toISOString(),
    });
  }

  // Curseur WhatsApp : messages déjà en base ne sont pas rejoués ; seuls les nouveaux s'affichent
  try {
    const res = await fetch(apiUrl("/api/whatsapp?since=0"));
    if (res.ok) {
      const data = await res.json();
      for (const m of data.messages ?? []) {
        seenWhatsAppIds.add(m.id);
        lastWhatsAppId = Math.max(lastWhatsAppId, m.id);
      }
    }
  } catch { /* ignore */ }

  scrollToBottom(true);
  await loadContacts();
  await loadDailyBilan();
}

/* ── Init ── */
async function init() {
  showTeamView();

  try {
    await refreshStatus();
  } catch {
    /* serveur peut être lent au démarrage */
  }

  setInterval(refreshStatus, 5000);
  setInterval(() => {
    if (currentView === "whatsapp") {
      pollWhatsApp();
      pollAgentHistory();
    }
  }, 3000);
  setInterval(() => {
    if (currentView === "whatsapp") {
      loadContacts();
      loadDailyBilan();
    }
  }, 8000);
}

init();
