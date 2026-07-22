/**
 * Resend transactional mail — HTTP API (no SDK dependency).
 * Secrets: RESEND_API_KEY, optional RESEND_FROM (default rapports@klanvio.com).
 */

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
};

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; error: string; status?: number };

function getFromAddress(): string {
  const raw = (process.env.RESEND_FROM || 'rapports@klanvio.com').trim();
  if (raw.includes('<')) return raw;
  return `Klanvio <${raw}>`;
}

export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

/** Convert plain-text report lines into simple HTML. */
export function plainTextToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const body = escaped
    .split('\n')
    .map((line) => (line.trim() ? line : '&nbsp;'))
    .join('<br/>');
  return `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111;padding:24px;">${body}</body></html>`;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: 'RESEND_API_KEY manquant' };
  }

  const to = Array.isArray(input.to) ? input.to : [input.to];
  const payload: Record<string, unknown> = {
    from: getFromAddress(),
    to,
    subject: input.subject,
    text: input.text,
    html: input.html ?? plainTextToHtml(input.text),
  };
  if (input.replyTo) payload.reply_to = input.replyTo;

  let res: Response;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Échec réseau Resend',
    };
  }

  const body = (await res.json().catch(() => ({}))) as {
    id?: string;
    message?: string;
    name?: string;
    error?: string;
  };

  if (!res.ok) {
    const msg =
      body.message ||
      body.error ||
      body.name ||
      `Resend HTTP ${res.status}`;
    return { ok: false, error: String(msg), status: res.status };
  }

  return { ok: true, id: body.id || 'unknown' };
}

export async function sendDailyReportEmail(opts: {
  to: string;
  campaignName: string;
  campaignId: number;
  text: string;
}): Promise<SendEmailResult> {
  return sendEmail({
    to: opts.to,
    subject: `Rapport du jour — ${opts.campaignName}`,
    text: opts.text,
  });
}

export async function sendWeeklyReportEmail(opts: {
  to: string;
  campaignName: string;
  text: string;
  html: string;
}): Promise<SendEmailResult> {
  return sendEmail({
    to: opts.to,
    subject: `Rapport hebdomadaire — ${opts.campaignName}`,
    text: opts.text,
    html: opts.html,
  });
}
