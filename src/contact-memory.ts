import OpenAI from "openai";
import { config } from "./config.js";
import {
  getAppSettings,
  getContact,
  getContactChatHistory,
  updateContactMemory,
} from "./db.js";

export async function getMemoryContextBlock(chatId: string): Promise<string> {
  const contact = await getContact(chatId);
  if (!contact?.memory_summary?.trim()) return "";
  return `Résumé des échanges précédents avec ce contact :\n${contact.memory_summary}`;
}

export async function refreshContactMemory(chatId: string): Promise<void> {
  const history = await getContactChatHistory(chatId, 40);
  if (history.length < 6) return;

  const contact = await getContact(chatId);
  if (contact?.memory_updated_at) {
    const last = new Date(contact.memory_updated_at.replace(" ", "T"));
    const hoursSince = (Date.now() - last.getTime()) / 3_600_000;
    if (hoursSince < 6) return;
  }

  const key = (await getAppSettings()).openai_api_key;
  if (!key) return;

  const transcript = history
    .map((m) => `${m.direction === "entrant" ? "Prospect" : "Moi"}: ${m.body}`)
    .join("\n");

  const client = new OpenAI({ apiKey: key });
  const response = await client.chat.completions.create({
    model: config.openaiModel,
    messages: [
      {
        role: "system",
        content:
          "Résume cette conversation WhatsApp en 5-8 lignes : qui est le prospect, son intérêt, objections, prix discuté, prochaine étape. Français, factuel.",
      },
      { role: "user", content: transcript },
    ],
    max_tokens: 300,
    temperature: 0.3,
  });

  const summary = response.choices[0]?.message?.content?.trim();
  if (summary) await updateContactMemory(chatId, summary);
}
