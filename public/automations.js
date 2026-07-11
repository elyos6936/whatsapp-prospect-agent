/* Page Automatisations WhatsApp */
(function () {
  const $ = (sel) => document.querySelector(sel);

  const TYPE_LABELS = {
    group_prospect: "Prospection groupe",
    keyword_sales: "Vente sur mots-clés",
    custom_followup: "Suivi personnalisé",
  };

  const STATUS_LABELS = {
    active: "Active",
    paused: "En pause",
    completed: "Terminée",
    failed: "Échouée",
  };

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function fmtTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T"));
    return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString("fr-FR");
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
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  function statCard(label, value, hint = "") {
    return `<div class="auto-stat"><span class="auto-stat-label">${esc(label)}</span><strong class="auto-stat-value">${esc(String(value))}</strong>${hint ? `<span class="auto-stat-hint">${esc(hint)}</span>` : ""}</div>`;
  }

  function switchAutoTab(tab) {
    $$(".auto-tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.autoTab === tab));
    $("#auto-panel-list")?.classList.toggle("hidden", tab !== "list");
    $("#auto-panel-roi")?.classList.toggle("hidden", tab !== "roi");
    $("#auto-panel-handoffs")?.classList.toggle("hidden", tab !== "handoffs");
    if (tab === "roi") void loadRoi();
    if (tab === "handoffs") void loadHandoffs();
  }

  async function loadRoi() {
    const el = $("#auto-roi-content");
    if (!el) return;
    try {
      const data = await api("/api/roi/dashboard");
      const t = data.totals || {};
      el.innerHTML = `
        <div class="auto-stats-grid">
          ${statCard("Contactés", t.contacted ?? 0)}
          ${statCard("Réponses", t.replied ?? 0)}
          ${statCard("Intéressés", t.interested ?? 0)}
          ${statCard("Conversions", t.conversions ?? 0)}
          ${statCard("Revenus", `${t.revenueFcfa ?? 0} FCFA`)}
          ${statCard("Budget", `${t.budgetFcfa ?? 0} FCFA`)}
          ${statCard("Leads chauds", t.hotLeads ?? 0)}
          ${statCard("Msgs sortants/jour", t.messagesToday ?? 0)}
        </div>
        <section class="auto-section"><h3>Par campagne</h3>
          ${(data.automations || []).map((a) => `
            <div class="auto-card" style="cursor:default">
              <h4>${esc(a.name)}</h4>
              <p>ROI: ${a.roiPercent != null ? a.roiPercent + "%" : "—"} · Coût/réponse: ${a.costPerReply != null ? a.costPerReply + " FCFA" : "—"}</p>
            </div>`).join("") || "<p class='contacts-empty'>Aucune campagne.</p>"}
        </section>
        ${data.abSummary?.length ? `<section class="auto-section"><h3>A/B Testing</h3><pre class="auto-pre">${esc(JSON.stringify(data.abSummary, null, 2))}</pre></section>` : ""}
      `;
    } catch (err) {
      el.innerHTML = `<p class="contacts-empty error">${esc(err.message)}</p>`;
    }
  }

  async function loadHandoffs() {
    const el = $("#auto-handoffs-content");
    if (!el) return;
    try {
      const data = await api("/api/handoffs");
      const list = data.handoffs || [];
      if (!list.length) {
        el.innerHTML = "<p class='contacts-empty'>Aucun handoff en attente. L'IA vous alertera quand un humain doit reprendre.</p>";
        return;
      }
      el.innerHTML = list.map((h) => `
        <article class="auto-card" style="cursor:default">
          <h4>${esc(h.contact_name || h.contact_phone)}</h4>
          <p><strong>${esc(h.reason)}</strong></p>
          <p class="toggle-hint">${esc(h.summary || "")}</p>
          ${h.suggested_reply ? `<pre class="auto-pre">${esc(h.suggested_reply)}</pre>` : ""}
          <div class="auto-card-actions">
            <button type="button" class="btn btn-primary btn-sm handoff-resolve" data-id="${h.id}" data-status="resolved">Traité</button>
            <button type="button" class="btn btn-ghost btn-sm handoff-resolve" data-id="${h.id}" data-status="dismissed">Ignorer</button>
          </div>
        </article>
      `).join("");
      el.querySelectorAll(".handoff-resolve").forEach((btn) => {
        btn.addEventListener("click", async () => {
          await api(`/api/handoffs/${btn.dataset.id}`, {
            method: "PATCH",
            body: { status: btn.dataset.status },
          });
          void loadHandoffs();
        });
      });
    } catch (err) {
      el.innerHTML = `<p class="contacts-empty error">${esc(err.message)}</p>`;
    }
  }

  function needsMemberReload(a) {
    if (a.type !== "group_prospect") return false;
    const contacted = a.stats?.contacted ?? 0;
    const pending = a.stats?.pending ?? 0;
    return a.status === "failed" || (contacted === 0 && pending === 0);
  }

  async function reloadMembers(id, onDone) {
    if (!confirm("Recharger les membres du groupe depuis Evolution API ? WhatsApp doit être connecté (état open).")) {
      return;
    }
    try {
      const data = await api(`/api/automations/${id}/reload-members`, { method: "POST" });
      alert(`${data.targetsAdded ?? 0} membre(s) ajouté(s). La campagne est réactivée.`);
      if (onDone) await onDone();
      else await loadAutomations();
    } catch (err) {
      alert(err.message || "Échec du rechargement.");
    }
  }

  function reloadButtonHtml(id) {
    return `<button type="button" class="btn btn-primary btn-sm auto-reload-btn" data-id="${id}">Recharger les membres</button>`;
  }

  function bindReloadButtons(scope, onDone) {
    scope?.querySelectorAll(".auto-reload-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await reloadMembers(Number(btn.dataset.id), onDone);
      });
    });
  }

  const $$ = (sel) => document.querySelectorAll(sel);

  function renderList(automations) {
    const listEl = $("#auto-list");
    const detailEl = $("#auto-detail");
    if (!listEl) return;

    detailEl?.classList.add("hidden");
    listEl.classList.remove("hidden");

    if (!automations.length) {
      listEl.innerHTML =
        '<p class="contacts-empty">Aucune automatisation. Demandez à l\'agent IA de lancer une campagne (ex. prospecter un groupe, vendre un produit sur mots-clés).</p>';
      return;
    }

    listEl.innerHTML = automations
      .map((a) => {
        const stats = a.stats || {};
        const contacted = stats.contacted ?? 0;
        const pending = stats.pending ?? 0;
        const replied = stats.replied ?? 0;
        const handled = stats.messagesHandled ?? 0;
        const progress =
          a.type === "group_prospect"
            ? `${contacted} contacté(s) · ${pending} restant(s) · ${replied} réponse(s)`
            : `${handled} message(s) traité(s)`;

        return `<article class="auto-card" data-auto-id="${a.id}">
          <div class="auto-card-head">
            <div>
              <h3>${esc(a.name)}</h3>
              <span class="auto-type">${esc(TYPE_LABELS[a.type] || a.type)}</span>
            </div>
            <span class="auto-status auto-status-${a.status}">${esc(STATUS_LABELS[a.status] || a.status)}</span>
          </div>
          <p class="auto-summary">${esc(a.summary || "—")}</p>
          <p class="auto-progress">${esc(progress)}</p>
          <div class="auto-card-actions">
            <button type="button" class="btn btn-secondary btn-sm auto-view-btn" data-id="${a.id}">Voir le détail</button>
            ${
              needsMemberReload(a)
                ? reloadButtonHtml(a.id)
                : a.status === "active"
                  ? `<button type="button" class="btn btn-ghost btn-sm auto-toggle-btn" data-id="${a.id}" data-status="paused">Désactiver</button>`
                  : a.status === "paused"
                    ? `<button type="button" class="btn btn-primary btn-sm auto-toggle-btn" data-id="${a.id}" data-status="active">Réactiver</button>`
                    : ""
            }
          </div>
        </article>`;
      })
      .join("");

    listEl.querySelectorAll(".auto-view-btn, .auto-card").forEach((el) => {
      el.addEventListener("click", (e) => {
        const btn = e.target.closest(".auto-view-btn, .auto-card");
        if (!btn || e.target.closest(".auto-toggle-btn, .auto-reload-btn")) return;
        const id = btn.dataset.id || btn.dataset.autoId;
        if (id) void showDetail(Number(id));
      });
    });

    listEl.querySelectorAll(".auto-toggle-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const id = Number(btn.dataset.id);
        const status = btn.dataset.status;
        try {
          await api(`/api/automations/${id}`, { method: "PATCH", body: { status } });
          await loadAutomations();
        } catch (err) {
          alert(err.message || "Erreur");
        }
      });
    });

    bindReloadButtons(listEl);
  }

  async function showDetail(id) {
    const listEl = $("#auto-list");
    const detailEl = $("#auto-detail");
    const contentEl = $("#auto-detail-content");
    if (!detailEl || !contentEl) return;

    contentEl.innerHTML = '<p class="contacts-empty">Chargement…</p>';
    listEl?.classList.add("hidden");
    detailEl.classList.remove("hidden");

    try {
      const data = await api(`/api/automations/${id}`);
      const a = data.automation;
      const stats = a.stats || {};
      const targets = data.targets || [];
      const logs = data.logs || [];

      const contacted = stats.contacted ?? targets.filter((t) => t.status === "contacted").length;
      const pending = stats.pending ?? targets.filter((t) => t.status === "pending").length;
      const replied = stats.replied ?? targets.filter((t) => t.status === "replied").length;
      const interested = stats.interested ?? 0;
      const errors = stats.errors ?? 0;
      const handled = stats.messagesHandled ?? 0;

      contentEl.innerHTML = `
        <header class="auto-detail-head">
          <div>
            <h2>${esc(a.name)}</h2>
            <p class="auto-detail-meta">${esc(TYPE_LABELS[a.type] || a.type)} · Créée le ${fmtTime(a.created_at)}</p>
          </div>
          <span class="auto-status auto-status-${a.status}">${esc(STATUS_LABELS[a.status] || a.status)}</span>
        </header>

        <p class="auto-detail-summary">${esc(a.summary || "—")}</p>

        <div class="auto-stats-grid">
          ${
            a.type === "group_prospect"
              ? [
                  statCard("Contactés", contacted),
                  statCard("Restants", pending),
                  statCard("Réponses", replied),
                  statCard("Intéressés", interested),
                  statCard("Erreurs", errors),
                ].join("")
              : [
                  statCard("Messages traités", handled),
                  statCard("Budget", `${a.budget_fcfa || 0} FCFA`),
                ].join("")
          }
        </div>

        ${
          stats.report
            ? `<section class="auto-section"><h3>Rapport</h3><p>${esc(stats.report)}</p></section>`
            : ""
        }

        ${
          a.config?.conversationGuide || a.config?.salesScript
            ? `<section class="auto-section"><h3>Instructions agent</h3><pre class="auto-pre">${esc(a.config.conversationGuide || a.config.salesScript || "")}</pre></section>`
            : ""
        }

        ${
          targets.length
            ? `<section class="auto-section"><h3>Cibles (${targets.length})</h3><div class="auto-targets">${targets
                .slice(0, 30)
                .map(
                  (t) =>
                    `<div class="auto-target"><span>${esc(t.target_label || t.target_id)}</span><span class="auto-target-status">${esc(t.status)}</span></div>`
                )
                .join("")}${targets.length > 30 ? `<p class="toggle-hint">… et ${targets.length - 30} autre(s)</p>` : ""}</div></section>`
            : ""
        }

        <section class="auto-section">
          <h3>Journal récent</h3>
          <div class="auto-logs">
            ${
              logs.length
                ? logs
                    .map(
                      (l) =>
                        `<div class="auto-log auto-log-${l.level}"><span class="auto-log-time">${fmtTime(l.created_at)}</span><span>${esc(l.message)}</span></div>`
                    )
                    .join("")
                : '<p class="contacts-empty">Aucun événement.</p>'
            }
          </div>
        </section>

        <div class="auto-detail-actions">
          ${needsMemberReload(a) ? reloadButtonHtml(a.id) : ""}
          ${
            a.status === "active"
              ? `<button type="button" class="btn btn-secondary auto-toggle-btn" data-id="${a.id}" data-status="paused">Désactiver l'automatisation</button>`
              : a.status === "paused"
                ? `<button type="button" class="btn btn-primary auto-toggle-btn" data-id="${a.id}" data-status="active">Réactiver l'automatisation</button>`
                : ""
          }
        </div>
      `;

      contentEl.querySelectorAll(".auto-toggle-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const autoId = Number(btn.dataset.id);
          const status = btn.dataset.status;
          try {
            await api(`/api/automations/${autoId}`, { method: "PATCH", body: { status } });
            await showDetail(autoId);
          } catch (err) {
            alert(err.message || "Erreur");
          }
        });
      });

      bindReloadButtons(contentEl, () => showDetail(id));
    } catch (err) {
      contentEl.innerHTML = `<p class="contacts-empty error">${esc(err.message || "Erreur")}</p>`;
    }
  }

  async function loadAutomations() {
    const listEl = $("#auto-list");
    if (!listEl) return;
    try {
      const data = await api("/api/automations");
      renderList(data.automations || []);
    } catch (err) {
      listEl.innerHTML = `<p class="contacts-empty error">${esc(err.message || "Erreur")}</p>`;
    }
  }

  function init() {
    $$(".auto-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => switchAutoTab(btn.dataset.autoTab || "list"));
    });
    $("#auto-refresh-btn")?.addEventListener("click", () => {
      const active = document.querySelector(".auto-tab-btn.active")?.dataset.autoTab || "list";
      if (active === "list") void loadAutomations();
      if (active === "roi") void loadRoi();
      if (active === "handoffs") void loadHandoffs();
    });
    $("#auto-back-btn")?.addEventListener("click", () => {
      $("#auto-detail")?.classList.add("hidden");
      $("#auto-list")?.classList.remove("hidden");
    });
  }

  window.AutomationsUI = {
    load: loadAutomations,
    init,
  };

  init();
})();
