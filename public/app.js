/* ── API base (Netlify → Hostinger) ── */
function apiUrl(path) {
  const base = (window.KLANVIO_CONFIG?.apiUrl || "").replace(/\/$/, "");
  return `${base}${path}`;
}

/* ── Markdown rendering ── */
function renderMarkdown(text) {
  if (typeof marked !== "undefined") {
    try {
      const html = marked.parse(text, { breaks: true, gfm: true });
      return typeof DOMPurify !== "undefined" ? DOMPurify.sanitize(html) : html;
    } catch {/* fall through */}
  }
  return escapeHtml(text).replace(/\n/g, "<br>");
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ── DOM shortcuts ── */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const messagesEl     = $("#messages");
const formEl         = $("#chat-form");
const inputEl        = $("#message-input");
const sendBtn        = $("#send-btn");
const filePreviewsEl = $("#file-previews");
const fileInput      = $("#file-input");
const attachBtn      = $("#attach-btn");
const micBtn         = $("#mic-btn");

const openaiStatus   = $("#openai-status");
const whatsappStatus = $("#whatsapp-status");
const openaiDetail   = $("#openai-detail");
const whatsappDetail = $("#whatsapp-detail");
const cardOpenai     = $("#card-openai");
const cardWhatsapp   = $("#card-whatsapp");

const modalOverlay    = $("#modal-overlay");
const connectBtn      = $("#connect-btn");
const modalClose      = $("#modal-close");
const clearBtn        = $("#clear-btn");

const openaiKeyInput  = $("#openai-key");
const saveOpenaiBtn   = $("#save-openai");
const openaiFeedback  = $("#openai-feedback");
const evoUrlInput     = $("#evo-url");
const evoKeyInput     = $("#evo-key");
const evoInstanceInput= $("#evo-instance");
const evoWebhookInput = $("#evo-webhook");
const saveEvoBtn      = $("#save-evolution");
const testEvoBtn      = $("#test-evolution");
const evoShowQrBtn    = $("#evo-show-qr");
const evoQrPanel      = $("#evo-qr-panel");
const evoQrOutput     = $("#evo-qr-output");
const evoFeedback     = $("#evo-feedback");
const autoReplyToggle = $("#auto-reply-toggle");
const contactsListEl  = $("#contacts-list");
const outboundQuotaEl = $("#outbound-quota");
const resetQuotaBtn   = $("#reset-quota-btn");
const dailyBilanEl    = $("#daily-bilan");
const refreshBilanBtn = $("#refresh-bilan");
const businessNameInput  = $("#business-name");
const businessOfferInput = $("#business-offer");
const businessPriceInput = $("#business-price");
const saveBusinessBtn    = $("#save-business");
const businessFeedback   = $("#business-feedback");
const viewTeam      = $("#view-team");
const viewWorkspace = $("#view-workspace");
const backTeamBtn   = $("#back-team-btn");
const agentWhatsapp = $("#agent-whatsapp");
const agentWaDot    = $("#agent-wa-dot");
const agentWaLabel  = $("#agent-wa-label");
const appTitle      = $("#app-title");
const appSubtitle   = $("#app-subtitle");
const statusPills   = $("#status-pills");

/* ── State ── */
let sending = false;
let currentView = "team";
let workspaceReady = false;
let lastIncomingId = 0;
let lastWhatsAppId = 0;
let lastAgentMsgId = 0;
const seenIncomingIds  = new Set();
const seenWhatsAppIds  = new Set();
const seenAgentMsgIds  = new Set();

/* ── File attachment state ── */
let pendingFiles = []; // { id, name, type, data, previewUrl }

/* ── Voice recording state ── */
let mediaRecorder     = null;
let recordingChunks   = [];
let isRecording       = false;
let recordingTimer    = null;
let recordingSeconds  = 0;

const STATUS_LABELS = {
  nouveau:        "Nouveau",
  en_conversation:"En cours",
  interesse:      "Intéressé",
  stop:           "STOP",
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

function fileIcon(type) {
  if (type.startsWith("image/")) return "🖼️";
  if (type.startsWith("video/")) return "🎬";
  if (type.startsWith("audio/")) return "🎵";
  if (type === "application/pdf") return "📄";
  return "📎";
}

function formatBytes(n) {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} Ko`;
  return `${(n / 1024 / 1024).toFixed(1)} Mo`;
}

/* ── Message rendering ── */
function buildMediaHTML(url, type, name) {
  const fullUrl = url.startsWith("http") ? url : apiUrl(url);
  if (type.startsWith("image/")) {
    return `<img src="${escapeHtml(fullUrl)}" alt="${escapeHtml(name)}" class="msg-image" loading="lazy" />`;
  }
  if (type.startsWith("audio/")) {
    return `<audio controls class="msg-audio" src="${escapeHtml(fullUrl)}"></audio>`;
  }
  if (type.startsWith("video/")) {
    return `<video controls class="msg-audio" style="max-width:100%;border-radius:8px;margin-top:0.5rem" src="${escapeHtml(fullUrl)}"></video>`;
  }
  const icon = fileIcon(type);
  return `<a href="${escapeHtml(fullUrl)}" target="_blank" rel="noopener" class="msg-file-link">${icon} ${escapeHtml(name)}</a>`;
}

function appendMessageTo(container, {
  role, content, created_at,
  isError = false,
  isWhatsapp = false,
  isWhatsappOut = false,
  sender = "",
  forceScroll = false,
  attachments = [],
}) {
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

  const metaHtml = `
    <div class="meta">
      <span>${escapeHtml(label)}</span>
      <span>${formatTime(created_at)}</span>
    </div>`;

  const bodyDiv = document.createElement("div");
  bodyDiv.className = "body";

  const isAssistant = role === "assistant" && !isWhatsapp && !isWhatsappOut;
  if (isAssistant) {
    bodyDiv.innerHTML = renderMarkdown(content);
  } else {
    bodyDiv.textContent = content;
  }

  // Render attachments
  let mediaHtml = "";
  for (const att of attachments) {
    mediaHtml += buildMediaHTML(att.url, att.type, att.name);
  }

  div.innerHTML = metaHtml;
  div.appendChild(bodyDiv);
  if (mediaHtml) {
    const mediaWrap = document.createElement("div");
    mediaWrap.innerHTML = mediaHtml;
    div.appendChild(mediaWrap);
  }

  container.appendChild(div);

  const near = forceScroll || role === "user" ||
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

function showTyping(on) { showTypingIn(messagesEl, on, "typing-indicator"); }

function setStatusPill(el, state) { el.className = "status-pill " + state; }
function setConnectionCard(card, state) { card.className = "connection-card " + state; }

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

/* ── Views ── */
function showTeamView() {
  currentView = "team";
  window.currentView = currentView;
  updateStatusPillsVisibility();
  viewTeam?.classList.remove("hidden");
  viewWorkspace?.classList.add("hidden");
  backTeamBtn?.classList.add("hidden");
  clearBtn?.classList.add("hidden");
  if (appTitle) appTitle.textContent = "Agent Team";
  if (appSubtitle) appSubtitle.textContent = "Votre équipe d'agents IA";
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

/* ── Data loading ── */
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
  } catch {/* ignore */}
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

/* ── Polling ── */
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
  } catch {/* ignore */}
}

async function pollAgentHistory() {
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
  } catch {/* ignore */}
}

async function loadHistory() {
  const res = await fetch(apiUrl("/api/history"));
  if (!res.ok) throw new Error("Impossible de charger l'historique");
  const data = await res.json();
  messagesEl.innerHTML = "";

  if (!data.messages.length) {
    appendMessage({
      role: "assistant",
      content: "Bonjour ! Je suis votre agent WhatsApp.\n\n1. Connexions → OpenAI + Evolution API.\n2. Cliquez « Connecter WhatsApp (QR) » pour scanner le QR code.\n3. Ex. : « Liste mes groupes », « Envoie un message à +229… ».",
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
    const health   = await healthRes.json();
    const settings = settingsRes.ok ? await settingsRes.json() : null;

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

    if (health.whatsapp?.connected) {
      setStatusPill(whatsappStatus, "connected");
      whatsappDetail.textContent = health.whatsapp.message || "Connecté";
      setConnectionCard(cardWhatsapp, "connected");
      setAgentWaStatus("connected", "Connecté · prêt");
    } else if (settings?.evolution?.configured) {
      setStatusPill(whatsappStatus, "pending");
      whatsappDetail.textContent = health.whatsapp?.message || "Configuré — en attente";
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

/* ── File attachment ── */
function addPendingFile(file) {
  if (pendingFiles.length >= 6) return;
  const id = Math.random().toString(36).slice(2);
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    const base64 = dataUrl.split(",")[1];
    const entry = { id, name: file.name, type: file.type, data: base64, previewUrl: null };
    if (file.type.startsWith("image/")) entry.previewUrl = dataUrl;
    pendingFiles.push(entry);
    renderFilePreviews();
  };
  reader.readAsDataURL(file);
}

function removePendingFile(id) {
  pendingFiles = pendingFiles.filter((f) => f.id !== id);
  renderFilePreviews();
}

function renderFilePreviews() {
  if (!filePreviewsEl) return;
  if (!pendingFiles.length) {
    filePreviewsEl.classList.add("hidden");
    filePreviewsEl.innerHTML = "";
    return;
  }
  filePreviewsEl.classList.remove("hidden");
  filePreviewsEl.innerHTML = "";
  for (const f of pendingFiles) {
    const chip = document.createElement("div");
    chip.className = "file-preview-chip";

    let mediaHtml;
    if (f.previewUrl) {
      mediaHtml = `<img src="${f.previewUrl}" class="file-preview-thumb" alt="" />`;
    } else {
      const icon = fileIcon(f.type);
      mediaHtml = `<div class="file-preview-icon">${icon}</div>`;
    }

    chip.innerHTML = `
      ${mediaHtml}
      <span class="file-preview-name">${escapeHtml(f.name)}</span>
      <button type="button" class="file-preview-remove" data-id="${f.id}" title="Retirer">×</button>
    `;
    chip.querySelector(".file-preview-remove").addEventListener("click", () => removePendingFile(f.id));
    filePreviewsEl.appendChild(chip);
  }
}

async function uploadFile(file) {
  const res = await fetch(apiUrl("/api/upload"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, type: file.type, data: file.data }),
  });
  if (!res.ok) throw new Error(`Upload échoué: ${file.name}`);
  return res.json(); // { url }
}

/* ── Voice recording ── */
function updateMicButton() {
  if (!micBtn) return;
  micBtn.classList.toggle("recording", isRecording);
  micBtn.title = isRecording ? "Arrêter l'enregistrement" : "Note vocale";
  micBtn.innerHTML = isRecording
    ? `<span class="recording-dot"></span>`
    : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" y1="19" x2="12" y2="23"/>
        <line x1="8" y1="23" x2="16" y2="23"/>
      </svg>`;
}

function updateRecordingHint() {
  let hint = document.querySelector(".recording-hint-el");
  if (isRecording) {
    if (!hint) {
      hint = document.createElement("span");
      hint.className = "recording-label recording-hint-el";
      micBtn.parentNode.insertBefore(hint, micBtn);
    }
    const m = Math.floor(recordingSeconds / 60).toString().padStart(2, "0");
    const s = (recordingSeconds % 60).toString().padStart(2, "0");
    hint.innerHTML = `<span class="recording-dot"></span> ${m}:${s}`;
  } else if (hint) {
    hint.remove();
  }
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";

    mediaRecorder   = new MediaRecorder(stream, { mimeType });
    recordingChunks = [];
    recordingSeconds = 0;

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordingChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(recordingChunks, { type: mimeType });
      const ext  = mimeType.includes("mp4") ? "m4a" : "webm";
      const name = `note-vocale-${Date.now()}.${ext}`;
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = e.target.result.split(",")[1];
        pendingFiles.push({ id: Math.random().toString(36).slice(2), name, type: mimeType, data: base64, previewUrl: null });
        renderFilePreviews();
        formEl.requestSubmit();
      };
      reader.readAsDataURL(blob);
    };

    mediaRecorder.start(250);
    isRecording = true;

    recordingTimer = setInterval(() => {
      recordingSeconds++;
      updateRecordingHint();
      if (recordingSeconds >= 120) stopRecording(); // max 2min
    }, 1000);

    updateMicButton();
    updateRecordingHint();
  } catch (err) {
    alert("Microphone non disponible : " + err.message);
  }
}

