import "dotenv/config";

const portRaw = process.env.PORT?.trim() || "3000";
const port = Number(portRaw);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`\n❌ PORT invalide : "${portRaw}". Attendu un entier entre 1 et 65535.\n`);
  process.exit(1);
}

export const config = {
  port,
  openaiModel: process.env.OPENAI_MODEL?.trim() || "gpt-4o",
  defaultGreenApiBaseUrl: "https://api.green-api.com",
  defaultEvolutionBaseUrl: "http://localhost:8080",
  envOpenAiKey: process.env.OPENAI_API_KEY?.trim() || "",
  envGreenApiId: process.env.GREEN_API_ID_INSTANCE?.trim() || "",
  envGreenApiToken: process.env.GREEN_API_TOKEN?.trim() || "",
  envGreenApiBaseUrl: (process.env.GREEN_API_BASE_URL?.trim() || "https://api.green-api.com").replace(
    /\/$/,
    ""
  ),
  envEvolutionBaseUrl: (process.env.EVOLUTION_API_BASE_URL?.trim() || "").replace(/\/$/, ""),
  envEvolutionApiKey: process.env.EVOLUTION_API_KEY?.trim() || "",
  envEvolutionInstance: process.env.EVOLUTION_INSTANCE_NAME?.trim() || "",
} as const;
