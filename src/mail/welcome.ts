/**
 * Email de bienvenue — première création de compte.
 */
import { config } from "../config.js";
import { isResendConfigured, sendEmail, type SendEmailResult } from "./resend.js";

const BRAND = "#2057CE";
const TEXT = "#0f172a";
const MUTED = "#64748b";
const BORDER = "#e2e8f0";
const BG = "#f8fafc";

export const WELCOME_TRIAL_DAYS = 3;

export type WelcomeEmailInput = {
  to: string;
  name: string;
  appUrl?: string;
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Prénom pour le salut (1er mot), sinon chaîne vide. */
export function welcomeFirstName(name: string): string {
  const first = String(name || "")
    .trim()
    .split(/\s+/)[0]
    ?.replace(/[^\p{L}\p{N}'’-]/gu, "");
  return first && first.length >= 2 ? first : "";
}

export function buildWelcomeEmailText(opts: {
  firstName: string;
  appUrl: string;
  trialDays: number;
}): string {
  const hello = opts.firstName ? `Bonjour ${opts.firstName},` : "Bonjour,";
  return [
    hello,
    "",
    "Bienvenue sur Klanvio.",
    "",
    `Ton compte est prêt. Tu disposes de ${opts.trialDays} jours d'essai pour connecter WhatsApp, configurer ton agent et lancer ta première automatisation (prospection, support ou diffusion dans tes groupes).`,
    "",
    "Pour bien démarrer :",
    "",
    "1. Connecte ton WhatsApp (scan QR)",
    "2. Relie Google Contacts (recommandé pour la prospection)",
    "3. Crée une automatisation et laisse-toi guider par l'agent",
    "",
    "Un numéro WhatsApp = un compte Klanvio. Si tu as déjà utilisé ce numéro sur un autre compte, reconnecte-toi avec celui d'origine.",
    "",
    `Accéder à l'app : ${opts.appUrl}`,
    "",
    "Une question ? Réponds à cet email — on te répond.",
    "",
    "À tout de suite,",
    "L'équipe Klanvio",
  ].join("\n");
}

export function buildWelcomeEmailHtml(opts: {
  firstName: string;
  appUrl: string;
  trialDays: number;
}): string {
  const title = opts.firstName
    ? `Bienvenue, ${esc(opts.firstName)}`
    : "Bienvenue sur Klanvio";
  const hello = opts.firstName
    ? `Bonjour ${esc(opts.firstName)},`
    : "Bonjour,";

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Bienvenue sur Klanvio</title></head>
<body style="margin:0;padding:0;background:${BG};font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${TEXT};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid ${BORDER};border-radius:12px;overflow:hidden;">
        <tr>
          <td style="background:${BRAND};padding:22px 28px;">
            <div style="font-size:13px;letter-spacing:0.04em;text-transform:uppercase;color:rgba(255,255,255,0.85);">Klanvio</div>
            <div style="font-size:20px;font-weight:700;color:#ffffff;margin-top:6px;">${title}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 28px 8px;font-size:15px;line-height:1.55;color:${TEXT};">
            <p style="margin:0 0 14px;">${hello}</p>
            <p style="margin:0 0 14px;">Bienvenue sur Klanvio.</p>
            <p style="margin:0 0 14px;">Ton compte est prêt. Tu disposes de <strong>${opts.trialDays}&nbsp;jours d'essai</strong> pour connecter WhatsApp, configurer ton agent et lancer ta première automatisation (prospection, support ou diffusion dans tes groupes).</p>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 28px 16px;">
            <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND};margin-bottom:10px;">Pour bien démarrer</div>
            <ol style="margin:0;padding-left:20px;font-size:15px;line-height:1.6;color:${TEXT};">
              <li style="margin-bottom:6px;">Connecte ton WhatsApp (scan QR)</li>
              <li style="margin-bottom:6px;">Relie Google Contacts (recommandé pour la prospection)</li>
              <li>Crée une automatisation et laisse-toi guider par l'agent</li>
            </ol>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 28px 20px;">
            <div style="padding:12px 14px;background:${BG};border:1px solid ${BORDER};border-radius:8px;font-size:13px;line-height:1.5;color:${MUTED};">
              Un numéro WhatsApp = un compte Klanvio. Si tu as déjà utilisé ce numéro sur un autre compte, reconnecte-toi avec celui d'origine.
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:0 28px 28px;" align="center">
            <a href="${esc(opts.appUrl)}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:8px;">Ouvrir Klanvio</a>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 28px;background:${BG};border-top:1px solid ${BORDER};font-size:12px;color:${MUTED};text-align:center;line-height:1.5;">
            Une question ? Réponds à cet email — on te répond.<br/>
            L'équipe Klanvio · ${esc(opts.appUrl)}
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function sendWelcomeEmail(
  input: WelcomeEmailInput
): Promise<SendEmailResult> {
  if (!isResendConfigured()) {
    return { ok: false, error: "RESEND_API_KEY manquant" };
  }
  const appUrl = (input.appUrl || config.appUrl || "https://www.klanvio.com").replace(
    /\/$/,
    ""
  );
  const appUrlWithPath = appUrl.endsWith("/app") ? appUrl : `${appUrl}/app`;
  const firstName = welcomeFirstName(input.name);
  const text = buildWelcomeEmailText({
    firstName,
    appUrl: appUrlWithPath,
    trialDays: WELCOME_TRIAL_DAYS,
  });
  const html = buildWelcomeEmailHtml({
    firstName,
    appUrl: appUrlWithPath,
    trialDays: WELCOME_TRIAL_DAYS,
  });

  return sendEmail({
    to: input.to,
    subject: `Bienvenue sur Klanvio — ton essai de ${WELCOME_TRIAL_DAYS} jours commence`,
    text,
    html,
  });
}

/**
 * Envoi non bloquant après inscription (ne fait pas échouer le register).
 */
export function queueWelcomeEmail(input: WelcomeEmailInput): void {
  void sendWelcomeEmail(input)
    .then((result) => {
      if (!result.ok) {
        console.warn(`[welcome-email] échec pour ${input.to}: ${result.error}`);
      } else {
        console.log(`[welcome-email] envoyé à ${input.to} id=${result.id}`);
      }
    })
    .catch((err) => {
      console.warn(
        `[welcome-email] erreur pour ${input.to}:`,
        err instanceof Error ? err.message : err
      );
    });
}
