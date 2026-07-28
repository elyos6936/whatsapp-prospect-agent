/**
 * Batterie de tests — simulation gate (pas de LLM / WhatsApp).
 * npx tsx scripts/test-simulation-gate.ts
 */
import type { AgentMessage } from "../src/db.js";
import {
  resolveSimulationTurnMode,
  shouldBlockDuplicateSimulation,
  shouldAutoOpenSimulationPanel,
  userWantsExplicitResimulation,
  userWantsSilentCampaignTweak,
  userAsksFollowUpAboutCampaign,
} from "../src/simulation-gate.js";
import {
  isCampaignObjectiveReached as objectiveReached,
  wasVerballyClosed,
} from "../src/lead-scoring.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function msg(role: AgentMessage["role"], content: string): AgentMessage {
  return {
    id: 0,
    user_id: 1,
    thread_id: 1,
    role,
    content,
    created_at: new Date().toISOString(),
  } as AgentMessage;
}

const SIM_THREAD = `Toi → « Bonjour, vous avez un instant ? »
Prospect → « Oui dites-moi »
Toi → « On livre à Cotonou, ça vous intéresse ? »
Prospect → « Oui »
Toi → « Super, quelle adresse ? »
Prospect → « Godomey »
Toi → « Parfait, je transmets au livreur. »

Qu'est-ce que tu veux ajuster ?`;

const ASK_ACTIVATE =
  "Simulation validée. Tu veux que je l'active maintenant, ou tu as encore des modifications à faire ?";

const PROPOSE_SIM = "Veux-tu tester la simulation à droite ?";

type Case = {
  name: string;
  history: AgentMessage[];
  user: string;
  expectMode: ReturnType<typeof resolveSimulationTurnMode>;
  expectBlockDup?: boolean;
};

const cases: Case[] = [
  // ——— Première simu ———
  {
    name: "1. Oui après proposition → force_sim",
    history: [msg("assistant", PROPOSE_SIM)],
    user: "Oui",
    expectMode: "force_sim",
    expectBlockDup: false,
  },
  {
    name: "2. « fais une simulation » sans historique → force_sim",
    history: [],
    user: "Fais une simulation",
    expectMode: "force_sim",
    expectBlockDup: false,
  },

  // ——— Après simu : silent tweaks ———
  {
    name: "3. Adoucis le ton → silent_tweak",
    history: [msg("assistant", SIM_THREAD)],
    user: "Adoucis le ton un peu",
    expectMode: "silent_tweak",
    expectBlockDup: true,
  },
  {
    name: "4. Change l'accroche → silent_tweak",
    history: [msg("assistant", SIM_THREAD)],
    user: "Change l'accroche, mets quelque chose de plus court",
    expectMode: "silent_tweak",
    expectBlockDup: true,
  },
  {
    name: "5. Vouvoie le client → silent_tweak",
    history: [msg("assistant", SIM_THREAD)],
    user: "Il faut vouvoyer le client",
    expectMode: "silent_tweak",
    expectBlockDup: true,
  },
  {
    name: "6. Moins agressif → silent_tweak",
    history: [msg("assistant", SIM_THREAD)],
    user: "Moins agressif s'il te plaît",
    expectMode: "silent_tweak",
    expectBlockDup: true,
  },
  {
    name: "7. Remplace le prix → silent_tweak",
    history: [msg("assistant", SIM_THREAD)],
    user: "Remplace le prix par 10 000 FCFA",
    expectMode: "silent_tweak",
    expectBlockDup: true,
  },

  // ——— Questions ———
  {
    name: "8. Pourquoi ce message ? → silent_tweak",
    history: [msg("assistant", SIM_THREAD)],
    user: "Pourquoi tu as mis ça dans le premier message ?",
    expectMode: "silent_tweak",
    expectBlockDup: true,
  },
  {
    name: "9. Question courte avec ? → silent_tweak",
    history: [msg("assistant", SIM_THREAD)],
    user: "C'est quoi le CTA exactement ?",
    expectMode: "silent_tweak",
    expectBlockDup: true,
  },
  {
    name: "10. Préoccupation → silent_tweak",
    history: [msg("assistant", SIM_THREAD)],
    user: "Je suis pas sûr que ce soit assez clair",
    expectMode: "silent_tweak",
    expectBlockDup: true,
  },

  // ——— Re-simu explicite ———
  {
    name: "11. Refais la simulation → force_sim",
    history: [msg("assistant", SIM_THREAD)],
    user: "Refais la simulation",
    expectMode: "force_sim",
    expectBlockDup: false,
  },
  {
    name: "12. Recommence la simu → force_sim",
    history: [msg("assistant", SIM_THREAD)],
    user: "Recommence la simulation avec le nouveau ton",
    expectMode: "force_sim",
    expectBlockDup: false,
  },
  {
    name: "13. Montre-moi encore un aperçu → force_sim",
    history: [msg("assistant", SIM_THREAD)],
    user: "Montre-moi encore un aperçu",
    expectMode: "force_sim",
    expectBlockDup: false,
  },

  // ——— Validation / activation ———
  {
    name: "14. C'est bon → activation_nudge",
    history: [msg("assistant", SIM_THREAD)],
    user: "C'est bon",
    expectMode: "activation_nudge",
    expectBlockDup: true,
  },
  {
    name: "15. Oui après demande d'activation → activation_confirm",
    history: [msg("assistant", SIM_THREAD), msg("assistant", ASK_ACTIVATE)],
    user: "Oui",
    expectMode: "activation_confirm",
    expectBlockDup: true,
  },
  {
    name: "16. Lance maintenant → activation_confirm",
    history: [msg("assistant", SIM_THREAD), msg("assistant", ASK_ACTIVATE)],
    user: "Lance maintenant",
    expectMode: "activation_confirm",
    expectBlockDup: true,
  },

  // ——— Ne pas casser ———
  {
    name: "17. Message banal après simu → none (pas silent si pas modif/question)",
    history: [msg("assistant", SIM_THREAD)],
    user: "Merci",
    expectMode: "none",
    expectBlockDup: true,
  },
  {
    name: "18. Briefing sans simu → none",
    history: [msg("user", "Je veux prospecter des contacts")],
    user: "Je vends des crèmes",
    expectMode: "none",
    expectBlockDup: false,
  },
];

