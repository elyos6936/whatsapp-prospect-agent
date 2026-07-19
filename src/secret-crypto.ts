/**
 * Chiffrement au repos des secrets utilisateur (tokens OAuth, etc.).
 * AES-256-GCM — format stocké : v1:<iv_b64>:<tag_b64>:<cipher_b64>
 */

import crypto from "node:crypto";
import { config } from "./config.js";

const PREFIX = "v1";

function getKey(): Buffer {
  const raw = config.tokensEncryptionKey;
  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      "TOKENS_ENCRYPTION_KEY manquante ou invalide (attendu 64 hex = 32 bytes). " +
        "Générer avec : openssl rand -hex 32 — ne jamais changer en prod.",
    );
  }
  return Buffer.from(raw, "hex");
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error("Payload chiffré invalide.");
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const key = getKey();
  const iv = Buffer.from(ivB64!, "base64");
  const tag = Buffer.from(tagB64!, "base64");
  const data = Buffer.from(dataB64!, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function isTokensEncryptionConfigured(): boolean {
  return Boolean(config.tokensEncryptionKey && /^[0-9a-fA-F]{64}$/.test(config.tokensEncryptionKey));
}
