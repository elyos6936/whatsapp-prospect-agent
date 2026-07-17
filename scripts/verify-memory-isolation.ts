/**
 * Vérifie l'isolation mémoire A / B (sans envoi WhatsApp).
 * Usage: npx tsx scripts/verify-memory-isolation.ts
 */
import "dotenv/config";
import {
  beginFreshCampaignConversation,
  getContactAutomationState,
  getContactChatHistory,
  saveWhatsAppMessage,
  createAutomation,
  deleteAutomation,
  ensureContactAutomationStateSchema,
} from "../src/db.js";

const USER_ID = Number(process.env.VERIFY_USER_ID || 1);
const PHONE = "22966000099@c.us";

async function main() {
  await ensureContactAutomationStateSchema();

  const autoA = await createAutomation(USER_ID, {
    name: `__test_mem_A_${Date.now()}`,
    type: "contact_prospect",
    config: { initialMessage: "salut A", contactTargets: [{ id: PHONE }] },
    status: "draft",
  });
  const autoB = await createAutomation(USER_ID, {
    name: `__test_mem_B_${Date.now()}`,
    type: "contact_prospect",
    config: { initialMessage: "salut B", contactTargets: [{ id: PHONE }] },
    status: "draft",
  });

  try {
    const freshA = await beginFreshCampaignConversation(USER_ID, PHONE, autoA.id);
    if (!freshA.fresh) throw new Error("A devrait être fresh la 1re fois");

    await saveWhatsAppMessage(USER_ID, {
      contactPhone: PHONE,
      direction: "sortant",
      body: "Message opener campagne A",
      greenApiId: `test-a-out-${Date.now()}`,
      automationId: autoA.id,
    });
    await saveWhatsAppMessage(USER_ID, {
      contactPhone: PHONE,
      direction: "entrant",
      body: "Oui intéressé A",
      greenApiId: `test-a-in-${Date.now()}`,
      senderName: "Prospect",
      automationId: autoA.id,
    });

    const histA1 = await getContactChatHistory(USER_ID, PHONE, 20, autoA.id);
    if (histA1.length < 2) throw new Error(`A devrait avoir ≥2 msgs, got ${histA1.length}`);

    const freshB = await beginFreshCampaignConversation(USER_ID, PHONE, autoB.id);
    if (!freshB.fresh) throw new Error("B devrait être fresh (nouvelle auto)");

    const histB0 = await getContactChatHistory(USER_ID, PHONE, 20, autoB.id);
    if (histB0.length !== 0) {
      throw new Error(`B doit démarrer vide, got ${histB0.length} msgs: ${histB0.map((m) => m.body).join(" | ")}`);
    }

    await saveWhatsAppMessage(USER_ID, {
      contactPhone: PHONE,
      direction: "sortant",
      body: "Message opener campagne B",
      greenApiId: `test-b-out-${Date.now()}`,
      automationId: autoB.id,
    });

    const histB1 = await getContactChatHistory(USER_ID, PHONE, 20, autoB.id);
    if (histB1.length !== 1 || !histB1[0].body.includes("campagne B")) {
      throw new Error(`B doit avoir uniquement son opener, got ${JSON.stringify(histB1.map((m) => m.body))}`);
    }

    // Reprendre A : mémoire A intacte, pas polluée par B
    const resumeA = await beginFreshCampaignConversation(USER_ID, PHONE, autoA.id);
    if (resumeA.fresh) throw new Error("Reprise A ne doit pas être fresh");

    const histA2 = await getContactChatHistory(USER_ID, PHONE, 20, autoA.id);
    if (histA2.length < 2) throw new Error(`A doit garder son historique (≥2), got ${histA2.length}`);
    if (histA2.some((m) => m.body.includes("campagne B"))) {
      throw new Error("Fuite : message B visible dans l'historique A");
    }

    const stateA = await getContactAutomationState(USER_ID, PHONE, autoA.id);
    const stateB = await getContactAutomationState(USER_ID, PHONE, autoB.id);
    if (!stateA || !stateB) throw new Error("États A et B doivent exister");

    console.log("✅ Isolation mémoire OK");
    console.log(`   A: ${histA2.length} msg(s) · B: ${histB1.length} msg(s)`);
  } finally {
    await deleteAutomation(USER_ID, autoA.id).catch(() => {});
    await deleteAutomation(USER_ID, autoB.id).catch(() => {});
  }
}

main().catch((err) => {
  console.error("❌", err instanceof Error ? err.message : err);
  process.exit(1);
});
