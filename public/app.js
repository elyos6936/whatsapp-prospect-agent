/* ── Elements ── */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const messagesEl = $("#messages");
const formEl = $("#chat-form");
const inputEl = $("#message-input");
const sendBtn = $("#send-btn");

const openaiStatus = $("#openai-status");
const whatsappStatus = $("#whatsapp-status");
const metaStatus = $("#meta-status");
const openaiDetail = $("#openai-detail");
const whatsappDetail = $("#whatsapp-detail");
const metaDetail = $("#meta-detail");
const cardOpenai = $("#card-openai");
const cardWhatsapp = $("#card-whatsapp");
const cardMeta = $("#card-meta");

const modalOverlay = $("#modal-overlay");
const connectBtn = $("#connect-btn");
const modalClose = $("#modal-close");
const clearBtn = $("#clear-btn");

const openaiKeyInput = $("#openai-key");
const greenIdInput = $("#green-id");
const greenTokenInput = $("#green-token");
const greenUrlInput = $("#green-url");
const saveOpenaiBtn = $("#save-openai");
const saveGreenBtn = $("#save-greenapi");
const testGreenBtn = $("#test-greenapi");
const openaiFeedback = $("#openai-feedback");
const greenFeedback = $("#green-feedback");
const autoReplyToggle = $("#auto-reply-toggle");
const contactsListEl = $("#contacts-list");
const outboundQuotaEl = $("#outbound-quota");
const dailyBilanEl = $("#daily-bilan");
const refreshBilanBtn = $("#refresh-bilan");
const businessNameInput = $("#business-name");
const businessOfferInput = $("#business-offer");
const businessPriceInput = $("#business-price");
const saveBusinessBtn = $("#save-business");
const businessFeedback = $("#business-feedback");
const viewTeam = $("#view-team");
const viewWorkspace = $("#view-workspace");
const viewAds = $("#view-ads");
const backTeamBtn = $("#back-team-btn");
const agentWhatsapp = $("#agent-whatsapp");
const agentMeta = $("#agent-meta");
const agentWaDot = $("#agent-wa-dot");
const agentWaLabel = $("#agent-wa-label");
const agentMetaDot = $("#agent-meta-dot");
const agentMetaLabel = $("#agent-meta-label");
const appTitle = $("#app-title");
const appSubtitle = $("#app-subtitle");
const statusPills = $("#status-pills");

const metaTokenInput = $("#meta-token");
const metaAdAccountInput = $("#meta-ad-account");
const metaPageIdInput = $("#meta-page-id");
const metaWaNumberInput = $("#meta-wa-number");
const saveMetaBtn = $("#save-meta");
const testMetaBtn = $("#test-meta");
const metaFeedback = $("#meta-feedback");
const adsMessagesEl = $("#ads-messages");
const adsFormEl = $("#ads-chat-form");
const adsInputEl = $("#ads-message-input");
const adsSendBtn = $("#ads-send-btn");
const adsReportEl = $("#ads-report");
const adsCampaignsListEl = $("#ads-campaigns-list");
const refreshAdsReportBtn = $("#refresh-ads-report");

let sending = false;
let adsSending = false;
let currentView = "team";
let workspaceReady = false;
let adsWorkspaceReady = false;
let adsReportPreset = "today";
let lastIncomingId = 0;
let lastWhatsAppId = 0;
let lastAgentMsgId = 0;
let lastAdsAgentMsgId = 0;
const seenIncomingIds = new Set();
const seenWhatsAppIds = new Set();
const seenAgentMsgIds = new Set();
const seenAdsAgentMsgIds = new Set();

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

