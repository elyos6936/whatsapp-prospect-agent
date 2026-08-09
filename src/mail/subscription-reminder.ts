/**
 * Rappels email avant échéance d'abonnement payé.
 */
import { config } from "../config.js";
import { isResendConfigured, sendEmail, type SendEmailResult } from "./resend.js";

const BRAND = "#2057CE";
const TEXT = "#0f172a";
const MUTED = "#64748b";
const BORDER = "#e2e8f0";
const BG = "#f8fafc";

export type RenewalReminderDays = 7 | 1;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function firstName(name: string): string {
  const first = String(name || "")
    .trim()
    .split(/\s+/)[0]
    ?.replace(/[^\p{L}\p{N}'’-]/gu, "");
  return first && first.length >= 2 ? first : "";
}

function formatFrDate(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function buildRenewalReminderText(opts: {
  name: string;
  daysLeft: RenewalReminderDays;
  periodEnd: string;
  billingUrl: string;
}): string {
  const hello = firstName(opts.name) ? `Bonjour ${firstName(opts.name)},` : "Bonjour,";
  const when =
    opts.daysLeft === 1
      ? "demain"
      : `dans ${opts.daysLeft} jours`;
  return [
    hello,
    "",
    `Ton abonnement Klanvio arrive à échéance ${when} (${formatFrDate(opts.periodEnd)}).`,
    "",
    "Pour éviter toute interruption (campagnes, réponses auto, envois), renouvelle dès maintenant depuis Paramètres → Facturation.",
    "",
    `Renouveler : ${opts.billingUrl}`,
    "",
    "Si tu as déjà renouvelé, ignore cet email.",
    "",
    "L'équipe Klanvio",
  ].join("\n");
}

export function buildRenewalReminderHtml(opts: {
  name: string;
  daysLeft: RenewalReminderDays;
  periodEnd: string;
  billingUrl: string;
}): string {
  const fn = firstName(opts.name);
  const hello = fn ? `Bonjour ${esc(fn)},` : "Bonjour,";
  const when =
    opts.daysLeft === 1
      ? "demain"
      : `dans ${opts.daysLeft} jours`;
  const title =
    opts.daysLeft === 1
      ? "Ton abonnement expire demain"
      : `Ton abonnement expire dans ${opts.daysLeft} jours`;

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${BG};font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${TEXT};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid ${BORDER};border-radius:12px;overflow:hidden;">
        <tr>
          <td style="background:${BRAND};padding:22px 28px;">
            <div style="font-size:13px;letter-spacing:0.04em;text-transform:uppercase;color:rgba(255,255,255,0.85);">Klanvio</div>
            <div style="font-size:20px;font-weight:700;color:#ffffff;margin-top:6px;">${esc(title)}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 28px 8px;font-size:15px;line-height:1.55;color:${TEXT};">
            <p style="margin:0 0 14px;">${hello}</p>
            <p style="margin:0 0 14px;">Ton abonnement arrive à échéance <strong>${esc(when)}</strong> — le <strong>${esc(formatFrDate(opts.periodEnd))}</strong>.</p>
            <p style="margin:0 0 14px;color:${MUTED};font-size:14px;">Sans renouvellement, les campagnes et l'envoi seront suspendus à cette date.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 28px 28px;" align="center">
            <a href="${esc(opts.billingUrl)}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:8px;">Renouveler mon abonnement</a>
          </td>
        </tr>
        <tr>
          <td style="padding:0 28px 24px;font-size:12px;line-height:1.5;color:${MUTED};">
            Si tu as déjà renouvelé, tu peux ignorer cet email.
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function sendSubscriptionRenewalReminder(opts: {
  to: string;
  name: string;
  daysLeft: RenewalReminderDays;
  periodEnd: string;
}): Promise<SendEmailResult> {
  if (!isResendConfigured()) {
    return { ok: false, error: "RESEND_API_KEY manquant" };
  }
  const billingUrl = `${config.appUrl.replace(/\/$/, "")}/?settings=billing`;
  const text = buildRenewalReminderText({ ...opts, billingUrl });
  const html = buildRenewalReminderHtml({ ...opts, billingUrl });
  const subject =
    opts.daysLeft === 1
      ? "Klanvio — ton abonnement expire demain"
      : `Klanvio — ton abonnement expire dans ${opts.daysLeft} jours`;
  return sendEmail({ to: opts.to, subject, text, html });
}
