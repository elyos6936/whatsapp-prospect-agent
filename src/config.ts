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
  metaGraphVersion: process.env.META_GRAPH_VERSION?.trim() || "v21.0",
  envOpenAiKey: process.env.OPENAI_API_KEY?.trim() || "",
  envGreenApiId: process.env.GREEN_API_ID_INSTANCE?.trim() || "",
  envGreenApiToken: process.env.GREEN_API_TOKEN?.trim() || "",
  envGreenApiBaseUrl: (process.env.GREEN_API_BASE_URL?.trim() || "https://api.green-api.com").replace(
    /\/$/,
    ""
  ),
  envMetaAccessToken: process.env.META_ACCESS_TOKEN?.trim() || "",
  envMetaAdAccountId: process.env.META_AD_ACCOUNT_ID?.trim() || "",
  envMetaPageId: process.env.META_PAGE_ID?.trim() || "",
  envMetaWhatsappNumber: process.env.META_WHATSAPP_NUMBER?.trim() || "",
} as const;
