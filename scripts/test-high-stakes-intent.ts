/**
 * Vague 1 — intention D pour outils irréversibles + non-régression Fédérico.
 * Run: npx tsx scripts/test-high-stakes-intent.ts
 */
import type { AgentMessage } from "../src/db.js";
import {
  allowsManualSend,
  extractNamedCampaignForDelete,
  highStakesConfirmNudge,
  isExplicitAutoReplyToggle,
  isExplicitBlockContact,
  isExplicitDeleteAutomation,
  isExplicitGroupAdminAction,
  isExplicitSendNow,
  isExplicitStatusChange,
  isFuzzySendAsk,
  resolveAllowedHighStakesTools,
} from "../src/high-stakes-intent.js";
import {
  assessCampaignBriefing,
  isShortCampaignValidation,
} from "../src/campaign-briefing.js";
import {
  POWER_CAMPAIGN_TOOLS,
  shouldDeterministicActivate,
} from "../src/deterministic-campaign.js";

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

function am(role: AgentMessage["role"], content: string): AgentMessage {
  return { id: 0, role, content, created_at: "" };
}

console.log("\n=== Vague 1 : envoi flou vs explicite ===\n");
{
  const fuzzy = "tu peux lui écrire ?";
  assert(isFuzzySendAsk(fuzzy), "tu peux lui écrire ? = flou");
  assert(!isExplicitSendNow(fuzzy), "flou ≠ send now");
  assert(!allowsManualSend([], fuzzy), "flou → send interdit");
  const allowed = resolveAllowedHighStakesTools({
    userMessage: fuzzy,
    recentHistory: [],
  });
  assert(!allowed.has("send_whatsapp_message"), "outil send masqué si flou");
  assert(
    Boolean(highStakesConfirmNudge(fuzzy, [], allowed)),
    "nudge confirmation si flou"
  );
}

{
  const explicit = "envoie-lui maintenant : Salut c'est Alex, tu as 2 min ?";
  assert(isExplicitSendNow(explicit), "envoie-lui maintenant : … = explicite");
  assert(allowsManualSend([], explicit), "explicite → send autorisé");
  const allowed = resolveAllowedHighStakesTools({
    userMessage: explicit,
    recentHistory: [],
  });
  assert(allowed.has("send_whatsapp_message"), "outil send visible si explicite");
  assert(
    highStakesConfirmNudge(explicit, [], allowed) === null,
    "pas de nudge si déjà explicite"
  );
}

{
  const hist = [am("assistant", "Je lui envoie « Salut c'est Alex » maintenant ?")];
  assert(allowsManualSend(hist, "oui envoie"), "oui après question d'envoi → OK");
  assert(allowsManualSend(hist, "oui"), "oui court après confirm envoi → OK");
  assert(!allowsManualSend(hist, "je valide"), "je valide ≠ confirm envoi");
}

console.log("\n=== Test 1 / Fédérico : je valide → brouillon, PAS d'envoi ===\n");
{
  const variants = `Voici 5 accroches pour Fédérico :

1. Salut, je vois que tu es dans le groupe, tu as 2 min ?
2. Hey, petit message rapide au sujet d'une masterclass.
3. Coucou, j'ai vu ton activité sur le groupe.
4. Hello, je me permets un message suite au groupe.
5. Salut Fédérico, je lance une masterclass graphisme.`;

  const history = [
    am("user", "Extraire les membres du groupe Design Cotonou"),
    am("assistant", "Membres : Fédérico, Aisha, Marc…"),
    am("user", "Propose moi"),
    am("assistant", variants),
  ];
  const userMessage = "je valide";

  assert(isShortCampaignValidation(userMessage), "je valide = validation campagne");
  const briefing = assessCampaignBriefing(history, userMessage, "prospection");
  assert(briefing.openerVariantsProposed, "5 variantes détectées");
  assert(
    briefing.openerVariantsProposed &&
      isShortCampaignValidation(userMessage) &&
      !shouldDeterministicActivate(history, userMessage),
    "chemin D brouillon (create_automation) ouvert"
  );
  assert(
    !allowsManualSend(history, userMessage),
    "je valide n'autorise PAS send_whatsapp_message"
  );
  const allowed = resolveAllowedHighStakesTools({
    userMessage,
    recentHistory: history,
  });
  assert(allowed.size === 0, "aucun outil irréversible déverrouillé");
  assert(
    POWER_CAMPAIGN_TOOLS.has("create_automation"),
    "create_automation reste hors Vague 1 (chemin D inchangé)"
  );
  assert(
    !POWER_CAMPAIGN_TOOLS.has("send_whatsapp_message"),
    "send n'est pas un POWER_CAMPAIGN_TOOL"
  );
}

console.log("\n=== Pause / delete / block / auto-reply / groupe ===\n");
assert(
  !isExplicitStatusChange("la campagne Masterclass"),
  "mention campagne ≠ pause"
);
assert(
  isExplicitStatusChange("mets la campagne Masterclass en pause"),
  "pause explicite"
);
assert(
  !isExplicitStatusChange("tu peux mettre la campagne en pause ?"),
  "pause floue bloquée"
);
assert(
  isExplicitStatusChange("reprends la campagne Masterclass"),
  "reprise explicite"
);

assert(
  !isExplicitDeleteAutomation("supprime cette campagne"),
  "delete sans nom → bloqué"
);
assert(
  !isExplicitDeleteAutomation("tu peux supprimer la campagne Masterclass ?"),
  "delete flou → bloqué"
);
assert(
  isExplicitDeleteAutomation('supprime la campagne « Masterclass »'),
  "delete + nom entre guillemets"
);
assert(
  extractNamedCampaignForDelete("supprime la campagne Masterclass") ===
    "Masterclass",
  "nom Masterclass extrait"
);
assert(
  isExplicitDeleteAutomation("supprime la campagne Masterclass"),
  "delete + nom après campagne"
);

assert(!isExplicitBlockContact("ce contact est relou"), "évocation ≠ bloquer");
assert(isExplicitBlockContact("bloque ce contact"), "bloque ce contact");
assert(isExplicitBlockContact("bloque +22901990000"), "bloque +numéro");
assert(!isExplicitBlockContact("tu peux bloquer ce numéro ?"), "block flou");

assert(
  !isExplicitAutoReplyToggle("les réponses auto c'est bien"),
  "évocation auto-reply ≠ toggle"
);
assert(
  isExplicitAutoReplyToggle("désactive les réponses automatiques"),
  "désactive auto-reply"
);
assert(
  !isExplicitAutoReplyToggle("tu peux activer l'auto-reply ?"),
  "auto-reply flou"
);

assert(
  !isExplicitGroupAdminAction("on parle du groupe Design"),
  "mention groupe ≠ admin"
);
assert(isExplicitGroupAdminAction("crée un groupe Design Cotonou"), "crée groupe");
assert(
  isExplicitGroupAdminAction("ajoute Marc dans le groupe Design"),
  "ajoute participant"
);
assert(isExplicitGroupAdminAction("quitte le groupe Design"), "quitte groupe");
assert(
  !isExplicitGroupAdminAction("tu peux créer un groupe ?"),
  "admin groupe flou"
);

{
  const allowed = resolveAllowedHighStakesTools({
    userMessage: "crée un groupe Design Cotonou",
    recentHistory: [],
  });
  assert(allowed.has("create_whatsapp_group"), "create_whatsapp_group déverrouillé");
  assert(allowed.has("leave_group"), "pack admin groupe entier si intention D");
  assert(!allowed.has("send_whatsapp_message"), "send reste fermé");
  assert(!allowed.has("delete_automation"), "delete reste fermé");
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
