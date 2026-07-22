/**
 * Rapport hebdomadaire campagne — payload, texte chat, HTML email.
 * Sans emojis. HTML table-safe (clients mail), pas de JS ni images externes.
 */

export type WeeklyReportPayload = {
  campaignName: string;
  campaignId: number;
  campaignStatus: string;
  /** Ex. « Semaine du 16/07/2026 au 22/07/2026 » */
  periodLabel: string;
  /** YYYY-MM-DD du vendredi de fin de période (clé d'idempotence). */
  fridayKey: string;
  messagesSent: number;
  messagesReceived: number;
  reached: number;
  answered: number;
  waitingReply: number;
  interested: number;
  stopped: number;
  conversions: number;
  /** Pourcentage entier, ou null si pas d'atteints. */
  responseRate: number | null;
  appUrl: string;
};

const BRAND = "#2057CE";
const TEXT = "#0f172a";
const MUTED = "#64748b";
const BORDER = "#e2e8f0";
const BG = "#f8fafc";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatFrFull(d: Date): string {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function addLocalDays(d: Date, days: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + days);
  return x;
}

/**
 * Fenêtre samedi 00:00 → vendredi 23:59:59 (7 jours) se terminant le vendredi donné.
 * `friday` doit être un vendredi (jour d'envoi).
 */
export function fridayWeeklyWindow(friday: Date): {
  fridayKey: string;
  periodStart: Date;
  periodEndExclusive: Date;
  periodLabel: string;
} {
  const endDay = startOfLocalDay(friday);
  const startDay = addLocalDays(endDay, -6); // samedi précédent
  const periodEndExclusive = addLocalDays(endDay, 1); // samedi suivant 00:00
  return {
    fridayKey: formatDateKey(endDay),
    periodStart: startDay,
    periodEndExclusive,
    periodLabel: `Semaine du ${formatFrFull(startDay)} au ${formatFrFull(endDay)}`,
  };
}

/** Aligné sur web/src/lib/campaign-metrics.ts outreachMetrics. */
export function funnelFromTargetStats(stats: {
  contacted?: number;
  replied?: number;
  interested?: number;
  stopped?: number;
}): {
  waitingReply: number;
  replied: number;
  interested: number;
  stopped: number;
  reached: number;
  answered: number;
  responseRate: number | null;
} {
  const waitingReply = Number(stats.contacted ?? 0);
  const replied = Number(stats.replied ?? 0);
  const interested = Number(stats.interested ?? 0);
  const stopped = Number(stats.stopped ?? 0);
  const reached = waitingReply + replied + interested + stopped;
  const answered = replied + interested + stopped;
  const responseRate = reached > 0 ? Math.round((answered / reached) * 100) : null;
  return { waitingReply, replied, interested, stopped, reached, answered, responseRate };
}

