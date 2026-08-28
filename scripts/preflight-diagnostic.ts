/**
 * Sonde santé plateforme (local ou CI).
 * Usage : npx tsx scripts/preflight-diagnostic.ts [--json] [--api-url URL]
 */
import "dotenv/config";
import { config } from "../src/config.js";
import { getSendQueueHealthStats } from "../src/agent-chat-jobs.js";
import { sql } from "../src/pg.js";

type Check = { name: string; ok: boolean; detail: string };

function parseArgs(argv: string[]) {
  const json = argv.includes("--json");
  const apiIdx = argv.indexOf("--api-url");
  const apiUrl =
    apiIdx >= 0 && argv[apiIdx + 1]
      ? argv[apiIdx + 1]!
      : process.env.PUBLIC_URL?.trim() || "http://localhost:3000";
  return { json, apiUrl: apiUrl.replace(/\/$/, "") };
}

async function main() {
  const { json, apiUrl } = parseArgs(process.argv.slice(2));
  const checks: Check[] = [];

  checks.push({
    name: "Modèle LLM chat",
    ok: Boolean(config.openaiModel),
    detail: `${config.llmProvider} / ${config.openaiModel}`,
  });

  try {
    await sql`SELECT 1`;
    checks.push({ name: "PostgreSQL", ok: true, detail: "SELECT 1 OK" });
  } catch (e) {
    checks.push({
      name: "PostgreSQL",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  try {
    const health = (await fetch(`${apiUrl}/api/health`).then((r) => r.json())) as Record<
      string,
      unknown
    >;
    checks.push({
      name: "API /health",
      ok: health.ok === true,
      detail: JSON.stringify({ ok: health.ok, model: health.model }),
    });
  } catch (e) {
    checks.push({
      name: "API /health",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  try {
    const sq = await getSendQueueHealthStats();
    checks.push({
      name: "send_queue stuck pending (>1h)",
      ok: sq.stuckPending === 0,
      detail: `${sq.stuckPending} stuck / ${sq.pending} pending`,
    });
    checks.push({
      name: "send_queue stuck processing (>30m)",
      ok: sq.stuckProcessing === 0,
      detail: `${sq.stuckProcessing} stuck / ${sq.processing} processing`,
    });
  } catch (e) {
    checks.push({
      name: "send_queue stats",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  const failed = checks.filter((c) => !c.ok);
  const payload = {
    ok: failed.length === 0,
    checks,
    failed: failed.map((c) => c.name),
    apiUrl,
    ts: new Date().toISOString(),
  };

  if (json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log("\n=== Preflight Klanvio ===\n");
    for (const c of checks) {
      console.log(`${c.ok ? "OK" : "FAIL"}  ${c.name}: ${c.detail}`);
    }
    console.log(`\n${failed.length === 0 ? "✅ Tous les checks OK" : `❌ ${failed.length} échec(s)`}\n`);
  }

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
