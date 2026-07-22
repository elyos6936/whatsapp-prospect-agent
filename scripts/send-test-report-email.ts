/**
 * Envoie un e-mail de rapport hebdomadaire de test via Resend.
 * Usage:
 *   npx tsx scripts/send-test-report-email.ts [destinataire]
 *   npx tsx scripts/send-test-report-email.ts --preview
 * Défaut destinataire: willwanvoesso@gmail.com
 */
import "dotenv/config";
import { writeFileSync } from "fs";
import { isResendConfigured, sendWeeklyReportEmail } from "../src/mail/resend.js";
import {
  buildWeeklyReportHtml,
  buildWeeklyReportText,
  sampleWeeklyReportPayload,
} from "../src/mail/weekly-report.js";

const args = process.argv.slice(2);
const previewOnly = args.includes("--preview");
const to = (args.find((a) => !a.startsWith("--")) || "willwanvoesso@gmail.com").trim();

const payload = sampleWeeklyReportPayload();
const text = buildWeeklyReportText(payload);
const html = buildWeeklyReportHtml(payload);

async function main() {
  console.log("--- TEXTE (chat / fallback) ---\n");
  console.log(text);
  console.log("\n--- HTML (aperçu écrit dans _tmp_weekly_report_preview.html) ---\n");
  writeFileSync("_tmp_weekly_report_preview.html", html, "utf8");
  console.log(`Période: ${payload.periodLabel}`);
  console.log(`Sujet: Rapport hebdomadaire — ${payload.campaignName}`);

  if (previewOnly) {
    console.log("\n(--preview) Pas d'envoi Resend.");
    return;
  }

  if (!isResendConfigured()) {
    console.error("\nRESEND_API_KEY manquant dans .env — utilise --preview pour l'aperçu seul.");
    process.exit(1);
  }

  console.log(`\nEnvoi test → ${to} depuis ${process.env.RESEND_FROM || "rapports@klanvio.com"}…`);
  const result = await sendWeeklyReportEmail({
    to,
    campaignName: payload.campaignName,
    text,
    html,
  });

  if (!result.ok) {
    console.error("Échec Resend:", result.error, result.status ? `(HTTP ${result.status})` : "");
    console.error(
      "Si le domaine klanvio.com n'est pas vérifié dans Resend, ajoutez les DNS (DKIM/SPF) puis réessayez."
    );
    process.exit(1);
  }

  console.log("Email envoyé. id =", result.id);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
