/**
 * Fidélité simulation ↔ mémoire campagne.
 * La mémoire dicte le process (variable par campagne) ; A.I.D.A. n'est qu'un secours.
 */

export type FidelityTurn = {
  speaker: "toi" | "prospect";
  name?: string;
  text: string;
};

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

const VAGUE_AFTER_YES_RE =
  /\b(comment\s+(vous\s+)?pr[eé]f[eé]rez\s+finaliser|dites[- ]moi\s+comment|on\s+avance\s+avec\s+vous|quelle\s+suite|comment\s+on\s+(proceed|avance|finalise)|je\s+reste\s+[aà]\s+votre\s+disposition|n'?h[eé]sitez\s+pas)\b/i;

const PROSPECT_YES_RE =
  /^(oui|ouais|ok|okay|d['’]accord|volontiers|int[eé]ress[eé]|je\s+suis\s+int[eé]ress[eé]|yes)([!.\s]|$)/i;

const INSCRIPTION_ASK_RE =
  /\b(inscri(re|ption|t)|rejoindre|participer|r[eé]server|s['’]inscrire|veux[- ]tu\s+(t['’])?inscrire|souhaitez[- ]vous\s+(vous\s+)?inscrire)\b/i;

export function extractUrlsFromText(text: string): string[] {
  const found = text.match(URL_RE) ?? [];
  return [...new Set(found.map((u) => u.replace(/[.,;:!?)]+$/, "")))];
}

export function memoryImpliesRegistrationThenLink(memoryText: string): boolean {
  const t = memoryText.toLowerCase();
  const hasInscription = /\binscri/i.test(t);
  const hasLink =
    extractUrlsFromText(memoryText).length > 0 ||
    /\b(lien|groupe\s+whatsapp|envoie[rz]?\s+(le\s+)?lien)\b/i.test(t);
  return hasInscription && hasLink;
}

export function memoryImpliesPresentOfferBeforeRegister(memoryText: string): boolean {
  const t = memoryText.toLowerCase();
  return (
    /\b(pr[eé]sent(e|er)|offre|masterclass|formation|d[eé]tail)\b/i.test(t) &&
    /\binscri/i.test(t)
  );
}

export type SimFidelityIssue = {
  code: string;
  detail: string;
};

export function assessSimulationMemoryFidelity(
  turns: FidelityTurn[],
  memoryText: string
): { ok: boolean; issues: SimFidelityIssue[]; repairHint: string } {
  const mem = memoryText.trim();
  const issues: SimFidelityIssue[] = [];
  if (!mem) return { ok: true, issues, repairHint: "" };

  const urls = extractUrlsFromText(mem);
  const regThenLink = memoryImpliesRegistrationThenLink(mem);
  const offerBeforeReg = memoryImpliesPresentOfferBeforeRegister(mem);

  let prospectYesCount = 0;
  let sawOfferAfterFirstYes = false;
  let sawInscriptionAsk = false;
  let sawLinkAfterInscriptionContext = false;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]!;
    if (turn.speaker === "prospect" && PROSPECT_YES_RE.test(turn.text.trim())) {
      prospectYesCount += 1;
      const next = turns[i + 1];
      if (next?.speaker === "toi") {
        if (VAGUE_AFTER_YES_RE.test(next.text)) {
          issues.push({
            code: "vague_after_yes",
            detail: `Après un « oui » du prospect, réponse vague interdite : « ${next.text.slice(0, 120)} »`,
          });
        }
        if (prospectYesCount === 1 && offerBeforeReg) {
          const hasSubstance =
            next.text.length >= 40 &&
            !VAGUE_AFTER_YES_RE.test(next.text) &&
            !urls.some((u) => next.text.includes(u));
          if (hasSubstance) sawOfferAfterFirstYes = true;
          else if (urls.some((u) => next.text.includes(u))) {
            issues.push({
              code: "link_too_early",
              detail:
                "La mémoire demande de présenter l'offre / demander l'inscription AVANT d'envoyer le lien.",
            });
          } else if (VAGUE_AFTER_YES_RE.test(next.text) || next.text.length < 40) {
            issues.push({
              code: "missing_offer_after_first_yes",
              detail:
                "Après le 1er « oui », présenter l'offre (détails mémoire) — pas une phrase vague.",
            });
          }
        }
        if (INSCRIPTION_ASK_RE.test(next.text)) sawInscriptionAsk = true;
        if (urls.some((u) => next.text.includes(u))) {
          if (sawInscriptionAsk || prospectYesCount >= 2) {
            sawLinkAfterInscriptionContext = true;
          }
        }
      }
    }
    if (turn.speaker === "toi") {
      if (INSCRIPTION_ASK_RE.test(turn.text)) sawInscriptionAsk = true;
      if (urls.some((u) => turn.text.includes(u)) && (sawInscriptionAsk || prospectYesCount >= 2)) {
        sawLinkAfterInscriptionContext = true;
      }
    }
  }

  if (offerBeforeReg && prospectYesCount >= 1 && !sawOfferAfterFirstYes) {
    if (!issues.some((x) => x.code === "missing_offer_after_first_yes" || x.code === "link_too_early")) {
      issues.push({
        code: "missing_offer_after_first_yes",
        detail: "Trajectoire : 1er oui → présenter l'offre (mémoire), puis inscription, puis lien.",
      });
    }
  }

  if (regThenLink && prospectYesCount >= 2) {
    if (!sawInscriptionAsk && !sawLinkAfterInscriptionContext) {
      issues.push({
        code: "missing_inscription_or_link",
        detail:
          "Après intérêt confirmé : demander l'inscription puis envoyer le lien mémoire — ne pas tourner en rond.",
      });
    } else if (sawInscriptionAsk && urls.length && !sawLinkAfterInscriptionContext) {
      // 2e oui peut être l'inscription — le lien doit apparaître avant la fin
      const lastProspectYes = [...turns]
        .map((t, idx) => ({ t, idx }))
        .filter(({ t }) => t.speaker === "prospect" && PROSPECT_YES_RE.test(t.text.trim()))
        .pop();
      if (lastProspectYes && lastProspectYes.idx < turns.length - 1) {
        const after = turns.slice(lastProspectYes.idx + 1).filter((t) => t.speaker === "toi");
        const hasLink = after.some((t) => urls.some((u) => t.text.includes(u)));
        if (!hasLink && prospectYesCount >= 2) {
          issues.push({
            code: "missing_link_after_register_yes",
            detail: `Après oui d'inscription, envoyer le lien : ${urls[0]}`,
          });
        }
      }
    }
  }

  // Toute réponse vague après oui est déjà capturée ; dédoublonner
  const unique = new Map(issues.map((i) => [i.code, i]));
  const deduped = [...unique.values()];
  const repairHint =
    deduped.length === 0
      ? ""
      : [
          "Corrige la simulation pour être FIDÈLE à la mémoire (process campagne) :",
          ...deduped.map((i) => `- ${i.detail}`),
          "Reste direct et précis. Varie les formulations, pas le process.",
          "INTERDIT : « comment préférez-vous finaliser », tourner en rond.",
          urls.length ? `Lien(s) mémoire à utiliser au BON moment : ${urls.join(" ")}` : "",
        ]
          .filter(Boolean)
          .join("\n");

  return { ok: deduped.length === 0, issues: deduped, repairHint };
}

