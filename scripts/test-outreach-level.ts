/**
 * Tests — niveaux d'outreach, plafonds, rapport hebdo (sans WhatsApp).
 * npx tsx scripts/test-outreach-level.ts
 */
import {
  outreachLevelFromTotalSent,
  dailyCapsForLevel,
  messagesUntilNextLevel,
  TRIAL_MAX_CONVERSATIONS,
  LEVEL_DAILY_CAPS,
} from "../src/outreach-level.js";
import {
  buildWeeklyReportText,
  sampleWeeklyReportPayload,
} from "../src/mail/weekly-report.js";

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) {
    passed++;
    console.log(`  OK  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL ${label}`);
  }
}

console.log("\n=== Niveaux lifetime ===");
assert(outreachLevelFromTotalSent(0) === 1, "0 → L1");
assert(outreachLevelFromTotalSent(999) === 1, "999 → L1");
assert(outreachLevelFromTotalSent(1000) === 2, "1000 → L2");
assert(outreachLevelFromTotalSent(1999) === 2, "1999 → L2");
assert(outreachLevelFromTotalSent(2000) === 3, "2000 → L3");
assert(outreachLevelFromTotalSent(3000) === 4, "3000 → L4");
assert(outreachLevelFromTotalSent(4000) === 5, "4000 → L5");
assert(outreachLevelFromTotalSent(99999) === 5, "cap L5");

assert(messagesUntilNextLevel(999) === 1, "999 → 1 avant L2");
assert(messagesUntilNextLevel(1000) === 1000, "1000 → 1000 avant L3");
assert(messagesUntilNextLevel(4000) === null, "4000 → plus de niveau");

console.log("\n=== Plafonds jour (nouveaux fils) ===");
assert(LEVEL_DAILY_CAPS[1].outbound === 100 && LEVEL_DAILY_CAPS[1].inbound === 200, "L1 200/100");
assert(LEVEL_DAILY_CAPS[2].outbound === 150 && LEVEL_DAILY_CAPS[2].inbound === 250, "L2 250/150");
assert(LEVEL_DAILY_CAPS[5].outbound === 300 && LEVEL_DAILY_CAPS[5].inbound === 400, "L5 400/300");
assert(dailyCapsForLevel(2).outbound === 150, "dailyCapsForLevel(2)");
assert(TRIAL_MAX_CONVERSATIONS === 20, "essai = 20 conversations");

console.log("\n=== Rapport hebdo (niveau sans campagne) ===");
const noCampaign = sampleWeeklyReportPayload({
  campaignName: "Votre compte Klanvio",
  campaignId: null,
  campaignStatus: "active",
  outreachLevel: 2,
  totalMessagesSent: 1000,
  leveledUp: true,
  previousOutreachLevel: 1,
  reached: 0,
  answered: 0,
});
const textNoCamp = buildWeeklyReportText(noCampaign);
assert(textNoCamp.includes("Niveau actuel : 2 / 5"), "rapport contient le niveau");
assert(textNoCamp.includes("Félicitations"), "félicitation level-up");
assert(textNoCamp.includes("Aucune campagne active"), "funnel simplifié sans campagne");
assert(!textNoCamp.includes("• Atteints :"), "pas de funnel détaillé sans campagne");

const withCamp = sampleWeeklyReportPayload({ leveledUp: false, previousOutreachLevel: 2 });
const textCamp = buildWeeklyReportText(withCamp);
assert(textCamp.includes("Funnel campagne"), "funnel avec campagne");
assert(textCamp.includes("• Atteints :"), "métriques funnel présentes");
assert(!textCamp.includes("Félicitations"), "pas de félicitation si pas de level-up");

console.log("\n=== Scénario manuel (intégration) ===");
console.log(`
  1) Lifetime / niveau en temps réel
     - Compte active (subscription_status=active), total_messages_sent=999
     - Envoyer 1 message counts_toward_quota → outreach_level passe à 2
     - Vérifier users.outreach_level et plafonds L2 (250 in / 150 out)

  2) Plafond jour = nouveaux fils seulement
     - Forcer compteur new_outbound_conversations_YYYY-MM-DD = plafond L1 (100)
     - File d'attente : nouvel opener → reporté à demain 08:30 (pas cancelled)
     - Réponse dans un fil déjà ouvert → envoi OK (pas bloqué)

  3) Essai 20 conversations
     - subscription_status=trial, trial_conversations_used=19
     - 1er nouveau fil OK → used=20
     - 2e nouveau fil → refus « Essai gratuit terminé »
     - Fil déjà ouvert : réponses toujours OK

  4) Rapport hebdo sans campagne active
     - User actif, 0 campagne active, last_weekly_report_week=null
     - Simuler vendredi ≥ 20h (ou appeler maybeSendUserWeeklyReport via tick)
     - Message agent + email : niveau + félicitation si level-up, funnel simplifié
`);

console.log(`\nRésultat : ${passed} OK, ${failed} FAIL`);
process.exit(failed > 0 ? 1 : 0);
