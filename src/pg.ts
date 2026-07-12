import postgres from "postgres";
import { config } from "./config.js";

if (!config.databaseUrl) {
  console.error(
    "\n❌ DATABASE_URL manquant. Définissez la variable d'environnement (ex. connexion Supabase Postgres).\n"
  );
  process.exit(1);
}

export const sql = postgres(config.databaseUrl, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  // PgBouncer (port 6543 Supabase) ne supporte pas les prepared statements.
  prepare: false,
});

console.log("📦 PostgreSQL prêt (DATABASE_URL)");
