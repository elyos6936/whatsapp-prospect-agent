/**
 * Génère des fichiers .excalidraw (squelette) pour ouvrir sur excalidraw.com
 * + HTML de liens. Usage: npx tsx scripts/preview-automation-plan.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAutomationVisualPlan } from "../src/automation-plan.js";
import { planToExcalidrawSkeleton } from "../src/excalidraw-plan.js";
import type { Automation } from "../src/db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "out");

type Sample = Pick<Automation, "id" | "name" | "type" | "config" | "summary">;

const samples: Sample[] = [
  {
    id: 101,
    name: "Prospection groupe coiffeurs Lyon",
    type: "group_prospect",
    summary: "Contacter les membres du groupe",
    config: {
      groupName: "Coiffeurs Lyon Pro",
      groupId: "120363@g.us",
      initialMessage:
        "Bonjour {prenom}, je propose un outil WhatsApp pour gérer les RDV salon. Tu as 2 min ?",
      conversationGuide: "Qualifier le besoin, proposer démo 15 min, envoyer lien Calendly",
      enableAutoReply: true,
      quietHoursStart: 21,
      quietHoursEnd: 9,
      closingGoal: "appointment",
      closingLink: "https://cal.com/klanvio/demo",
      productName: "Klanvio",
      relance: { enabled: true, delaysDays: [2, 5, 10], hour: 10 },
      stopOnDissatisfaction: true,
      stopOnUnknownQuestion: true,
      scheduledStartAt: "2026-07-20T09:00:00.000Z",
    },
  },
  {
    id: 102,
    name: "Relance contacts warm CRM",
    type: "contact_prospect",
    summary: "Séquence vers liste CRM",
    config: {
      contactTargets: [
        { id: "+33611111111", label: "Alice" },
        { id: "+33622222222", label: "Bob" },
        { id: "+33633333333", label: "Chloé" },
      ],
      initialMessage: "Salut {prenom}, suite à notre échange — toujours intéressant pour toi ?",
      conversationGuide: "Relancer doucement, proposer un créneau, éviter spam",
      enableAutoReply: true,
      closingGoal: "link",
      closingLink: "https://klanvio.com/pricing",
      quietHoursStart: 22,
      quietHoursEnd: 8,
      relance: { enabled: true, delaysDays: [3, 7], hour: 11 },
      stopOnDissatisfaction: true,
    },
  },
  {
    id: 103,
    name: "Sales inbound mots-clés",
    type: "keyword_sales",
    summary: "Répondre aux leads entrants",
    config: {
      triggerPhrases: ["prix", "tarif", "combien", "devis"],
      salesScript: "Présenter l'offre, qualifier budget, closer sur paiement ou démo",
      conversationGuide: "Réponses courtes, CTA clair",
      enableAutoReply: true,
      closingGoal: "payment",
      price: "49€/mois",
      productName: "Klanvio Pro",
      stopOnUnknownQuestion: true,
    },
  },
];

mkdirSync(OUT_DIR, { recursive: true });

const files: { name: string; path: string; nodes: number; edges: number }[] = [];

for (const sample of samples) {
  const plan = buildAutomationVisualPlan(sample);
  const skeleton = planToExcalidrawSkeleton(plan);
  const scene = {
    type: "excalidraw",
    version: 2,
    source: "https://www.klanvio.com",
    elements: skeleton,
    appState: {
      viewBackgroundColor: "#f8f7f4",
      gridSize: null,
      currentItemFontFamily: 6,
    },
    files: {},
  };
  const safe = (plan.title || "plan").replace(/[^\w\-]+/g, "_");
  const outPath = join(OUT_DIR, `${safe}.excalidraw`);
  writeFileSync(outPath, JSON.stringify(scene, null, 2), "utf8");
  files.push({ name: plan.title, path: outPath, nodes: plan.nodes.length, edges: plan.edges.length });
  console.log(`✓ ${plan.type}: ${plan.nodes.map((n) => n.id).join(" → ")}`);
  console.log(`  edges: ${plan.edges.map((e) => `${e.from}->${e.to}`).join(", ")}`);
  console.log(`  → ${outPath}`);
}

const indexHtml = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8"/>
  <title>Klanvio — plans Excalidraw</title>
  <style>
    body { font-family: system-ui; max-width: 720px; margin: 40px auto; padding: 0 16px; background: #f8f7f4; color: #1e1e1e; }
    a { color: #1971c2; }
    li { margin: 12px 0; }
    code { background: #eee; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Plans Excalidraw générés</h1>
  <p>Ouvre chaque fichier <code>.excalidraw</code> sur <a href="https://excalidraw.com" target="_blank" rel="noreferrer">excalidraw.com</a> (Load → Open), ou lance le front <code>npm run dev</code> dans <code>web/</code> pour le vrai canvas intégré.</p>
  <ul>
    ${files
      .map(
        (f) =>
          `<li><strong>${f.name}</strong> — ${f.nodes} nœuds / ${f.edges} liens<br/><code>${f.path}</code></li>`,
      )
      .join("\n")}
  </ul>
</body>
</html>`;

writeFileSync(join(OUT_DIR, "plan-preview.html"), indexHtml, "utf8");
console.log(`\nIndex: ${join(OUT_DIR, "plan-preview.html")}`);
