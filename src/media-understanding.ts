import OpenAI from "openai";
import { config } from "./config.js";
import { getAppSettings } from "./db.js";
import { getMessageMediaBase64 } from "./evolutionapi.js";

/**
 * Compréhension des médias entrants (notes vocales, images, etc.) via les modèles OpenAI.
 * Objectif : quand un prospect envoie un vocal ou une image, l'IA doit pouvoir « lire »
 * le contenu pour poursuivre la conversation naturellement, au lieu de rester bloquée.
 */

export type InboundMediaKind = "audio" | "image" | "video" | "document" | "sticker";

export interface InboundMediaInfo {
  kind: InboundMediaKind;
  /** Légende éventuelle jointe (image/vidéo/document). */
  caption?: string;
}

/** Détecte le type de média d'un message Baileys/Evolution entrant (payload webhook). */
export function detectInboundMedia(message: unknown): InboundMediaInfo | null {
  if (!message || typeof message !== "object") return null;
  const m = message as Record<string, unknown>;

  const readCaption = (key: string): string | undefined => {
    const obj = m[key];
    if (obj && typeof obj === "object") {
      const c = (obj as { caption?: string }).caption;
      if (typeof c === "string" && c.trim()) return c.trim();
    }
    return undefined;
  };

  if (m.audioMessage) return { kind: "audio" };
  if (m.imageMessage) return { kind: "image", caption: readCaption("imageMessage") };
  if (m.videoMessage) return { kind: "video", caption: readCaption("videoMessage") };
  if (m.documentWithCaptionMessage && typeof m.documentWithCaptionMessage === "object") {
    const inner = (m.documentWithCaptionMessage as { message?: Record<string, unknown> }).message;
    if (inner?.documentMessage) return { kind: "document" };
  }
  if (m.documentMessage) return { kind: "document" };
  if (m.stickerMessage) return { kind: "sticker" };
  return null;
}

/** Convertit le typeMessage renvoyé par l'historique Evolution en type de média. */
export function typeMessageToKind(typeMessage: string): InboundMediaKind | null {
  switch (typeMessage) {
    case "audioMessage":
    case "voiceMessage":
      return "audio";
    case "imageMessage":
      return "image";
    case "videoMessage":
      return "video";
    case "documentMessage":
    case "documentWithCaptionMessage":
      return "document";
    case "stickerMessage":
      return "sticker";
    default:
      return null;
  }
}

async function getOpenAiClient(userId: number): Promise<OpenAI> {
  const key = (await getAppSettings(userId)).openai_api_key;
  if (!key) throw new Error("Clé OpenAI manquante.");
  return new OpenAI({ apiKey: key });
}

function audioFileName(mimetype: string): string {
  const mt = mimetype.toLowerCase();
  if (mt.includes("ogg") || mt.includes("opus")) return "audio.ogg";
  if (mt.includes("mp4") || mt.includes("m4a") || mt.includes("aac")) return "audio.m4a";
  if (mt.includes("wav")) return "audio.wav";
  if (mt.includes("webm")) return "audio.webm";
  if (mt.includes("mpeg") || mt.includes("mp3")) return "audio.mp3";
  return "audio.ogg";
}

/** Transcrit une note vocale / un audio entrant (Whisper). */
async function transcribeAudio(userId: number, messageId: string): Promise<string | null> {
  const media = await getMessageMediaBase64(userId, messageId);
  const buffer = Buffer.from(media.base64, "base64");
  if (buffer.length === 0) return null;

  const client = await getOpenAiClient(userId);
  const file = await OpenAI.toFile(buffer, audioFileName(media.mimetype));
  const result = await client.audio.transcriptions.create({
    file,
    model: config.openaiTranscribeModel,
    language: "fr",
  });
  const text = (result.text ?? "").trim();
  return text || null;
}

/** Analyse une image entrante (vision) et décrit son contenu utile à la conversation. */
async function describeImage(userId: number, messageId: string, caption?: string): Promise<string | null> {
  const media = await getMessageMediaBase64(userId, messageId);
  if (!media.base64) return null;

  const client = await getOpenAiClient(userId);
  const dataUrl = `data:${media.mimetype};base64,${media.base64}`;
  const instruction =
    "Tu aides un entrepreneur à comprendre une image reçue d'un prospect sur WhatsApp. " +
    "Décris en français, en 1 à 2 phrases, ce que montre l'image et RETRANSCRIS tout texte visible " +
    "(capture d'écran, reçu de paiement, montant, référence, produit…). Va à l'essentiel, sans blabla." +
    (caption ? ` Légende jointe par le prospect : « ${caption} ».` : "");

  const response = await client.chat.completions.create({
    model: config.openaiVisionModel,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: instruction },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    max_tokens: 300,
    temperature: 0.2,
  });

  const text = response.choices[0]?.message?.content?.trim();
  return text || null;
}

/**
 * Produit un texte exploitable pour un média entrant afin que la prospection continue.
 * Renvoie null si le média n'est pas décodable (le caller utilisera un placeholder).
 * Le préfixe (🎤 / 🖼️) permet à l'IA de savoir que le prospect a envoyé un vocal/une image.
 */
export async function describeInboundMedia(
  userId: number,
  messageId: string,
  info: InboundMediaInfo
): Promise<string | null> {
  try {
    if (info.kind === "audio") {
      const transcript = await transcribeAudio(userId, messageId);
      if (!transcript) return null;
      return `🎤 (note vocale) ${transcript}`;
    }

    if (info.kind === "image" || info.kind === "sticker") {
      const description = await describeImage(userId, messageId, info.caption);
      if (!description) {
        return info.caption ? `🖼️ (image) ${info.caption}` : null;
      }
      const cap = info.caption ? ` — légende du prospect : « ${info.caption} »` : "";
      return `🖼️ (image) ${description}${cap}`;
    }

    // Vidéo / document : pas de décodage profond, mais on garde la légende éventuelle
    // pour que l'IA puisse rebondir dessus au lieu de rester muette.
    if (info.caption) {
      const label = info.kind === "video" ? "🎬 (vidéo)" : "📎 (document)";
      return `${label} ${info.caption}`;
    }
    return null;
  } catch (err) {
    console.error(`⚠️ Compréhension média (${info.kind}) échouée pour ${messageId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}
