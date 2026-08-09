/**
 * Job : emails de rappel J-7 et J-1 avant fin d'abonnement payé.
 */
import { sql } from "./pg.js";
import { ensureUserOutreachSchema } from "./users.js";
import {
  sendSubscriptionRenewalReminder,
  type RenewalReminderDays,
} from "./mail/subscription-reminder.js";
import { isResendConfigured } from "./mail/resend.js";

function reminderKey(periodEndIso: string, days: RenewalReminderDays): string {
  return `${new Date(periodEndIso).toISOString()}#${days}`;
}

export async function sendDueSubscriptionRenewalReminders(): Promise<{
  sent7: number;
  sent1: number;
  skipped: number;
}> {
  await ensureUserOutreachSchema();
  if (!isResendConfigured()) {
    return { sent7: 0, sent1: 0, skipped: 0 };
  }

  let sent7 = 0;
  let sent1 = 0;
  let skipped = 0;

  // J-7 : échéance dans [6j ; 7j] (fenêtre ~24h pour le job 15 min)
  const due7 = await sql<
    {
      id: number;
      email: string;
      name: string;
      subscription_period_end: string;
      subscription_renewal_reminder_key: string | null;
    }[]
  >`
    SELECT id, email, name,
           subscription_period_end::text AS subscription_period_end,
           subscription_renewal_reminder_key
    FROM users
    WHERE deleted_at IS NULL
      AND account_status = 'active'
      AND subscription_status = 'active'
      AND subscription_period_end IS NOT NULL
      AND subscription_period_end > NOW()
      AND subscription_period_end <= NOW() + INTERVAL '7 days'
      AND subscription_period_end > NOW() + INTERVAL '1 day'
  `;

  for (const row of due7) {
    const key = reminderKey(row.subscription_period_end, 7);
    if (row.subscription_renewal_reminder_key === key) {
      skipped += 1;
      continue;
    }
    // Déjà rappelé J-1 pour la même échéance ? ne pas renvoyer J-7
    if (row.subscription_renewal_reminder_key === reminderKey(row.subscription_period_end, 1)) {
      skipped += 1;
      continue;
    }
    const res = await sendSubscriptionRenewalReminder({
      to: row.email,
      name: row.name || "",
      daysLeft: 7,
      periodEnd: row.subscription_period_end,
    });
    if (!res.ok) {
      skipped += 1;
      continue;
    }
    await sql`
      UPDATE users
      SET subscription_renewal_reminder_key = ${key}
      WHERE id = ${row.id}
    `;
    sent7 += 1;
  }

  const due1 = await sql<
    {
      id: number;
      email: string;
      name: string;
      subscription_period_end: string;
      subscription_renewal_reminder_key: string | null;
    }[]
  >`
    SELECT id, email, name,
           subscription_period_end::text AS subscription_period_end,
           subscription_renewal_reminder_key
    FROM users
    WHERE deleted_at IS NULL
      AND account_status = 'active'
      AND subscription_status = 'active'
      AND subscription_period_end IS NOT NULL
      AND subscription_period_end > NOW()
      AND subscription_period_end <= NOW() + INTERVAL '1 day'
  `;

  for (const row of due1) {
    const key = reminderKey(row.subscription_period_end, 1);
    if (row.subscription_renewal_reminder_key === key) {
      skipped += 1;
      continue;
    }
    const res = await sendSubscriptionRenewalReminder({
      to: row.email,
      name: row.name || "",
      daysLeft: 1,
      periodEnd: row.subscription_period_end,
    });
    if (!res.ok) {
      skipped += 1;
      continue;
    }
    await sql`
      UPDATE users
      SET subscription_renewal_reminder_key = ${key}
      WHERE id = ${row.id}
    `;
    sent1 += 1;
  }

  return { sent7, sent1, skipped };
}
