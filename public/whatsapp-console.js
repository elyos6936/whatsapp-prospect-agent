/* Console WhatsApp — Evolution API */
(function () {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  let inboxSource = "local";
  let inboxTodayOnly = false;
  let consoleReady = false;

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function fmtTime(isoOrTs) {
    if (!isoOrTs) return "—";
    if (typeof isoOrTs === "number") {
      return new Date(isoOrTs * 1000).toLocaleString("fr-FR");
    }
    const d = new Date(isoOrTs.includes("T") ? isoOrTs : isoOrTs.replace(" ", "T"));
    return Number.isNaN(d.getTime()) ? String(isoOrTs) : d.toLocaleString("fr-FR");
  }

  function setFeedback(el, text, type = "") {
    if (!el) return;
    el.textContent = text;
    el.className = "form-feedback" + (type ? ` ${type}` : "");
  }

  async function api(path, opts = {}) {
    const base = (window.KLANVIO_CONFIG?.apiUrl || "").replace(/\/$/, "");
    const url = `${base}${path}`;
    const res = await fetch(url, {
      method: opts.method || "GET",
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || res.statusText);
    return data;
  }

  function renderQrPanel(container, data) {
    if (!container) return;
    if (data.connected) {
      container.innerHTML = `<p class="form-feedback ok">${esc(data.message || "WhatsApp connecté.")}</p>`;
      return;
    }
    const b64 = data.base64 || "";
    const pairing = data.pairingCode || "";
    container.innerHTML = `
      ${b64 ? `<img class="gapi-qr" src="data:image/png;base64,${esc(b64)}" alt="QR WhatsApp" />` : ""}
      ${pairing ? `<p class="toggle-hint">Code d'appairage : <strong>${esc(pairing)}</strong></p>` : ""}
      <p class="toggle-hint">${esc(data.message || "Scannez le QR avec WhatsApp → Appareils connectés.")}</p>`;
  }

  async function loadQr(into) {
    const out = into || $("#gapi-instance-output");
    if (out) out.innerHTML = '<p class="contacts-empty">Chargement du QR…</p>';
    try {
      const data = await api("/api/evolution/instance/qr");
      renderQrPanel(out, data);
      return data;
    } catch (err) {
      if (out) out.innerHTML = `<p class="contacts-empty">${esc(err.message)}</p>`;
      throw err;
    }
  }

  function switchWaMode(mode) {
    const agent = $("#wa-agent-layout");
    const consoleEl = $("#wa-console-layout");
    const automationEl = $("#wa-automation-layout");
    $$(".wa-mode-btn").forEach((b) => b.classList.toggle("active", b.dataset.waMode === mode));

    agent?.classList.add("hidden");
    consoleEl?.classList.add("hidden");
    automationEl?.classList.add("hidden");
    $("#clear-btn")?.classList.add("hidden");

    if (mode === "console") {
      consoleEl?.classList.remove("hidden");
      void initConsole();
    } else if (mode === "automation") {
      automationEl?.classList.remove("hidden");
      window.AutomationsUI?.load?.();
    } else {
      agent?.classList.remove("hidden");
      if (window.currentView === "whatsapp") $("#clear-btn")?.classList.remove("hidden");
    }
  }

  function switchGapiTab(tab) {
    $$(".gapi-tab").forEach((t) => t.classList.toggle("active", t.dataset.gapiTab === tab));
    $$(".gapi-panel").forEach((p) => {
      const on = p.id === `gapi-panel-${tab}`;
      p.classList.toggle("hidden", !on);
      p.classList.toggle("active", on);
    });
    if (tab === "overview") void loadDashboard();
    if (tab === "inbox") void loadInbox();
    if (tab === "chats") void loadChats();
    if (tab === "contacts") void loadContacts();
    if (tab === "groups") void loadGroups();
    if (tab === "instance") void loadQr();
  }

  async function loadDashboard() {
    const el = $("#gapi-dashboard");
    if (!el) return;
    try {
      const d = await api("/api/evolution/dashboard");
      const s = d.stats || {};
      const poll = d.poll || {};
      el.innerHTML = `
        <div class="gapi-kpi-grid">
          <div class="gapi-kpi"><span>État instance</span><strong>${esc(d.instance?.state || "?")}</strong><small>${esc(d.instance?.message || "")}</small></div>
          <div class="gapi-kpi"><span>Messages reçus</span><strong>${s.totalIncoming ?? 0}</strong><small>${s.incomingToday ?? 0} aujourd'hui</small></div>
          <div class="gapi-kpi"><span>Messages envoyés</span><strong>${s.totalOutgoing ?? 0}</strong><small>${s.outboundToday ?? 0}/${s.outboundLimit ?? 30} quota jour</small></div>
          <div class="gapi-kpi"><span>Chats / contacts</span><strong>${s.chatsCount ?? 0}</strong><small>${s.contactsCount ?? 0} contacts · ${s.groupsCount ?? 0} groupes</small></div>
          <div class="gapi-kpi"><span>Sync Evolution</span><strong>${poll.authorized ? "OK" : "Hors ligne"}</strong><small>${poll.lastIncomingAt ? "Dernier entrant " + fmtTime(poll.lastIncomingAt) : "—"}</small></div>
        </div>`;
    } catch (err) {
      el.innerHTML = `<p class="contacts-empty">${esc(err.message)}</p>`;
    }
  }

  function renderInboxMessages(messages, source) {
    const el = $("#gapi-inbox-list");
    if (!el) return;
    if (!messages?.length) {
      el.innerHTML = '<p class="contacts-empty">Aucun message reçu.</p>';
      return;
    }
    el.innerHTML = messages
      .map((m) => {
        const phone = m.contact_phone || m.chatId || "";
        const display = m.display || (phone.endsWith("@c.us") ? "+" + phone.replace("@c.us", "") : phone);
        const body = m.body || m.text || "";
        const time = m.created_at || m.timestamp;
        const id = m.green_api_id || m.idMessage || m.id || "";
        return `<article class="gapi-row">
          <div class="gapi-row-top"><strong>${esc(display)}</strong><span>${esc(fmtTime(time))}</span></div>
          <div class="gapi-row-meta">${esc(m.sender_name || m.senderName || "")} · ${esc(source)} · ${esc(id)}</div>
          <div class="gapi-row-body">${esc(body)}</div>
          ${phone ? `<div class="gapi-row-actions"><button type="button" class="btn btn-ghost btn-sm gapi-read-btn" data-chat="${esc(phone)}">Marquer lu</button></div>` : ""}
        </article>`;
      })
      .join("");
  }

  async function loadInbox() {
    try {
      if (inboxSource === "live") {
        const data = await api("/api/evolution/inbox/live");
        renderInboxMessages(data.messages, "Evolution");
      } else {
        const q = inboxTodayOnly ? "?today=1&limit=200" : "?limit=200";
        const data = await api(`/api/evolution/inbox/local${q}`);
        const msgs = (data.messages || []).map((m) => ({
          ...m,
          display: m.contact_phone?.endsWith("@c.us") ? "+" + m.contact_phone.replace("@c.us", "") : m.contact_phone,
        }));
        renderInboxMessages(msgs, "SQLite");
      }
    } catch (err) {
      const el = $("#gapi-inbox-list");
      if (el) el.innerHTML = `<p class="contacts-empty">${esc(err.message)}</p>`;
    }
  }

  async function loadChats() {
    const list = $("#gapi-chats-list");
    if (!list) return;
    try {
      const data = await api("/api/evolution/chats?count=150");
      const chats = data.chats || [];
      if (!chats.length) {
        list.innerHTML = '<p class="contacts-empty">Aucun chat.</p>';
        return;
      }
      list.innerHTML = chats
        .map(
          (c) => `<button type="button" class="gapi-list-item gapi-chat-pick" data-id="${esc(c.id)}" data-name="${esc(c.name || c.id)}">
            <strong>${esc(c.name || c.id)}</strong>
            <span>${esc(c.type || "")}${c.archive ? " · archivé" : ""}</span>
          </button>`
        )
        .join("");
    } catch (err) {
      list.innerHTML = `<p class="contacts-empty">${esc(err.message)}</p>`;
    }
  }

  async function openChatHistory(chatId, name) {
    const detail = $("#gapi-chat-detail");
    if (!detail) return;
    detail.innerHTML = '<p class="contacts-empty">Chargement…</p>';
    try {
      const data = await api(`/api/evolution/chat-history?chatId=${encodeURIComponent(chatId)}&count=60`);
      const rows = (data.messages || [])
        .map(
          (m) => `<div class="gapi-msg ${m.type}">
            <div class="gapi-msg-meta">${esc(m.type === "incoming" ? "←" : "→")} ${esc(m.senderName || "")} · ${esc(fmtTime(m.timestamp))}</div>
            <div>${esc(m.text)}</div>
          </div>`
        )
        .join("");
      detail.innerHTML = `
        <div class="gapi-detail-head">
          <h3>${esc(name || chatId)}</h3>
          <div class="gapi-toolbar-actions">
            <button type="button" class="btn btn-secondary btn-sm gapi-read-btn" data-chat="${esc(chatId)}">Marquer tout lu</button>
            <button type="button" class="btn btn-primary btn-sm gapi-use-chat" data-chat="${esc(chatId)}">Utiliser pour envoi</button>
          </div>
        </div>
        <div class="gapi-thread">${rows || '<p class="contacts-empty">Historique vide.</p>'}</div>`;
    } catch (err) {
      detail.innerHTML = `<p class="contacts-empty">${esc(err.message)}</p>`;
    }
  }

  async function loadContacts() {
    const el = $("#gapi-contacts-list");
    if (!el) return;
    try {
      const data = await api("/api/evolution/contacts?count=200");
      const contacts = data.contacts || [];
      if (!contacts.length) {
        el.innerHTML = '<p class="contacts-empty">Aucun contact.</p>';
        return;
      }
      el.innerHTML = contacts
        .map(
          (c) => `<div class="gapi-row">
            <div class="gapi-row-top"><strong>${esc(c.name || c.id)}</strong><button type="button" class="btn btn-ghost btn-sm gapi-use-chat" data-chat="${esc(c.id)}">Envoyer</button></div>
            <div class="gapi-row-meta">${esc(c.id)}</div>
          </div>`
        )
        .join("");
    } catch (err) {
      el.innerHTML = `<p class="contacts-empty">${esc(err.message)}</p>`;
    }
  }

  async function loadGroups() {
    const list = $("#gapi-groups-list");
    if (!list) return;
    try {
      const data = await api("/api/evolution/groups");
      const groups = data.groups || [];
      if (!groups.length) {
        list.innerHTML = '<p class="contacts-empty">Aucun groupe.</p>';
        return;
      }
      list.innerHTML = groups
        .map(
          (g) => `<button type="button" class="gapi-list-item gapi-group-pick" data-id="${esc(g.id)}" data-name="${esc(g.name)}">
            <strong>${esc(g.name)}</strong><span>${esc(g.id)}</span>
          </button>`
        )
        .join("");
    } catch (err) {
      list.innerHTML = `<p class="contacts-empty">${esc(err.message)}</p>`;
    }
  }

  async function openGroupDetail(groupId, name) {
    const detail = $("#gapi-group-detail");
    if (!detail) return;
    detail.innerHTML = '<p class="contacts-empty">Chargement…</p>';
    try {
      const data = await api(`/api/evolution/groups/members?groupId=${encodeURIComponent(groupId)}`);
      const g = data.group || {};
      const members = (g.participants || [])
        .map((p) => `<li>${esc(p.name || p.id)}${p.isAdmin ? " (admin)" : ""}</li>`)
        .join("");
      detail.innerHTML = `
        <div class="gapi-detail-head"><h3>${esc(name || g.subject || groupId)}</h3><span>${g.size ?? "?"} membres</span></div>
        <ul class="gapi-members">${members || "<li>Aucun membre listé</li>"}</ul>
        <button type="button" class="btn btn-primary btn-sm gapi-use-chat" data-chat="${esc(groupId)}">Envoyer au groupe</button>`;
    } catch (err) {
      detail.innerHTML = `<p class="contacts-empty">${esc(err.message)}</p>`;
    }
  }

  async function markRead(chatId) {
    await api("/api/evolution/read-chat", { method: "POST", body: { chatId } });
    alert("Chat marqué comme lu.");
  }

  async function initConsole() {
    if (consoleReady) {
      const active = document.querySelector(".gapi-tab.active")?.dataset.gapiTab;
      if (active) switchGapiTab(active);
      return;
    }
    consoleReady = true;
    switchGapiTab("overview");
  }

  $$(".wa-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchWaMode(btn.dataset.waMode || "agent"));
  });

  $$(".gapi-tab").forEach((tab) => {
    tab.addEventListener("click", () => switchGapiTab(tab.dataset.gapiTab || "overview"));
  });

  $("#gapi-refresh-dashboard")?.addEventListener("click", () => void loadDashboard());

  $$(".gapi-inbox-src").forEach((btn) => {
    btn.addEventListener("click", () => {
      inboxSource = btn.dataset.inboxSrc || "local";
      $$(".gapi-inbox-src").forEach((b) => b.classList.toggle("active", b === btn));
      void loadInbox();
    });
  });
  $("#gapi-inbox-today")?.addEventListener("click", () => {
    inboxTodayOnly = !inboxTodayOnly;
    $("#gapi-inbox-today")?.classList.toggle("active", inboxTodayOnly);
    void loadInbox();
  });
  $("#gapi-inbox-refresh")?.addEventListener("click", () => void loadInbox());

  $("#gapi-chats-refresh")?.addEventListener("click", () => void loadChats());
  $("#gapi-contacts-refresh")?.addEventListener("click", () => void loadContacts());
  $("#gapi-groups-refresh")?.addEventListener("click", () => void loadGroups());

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    const chatPick = t.closest(".gapi-chat-pick");
    if (chatPick) {
      void openChatHistory(chatPick.getAttribute("data-id") || "", chatPick.getAttribute("data-name") || "");
      return;
    }
    const groupPick = t.closest(".gapi-group-pick");
    if (groupPick) {
      void openGroupDetail(groupPick.getAttribute("data-id") || "", groupPick.getAttribute("data-name") || "");
      return;
    }
    const readBtn = t.closest(".gapi-read-btn");
    if (readBtn) {
      const chat = readBtn.getAttribute("data-chat");
      if (chat) void markRead(chat);
      return;
    }
    const useChat = t.closest(".gapi-use-chat");
    if (useChat) {
      const chat = useChat.getAttribute("data-chat") || "";
      const input = $("#gapi-send-chatid");
      if (input) input.value = chat;
      switchGapiTab("send");
    }
  });

  $("#gapi-status-send")?.addEventListener("click", async () => {
    const fb = $("#gapi-status-feedback");
    const message = $("#gapi-status-text")?.value?.trim();
    const backgroundColor = $("#gapi-status-color")?.value?.trim() || "#228B22";
    if (!message) {
      setFeedback(fb, "Message requis.", "err");
      return;
    }
    try {
      const data = await api("/api/evolution/send-status", {
        method: "POST",
        body: { message, backgroundColor, font: "SERIF" },
      });
      setFeedback(fb, `Statut publié · ${data.audienceCount ?? ""} contact(s)`, "ok");
    } catch (err) {
      setFeedback(fb, err.message, "err");
    }
  });

  $("#gapi-send-btn")?.addEventListener("click", async () => {
    const fb = $("#gapi-send-feedback");
    const chatId = $("#gapi-send-chatid")?.value?.trim();
    const message = $("#gapi-send-message")?.value?.trim();
    if (!chatId || !message) {
      setFeedback(fb, "Chat ID et message requis.", "err");
      return;
    }
    try {
      const data = await api("/api/evolution/send-message", {
        method: "POST",
        body: { chatId, message },
      });
      setFeedback(fb, "Envoyé · " + (data.idMessage || ""), "ok");
      $("#gapi-send-message").value = "";
    } catch (err) {
      setFeedback(fb, err.message, "err");
    }
  });

  $("#gapi-load-qr")?.addEventListener("click", () => void loadQr());
  $("#gapi-reboot")?.addEventListener("click", async () => {
    if (!confirm("Redémarrer l'instance Evolution API ?")) return;
    const out = $("#gapi-instance-output");
    try {
      const data = await api("/api/evolution/instance/restart", { method: "POST" });
      if (out) out.innerHTML = `<pre class="gapi-json-preview">${esc(JSON.stringify(data.result, null, 2))}</pre>`;
    } catch (err) {
      if (out) out.innerHTML = `<p class="contacts-empty">${esc(err.message)}</p>`;
    }
  });

  window.WhatsAppConsole = { switchWaMode, initConsole, loadQr, renderQrPanel };
})();
