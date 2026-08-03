/**
 * Interprétation des médias entrants WhatsApp.
 *
 * Images : vision Mistral Medium 3.5.
 * Audio : pas d'API Whisper côté Mistral → skip (note vocale ignorée).
 */

import { getMessageMediaBase64 } from "./evolutionapi.js";
import { getAppSettings } from "./db.js";
import { config } from "./config.js";
import { createLlmClient } from "./llm.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MediaKind = "audio" | "image" | "video" | "document" | "sticker";

export interface DetectedMedia {
  kind: MediaKind;
}

// ─── Détection ────────────────────────────────────────────────────────────────

/**
 * Détecte la présence d'un média dans un payload de message Evolution API
 * (chemin webhook MESSAGES_UPSERT).
 */
export function detectInboundMedia(message: unknown): DetectedMedia | null {
  if (!message || typeof message !== "object") return null;
  const m = message as Record<string, unknown>;

  if (m.audioMessage || m.voiceMessage || m.pttMessage) return { kind: "audio" };
  if (m.imageMessage) return { kind: "image" };
  if (m.videoMessage) return { kind: "video" };
  if (m.documentMessage || m.documentWithCaptionMessage) return { kind: "document" };
  if (m.stickerMessage) return { kind: "sticker" };
  return null;
}

/**
 * Convertit un `typeMessage` (tel que renvoyé par l'historique Evolution)
 * en MediaKind.
 */
export function typeMessageToKind(typeMessage: string | undefined): MediaKind | null {
  if (!typeMessage) return null;
  const t = typeMessage.toLowerCase();
  if (t.includes("audio") || t.includes("voice") || t.includes("ptt")) return "audio";
  if (t.includes("image")) return "image";
  if (t.includes("video")) return "video";
  if (t.includes("document")) return "document";
  if (t.includes("sticker")) return "sticker";
  return null;
}

// ─── Placeholders ─────────────────────────────────────────────────────────────

export function placeholderForKind(kind: MediaKind): string {
  switch (kind) {
    case "audio":    return "[Message vocal reçu]";
    case "image":    return "[Image reçue]";
    case "video":    return "[Vidéo reçue]";
    case "document": return "[Document reçu]";
    case "sticker":  return "[Sticker reçu]";
  }
}

// ─── Interprétation ───────────────────────────────────────────────────────────

async function resolveOpenAIKey(userId: number): Promise<string | null> {
  try {
    const s = await getAppSettings(userId);
    if (s.openai_api_key?.trim()) return s.openai_api_key.trim();
  } catch {
    // silencieux
  }
  return config.envOpenAiKey || null;
}

/**
 * Télécharge le média via Evolution API puis l'interprète avec OpenAI.
 *
 * Retourne :
 * - La transcription (audio) ou la description (image) si tout réussit.
 * - `null` si le média n'est pas interprétable ou si OpenAI échoue.
 *   → L'appelant doit alors utiliser `placeholderForKind()`.
 */
export async function describeInboundMedia(
  userId: number,
  messageId: string,
  media: DetectedMedia,
): Promise<string | null> {
  // On n'interprète que l'audio et les images (coût / utilité).
  if (media.kind !== "audio" && media.kind !== "image") return null;

  const apiKey = await resolveOpenAIKey(userId);
  if (!apiKey) return null;

  let base64: string;
  let mimetype: string;
  try {
    const result = await getMessageMediaBase64(userId, messageId);
    base64 = result.base64;
    mimetype = result.mimetype;
    console.log(
      `[media] Téléchargé ${media.kind} (${mimetype}, ${Math.round((base64.length * 3) / 4 / 1024)} Ko) pour ${messageId}`,
    );
  } catch (err) {
    console.warn(
      `[media] Téléchargement impossible pour le message ${messageId}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }

  try {
    if (media.kind === "audio") {
      const transcript = await transcribeAudio(apiKey, base64, mimetype);
      console.log(`[media] Transcription audio ${messageId}: ${transcript ? `« ${transcript.slice(0, 80)} »` : "(vide)"}`);
      return transcript;
    }
    if (media.kind === "image") {
      const desc = await describeImage(apiKey, base64, mimetype);
      console.log(`[media] Description image ${messageId}: ${desc ? `« ${desc.slice(0, 80)} »` : "(vide)"}`);
      return desc;
    }
  } catch (err) {
    console.warn(
      `[media] Interprétation (${media.kind}) échouée pour ${messageId}:`,
      err instanceof Error ? err.message : err,
    );
  }
  return null;
}

/** Retire les paramètres d'un mimetype (« audio/ogg; codecs=opus » → « audio/ogg »). */
function baseMimetype(mimetype: string): string {
  return mimetype.split(";")[0].trim().toLowerCase();
}

/**
 * Transcrit un audio (base64) fourni par l'utilisateur depuis l'interface web
 * (dictée vocale de l'input de chat). Retourne le texte, ou lève une erreur
 * explicite si aucune clé OpenAI n'est configurée.
 */
export async function transcribeChatAudio(
  userId: number,
  base64: string,
  mimetype: string,
): Promise<string> {
  const apiKey = await resolveOpenAIKey(userId);
  if (!apiKey) {
    throw new Error("Aucune clé IA configurée pour la transcription.");
  }
  const text = await transcribeAudio(apiKey, base64, mimetype || "audio/webm");
  return text ?? "";
}

// ─── Implémentations LLM ──────────────────────────────────────────────────────

async function transcribeAudio(
  _apiKey: string,
  _base64: string,
  _mimetype: string,
): Promise<string | null> {
  // Mistral Medium 3.5 n'expose pas Whisper — éviter un appel en erreur.
  console.warn("[media] Transcription audio indisponible avec Mistral — note vocale ignorée.");
  return null;
}

async function describeImage(
  apiKey: string,
  base64: string,
  mimetype: string,
): Promise<string | null> {
  const openai = createLlmClient(apiKey);
  const clean = baseMimetype(mimetype) || "image/jpeg";
  const dataUrl = `data:${clean};base64,${base64}`;

  const response = await openai.chat.completions.create({
    model: config.openaiModel,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Décris en 1-2 phrases ce que tu vois dans cette image (contexte : message WhatsApp reçu d'un prospect).",
          },
          {
            type: "image_url",
            image_url: { url: dataUrl, detail: "low" },
          },
        ],
      },
    ],
    max_tokens: 200,
  });

  const text = response.choices[0]?.message?.content?.trim();
  return text || null;
}

