import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { sql } from "./pg.js";
import type { UserRecord } from "./users.js";
import { setWorkspaceBillingPlan } from "./team.js";
import { listWhatsAppPhoneBindingsForUser } from "./whatsapp-phone-registry.js";

export type BillingPlanId = "starter" | "pro" | "business";
export type BillingPeriod = "monthly" | "annual";
export type BillingPaymentStatus = "pending" | "paid" | "cancelled" | "failed";

export type BillingPaymentRecord = {
  id: number;
  user_id: number;
  provider: "moneyfusion";
  provider_token: string;
  provider_checkout_url: string;
  plan_id: BillingPlanId;
  billing_period: BillingPeriod;
  amount_eur: number;
  customer_phone: string;
  customer_name: string;
  status: BillingPaymentStatus;
  provider_event: string | null;
  provider_raw: unknown;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
};

type MoneyFusionCreateResponse = {
  statut?: boolean;
  token?: string;
  url?: string;
  message?: string;
};

type MoneyFusionVerifyResponse = {
  statut?: boolean;
  data?: {
    tokenPay?: string;
    statut?: string;
    Montant?: number;
  };
  message?: string;
};

const PLAN_PRICE_EUR: Record<BillingPlanId, Record<BillingPeriod, number>> = {
  // Un seul tarif public — ids legacy gardés pour les checkouts existants.
  starter: { monthly: 20, annual: 200 },
  pro: { monthly: 20, annual: 200 },
  business: { monthly: 20, annual: 200 },
};

/** Parité fixe EUR → XOF (FCFA) — FusionPay attend un montant en francs (≥ 200 F). */
const EUR_TO_XOF = 655.957;

/**
 * TEMP test : forcer le checkout à 202 F (au-dessus du min Money Fusion).
 * Remettre à `null` pour facturer le vrai tarif EUR→XOF.
 */
const FORCE_CHECKOUT_AMOUNT_XOF: number | null = 202;

function eurToXof(amountEur: number): number {
  if (FORCE_CHECKOUT_AMOUNT_XOF != null) {
    return Math.max(200, Math.floor(FORCE_CHECKOUT_AMOUNT_XOF));
  }
  const xof = Math.round(Number(amountEur) * EUR_TO_XOF);
  // Garde-fou au-dessus du minimum Money Fusion (200 F).
  return Math.max(200, xof);
}

let billingSchemaReady = false;

