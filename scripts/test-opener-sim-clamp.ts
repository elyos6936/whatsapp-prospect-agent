/**
 * Clamp tour 1 simulation sur accroche validée (pas pitch collé).
 * Run: npx tsx scripts/test-opener-sim-clamp.ts
 */
import { clampSimulationOpenerTurn, formatCampaignSimulationDisplay } from "../src/campaign-simulation.js";
import { stripOutboundMessageDecorations } from "../src/outbound-sanitize.js";

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

const variants = [
  "Bonjour comment ça va ?",
  "Bonjour, comment allez-vous ?",
  "Bonjour, ça va bien ?",
  "Bonjour, comment ça va aujourd'hui ?",
  "Bonjour, tout va bien ?",
];

console.log("\n=== clamp bloated opener ===\n");
{
  const turns = clampSimulationOpenerTurn(
    [
      {
        speaker: "toi",
        text:
          "Bonjour comment ça va ? Je suis Will Wanvoesso, expert en automatisation no-code/IA pour les freelances et PME en Afrique.",
      },
      { speaker: "prospect", name: "Prospect", text: "Bonjour" },
      { speaker: "toi", text: "Merci — je vous propose un échange rapide." },
    ],
    variants[0],
    variants
  );
  assert(turns[0]?.text === variants[0], "tour 1 = accroche seule");
  assert(!/Will Wanvoesso/i.test(turns[0]?.text ?? ""), "pas de présentation collée");
}

console.log("\n=== preserve exact variant match ===\n");
{
  const turns = clampSimulationOpenerTurn(
    [
      { speaker: "toi", text: "Bonjour, comment allez-vous ?" },
      { speaker: "prospect", name: "Prospect", text: "Bonjour" },
      { speaker: "toi", text: "Suite." },
    ],
    variants[0],
    variants
  );
  assert(turns[0]?.text === variants[1], "match variante v2");
}

console.log("\n=== strip decorated opener in sim display ===\n");
{
  const decorated =
    "*« Bonjour, je me permets de vous écrire rapidement. Ça vous parle un peu? »*";
  const clean = stripOutboundMessageDecorations(decorated);
  assert(!clean.includes("«"), "sans guillemets");
  assert(!clean.includes("*"), "sans astérisques");
  const display = formatCampaignSimulationDisplay([
    { speaker: "toi", text: decorated },
    { speaker: "prospect", name: "Prospect", text: "Bonjour" },
    { speaker: "toi", text: "Merci — je vous propose un échange rapide." },
  ]);
  assert(!display.includes("*«"), "fence sans markdown");
  assert(display.includes(clean), "texte net dans fence");
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
