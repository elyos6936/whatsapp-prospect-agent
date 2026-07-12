import "dotenv/config";

const portRaw = process.env.PORT?.trim() || "3000";
const port = Number(portRaw);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`\n❌ PORT invalide : "${portRaw}". Attendu un entier entre 1 et 65535.\n`);
  process.exit(1);
}

export const config = {
  port,
  databaseUrl: process.env.DATABASE_URL?.trim() || "",
  jwtSecret: process.env.JWT_SECRET?.trim() || "",
  publicUrl: (process.env.PUBLIC_URL?.trim() || "http://localhost:3000").replace(/\/$/, ""),
  openaiModel: process.env.OPENAI_MODEL?.trim() || "gpt-4o",
  defaultEvolutionBaseUrl: "http://localhost:8080",
  envOpenAiKey: process.env.OPENAI_API_KEY?.trim() || "",
  envEvolutionBaseUrl: (process.env.EVOLUTION_API_BASE_URL?.trim() || "").replace(/\/$/, ""),
  envEvolutionApiKey: process.env.EVOLUTION_API_KEY?.trim() || "",
} as const;

/** Instance Evolution dédiée par utilisateur (plateforme gérée). */
export function evolutionInstanceName(userId: number): string {
  return `klanvio_${userId}`;
}