export function buildWeeklyReportText(p: WeeklyReportPayload): string {
  const rate =
    p.responseRate != null ? `${p.responseRate}%` : "— (aucun prospect atteint)";
  return [
    `Rapport hebdomadaire — « ${p.campaignName} » · ${p.campaignStatus}`,
    p.periodLabel,
    "",
    "Activité (7 jours)",
    `• Messages envoyés : ${p.messagesSent}`,
    `• Messages reçus : ${p.messagesReceived}`,
    "",
    "Funnel campagne",
    `• Atteints : ${p.reached}`,
    `• Réponses : ${p.answered}`,
    `• Sans réponse : ${p.waitingReply}`,
    `• Intéressés : ${p.interested}`,
    `• Arrêtés : ${p.stopped}`,
    `• Conversions : ${p.conversions}`,
    "",
    "Performance",
    `• Taux de réponse : ${rate}`,
    "",
    `Ouvre Klanvio pour le détail : ${p.appUrl}`,
  ].join("\n");
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function metricRow(label: string, value: string | number): string {
  return `<tr>
  <td style="padding:10px 0;border-bottom:1px solid ${BORDER};color:${MUTED};font-size:14px;">${esc(label)}</td>
  <td style="padding:10px 0;border-bottom:1px solid ${BORDER};text-align:right;font-size:15px;font-weight:600;color:${TEXT};">${esc(String(value))}</td>
</tr>`;
}

/** Barre horizontale email-safe (table imbriquée, largeur %). */
function rateBar(pct: number | null): string {
  if (pct == null) {
    return `<p style="margin:8px 0 0;color:${MUTED};font-size:13px;">Pas encore de prospects atteints.</p>`;
  }
  const clamped = Math.max(0, Math.min(100, pct));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border-collapse:collapse;">
  <tr>
    <td style="background:${BORDER};border-radius:6px;padding:0;">
      <table role="presentation" width="${clamped}%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr><td style="height:10px;background:${BRAND};border-radius:6px;font-size:0;line-height:0;">&nbsp;</td></tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="padding-top:8px;font-size:13px;color:${MUTED};">Taux de réponse : <strong style="color:${TEXT};">${clamped}%</strong></td>
  </tr>
</table>`;
}

export function buildWeeklyReportHtml(p: WeeklyReportPayload): string {
  const rateLabel = p.responseRate != null ? `${p.responseRate}%` : "—";
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Rapport hebdomadaire — ${esc(p.campaignName)}</title></head>
<body style="margin:0;padding:0;background:${BG};font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${TEXT};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid ${BORDER};border-radius:12px;overflow:hidden;">
        <tr>
          <td style="background:${BRAND};padding:22px 28px;">
            <div style="font-size:13px;letter-spacing:0.04em;text-transform:uppercase;color:rgba(255,255,255,0.85);">Klanvio</div>
            <div style="font-size:20px;font-weight:700;color:#ffffff;margin-top:6px;">Rapport hebdomadaire</div>
            <div style="font-size:14px;color:rgba(255,255,255,0.9);margin-top:8px;">${esc(p.periodLabel)}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 28px 8px;">
            <div style="font-size:16px;font-weight:600;color:${TEXT};">${esc(p.campaignName)}</div>
            <div style="font-size:13px;color:${MUTED};margin-top:4px;">Campagne ${esc(p.campaignStatus)} · #${p.campaignId}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 28px;">
            <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND};margin-bottom:8px;">Activité (7 jours)</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${metricRow("Messages envoyés", p.messagesSent)}${metricRow("Messages reçus", p.messagesReceived)}</table>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 28px 16px;">
            <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND};margin-bottom:8px;">Funnel campagne</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${metricRow("Atteints", p.reached)}${metricRow("Réponses", p.answered)}${metricRow("Sans réponse", p.waitingReply)}${metricRow("Intéressés", p.interested)}${metricRow("Arrêtés", p.stopped)}${metricRow("Conversions", p.conversions)}</table>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 28px 24px;">
            <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND};margin-bottom:4px;">Performance</div>
            <div style="font-size:28px;font-weight:700;color:${TEXT};line-height:1.2;">${esc(rateLabel)}</div>
            <div style="font-size:13px;color:${MUTED};">Taux de réponse (réponses / atteints)</div>
            ${rateBar(p.responseRate)}
          </td>
        </tr>
        <tr>
          <td style="padding:0 28px 28px;" align="center">
            <a href="${esc(p.appUrl)}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:8px;">Ouvrir Klanvio</a>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 28px;background:${BG};border-top:1px solid ${BORDER};font-size:12px;color:${MUTED};text-align:center;">
            Rapport automatique Klanvio · ${esc(p.appUrl)}
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** Données d'exemple pour aperçu / script de test. */
export function sampleWeeklyReportPayload(overrides?: Partial<WeeklyReportPayload>): WeeklyReportPayload {
  const friday = new Date(2026, 6, 17); // vendredi 17/07/2026
  const win = fridayWeeklyWindow(friday);
  return {
    campaignName: "Le Labo du No-Code – Prospection",
    campaignId: 80,
    campaignStatus: "active",
    periodLabel: win.periodLabel,
    fridayKey: win.fridayKey,
    messagesSent: 42,
    messagesReceived: 18,
    reached: 50,
    answered: 18,
    waitingReply: 32,
    interested: 5,
    stopped: 8,
    conversions: 3,
    responseRate: 36,
    appUrl: "https://www.klanvio.com",
    ...overrides,
  };
}