/** Construit le bloc mémoire prioritaire pour la simu (non tronqué agressivement). */
export function buildMemoryPriorityBlock(opts: {
  memoryName?: string | null;
  memoryInstructions?: string | null;
  productName?: string | null;
  price?: string | null;
  closingLink?: string | null;
  conversationGuide?: string | null;
  salesScript?: string | null;
}): { memoryBlock: string; configBlock: string; fullBrief: string } {
  const memBody = (opts.memoryInstructions ?? "").trim();
  const urls = [
    ...extractUrlsFromText(memBody),
    ...(opts.closingLink?.trim() ? [opts.closingLink.trim()] : []),
  ];
  const uniqueUrls = [...new Set(urls)];

  const memoryBlock = memBody
    ? [
        `=== MÉMOIRE CAMPAGNE (SOURCE DE VÉRITÉ — PROCESS À EXÉCUTER) : « ${opts.memoryName || "Mémoire"} » ===`,
        `Suis l'ORDRE des étapes de cette mémoire à la lettre.`,
        `Chaque « oui » du prospect = avancer d'UNE étape du process (pas une phrase vague).`,
        `Varie les MOTS ; ne change PAS le process.`,
        `INTERDIT de tourner en rond / « comment finaliser » / questions hors mémoire.`,
        uniqueUrls.length
          ? `Liens à utiliser UNIQUEMENT au moment prévu par la mémoire : ${uniqueUrls.join(" ")}`
          : "",
        "",
        memBody,
      ]
        .filter((l) => l !== "")
        .join("\n")
    : "";

  const configBits = [
    opts.conversationGuide?.trim()
      ? `Guide config (secondaire si conflit → mémoire gagne) :\n${opts.conversationGuide.trim().slice(0, 1200)}`
      : "",
    opts.productName?.trim() ? `Produit : ${opts.productName.trim()}` : "",
    opts.price?.trim() ? `Prix : ${opts.price.trim()}` : "",
    opts.closingLink?.trim() ? `Lien config : ${opts.closingLink.trim()}` : "",
    opts.salesScript?.trim()
      ? `Script : ${opts.salesScript.trim().slice(0, 800)}`
      : "",
  ].filter(Boolean);
  const configBlock = configBits.join("\n\n");

  const fullBrief = [memoryBlock, configBlock].filter(Boolean).join("\n\n");
  return { memoryBlock, configBlock, fullBrief };
}
