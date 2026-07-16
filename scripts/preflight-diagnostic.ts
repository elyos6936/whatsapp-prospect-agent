/**
 * Diagnostic global avant relance des tests.
 * Usage : npx tsx scripts/preflight-diagnostic.ts
 */
import "dotenv/config";
import { config } from "../src/config.js";
import { sql } from "../src/pg.js";

type Check = { name: string; ok: boolean; detail: string };

async function main() {
  const checks: Check[] = [];

  // 1. Modèle LLM
  const model = config.openaiModel;
  const isPro = model === "deepseek-v4-pro" || (!/flash/i.test(model) && /pro|v4/i.test(model));
  checks.push({
    name: "Modèle LLM",
    ok: isPro && !/flash/i.test(model),
    detail: `${config.llmProvider} / ${model}${/flash/i.test(model) ? " ⚠️ FLASH" : ""}`,
  });

  // 2. Health prod
  let health: Record<string, unknown> = {};
  try {
    health = (await fetch("https://klanvio-api.srv1820011.hstgr.cloud/api/health").then((r) =>
      r.json()
    )) as Record<string, unknown>;
    checks.push({
      name: "API prod /health",
      ok: health.ok === true,
      detail: JSON.stringify({
        ok: health.ok,
        model: health.model,
        whatsappPoll: (health.whatsappPoll as { authorized?: boolean })?.authorized,
      }),
    });
    checks.push({
      name: "API prod = DeepSeek Pro",
      ok: String(health.model) === "deepseek-v4-pro",
      detail: `model=${health.model}`,
    });
  } catch (e) {
    checks.push({
      name: "API prod /health",
      ok: false,
      detail: String(e),
    });
  }

  // 3. Campagnes actives
  const active = await sql<{ id: number; name: string; status: string; user_id: number }[]>`
    SELECT id, name, status, user_id FROM automations WHERE status = 'active' ORDER BY id
  `;
  checks.push({
    name: "Campagnes actives",
    ok: active.length === 0,
    detail:
      active.length === 0
        ? "Aucune (sûr pour relancer proprement)"
        : active.map((a) => `#${a.id} « ${a.name} » user=${a.user_id}`).join(" | "),
  });

  // 4. File d'envoi
  const queue = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM send_queue WHERE status IN ('pending', 'processing')
  `;
  const qn = Number(queue[0]?.n ?? 0);
  checks.push({
    name: "File d'envoi pending",
    ok: qn === 0,
    detail: `${qn} message(s)`,
  });

  // 5. Séquences actives dues
  const seq = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM contact_sequences
    WHERE status = 'active' AND next_step_at IS NOT NULL AND next_step_at <= NOW()
  `;
  checks.push({
    name: "Séquences dues maintenant",
    ok: Number(seq[0]?.n ?? 0) === 0,
    detail: `${seq[0]?.n ?? 0}`,
  });

  // 6. Garde-fous code (fichiers critiques)
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(".");
  const safetySrc = fs.readFileSync(path.join(root, "src/outbound-safety.ts"), "utf8");
  const engineSrc = fs.readFileSync(path.join(root, "src/automation-engine.ts"), "utf8");
  const simSrc = fs.readFileSync(path.join(root, "src/simulation-preview.ts"), "utf8");
  checks.push({
    name: "Anti-spam (awaiting reply)",
    ok: safetySrc.includes("isAwaitingProspectReply"),
    detail: "outbound-safety.ts présent",
  });
  checks.push({
    name: "Pas de relance auto à l'opener",
    ok: engineSrc.includes("PAS de séquence") || !engineSrc.includes("startSequenceForContact"),
    detail: engineSrc.includes("startSequenceForContact")
      ? "startSequenceForContact encore importé ?"
      : "OK — séquences retirées de l'opener",
  });
  checks.push({
    name: "Simulation max ≥ 6",
    ok: /MAX_TURNS\s*=\s*7/.test(simSrc) || /MAX_TURNS\s*=\s*6/.test(simSrc),
    detail: (simSrc.match(/MAX_TURNS\s*=\s*\d+/) || ["?"])[0],
  });

  // 7. CORS domaine
  const serverSrc = fs.readFileSync(path.join(root, "src/server.ts"), "utf8");
  checks.push({
    name: "CORS klanvio.com",
    ok: serverSrc.includes("www.klanvio.com"),
    detail: serverSrc.includes("www.klanvio.com") ? "défaut OK" : "manquant",
  });

  // 8. Chat async (anti Failed to fetch)
  checks.push({
    name: "Chat async 202",
    ok: serverSrc.includes("pending: true") && serverSrc.includes("status(202)"),
    detail: "POST /api/chat → 202 + job fond",
  });

  // 9. Liste groupes rapide
  const agentSrc = fs.readFileSync(path.join(root, "src/agent.ts"), "utf8");
  const evoSrc = fs.readFileSync(path.join(root, "src/evolutionapi.ts"), "utf8");
  checks.push({
    name: "Fast-path liste groupes",
    ok: agentSrc.includes("detectQuickListIntent") && evoSrc.includes("GROUPS_LIST_CACHE"),
    detail: "chemin rapide + cache groupes",
  });
  checks.push({
    name: "Messages connexion sans Evolution",
    ok:
      !evoSrc.includes("WhatsApp connecté (Evolution API)") &&
      evoSrc.includes('WhatsApp connecté.'),
    detail: "messages user-facing nettoyés",
  });

  // 10. UI popup WhatsApp
  const modalSrc = fs.readFileSync(
    path.join(root, "web/src/components/whatsapp/WhatsAppConnectModal.tsx"),
    "utf8"
  );
  const settingsSrc = fs.readFileSync(path.join(root, "web/src/pages/SettingsPage.tsx"), "utf8");
  checks.push({
    name: "Popup connexion WhatsApp",
    ok: modalSrc.includes("WhatsAppConnectModal") && settingsSrc.includes("WhatsAppConnectModal"),
    detail: "modale centrée + reconnect après déconnexion",
  });

  // 11. Persona : jamais Evolution à l'utilisateur
  const personaSrc = fs.readFileSync(path.join(root, "src/persona.ts"), "utf8");
  checks.push({
    name: "Agent ne cite pas Evolution",
    ok: personaSrc.includes("N'évoque JAMAIS") && personaSrc.includes("Evolution API"),
    detail: "règle confidentialité technique",
  });

  // 12. DeepSeek Pro forcé
  const configSrc = fs.readFileSync(path.join(root, "src/config.ts"), "utf8");
  checks.push({
    name: "Flash bloqué",
    ok: configSrc.includes("jamais Flash") || configSrc.includes("deepseek-v4-pro"),
    detail: "config LLM",
  });

  console.log("\n=== DIAGNOSTIC KLANVIO ===\n");
  let allOk = true;
  for (const c of checks) {
    const mark = c.ok ? "✅" : "❌";
    if (!c.ok) allOk = false;
    console.log(`${mark} ${c.name}: ${c.detail}`);
  }
  console.log(allOk ? "\n✅ Prêt pour les tests (après deploy Hostinger si besoin).\n" : "\n⚠️ Corrigez les points ❌ avant de relancer.\n");
  process.exitCode = allOk ? 0 : 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 });
  });