export async function ensureBillingSchema(): Promise<void> {
  if (billingSchemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS billing_payments (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_token TEXT NOT NULL UNIQUE,
      provider_checkout_url TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      billing_period TEXT NOT NULL,
      amount_eur INTEGER NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      provider_event TEXT,
      provider_raw JSONB NOT NULL DEFAULT '{}'::jsonb,
      paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_billing_payments_user_created
    ON billing_payments (user_id, created_at DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_billing_payments_status
    ON billing_payments (status, created_at DESC)
  `;
  billingSchemaReady = true;
}

function moneyFusionConfigured(): boolean {
  return Boolean(config.moneyFusionApiUrl);
}

function planLabel(planId: BillingPlanId, period: BillingPeriod): string {
  const p = period === "annual" ? "annuel" : "mensuel";
  return `Abonnement Klanvio ${planId.toUpperCase()} (${p})`;
}

function resolveStatus(input: {
  webhookEvent?: string | null;
  webhookStatut?: string | null;
  verifiedStatut?: string | null;
}): BillingPaymentStatus {
  const normalizedEvent = (input.webhookEvent || "").toLowerCase();
  const normalizedWebhookStatut = (input.webhookStatut || "").toLowerCase();
  const normalizedVerifiedStatut = (input.verifiedStatut || "").toLowerCase();

  if (
    normalizedEvent.includes("completed") ||
    normalizedWebhookStatut === "paid" ||
    normalizedVerifiedStatut === "paid"
  ) {
    return "paid";
  }
  if (normalizedEvent.includes("cancelled")) return "cancelled";
  if (
    normalizedWebhookStatut === "failed" ||
    normalizedWebhookStatut === "no paid" ||
    normalizedVerifiedStatut === "failed" ||
    normalizedVerifiedStatut === "no paid"
  ) {
    return "failed";
  }
  return "pending";
}

async function moneyFusionCreatePayment(payload: Record<string, unknown>): Promise<MoneyFusionCreateResponse> {
  if (!moneyFusionConfigured()) {
    throw new Error("MONEYFUSION_API_URL manquante sur le serveur.");
  }
  const res = await fetch(config.moneyFusionApiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as MoneyFusionCreateResponse;
  if (!res.ok || !data.statut || !data.token || !data.url) {
    const msg = data.message || `MoneyFusion API a retourné HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

async function moneyFusionVerifyPayment(token: string): Promise<MoneyFusionVerifyResponse | null> {
  const safeToken = String(token || "").trim();
  if (!safeToken) return null;
  const url = `${config.moneyFusionVerifyBaseUrl}/${encodeURIComponent(safeToken)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return (await res.json().catch(() => null)) as MoneyFusionVerifyResponse | null;
}

function mapPayment(row: Record<string, unknown>): BillingPaymentRecord {
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    provider: "moneyfusion",
    provider_token: String(row.provider_token),
    provider_checkout_url: String(row.provider_checkout_url),
    plan_id: String(row.plan_id) as BillingPlanId,
    billing_period: String(row.billing_period) as BillingPeriod,
    amount_eur: Number(row.amount_eur),
    customer_phone: String(row.customer_phone),
    customer_name: String(row.customer_name),
    status: String(row.status) as BillingPaymentStatus,
    provider_event: row.provider_event == null ? null : String(row.provider_event),
    provider_raw: row.provider_raw ?? {},
    paid_at: row.paid_at == null ? null : String(row.paid_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function createMoneyFusionCheckout(input: {
  user: UserRecord;
  planId: BillingPlanId;
  billingPeriod: BillingPeriod;
  customerPhone?: string;
}): Promise<{ checkoutUrl: string; token: string }> {
  await ensureBillingSchema();
  const price = PLAN_PRICE_EUR[input.planId][input.billingPeriod];
  const webhookUrl = `${config.publicUrl}/api/billing/moneyfusion/webhook`;
  const returnUrl = `${config.appUrl}/?settings=billing&provider=moneyfusion`;
  const orderRef = `${input.user.id}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const customerName = input.user.name?.trim() || input.user.email;

  // FusionPay exige numeroSend ; la page checkout permet carte + Mobile Money.
  // On ne demande pas le numéro dans l'UI SaaS — WhatsApp lié ou placeholder API.
  let customerPhone = String(input.customerPhone || "").replace(/\D/g, "");
  if (customerPhone.length < 8) {
    try {
      const bindings = await listWhatsAppPhoneBindingsForUser(input.user.id);
      customerPhone = String(bindings[0]?.phoneKey || "").replace(/\D/g, "");
    } catch {
      /* ignore */
    }
  }
  if (customerPhone.length < 8) {
    customerPhone = "01010101";
  }

  // Affichage SaaS en € ; API Money Fusion / Mobile Money en XOF (FCFA).
  const priceXof = eurToXof(price);
  const payload = {
    totalPrice: priceXof,
    article: [
      {
        name: `${planLabel(input.planId, input.billingPeriod)} — ${price}€`,
        price: priceXof,
        quantity: 1,
      },
    ],
    personal_Info: [
      {
        userId: input.user.id,
        orderRef,
        planId: input.planId,
        billingPeriod: input.billingPeriod,
        amountEur: price,
        amountXof: priceXof,
      },
    ],
    numeroSend: customerPhone,
    nomclient: customerName,
    return_url: returnUrl,
    webhook_url: webhookUrl,
  };

  const created = await moneyFusionCreatePayment(payload);
  await sql`
    INSERT INTO billing_payments (
      user_id, provider, provider_token, provider_checkout_url, plan_id, billing_period,
      amount_eur, customer_phone, customer_name, status, provider_event, provider_raw
    )
    VALUES (
      ${input.user.id}, 'moneyfusion', ${created.token!}, ${created.url!}, ${input.planId},
      ${input.billingPeriod}, ${price}, ${customerPhone}, ${customerName},
      'pending', 'payin.session.pending', ${JSON.stringify(created)}::jsonb
    )
    ON CONFLICT (provider_token)
    DO UPDATE SET
      provider_checkout_url = EXCLUDED.provider_checkout_url,
      provider_raw = EXCLUDED.provider_raw,
      updated_at = NOW()
  `;

  return { checkoutUrl: created.url!, token: created.token! };
}

export async function getLatestBillingPaymentForUser(userId: number): Promise<BillingPaymentRecord | null> {
  await ensureBillingSchema();
  const rows = await sql<Record<string, unknown>[]>`
    SELECT *
    FROM billing_payments
    WHERE user_id = ${userId}
    ORDER BY id DESC
    LIMIT 1
  `;
  return rows.length ? mapPayment(rows[0]) : null;
}

export async function listBillingPaymentsForUser(
  userId: number,
  limit = 20
): Promise<BillingPaymentRecord[]> {
  await ensureBillingSchema();
  const safeLimit = Math.min(50, Math.max(1, Math.floor(limit)));
  const rows = await sql<Record<string, unknown>[]>`
    SELECT *
    FROM billing_payments
    WHERE user_id = ${userId}
    ORDER BY id DESC
    LIMIT ${safeLimit}
  `;
  return rows.map(mapPayment);
}

export async function findBillingPaymentByToken(token: string): Promise<BillingPaymentRecord | null> {
  await ensureBillingSchema();
  const rows = await sql<Record<string, unknown>[]>`
    SELECT *
    FROM billing_payments
    WHERE provider = 'moneyfusion' AND provider_token = ${token}
    LIMIT 1
  `;
  return rows.length ? mapPayment(rows[0]) : null;
}

async function applyPaidSubscription(
  userId: number,
  planId?: BillingPlanId,
  billingPeriod?: BillingPeriod,
): Promise<void> {
  const { activatePaidSubscription } = await import("./users.js");
  await activatePaidSubscription(userId, billingPeriod === "annual" ? "annual" : "monthly");
  if (planId) {
    await setWorkspaceBillingPlan(userId, planId);
  }
}

export async function syncMoneyFusionPaymentByToken(
  token: string,
  webhookRaw?: unknown,
): Promise<BillingPaymentRecord | null> {
  await ensureBillingSchema();
  const payment = await findBillingPaymentByToken(token);
  if (!payment) return null;

  const webhookObj = webhookRaw && typeof webhookRaw === "object" ? (webhookRaw as Record<string, unknown>) : {};
  const webhookEvent = webhookObj.event != null ? String(webhookObj.event) : null;
  const webhookStatut = webhookObj.statut != null ? String(webhookObj.statut) : null;
  const verified = await moneyFusionVerifyPayment(token);
  const verifiedStatut = verified?.data?.statut ? String(verified.data.statut) : null;
  const nextStatus = resolveStatus({
    webhookEvent,
    webhookStatut,
    verifiedStatut,
  });

  const rows = await sql<Record<string, unknown>[]>`
    UPDATE billing_payments
    SET
      status = ${nextStatus},
      provider_event = ${webhookEvent},
      provider_raw = ${JSON.stringify({
        webhook: webhookRaw ?? null,
        verified: verified ?? null,
      })}::jsonb,
      paid_at = CASE
        WHEN ${nextStatus} = 'paid' THEN COALESCE(paid_at, NOW())
        ELSE paid_at
      END,
      updated_at = NOW()
    WHERE id = ${payment.id}
    RETURNING *
  `;

  const updated = rows.length ? mapPayment(rows[0]) : null;
  if (updated?.status === "paid") {
    await applyPaidSubscription(updated.user_id, updated.plan_id, updated.billing_period);
  }
  return updated;
}