function appendAdsMessage(opts) {
  appendMessageTo(adsMessagesEl, opts);
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

function showAdsTyping(on) {
  showTypingIn(adsMessagesEl, on, "ads-typing-indicator");
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

function setAgentMetaStatus(state, label) {
  if (agentMetaDot) {
    agentMetaDot.className = "agent-dot " + (state === "connected" ? "on" : state === "pending" ? "wait" : "off");
  }
  if (agentMetaLabel) agentMetaLabel.textContent = label;
}

function showTeamView() {
  currentView = "team";
  viewTeam?.classList.remove("hidden");
  viewWorkspace?.classList.add("hidden");
  viewAds?.classList.add("hidden");
  backTeamBtn?.classList.add("hidden");
  clearBtn?.classList.add("hidden");
  if (appTitle) appTitle.textContent = "Agent Team";
  if (appSubtitle) appSubtitle.textContent = "Votre équipe d’agents IA";
  document.title = "Agent Team";
}

async function showWhatsAppWorkspace() {
  currentView = "whatsapp";
  viewTeam?.classList.add("hidden");
  viewAds?.classList.add("hidden");
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

async function showAdsWorkspace() {
  currentView = "ads";
  viewTeam?.classList.add("hidden");
  viewWorkspace?.classList.add("hidden");
  viewAds?.classList.remove("hidden");
  backTeamBtn?.classList.remove("hidden");
  clearBtn?.classList.remove("hidden");
  if (appTitle) appTitle.textContent = "Publicité Meta";
  if (appSubtitle) appSubtitle.textContent = "Campagnes FB/IG → WhatsApp & rapports";
  document.title = "Meta Ads · Agent Team";

  if (!adsWorkspaceReady) {
    adsWorkspaceReady = true;
    await bootstrapAdsWorkspace();
  } else {
    await loadAdsReport();
  }

  adsInputEl?.focus();
}

async function loadContacts() {
  if (!contactsListEl) return;
  try {
    const res = await fetch("/api/contacts");
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
    const res = await fetch("/api/reports/daily");
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

function formatMoney(n, currency) {
  const num = Number(n) || 0;
  const formatted = num.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  return currency ? `${formatted} ${currency}` : formatted;
}

async function loadAdsReport() {
  if (!adsReportEl) return;
  try {
    const res = await fetch(`/api/ads/report?preset=${encodeURIComponent(adsReportPreset)}`);
    const data = await res.json();
    if (!res.ok) {
      adsReportEl.innerHTML = `<p class="contacts-empty">${data.error || "Rapport indisponible."}</p>`;
      if (adsCampaignsListEl) {
        adsCampaignsListEl.innerHTML = '<p class="contacts-empty">Connectez Meta Ads.</p>';
      }
      return;
    }

    if (data.configured === false) {
      adsReportEl.innerHTML = `<p class="contacts-empty">${data.message || "Connectez Meta Ads pour voir les KPIs."}</p>`;
      if (adsCampaignsListEl) {
        adsCampaignsListEl.innerHTML = '<p class="contacts-empty">Aucune campagne.</p>';
      }
      return;
    }

    const r = data.report || {};
    adsReportEl.innerHTML = `
      <div class="bilan-row"><span>Dépense</span><strong></strong></div>
      <div class="bilan-row"><span>Impressions</span><strong></strong></div>
      <div class="bilan-row"><span>Clics</span><strong></strong></div>
      <div class="bilan-row"><span>Conversations</span><strong></strong></div>
      <div class="bilan-row"><span>CPC</span><strong></strong></div>
    `;
    const vals = adsReportEl.querySelectorAll("strong");
    vals[0].textContent = formatMoney(r.spend, r.currency);
    vals[1].textContent = String(r.impressions ?? 0);
    vals[2].textContent = String(r.clicks ?? 0);
    vals[3].textContent = String(r.messages ?? 0);
    vals[4].textContent =
      r.cpc != null ? formatMoney(r.cpc, r.currency) : "—";

    const campaigns = data.campaigns ?? [];
    if (!adsCampaignsListEl) return;
    if (!campaigns.length) {
      adsCampaignsListEl.innerHTML = '<p class="contacts-empty">Aucune campagne.</p>';
      return;
    }

    adsCampaignsListEl.innerHTML = "";
    for (const c of campaigns) {
      const item = document.createElement("div");
      const st = (c.effective_status || c.status || "").toUpperCase();
      item.className = `contact-item ${st === "ACTIVE" ? "interesse" : st === "PAUSED" ? "" : "stop"}`;
      item.innerHTML = `
        <div class="contact-top">
          <span class="contact-name"></span>
          <span class="contact-status"></span>
        </div>
        <div class="contact-meta"></div>
      `;
      item.querySelector(".contact-name").textContent = c.name || c.id;
      item.querySelector(".contact-status").textContent = st || "—";
      item.querySelector(".contact-meta").textContent = c.id;
      item.addEventListener("click", () => {
        if (!adsInputEl) return;
        adsInputEl.value = `Montre le statut et propose de ${st === "ACTIVE" ? "mettre en pause" : "lancer"} la campagne ${c.id}`;
        autoResizeAds();
        adsInputEl.focus();
      });
      adsCampaignsListEl.appendChild(item);
    }
  } catch {
    adsReportEl.innerHTML = '<p class="contacts-empty">Rapport indisponible.</p>';
  }
}

/* ── API ── */
/** Étape 3 : les messages WhatsApp (entrants/sortants) s'affichent en temps réel dans le chat. */
async function pollWhatsApp() {
  try {
    const res = await fetch(`/api/whatsapp?since=${lastWhatsAppId}`);
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
    const res = await fetch(`/api/history/since?since=${lastAgentMsgId}`);
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
  const res = await fetch("/api/history");
  if (!res.ok) throw new Error("Impossible de charger l'historique");
  const data = await res.json();
  messagesEl.innerHTML = "";

  if (!data.messages.length) {
    appendMessage({
      role: "assistant",
      content:
        "Bonjour ! Je suis votre agent WhatsApp.\n\n1. Connexions → OpenAI + Green-API.\n2. Les messages WhatsApp reçus apparaissent ici en temps réel.\n3. Ex. : « Liste mes groupes », « Montre l'historique avec +229… », « Messages reçus aujourd'hui ».",
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
      fetch("/api/health"),
      fetch("/api/settings"),
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
    } else if (settings?.greenApi?.configured) {
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

    // Meta Ads
    if (health.metaAds?.connected) {
      setStatusPill(metaStatus, "connected");
      if (metaDetail) metaDetail.textContent = health.metaAds.message || "Connecté";
      if (cardMeta) setConnectionCard(cardMeta, "connected");
      setAgentMetaStatus("connected", "Connecté · prêt");
    } else if (settings?.metaAds?.configured) {
      setStatusPill(metaStatus, "pending");
      if (metaDetail) metaDetail.textContent = health.metaAds?.message || "Configuré — vérifier le token";
      if (cardMeta) setConnectionCard(cardMeta, "error");
      setAgentMetaStatus("pending", "À vérifier");
    } else {
      setStatusPill(metaStatus, "error");
      if (metaDetail) metaDetail.textContent = "Non connecté";
      if (cardMeta) setConnectionCard(cardMeta, "error");
      setAgentMetaStatus("error", "À configurer");
    }

    if (autoReplyToggle && typeof settings?.autoReply === "boolean") {
      autoReplyToggle.checked = settings.autoReply;
    } else if (autoReplyToggle && typeof health.autoReply === "boolean") {
      autoReplyToggle.checked = health.autoReply;
    }

    if (outboundQuotaEl && health.outbound) {
      outboundQuotaEl.textContent = `${health.outbound.today}/${health.outbound.limit}`;
    }

    // Pré-remplir le modal
    if (settings?.greenApi) {
      if (settings.greenApi.idInstance) greenIdInput.value = settings.greenApi.idInstance;
      if (settings.greenApi.baseUrl) greenUrlInput.value = settings.greenApi.baseUrl;
    }
    if (settings?.business) {
      if (businessNameInput) businessNameInput.value = settings.business.ownerName || "";
      if (businessOfferInput) businessOfferInput.value = settings.business.offer || "";
      if (businessPriceInput) businessPriceInput.value = settings.business.price || "";
    }
    if (settings?.metaAds) {
      if (metaAdAccountInput && settings.metaAds.adAccountId) {
        metaAdAccountInput.value = settings.metaAds.adAccountId;
      }
      if (metaPageIdInput && settings.metaAds.pageId) {
        metaPageIdInput.value = settings.metaAds.pageId;
      }
      if (metaWaNumberInput) {
        metaWaNumberInput.value = settings.metaAds.whatsappNumber || "";
      }
    }

    await loadContacts();
    if (currentView === "whatsapp") await loadDailyBilan();
    if (currentView === "ads") await loadAdsReport();
  } catch {
    setStatusPill(openaiStatus, "error");
    setStatusPill(whatsappStatus, "error");
    setStatusPill(metaStatus, "error");
    if (openaiDetail) openaiDetail.textContent = "Serveur hors ligne";
    if (whatsappDetail) whatsappDetail.textContent = "Serveur hors ligne";
    if (metaDetail) metaDetail.textContent = "Serveur hors ligne";
    setAgentWaStatus("error", "Serveur hors ligne");
    setAgentMetaStatus("error", "Serveur hors ligne");
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
    const res = await fetch("/api/chat", {
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
        const hist = await fetch("/api/history");
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

async function sendAdsMessage(text) {
  if (adsSending || !text.trim()) return;
  adsSending = true;
  if (adsSendBtn) adsSendBtn.disabled = true;

  appendAdsMessage({ role: "user", content: text, created_at: new Date().toISOString(), forceScroll: true });
  adsInputEl.value = "";
  autoResizeAds();
  showAdsTyping(true);

  try {
    const res = await fetch("/api/ads/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });
    const data = await res.json();
    showAdsTyping(false);

    if (data.id) {
      seenAdsAgentMsgIds.add(data.id);
      lastAdsAgentMsgId = Math.max(lastAdsAgentMsgId, data.id);
    }

    appendAdsMessage({
      role: "assistant",
      content: data.reply || data.error || "Erreur serveur",
      created_at: data.created_at || new Date().toISOString(),
      isError: Boolean(data.error) || String(data.reply || "").startsWith("❌"),
      forceScroll: true,
    });
    void loadAdsReport();
  } catch (err) {
    showAdsTyping(false);
    appendAdsMessage({
      role: "assistant",
      content: `❌ Impossible de joindre le serveur : ${err.message}`,
      created_at: new Date().toISOString(),
      isError: true,
    });
  } finally {
    adsSending = false;
    if (adsSendBtn) adsSendBtn.disabled = false;
    adsInputEl?.focus();
  }
}

async function pollAdsAgentHistory() {
  if (adsSending) return;
  try {
    const res = await fetch(`/api/ads/history/since?since=${lastAdsAgentMsgId}`);
    if (!res.ok) return;
    const data = await res.json();
    for (const m of data.messages ?? []) {
      if (seenAdsAgentMsgIds.has(m.id)) continue;
      seenAdsAgentMsgIds.add(m.id);
      lastAdsAgentMsgId = Math.max(lastAdsAgentMsgId, m.id);
      appendAdsMessage({
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

async function loadAdsHistory() {
  const res = await fetch("/api/ads/history");
  if (!res.ok) throw new Error("Impossible de charger l'historique Meta Ads");
  const data = await res.json();
  adsMessagesEl.innerHTML = "";

  if (!data.messages.length) {
    appendAdsMessage({
      role: "assistant",
      content:
        "Bonjour ! Je gère vos publicités Meta (Facebook / Instagram) vers WhatsApp.\n\n1. Connexions → Meta Ads (token, Ad Account, Page, n° WhatsApp).\n2. Demandez un brouillon de campagne, je crée en pause, puis vous validez le lancement.\n3. Les rapports (dépense, clics, conversations) sont dans le panneau de gauche.",
      created_at: new Date().toISOString(),
    });
    return;
  }

  for (const m of data.messages) {
    seenAdsAgentMsgIds.add(m.id);
    lastAdsAgentMsgId = Math.max(lastAdsAgentMsgId, m.id);
    appendAdsMessage({
      role: m.role,
      content: m.content,
      created_at: m.created_at,
      isError: m.content.startsWith("❌"),
    });
  }
  if (adsMessagesEl) adsMessagesEl.scrollTop = adsMessagesEl.scrollHeight;
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
    const res = await fetch("/api/settings/openai", {
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

async function saveGreenApi() {
  const idInstance = greenIdInput.value.trim();
  const apiToken = greenTokenInput.value.trim();
  const baseUrl = greenUrlInput.value.trim();

  if (!idInstance || !apiToken) {
    setFeedback(greenFeedback, "Instance ID et Token sont requis.", "err");
    return null;
  }

  const res = await fetch("/api/settings/greenapi", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idInstance, apiToken, baseUrl }),
  });
  return { res, data: await res.json() };
}

saveGreenBtn.addEventListener("click", async () => {
  saveGreenBtn.disabled = true;
  setFeedback(greenFeedback, "Connexion en cours…");

  try {
    const { res, data } = await saveGreenApi();
    if (!res.ok) {
      setFeedback(greenFeedback, data.error || data.message || "Erreur", "err");
    } else if (data.connected) {
      setFeedback(greenFeedback, "✅ " + (data.message || "WhatsApp connecté !"), "ok");
      greenTokenInput.value = "";
      await refreshStatus();
    } else {
      setFeedback(greenFeedback, "⚠️ " + (data.message || "Configuré mais non autorisé"), "err");
      await refreshStatus();
    }
  } catch (err) {
    setFeedback(greenFeedback, err.message, "err");
  } finally {
    saveGreenBtn.disabled = false;
  }
});

testGreenBtn.addEventListener("click", async () => {
  testGreenBtn.disabled = true;
  setFeedback(greenFeedback, "Test en cours…");

  try {
    // Sauvegarder d'abord si les champs sont remplis
    if (greenIdInput.value.trim() && greenTokenInput.value.trim()) {
      await saveGreenApi();
    }

    const res = await fetch("/api/settings/greenapi/test", { method: "POST" });
    const data = await res.json();

    if (data.connected) {
      setFeedback(greenFeedback, "✅ " + data.message, "ok");
    } else {
      setFeedback(greenFeedback, "⚠️ " + data.message, "err");
    }
    await refreshStatus();
  } catch (err) {
    setFeedback(greenFeedback, err.message, "err");
  } finally {
    testGreenBtn.disabled = false;
  }
});

saveBusinessBtn?.addEventListener("click", async () => {
  saveBusinessBtn.disabled = true;
  setFeedback(businessFeedback, "Enregistrement…");
  try {
    const res = await fetch("/api/settings/business", {
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

async function saveMetaAds() {
  const accessToken = metaTokenInput?.value?.trim() || "";
  const adAccountId = metaAdAccountInput?.value?.trim() || "";
  const pageId = metaPageIdInput?.value?.trim() || "";
  const whatsappNumber = metaWaNumberInput?.value?.trim() || "";

  if (!accessToken || !adAccountId || !pageId) {
    setFeedback(metaFeedback, "Token, Ad Account ID et Page ID sont requis.", "err");
    return null;
  }

  const res = await fetch("/api/settings/meta", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessToken, adAccountId, pageId, whatsappNumber }),
  });
  return { res, data: await res.json() };
}

saveMetaBtn?.addEventListener("click", async () => {
  saveMetaBtn.disabled = true;
  setFeedback(metaFeedback, "Connexion Meta…");
  try {
    const result = await saveMetaAds();
    if (!result) return;
    const { res, data } = result;
    if (!res.ok) {
      setFeedback(metaFeedback, data.error || data.message || "Erreur", "err");
    } else if (data.connected || data.ok) {
      setFeedback(metaFeedback, "✅ " + (data.message || "Meta Ads connecté"), "ok");
      if (metaTokenInput) metaTokenInput.value = "";
      await refreshStatus();
      if (currentView === "ads") await loadAdsReport();
    } else {
      setFeedback(metaFeedback, "⚠️ " + (data.message || "Configuré mais non validé"), "err");
      await refreshStatus();
    }
  } catch (err) {
    setFeedback(metaFeedback, err.message, "err");
  } finally {
    saveMetaBtn.disabled = false;
  }
});

testMetaBtn?.addEventListener("click", async () => {
  testMetaBtn.disabled = true;
  setFeedback(metaFeedback, "Test Meta…");
  try {
    if (metaTokenInput?.value?.trim() && metaAdAccountInput?.value?.trim() && metaPageIdInput?.value?.trim()) {
      await saveMetaAds();
    }
    const res = await fetch("/api/settings/meta/test", { method: "POST" });
    const data = await res.json();
    if (data.connected) {
      setFeedback(metaFeedback, "✅ " + data.message, "ok");
    } else {
      setFeedback(metaFeedback, "⚠️ " + (data.message || "Échec"), "err");
    }
    await refreshStatus();
  } catch (err) {
    setFeedback(metaFeedback, err.message, "err");
  } finally {
    testMetaBtn.disabled = false;
  }
});

refreshAdsReportBtn?.addEventListener("click", () => {
  void loadAdsReport();
});

$$("[data-ads-preset]").forEach((btn) => {
  btn.addEventListener("click", () => {
    adsReportPreset = btn.dataset.adsPreset || "today";
    $$("[data-ads-preset]").forEach((b) => b.classList.toggle("active", b === btn));
    void loadAdsReport();
  });
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

agentMeta?.addEventListener("click", () => {
  showAdsWorkspace();
});

backTeamBtn?.addEventListener("click", () => {
  showTeamView();
});

$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

autoReplyToggle?.addEventListener("change", async () => {
  try {
    await fetch("/api/settings/auto-reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: autoReplyToggle.checked }),
    });
  } catch {
    autoReplyToggle.checked = !autoReplyToggle.checked;
  }
});

clearBtn.addEventListener("click", async () => {
  if (!confirm("Effacer toute la conversation ?")) return;
  if (currentView === "ads") {
    await fetch("/api/ads/history", { method: "DELETE" });
    await loadAdsHistory();
  } else {
    await fetch("/api/history", { method: "DELETE" });
    await loadHistory();
  }
});

$$(".hints li").forEach((li) => {
  li.addEventListener("click", () => {
    const text = li.textContent.replace(/^«|»$/g, "").trim();
    if (li.closest(".ads-hints")) {
      if (!adsInputEl) return;
      adsInputEl.value = text;
      autoResizeAds();
      adsInputEl.focus();
    } else {
      inputEl.value = text;
      autoResize();
      inputEl.focus();
    }
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

adsFormEl?.addEventListener("submit", (e) => {
  e.preventDefault();
  sendAdsMessage(adsInputEl.value);
});

adsInputEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    adsFormEl?.requestSubmit();
  }
});

adsInputEl?.addEventListener("input", autoResizeAds);

function autoResize() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + "px";
}

function autoResizeAds() {
  if (!adsInputEl) return;
  adsInputEl.style.height = "auto";
  adsInputEl.style.height = Math.min(adsInputEl.scrollHeight, 160) + "px";
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!modalOverlay.classList.contains("hidden")) {
      closeModal();
    } else if (currentView === "whatsapp" || currentView === "ads") {
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
    const res = await fetch("/api/whatsapp?since=0");
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

async function bootstrapAdsWorkspace() {
  try {
    await loadAdsHistory();
  } catch {
    appendAdsMessage({
      role: "assistant",
      content: "Interface Meta Ads prête. Configurez Connexions → Meta Ads pour commencer.",
      created_at: new Date().toISOString(),
    });
  }
  await loadAdsReport();
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
    if (currentView === "ads") {
      pollAdsAgentHistory();
    }
  }, 3000);
  setInterval(() => {
    if (currentView === "whatsapp") {
      loadContacts();
      loadDailyBilan();
    }
    if (currentView === "ads") {
      loadAdsReport();
    }
  }, 8000);
}

init();
