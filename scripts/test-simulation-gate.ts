/**
 * Tests purs simulation-gate (chat-only, sans panneau).
 * Run: npx tsx scripts/test-simulation-gate.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentMessage } from "../src/db.js";
import {
  allowsActivateWithoutSimulation,
  hasSimulationThread,
  isActivationNegation,
  isExplicitActivationConfirm,
  isSimulationApproval,
  recentAssistantAskedActivationConfirm,
  recentHistoryHasSimulation,
  resolveSimulationTurnMode,
  shouldAutoOpenSimulationPanel,
  shouldBlockDuplicateSimulation,
  userWantsExplicitResimulation,
  userWantsSilentCampaignTweak,
} from "../src/simulation-gate.js";
import { shouldDeterministicActivate } from "../src/deterministic-campaign.js";
import { proposeShortAttentionOpener, isValidAttentionOpener } from "../src/opener-frame.js";

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

function msg(role: AgentMessage["role"], content: string): AgentMessage {
  return {
    id: 0,
    role,
    content,
    created_at: new Date().toISOString(),
  };
}

const SIM_THREAD =
  "Toi → « Bonjour, vous travaillez dans le bio ? »\n" +
  "Prospect → « Oui, pourquoi ? »\n" +
  "Toi → « Je voulais juste échanger 2 min. »\n" +
  "Prospect → « Ok dites-moi. »\n\n" +
  "---\n*(Simulation — jusqu'à 7 messages.)*\n\n" +
  "Dis-moi concrètement :\n• ce qui te convient\n• ce que tu veux changer\n\n" +
  "Ou réponds « c'est bon » si on peut passer à l'activation.";

const PROPOSE_SIM = "Veux-tu tester une simulation dans ce chat ?";

console.log("\n=== A. Détection fil / approval / resim ===\n");
assert(hasSimulationThread(SIM_THREAD), "hasSimulationThread on Toi/Prospect");
assert(!hasSimulationThread("Simple message sans flèche"), "no false positive");
assert(isSimulationApproval("c'est bon"), "approval: c'est bon");
assert(isSimulationApproval("ok"), "approval: ok");
assert(!isSimulationApproval("change le ton"), "not approval: change ton");
assert(isExplicitActivationConfirm("lance"), "activation: lance");
assert(isExplicitActivationConfirm("oui active"), "activation: oui active");
assert(
  !hasSimulationThread(
    "Voici 5 variantes :\n1. « Salut A »\n2. « Salut B »\n3. « Salut C »\n4. « Salut D »\n5. « Salut E »\n\nTu valides l'ensemble ? Si oui, je lance la création puis la simulation.",
  ),
  "5 variantes + mot simulation ≠ fil sim",
);
{
  const histVariants: AgentMessage[] = [
    msg(
      "assistant",
      "Voici 5 variantes :\n1. « Salut A »\n2. « Salut B »\n3. « Salut C »\n4. « Salut D »\n5. « Salut E »\n\nTu valides l'ensemble ? Si oui, je lance la création de la campagne, puis la simulation.",
    ),
  ];
  assert(
    !recentHistoryHasSimulation(histVariants),
    "history: variantes ≠ hasSim",
  );
  assert(
    !recentAssistantAskedActivationConfirm(histVariants),
    "valides l'ensemble ≠ ask activate",
  );
  assert(
    !shouldDeterministicActivate(histVariants, "oui"),
    "oui après variantes ≠ activate",
  );
}
assert(userWantsExplicitResimulation("refais la simulation"), "resim: refais");
assert(userWantsExplicitResimulation("recommence la simu"), "resim: recommence");
assert(!userWantsExplicitResimulation("adoucis le ton"), "no resim: tweak only");
assert(userWantsSilentCampaignTweak("adoucis le ton"), "silent tweak: ton");
assert(!userWantsSilentCampaignTweak("refais la simulation"), "no silent on resim");

console.log("\n=== B. resolveSimulationTurnMode ===\n");
{
  const hist: AgentMessage[] = [msg("assistant", PROPOSE_SIM)];
  assert(
    resolveSimulationTurnMode(hist, "oui") === "force_sim",
    "oui après proposition → force_sim",
  );
}
{
  const hist: AgentMessage[] = [msg("assistant", SIM_THREAD)];
  assert(
    resolveSimulationTurnMode(hist, "c'est bon") === "activation_nudge",
    "c'est bon après sim → activation_nudge",
  );
  assert(
    resolveSimulationTurnMode(hist, "adoucis le ton") === "silent_tweak",
    "tweak après sim → silent_tweak",
  );
  assert(
    resolveSimulationTurnMode(hist, "refais la simulation") === "force_sim",
    "refais après sim → force_sim",
  );
  assert(
    shouldBlockDuplicateSimulation(hist, "adoucis le ton"),
    "block duplicate sim on tweak",
  );
  assert(
    !shouldBlockDuplicateSimulation(hist, "refais la simulation"),
    "allow resim on explicit ask",
  );
}
{
  const hist: AgentMessage[] = [
    msg("assistant", SIM_THREAD),
    msg(
      "assistant",
      "Tu veux activer maintenant ou tu as d'autres modifications ?",
    ),
  ];
  assert(
    resolveSimulationTurnMode(hist, "lance") === "activation_confirm",
    "lance après question activation → activation_confirm",
  );
}

console.log("\n=== C. Heuristique draft / sim (ex-auto-open panneau) ===\n");
assert(
  shouldAutoOpenSimulationPanel(
    "« Florelle » est prêt en brouillon. Veux-tu tester une **simulation** dans ce chat ?",
  ),
  "draft reveal chat-only",
);
assert(shouldAutoOpenSimulationPanel(SIM_THREAD), "sim thread");
assert(
  !shouldAutoOpenSimulationPanel(
    "C'est fait : j'ai adouci le ton. Dis « refais la simulation » ou « c'est bon ».",
  ),
  "silent tweak confirm ≠ draft reveal",
);

console.log("\n=== D. Copy agent : plus de « à droite » ===\n");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const persona = readFileSync(join(root, "src/persona.ts"), "utf8");
const agent = readFileSync(join(root, "src/agent.ts"), "utf8");
const tools = readFileSync(join(root, "src/tools.ts"), "utf8");

assert(!/simulation à droite/i.test(persona), "persona: pas « simulation à droite »");
assert(!/Valider à droite/i.test(persona), "persona: pas « Valider à droite »");
assert(!/simulation à droite/i.test(agent), "agent: pas « simulation à droite »");
assert(!/Valider à droite/i.test(agent), "agent: pas « Valider à droite »");
assert(!/simulation à droite/i.test(tools), "tools: pas « simulation à droite »");
assert(/simulation dans ce chat/i.test(persona), "persona: simulation dans ce chat");
assert(/refais la simulation/i.test(agent), "agent: invite refais la simulation");

console.log("\n=== E. Négation activate / lance sans sim / opener long ===\n");
assert(isActivationNegation("n'active pas"), "negation: n'active pas");
assert(isActivationNegation("ne lance pas"), "negation: ne lance pas");
assert(isActivationNegation("annule"), "negation: annule");
assert(isActivationNegation("pas maintenant"), "negation: pas maintenant");
assert(!isActivationNegation("active"), "not negation: active");
assert(!isExplicitActivationConfirm("n'active pas"), "confirm false on n'active pas");
assert(!isExplicitActivationConfirm("ne l'active pas"), "confirm false on ne l'active pas");
assert(allowsActivateWithoutSimulation("lance sans simulation"), "allow skip sim");
assert(allowsActivateWithoutSimulation("active sans simu"), "allow skip simu");
assert(!allowsActivateWithoutSimulation("lance"), "bare lance ≠ skip sim");
assert(!allowsActivateWithoutSimulation("sans simulation"), "sans sim alone ≠ activate");
{
  const histNoSim: AgentMessage[] = [msg("assistant", "Brouillon prêt. Veux-tu activer ?")];
  assert(
    shouldDeterministicActivate(histNoSim, "lance"),
    "lance intent even without sim (gate message later)",
  );
  assert(
    !shouldDeterministicActivate(histNoSim, "n'active pas"),
    "n'active pas → no activate intent",
  );
  assert(
    shouldDeterministicActivate(histNoSim, "lance sans simulation"),
    "lance sans simulation → activate intent",
  );
}
assert(
  isValidAttentionOpener(
    "Bonjour, je vous contacte au sujet de notre masterclass complète sur l'automatisation WhatsApp pour les agences qui veulent scaler leur closing en Afrique de l'Ouest avec un accompagnement sur 8 semaines.",
  ),
  "long opener without URL/price = valid (soft length)",
);
assert(
  Boolean(
    proposeShortAttentionOpener(
      "Bonjour, je vous contacte au sujet de notre masterclass complète sur l'automatisation WhatsApp pour les agences qui veulent scaler leur closing en Afrique de l'Ouest avec un accompagnement sur 8 semaines et un suivi personnalisé.",
    ),
  ),
  "propose short for long opener",
);

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