function stopRecording() {
  if (!isRecording || !mediaRecorder) return;
  clearInterval(recordingTimer);
  recordingTimer  = null;
  isRecording     = false;
  mediaRecorder.stop();
  mediaRecorder   = null;
  updateMicButton();
  updateRecordingHint();
}

micBtn?.addEventListener("click", () => {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
});

/* ── File input ── */
attachBtn?.addEventListener("click", () => fileInput?.click());

fileInput?.addEventListener("change", () => {
  for (const file of fileInput.files ?? []) addPendingFile(file);
  fileInput.value = "";
});

/* ── Send message ── */
async function sendMessage(text) {
  const hasFiles = pendingFiles.length > 0;
  if (sending || (!text.trim() && !hasFiles)) return;

  sending = true;
  sendBtn.disabled = true;

  // Optimistic display of user bubble
  const filesToSend = [...pendingFiles];
  pendingFiles = [];
  renderFilePreviews();

  const localAttachments = filesToSend.map((f) => ({
    name: f.name,
    type: f.type,
    url: f.previewUrl || "",
  }));

  appendMessage({
    role: "user",
    content: text,
    created_at: new Date().toISOString(),
    forceScroll: true,
    attachments: localAttachments,
  });

  inputEl.value = "";
  autoResize();
  showTyping(true);

  try {
    // Upload all files first
    const uploaded = [];
    for (const f of filesToSend) {
      try {
        const { url } = await uploadFile(f);
        uploaded.push({ name: f.name, type: f.type, url });
      } catch {
        uploaded.push({ name: f.name, type: f.type, url: "" });
      }
    }

    // Build message: text + file references
    let finalMessage = text.trim();
    for (const u of uploaded) {
      if (!u.url) continue;
      const fullUrl = apiUrl(u.url);
      if (u.type.startsWith("image/")) {
        finalMessage += (finalMessage ? "\n" : "") + `[Image jointe: ${u.name}] ${fullUrl}`;
      } else if (u.type.startsWith("audio/")) {
        finalMessage += (finalMessage ? "\n" : "") + `[Note vocale: ${u.name}] ${fullUrl}`;
      } else if (u.type.startsWith("video/")) {
        finalMessage += (finalMessage ? "\n" : "") + `[Vidéo jointe: ${u.name}] ${fullUrl}`;
      } else {
        finalMessage += (finalMessage ? "\n" : "") + `[Fichier joint: ${u.name}] ${fullUrl}`;
      }
    }

    if (!finalMessage.trim()) {
      showTyping(false);
      return;
    }

    const res = await fetch(apiUrl("/api/chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: finalMessage }),
    });

    const data = await res.json();
    showTyping(false);

    if (data.id) {
      seenAgentMsgIds.add(data.id);
      lastAgentMsgId = Math.max(lastAgentMsgId, data.id);
    } else {
      try {
        const hist = await fetch(apiUrl("/api/history"));
        if (hist.ok) {
          const h = await hist.json();
          for (const m of h.messages ?? []) {
            seenAgentMsgIds.add(m.id);
            lastAgentMsgId = Math.max(lastAgentMsgId, m.id);
          }
        }
      } catch {/* ignore */}
    }

    // Re-render user bubble with real uploaded URLs
    if (uploaded.length > 0 && localAttachments.some((a) => !a.url)) {
      const lastUserMsg = messagesEl.querySelectorAll(".msg.user");
      if (lastUserMsg.length) {
        const last = lastUserMsg[lastUserMsg.length - 1];
        const mediaWrap = last.querySelector("div:last-child");
        if (mediaWrap && mediaWrap !== last.querySelector(".body")) {
          mediaWrap.innerHTML = uploaded.map((u) => u.url ? buildMediaHTML(u.url, u.type, u.name) : "").join("");
        }
      }
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

function closeModal() { modalOverlay.classList.add("hidden"); }

function switchTab(name) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $$(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${name}`));
}

/* ── Settings handlers ── */
saveOpenaiBtn.addEventListener("click", async () => {
  const apiKey = openaiKeyInput.value.trim();
  if (!apiKey) { setFeedback(openaiFeedback, "Entrez votre clé API OpenAI.", "err"); return; }
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
  const apiKey  = evoKeyInput.value.trim();
  const instanceName = evoInstanceInput.value.trim();
  const webhookUrl   = evoWebhookInput?.value?.trim() || "";
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
      setFeedback(evoFeedback, "Config enregistrée. Cliquez « Connecter WhatsApp (QR) ».", "ok");
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
    if (evoKeyInput.value.trim() && evoInstanceInput.value.trim()) await saveEvolutionApi();
    const res  = await fetch(apiUrl("/api/settings/evolution/test"), { method: "POST" });
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
    if (evoKeyInput.value.trim() && evoInstanceInput.value.trim()) await saveEvolutionApi();
    const res  = await fetch(apiUrl("/api/evolution/instance/qr"));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Impossible d'obtenir le QR code");
    if (window.WhatsAppConsole?.renderQrPanel) window.WhatsAppConsole.renderQrPanel(evoQrOutput, data);
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
        offer:     businessOfferInput?.value?.trim() || "",
        price:     businessPriceInput?.value?.trim() || "",
      }),
    });
    const data = await res.json();
    if (!res.ok) { setFeedback(businessFeedback, data.error || "Erreur", "err"); }
    else         { setFeedback(businessFeedback, "✅ Profil enregistré", "ok"); }
  } catch (err) {
    setFeedback(businessFeedback, err.message, "err");
  } finally {
    saveBusinessBtn.disabled = false;
  }
});

refreshBilanBtn?.addEventListener("click", () => void loadDailyBilan());

/* ── UI Events ── */
connectBtn.addEventListener("click", () => openModal("openai"));
modalClose.addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (e) => { if (e.target === modalOverlay) closeModal(); });

agentWhatsapp?.addEventListener("click", () => { showWhatsAppWorkspace(); });
backTeamBtn?.addEventListener("click", () => { showTeamView(); });

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
  } catch { autoReplyToggle.checked = !autoReplyToggle.checked; }
});

resetQuotaBtn?.addEventListener("click", async () => {
  if (!confirm("Débloquer les envois pour aujourd'hui ?")) return;
  resetQuotaBtn.disabled = true;
  try {
    const res  = await fetch(apiUrl("/api/settings/outbound-quota"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset", extra: 20 }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur");
    if (outboundQuotaEl && data.outbound) {
      const { today, limit, bonus } = data.outbound;
      outboundQuotaEl.textContent = bonus > 0 ? `${today}/${limit} (+${bonus} bonus)` : `${today}/${limit}`;
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
    const text = li.textContent.replace(/^«\s*/, "").replace(/\s*»$/, "").trim();
    inputEl.value = text;
    autoResize();
    inputEl.focus();
  });
});

formEl.addEventListener("submit", (e) => {
  e.preventDefault();
  if (isRecording) { stopRecording(); return; }
  sendMessage(inputEl.value);
});

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    formEl.requestSubmit();
  }
});

inputEl.addEventListener("input", autoResize);

// Paste files into composer
inputEl.addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files ?? [])];
  if (files.length) {
    e.preventDefault();
    files.forEach(addPendingFile);
  }
});

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

/* ── Bootstrap ── */
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

  try {
    const res = await fetch(apiUrl("/api/whatsapp?since=0"));
    if (res.ok) {
      const data = await res.json();
      for (const m of data.messages ?? []) {
        seenWhatsAppIds.add(m.id);
        lastWhatsAppId = Math.max(lastWhatsAppId, m.id);
      }
    }
  } catch {/* ignore */}

  scrollToBottom(true);
  await loadContacts();
  await loadDailyBilan();
}

async function init() {
  showTeamView();
  try { await refreshStatus(); } catch {/* serveur peut être lent */}

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
