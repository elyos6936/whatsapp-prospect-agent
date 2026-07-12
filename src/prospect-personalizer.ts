import OpenAI from "openai";
import { config } from "./config.js";
import { getAppSettings } from "./db.js";

export async function generatePersonalizedOpener(userId: number, input: {
  template: string;
  memberName: string;
  groupName: string;
  conversationGuide?: string;
}): Promise<string> {
  const key = (await getAppSettings(userId)).openai_api_key;
  if (!key) return personalizeFallback(input);

  const client = new OpenAI({ apiKey: key });
  const response = await client.chat.completions.create({
    model: config.openaiModel,
    messages: [
      {
        role: "system",
        content:
          "Tu personnalises un premier message WhatsApp de prospection. Court (2-4 phrases), humain, en français. Pas de placeholders. Utilise le prénom si disponible.",
      },
      {
        role: "user",
        content: `Groupe : ${input.groupName}
Membre : ${input.memberName}
Message modèle : ${input.template}
Consignes : ${input.conversationGuide || "Rester naturel et professionnel"}
Génère UNIQUEMENT le texte du message.`,
      },
    ],
    max_tokens: 200,
    temperature: 0.8,
  });

  const text = response.choices[0]?.message?.content?.trim();
  return text || personalizeFallback(input);
}

function personalizeFallback(input: {
  template: string;
  memberName: string;
}): string {
  const firstName = input.memberName.split(/\s+/)[0] || "";
  if (firstName && firstName.length > 1) {
    return input.template.replace(/\{nom\}/gi, firstName).replace(/^Bonjour,?/i, `Bonjour ${firstName},`);
  }
  return input.template;
}
