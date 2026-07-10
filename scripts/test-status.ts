import { callGreenApi, testGreenApiConnection, sendWhatsAppTextStatus } from "../src/greenapi.js";

async function main() {
  console.log("=== Test réel — statut WhatsApp « Dieu est grand » ===\n");

  const conn = await testGreenApiConnection();
  console.log("État instance :", conn.state);
  console.log("Connecté     :", conn.connected ? "oui" : "non");
  console.log("Détail       :", conn.message);

  if (conn.state === "starting") {
    console.log("\n⚠️  L'instance Green-API est en cours de démarrage (starting).");
    console.log("   Attendez 1–2 min ou rescannez le QR (Console → Instance → QR code).");
  }

  if (conn.state === "notAuthorized") {
    console.log("\n⚠️  WhatsApp non autorisé — scannez le QR dans Green-API ou Console → Instance.");
  }

  console.log("\n--- Tentative sendTextStatus : « Dieu est grand » ---");

  try {
    const result = await sendWhatsAppTextStatus("Dieu est grand", {
      backgroundColor: "#228B22",
      font: "SERIF",
    });
    console.log("\n✅ RÉSULTAT : ÇA FONCTIONNE");
    console.log("   Statut publié. idMessage =", result.idMessage);
    return;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log("\n❌ RÉSULTAT : ÉCHEC à la publication");
    console.log("   Erreur :", msg);

    if (/forbidden|403/i.test(msg)) {
      console.log("\n   Cause : accès « statuts » non activé sur votre compte Green-API (bêta).");
      console.log("   Action : demander l'activation au support Green-API.");
      console.log("   Note : le code de l'app est OK ; c'est la plateforme qui bloque.");
    } else if (/starting|notAuthorized|authorized/i.test(msg) || conn.state !== "authorized") {
      console.log("\n   Cause : instance WhatsApp pas prête (état:", conn.state + ").");
      console.log("   Action : attendre ou reconnecter WhatsApp via QR.");
    }
  }

  try {
    const settings = await callGreenApi("getSettings");
    console.log("\n--- Paramètres instance (extrait) ---");
    console.log(JSON.stringify(settings, null, 2).slice(0, 800));
  } catch {
    /* ignore */
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
