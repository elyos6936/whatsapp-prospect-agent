import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/run-migration.mjs <path-to-sql>");
  process.exit(1);
}

const sqlPath = path.resolve(__dirname, "..", file);
if (!fs.existsSync(sqlPath)) {
  console.error(`Fichier introuvable : ${sqlPath}`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("DATABASE_URL manquant dans l'environnement.");
  process.exit(1);
}

const content = fs.readFileSync(sqlPath, "utf8");
const sql = postgres(databaseUrl, { max: 1, idle_timeout: 10, connect_timeout: 15 });

try {
  console.log(`Application de ${path.basename(sqlPath)} ...`);
  // Simple query protocol (no params) supporte plusieurs instructions.
  await sql.unsafe(content);
  console.log("Migration appliquée avec succès.");
} catch (err) {
  console.error("Échec de la migration :", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
