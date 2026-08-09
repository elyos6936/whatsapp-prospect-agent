import type { FastifyInstance } from "fastify";
import { requireUserId } from "./auth.js";
import { getUserById } from "./users.js";
import {
  createMoneyFusionCheckout,
  findBillingPaymentByToken,
  getLatestBillingPaymentForUser,
  syncMoneyFusionPaymentByToken,
  type BillingPeriod,
  type BillingPlanId,
} from "./billing-moneyfusion.js";

function isPlanId(v: string): v is BillingPlanId {
  return v === "starter" || v === "pro" || v === "business";
}

function isBillingPeriod(v: string): v is BillingPeriod {
  return v === "monthly" || v === "annual";
}

export async function registerBillingRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: { planId?: string; billingPeriod?: string; customerPhone?: string };
  }>("/api/billing/moneyfusion/checkout", async (request, reply) => {
    const userId = requireUserId(request);
    const user = await getUserById(userId);
    if (!user) return reply.status(404).send({ error: "Utilisateur introuvable." });

    const planId = String(request.body?.planId || "pro").trim().toLowerCase();
    const billingPeriod = String(request.body?.billingPeriod || "monthly").trim().toLowerCase();
    const customerPhone = String(request.body?.customerPhone || "").trim();

    if (!isPlanId(planId)) {
      return reply.status(400).send({ error: "Plan invalide." });
    }
    if (!isBillingPeriod(billingPeriod)) {
      return reply.status(400).send({ error: "Période de facturation invalide." });
    }

    try {
      const out = await createMoneyFusionCheckout({
        user,
        planId,
        billingPeriod,
        customerPhone: customerPhone || undefined,
      });
      return { ok: true, ...out };
    } catch (err) {
      return reply.status(502).send({
        error: err instanceof Error ? err.message : "Échec de création du paiement.",
      });
    }
  });

  app.get<{ Querystring: { token?: string } }>(
    "/api/billing/moneyfusion/verify",
    async (request, reply) => {
      const userId = requireUserId(request);
      const token = String(request.query?.token || "").trim();

      let payment = token
        ? await findBillingPaymentByToken(token)
        : await getLatestBillingPaymentForUser(userId);
      if (!payment) return reply.status(404).send({ error: "Paiement introuvable." });
      if (payment.user_id !== userId) {
        return reply.status(403).send({ error: "Paiement non autorisé." });
      }
      if (token) {
        payment = await syncMoneyFusionPaymentByToken(token);
        if (!payment) return reply.status(404).send({ error: "Paiement introuvable." });
      }
      const user = await getUserById(userId);
      return {
        ok: true,
        payment: {
          token: payment.provider_token,
          checkoutUrl: payment.provider_checkout_url,
          planId: payment.plan_id,
          billingPeriod: payment.billing_period,
          amountEur: payment.amount_eur,
          status: payment.status,
          paidAt: payment.paid_at,
          updatedAt: payment.updated_at,
        },
        subscription: user
          ? {
              status: user.subscription_status,
              periodEnd: user.subscription_period_end,
              trialStartedAt: user.trial_started_at,
              trialConversationsUsed: user.trial_conversations_used,
            }
          : null,
      };
    },
  );

  app.post("/api/billing/moneyfusion/webhook", async (request, reply) => {
    const payload = request.body && typeof request.body === "object"
      ? (request.body as Record<string, unknown>)
      : {};
    const token = String(payload.tokenPay ?? payload.token ?? "").trim();
    if (!token) {
      return reply.status(400).send({ error: "tokenPay manquant." });
    }
    const synced = await syncMoneyFusionPaymentByToken(token, payload);
    if (!synced) {
      return reply.status(404).send({ error: "Paiement inconnu." });
    }
    return { ok: true, token, status: synced.status };
  });
}
