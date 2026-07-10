import { testGreenApiConnection, sendWhatsAppTextStatus } from "./src/greenapi.js";

const TEST_MESSAGE = "Test Agent Team — " + new Date().toLocaleString("fr-FR");

async function main() {
  console.log("=== Test Green-API / statut WhatsApp ===\n");

  const conn = await testGreenApiConnection();
  console.log("Connexion:", JSON.stringify(conn, null, 2));

  if (!conn.connected) {
    console.log("\n❌ ARRÊT : WhatsApp non connecté — impossible de tester le statut.");
    process.exit(1);
  }

  console.log("\nTentative sendTextStatus avec:", TEST_MESSAGE);

  try {
    const result = await sendWhatsAppTextStatus(TEST_MESSAGE, {
      backgroundColor: "#228B22",
      font: "SERIF",
    });
    console.log("\n✅ SUCCÈS — Statut publié");
    console.log("idMessage:", result.idMessage);
    process.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log("\n❌ ÉCHEC — Statut non publié");
    console.log("Erreur:", msg);
    if (msg.includes("Forbidden") || msg.includes("403")) {
      console.log("\nCause probable: fonctionnalité statuts bêta non activée sur votre instance Green-API.");
      console.log("→ Contactez le support Green-API pour activer sendTextStatus.");
    }
    process.exit(2);
  }
}

main();
