# Inventaire multi-turn — hijacks & drops (Klanvio)

Audit code-backed du routeur agent. Pattern dominant : message court (oui, numéro, nom) classé `advance_rail` → hard-return briefing alors que le tour continue une action parallèle.

## Chiffres

| | |
|--|--|
| Total cas | 31 |
| Ouverts | 0 |
| Corrigés | 31 |
| P0 / P1 / P2 | 0 ouverts |

## P1 + P2 — CORRIGÉS (2026-08-29, vague finale)

| ID | Fix |
|----|-----|
| GAP-025 | Soft WA : hard-stop seulement si `messageNeedsWhatsAppConnection` |
| GAP-026 | Soft mémoire : hard-stop seulement si `messageNeedsCampaignMemory` |
| GAP-006 | Support + bare name après introuvable / ask nom → `allowGroupQuickPaths` |
| GAP-007 | `resolveMembersIntentFromHistory("maintenant")` si last asst = extract |
| GAP-008 | Groups « je valide » sans post → nudge LLM (plus hard-return seul) |
| GAP-012 | Soft greeting → digression (déjà) |
| GAP-017 | Plus de `forceRailAfterStallClarify` → soft LLM recovery |
| GAP-020 | Isolation Support conservée hors ask groupe (006 = exception) |
| GAP-024 | Tool blob history −18 + keywords OAuth/Google/Calendly |
| GAP-027 | Stall clarify → nudge LLM (plus hard-return) |
| GAP-028 | Sim fail → fallback LLM |
| GAP-029 | Publish non-admin → soft system nudge, fil continue |
| GAP-030 | Low-risk join/catalog — documenté / current-only OK |

Tests : `scripts/test-p2-continuity.ts`, `scripts/test-group-list-intent.ts`

## P1 continuity guards — CORRIGÉS

| ID | Fix |
|----|-----|
| GAP-013…016 / 019 / 022 / 023 | turn-kind / agent / high-stakes (voir vague précédente) |

Tests : `scripts/test-p1-continuity-guards.ts`

## P1 history-resolve groupes — CORRIGÉS

GAP-001…005 + GAP-031

## P0 — CORRIGÉS

GAP-009 / 010 / 011 / 018 / 021

## Mécanisme (ordre `chatWithAgent`)

```
WA connected? (soft si Q&A) → allowGroupQuickPaths → memory? (soft si Q&A)
→ deterministic (window / support / groups / draft / activate / sim→LLM fallback)
→ stall clarify (nudge LLM)
→ classifyBriefingTurn (history)
→ pause → LLM  |  advance → satisfy? → HARD-RETURN | LLM
```
