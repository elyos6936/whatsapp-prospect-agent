import { testEvolutionConnection, sendWhatsAppTextStatus } from "../src/evolutionapi.js";

async function main() {
  console.log("=== Test statut WhatsApp ===\n");

  const conn = await testEvolutionConnection();
  console.log("État instance :", conn.state);
  console.log("Connecté     :", conn.connected ? "oui" : "non");
  console.log("Détail       :", conn.message);

  if (!conn.connected) {
    console.log("\n⚠️  WhatsApp non connecté — scannez le QR dans Connexions → Connecter WhatsApp (QR).");
  }

  console.log('\n--- Tentative statut : « Dieu est grand » ---');

  try {
    const result = await sendWhatsAppTextStatus("Dieu est grand", {
      backgroundColor: "#228B22",
      font: "SERIF",
    });
    console.log("\n✅ Statut publié. idMessage =", result.idMessage, "· audience =", result.audienceCount);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log("\n❌ Échec :", msg);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