let failed = 0;

console.log("=== A. Modes de tour simulation ===\n");
for (const c of cases) {
  const mode = resolveSimulationTurnMode(c.history, c.user);
  const block = shouldBlockDuplicateSimulation(c.history, c.user);
  const modeOk = mode === c.expectMode;
  const blockOk = c.expectBlockDup === undefined || block === c.expectBlockDup;
  const ok = modeOk && blockOk;
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${c.name}\n` +
      `      mode=${mode} (expect ${c.expectMode})` +
      (c.expectBlockDup !== undefined
        ? ` | blockDup=${block} (expect ${c.expectBlockDup})`
        : "")
  );
}

console.log("\n=== B. Détecteurs unitaires ===\n");
const unit: [string, boolean, boolean][] = [
  ["explicit: refais la simulation", userWantsExplicitResimulation("refais la simulation"), true],
  ["explicit: adoucis le ton", userWantsExplicitResimulation("adoucis le ton"), false],
  ["silent: adoucis le ton", userWantsSilentCampaignTweak("adoucis le ton"), true],
  ["silent: refais la simulation", userWantsSilentCampaignTweak("refais la simulation"), false],
  ["ask: pourquoi ?", userAsksFollowUpAboutCampaign("Pourquoi ce message ?"), true],
  ["ask: change l'accroche", userAsksFollowUpAboutCampaign("Change l'accroche"), false],
];
for (const [name, got, want] of unit) {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} → ${got} (expect ${want})`);
}

console.log("\n=== C. Auto-open panneau (front) ===\n");
const openCases: [string, string, boolean][] = [
  [
    "Fil Toi/Prospect",
    "Toi → « Salut »\nProspect → « Oui »\nToi → « Super »",
    true,
  ],
  [
    "Brouillon prêt",
    "« Florelle » est prêt en brouillon. Ouvre la **simulation** à droite.",
    true,
  ],
  [
    "Confirm silent tweak (PAS d'open)",
    "C'est fait : j'ai adouci le ton. Tu peux repartir Valider à droite.",
    false,
  ],
  [
    "Réponse question (PAS d'open)",
    "Le premier message reste volontairement court pour A.I.D.A.",
    false,
  ],
];
for (const [name, reply, want] of openCases) {
  const got = shouldAutoOpenSimulationPanel(reply);
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} → ${got} (expect ${want})`);
}

console.log("\n=== D. Régression clôture livraison ===\n");
const offer =
  "Parfait, c'est noté. Le livreur peut passer, je lui envoie votre contact ?";
const transmet = "Ok, je transmets votre numéro au livreur.";
const histOffer = [{ direction: "sortant", body: offer }];
const histVerbal = [
  { direction: "sortant", body: offer },
  { direction: "sortant", body: transmet },
];
const dCases: [string, boolean, boolean][] = [
  ["Oui après offre → objectif", objectiveReached("Oui", histOffer, { closingGoal: "delivery" }), true],
  ["Adresse seule → pas objectif", objectiveReached("Sodjatimin", histOffer, { closingGoal: "delivery" }), false],
  ["Ok après transmets → verbal close", wasVerballyClosed(histVerbal), true],
  ["Offre seule → pas verbal close", wasVerballyClosed(histOffer), false],
];
for (const [name, got, want] of dCases) {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} → ${got}`);
}

console.log("\n=== E. update_automation_config ne doit plus renvoyer planDisplay ===\n");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const toolsSrc = fs.readFileSync(path.join(root, "src/tools.ts"), "utf8");
// Dans le case update_automation_config, message sans planDisplay:
const updateBlock = toolsSrc.includes(
  "Pas de planDisplay : évite de re-coller le fence"
);
const stillHasRelanceSim =
  /Relance la \*\*simulation\*\* à droite pour vérifier/.test(toolsSrc);
const e1 = updateBlock && !stillHasRelanceSim;
if (!e1) failed++;
console.log(
  `${e1 ? "PASS" : "FAIL"}  update_automation_config sans planDisplay spam`
);

const agentSrc = fs.readFileSync(path.join(root, "src/agent.ts"), "utf8");
const onlyCreateReturnsPlan =
  /toolCall\.function\.name === "create_automation"/.test(agentSrc) &&
  !/create_automation" \|\|\s*\n\s*toolCall\.function\.name === "update_automation_config"/.test(
    agentSrc
  );
if (!onlyCreateReturnsPlan) failed++;
console.log(
  `${onlyCreateReturnsPlan ? "PASS" : "FAIL"}  agent ne force planDisplay que sur create`
);

console.log(
  failed
    ? `\nRésultat: ${failed} échec(s)`
    : `\nRésultat: TOUT OK`
);
process.exit(failed ? 1 : 0);
