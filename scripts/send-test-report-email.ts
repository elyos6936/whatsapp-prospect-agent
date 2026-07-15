/**
 * Envoie un vrai e-mail de rapport de test via Resend.
 * Usage: npx tsx scripts/send-test-report-email.ts [destinataire]
 * Défaut: willwanvoesso@gmail.com
 */
import "dotenv/config";
import { isResendConfigured, sendDailyReportEmail } from "../src/mail/resend.js";

const to = (process.argv[2] || "willwanvoesso@gmail.com").trim();

const sampleText = [
  "📊 Rapport du jour — Campagne « Test Klanvio » (#0) · statut : active",
  "• Messages envoyés aujourd'hui : 12",
  "• Total contactés : 48 (restants à contacter : 15)",
  "• Réponses reçues : 7 · intéressés : 3",
  "Ouvre Automatisation pour le détail.",
  "",
  "(Ceci est un e-mail de test Resend — rapports@klanvio.com)",
].join("\n");

async function main() {
  if (!isResendConfigured()) {
    console.error("❌ RESEND_API_KEY manquant dans .env");
    process.exit(1);
  }

  console.log(`Sending test report to ${to} from ${process.env.RESEND_FROM || "rapports@klanvio.com"}…`);
  const result = await sendDailyReportEmail({
    to,
    campaignName: "Test Klanvio",
    campaignId: 0,
    text: sampleText,
  });

  if (!result.ok) {
    console.error("❌ Échec Resend:", result.error, result.status ? `(HTTP ${result.status})` : "");
    console.error(
      "Si le domaine klanvio.com n'est pas vérifié dans Resend, ajoutez les DNS (DKIM/SPF/MX) puis réessayez.",
    );
    process.exit(1);
  }

  console.log("✅ Email envoyé. id =", result.id);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
