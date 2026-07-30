/**
 * Lecture / mutations cross-tenant pour le panneau ops.
 */
import { sql } from "./pg.js";
import {
  cancelPendingSendQueue,
  isAutoReplyEnabled,
  pauseAllActiveAutomations,
  setAutoReplyEnabled,
} from "./db.js";
import {
  getUserById,
  setSubscriptionStatus,
  type UserRecord,
} from "./users.js";
import {
  dailyCapsForLevel,
  type OutreachLevel,
  type SubscriptionStatus,
} from "./outreach-level.js";
import { testEvolutionConnection } from "./evolutionapi.js";
import { config } from "./config.js";

/** Jour calendaire dans le fuseau app (évite les « 0 aujourd’hui » dus à UTC Supabase). */
function isLocalDay(column: string) {
  // `column` vient uniquement du code ops (jamais d’entrée utilisateur).
  const tz = config.timezone.replace(/'/g, "''");
  return sql.unsafe(
    `(${column} AT TIME ZONE '${tz}')::date = (NOW() AT TIME ZONE '${tz}')::date`
  );
}

function outboundLifetime(counter: number, fromMessages: number, fromQueue = 0): number {
  return Math.max(counter, fromMessages, fromQueue);
}

let auditSchemaReady = false;

export async function ensureAdminAuditSchema(): Promise<void> {
  if (auditSchemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      ip TEXT,
      user_agent TEXT
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at ON admin_audit_log (created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_admin_audit_log_target ON admin_audit_log (target_user_id)`;
  auditSchemaReady = true;
}

export async function writeAdminAudit(input: {
  actor: string;
  action: string;
  targetUserId?: number | null;
  payload?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}): Promise<void> {
  await ensureAdminAuditSchema();
  await sql`
    INSERT INTO admin_audit_log (actor, action, target_user_id, payload, ip, user_agent)
    VALUES (
      ${input.actor},
      ${input.action},
      ${input.targetUserId ?? null},
      ${JSON.stringify(input.payload ?? {})}::jsonb,
      ${input.ip ?? null},
      ${input.userAgent ?? null}
    )
  `;
}

export async function getAdminOverview() {
  const [usersRow] = await sql<{
    total: number;
    active: number;
    trial: number;
    expired: number;
    lifetime_out: number;
  }[]>`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE subscription_status = 'active')::int AS active,
      COUNT(*) FILTER (WHERE subscription_status = 'trial')::int AS trial,
      COUNT(*) FILTER (WHERE subscription_status = 'expired')::int AS expired,
      COALESCE(SUM(total_messages_sent), 0)::int AS lifetime_out
    FROM users
  `;

  const [msgToday] = await sql<{
    entrant: number;
    sortant: number;
    lifetime_sortant: number;
  }[]>`
    SELECT
      COUNT(*) FILTER (
        WHERE direction = 'entrant' AND ${isLocalDay("created_at")}
      )::int AS entrant,
      COUNT(*) FILTER (
        WHERE direction = 'sortant' AND ${isLocalDay("created_at")}
      )::int AS sortant,
      COUNT(*) FILTER (WHERE direction = 'sortant')::int AS lifetime_sortant
    FROM messages
  `;

  const [msg7] = await sql<{ entrant: number; sortant: number }[]>`
    SELECT
      COUNT(*) FILTER (WHERE direction = 'entrant')::int AS entrant,
      COUNT(*) FILTER (WHERE direction = 'sortant')::int AS sortant
    FROM messages
    WHERE created_at >= NOW() - INTERVAL '7 days'
  `;

  const [queueSent] = await sql<{ lifetime: number; today: number }[]>`
    SELECT
      COUNT(*) FILTER (WHERE status = 'sent')::int AS lifetime,
      COUNT(*) FILTER (
        WHERE status = 'sent'
          AND ${isLocalDay("COALESCE(sent_at, send_at)")}
      )::int AS today
    FROM send_queue
  `;

  const [campaigns] = await sql<{
    active: number;
    draft: number;
    paused: number;
    completed: number;
  }[]>`
    SELECT
      COUNT(*) FILTER (WHERE status = 'active')::int AS active,
      COUNT(*) FILTER (WHERE status = 'draft')::int AS draft,
      COUNT(*) FILTER (WHERE status = 'paused')::int AS paused,
      COUNT(*) FILTER (WHERE status = 'completed')::int AS completed
    FROM automations
  `;

  let errors24h = 0;
  try {
    const [errRow] = await sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n
      FROM automation_logs
      WHERE created_at >= NOW() - INTERVAL '24 hours'
        AND lower(level) IN ('error', 'err', 'fatal')
    `;
    errors24h = Number(errRow?.n ?? 0);
  } catch {
    errors24h = 0;
  }

  const recentUsers = await sql<
    { id: number; email: string; name: string; created_at: string }[]
  >`
    SELECT id, email, name, created_at::text
    FROM users
    ORDER BY created_at DESC
    LIMIT 8
  `;

  const topOutbound = await sql<
    {
      id: number;
      email: string;
      total_messages_sent: number;
      msg_lifetime: number;
      queue_lifetime: number;
      out_today: number;
    }[]
  >`
    SELECT
      u.id,
      u.email,
      u.total_messages_sent,
      COALESCE(m.msg_lifetime, 0)::int AS msg_lifetime,
      COALESCE(q.queue_lifetime, 0)::int AS queue_lifetime,
      GREATEST(COALESCE(m.out_today, 0), COALESCE(q.out_today, 0))::int AS out_today
    FROM users u
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE direction = 'sortant')::int AS msg_lifetime,
        COUNT(*) FILTER (
          WHERE direction = 'sortant' AND ${isLocalDay("created_at")}
        )::int AS out_today
      FROM messages
      WHERE user_id = u.id
    ) m ON true
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE status = 'sent')::int AS queue_lifetime,
        COUNT(*) FILTER (
          WHERE status = 'sent'
            AND ${isLocalDay("COALESCE(sent_at, send_at)")}
        )::int AS out_today
      FROM send_queue
      WHERE user_id = u.id
    ) q ON true
    ORDER BY GREATEST(
      u.total_messages_sent,
      COALESCE(m.msg_lifetime, 0),
      COALESCE(q.queue_lifetime, 0)
    ) DESC
    LIMIT 8
  `;

  const lifetimeFromUsers = Number(usersRow?.lifetime_out ?? 0);
  const lifetimeFromMessages = Number(msgToday?.lifetime_sortant ?? 0);
  const lifetimeFromQueue = Number(queueSent?.lifetime ?? 0);
  const todayOut = Math.max(
    Number(msgToday?.sortant ?? 0),
    Number(queueSent?.today ?? 0)
  );

  return {
    users: {
      total: Number(usersRow?.total ?? 0),
      active: Number(usersRow?.active ?? 0),
      trial: Number(usersRow?.trial ?? 0),
      expired: Number(usersRow?.expired ?? 0),
    },
    messages: {
      envoyesAujourdhui: todayOut,
      recusAujourdhui: Number(msgToday?.entrant ?? 0),
      envoyes7j: Number(msg7?.sortant ?? 0),
      recus7j: Number(msg7?.entrant ?? 0),
      envoyesLifetime: outboundLifetime(
        lifetimeFromUsers,
        lifetimeFromMessages,
        lifetimeFromQueue
      ),
    },
    campaigns: {
      active: Number(campaigns?.active ?? 0),
      draft: Number(campaigns?.draft ?? 0),
      paused: Number(campaigns?.paused ?? 0),
      completed: Number(campaigns?.completed ?? 0),
    },
    errors24h,
    recentUsers: recentUsers.map((u) => ({
      id: Number(u.id),
      email: u.email,
      name: u.name || "",
      createdAt: u.created_at,
    })),
    topOutbound: topOutbound.map((u) => ({
      id: Number(u.id),
      email: u.email,
      envoyesLifetime: outboundLifetime(
        Number(u.total_messages_sent ?? 0),
        Number(u.msg_lifetime ?? 0),
        Number(u.queue_lifetime ?? 0)
      ),
      envoyesAujourdhui: Number(u.out_today ?? 0),
    })),
  };
}

export type AdminUserListItem = {
  id: number;
  email: string;
  name: string;
  subscriptionStatus: SubscriptionStatus;
  outreachLevel: number;
  totalMessagesSent: number;
  messagesTodayOut: number;
  messagesTodayIn: number;
  activeCampaigns: number;
  onboardingCompleted: boolean;
  createdAt: string;
};

export async function listAdminUsers(opts: {
  q?: string;
  status?: string;
  level?: number;
  limit?: number;
  offset?: number;
}): Promise<{ items: AdminUserListItem[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const q = opts.q?.trim() || "";
  const status = opts.status?.trim() || "";
  const level =
    opts.level != null && Number.isFinite(opts.level) ? Math.floor(opts.level) : null;

  const rows = await sql<
    {
      id: number;
      email: string;
      name: string;
      subscription_status: string;
      outreach_level: number;
      total_messages_sent: number;
      onboarding_completed: boolean;
      created_at: string;
      msg_lifetime: number;
      queue_lifetime: number;
      messages_today_out: number;
      messages_today_in: number;
      active_campaigns: number;
      total_count: number;
    }[]
  >`
    WITH filtered AS (
      SELECT u.*
      FROM users u
      WHERE
        (${q} = '' OR u.email ILIKE ${"%" + q + "%"} OR u.name ILIKE ${"%" + q + "%"})
        AND (${status} = '' OR u.subscription_status = ${status})
        AND (${level}::int IS NULL OR u.outreach_level = ${level})
    ),
    counted AS (
      SELECT COUNT(*)::int AS total_count FROM filtered
    )
    SELECT
      f.id,
      f.email,
      f.name,
      f.subscription_status,
      f.outreach_level,
      f.total_messages_sent,
      f.onboarding_completed,
      f.created_at::text,
      COALESCE(m.msg_lifetime, 0)::int AS msg_lifetime,
      COALESCE(q.queue_lifetime, 0)::int AS queue_lifetime,
      COALESCE(m.messages_today_out, 0)::int AS messages_today_out,
      COALESCE(m.messages_today_in, 0)::int AS messages_today_in,
      COALESCE(a.active_campaigns, 0)::int AS active_campaigns,
      c.total_count
    FROM filtered f
    CROSS JOIN counted c
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE direction = 'sortant')::int AS msg_lifetime,
        COUNT(*) FILTER (
          WHERE direction = 'sortant' AND ${isLocalDay("created_at")}
        )::int AS messages_today_out,
        COUNT(*) FILTER (
          WHERE direction = 'entrant' AND ${isLocalDay("created_at")}
        )::int AS messages_today_in
      FROM messages
      WHERE user_id = f.id
    ) m ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) FILTER (WHERE status = 'sent')::int AS queue_lifetime
      FROM send_queue
      WHERE user_id = f.id
    ) q ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS active_campaigns
      FROM automations
      WHERE user_id = f.id AND status = 'active'
    ) a ON true
    ORDER BY f.id DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const total = rows[0] ? Number(rows[0].total_count) : 0;
  return {
    total,
    items: rows.map((r) => ({
      id: Number(r.id),
      email: r.email,
      name: r.name || "",
      subscriptionStatus: (r.subscription_status === "active" || r.subscription_status === "expired"
        ? r.subscription_status
        : "trial") as SubscriptionStatus,
      outreachLevel: Number(r.outreach_level ?? 1),
      totalMessagesSent: outboundLifetime(
        Number(r.total_messages_sent ?? 0),
        Number(r.msg_lifetime ?? 0),
        Number(r.queue_lifetime ?? 0)
      ),
      messagesTodayOut: Number(r.messages_today_out ?? 0),
      messagesTodayIn: Number(r.messages_today_in ?? 0),
      activeCampaigns: Number(r.active_campaigns ?? 0),
      onboardingCompleted: Boolean(r.onboarding_completed),
      createdAt: r.created_at,
    })),
  };
}

function serializeUser(user: UserRecord) {
  const caps = dailyCapsForLevel(user.outreach_level);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatar_url,
    onboardingCompleted: user.onboarding_completed,
    business: {
      ownerName: user.business_owner_name,
      offer: user.business_offer,
      price: user.business_price,
    },
    subscriptionStatus: user.subscription_status,
    outreachLevel: user.outreach_level,
    totalMessagesSent: user.total_messages_sent,
    trialConversationsUsed: user.trial_conversations_used,
    dailyCaps: caps,
    createdAt: user.created_at,
  };
}

export async function getAdminUserDetail(userId: number) {
  const user = await getUserById(userId);
  if (!user) return null;

  const [msgStats] = await sql<{
    total: number;
    entrant: number;
    sortant: number;
    out_today: number;
    in_today: number;
    last_7d: number;
  }[]>`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE direction = 'entrant')::int AS entrant,
      COUNT(*) FILTER (WHERE direction = 'sortant')::int AS sortant,
      COUNT(*) FILTER (
        WHERE direction = 'sortant' AND ${isLocalDay("created_at")}
      )::int AS out_today,
      COUNT(*) FILTER (
        WHERE direction = 'entrant' AND ${isLocalDay("created_at")}
      )::int AS in_today,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS last_7d
    FROM messages
    WHERE user_id = ${userId}
  `;

  const [queueStats] = await sql<{ lifetime: number; today: number }[]>`
    SELECT
      COUNT(*) FILTER (WHERE status = 'sent')::int AS lifetime,
      COUNT(*) FILTER (
        WHERE status = 'sent' AND ${isLocalDay("COALESCE(sent_at, send_at)")}
      )::int AS today
    FROM send_queue
    WHERE user_id = ${userId}
  `;

  const campaigns = await sql<
    {
      id: number;
      name: string;
      type: string;
      status: string;
      stats_json: string;
      created_at: string;
      updated_at: string;
    }[]
  >`
    SELECT id, name, type, status, stats_json, created_at::text, updated_at::text
    FROM automations
    WHERE user_id = ${userId}
    ORDER BY id DESC
    LIMIT 50
  `;

  let whatsapp: { connected: boolean; message: string } = {
    connected: false,
    message: "Non vérifié",
  };
  try {
    const state = await Promise.race([
      testEvolutionConnection(userId),
      new Promise<{ connected: boolean; message: string }>((resolve) =>
        setTimeout(
          () => resolve({ connected: false, message: "Délai dépassé (3s)" }),
          3000
        )
      ),
    ]);
    whatsapp = { connected: state.connected, message: state.message };
  } catch (err) {
    whatsapp = {
      connected: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const autoReply = await isAutoReplyEnabled(userId).catch(() => false);

  const sortant = outboundLifetime(
    Number(user.total_messages_sent ?? 0),
    Number(msgStats?.sortant ?? 0),
    Number(queueStats?.lifetime ?? 0)
  );
  const serialized = serializeUser(user);
  serialized.totalMessagesSent = sortant;

  return {
    user: serialized,
    messages: {
      total: Number(msgStats?.total ?? 0),
      entrant: Number(msgStats?.entrant ?? 0),
      sortant,
      envoyesAujourdhui: Math.max(
        Number(msgStats?.out_today ?? 0),
        Number(queueStats?.today ?? 0)
      ),
      recusAujourdhui: Number(msgStats?.in_today ?? 0),
      derniers7j: Number(msgStats?.last_7d ?? 0),
    },
    campaigns: campaigns.map((c) => {
      let stats: Record<string, unknown> = {};
      try {
        stats = JSON.parse(c.stats_json || "{}") as Record<string, unknown>;
      } catch {
        stats = {};
      }
      return {
        id: Number(c.id),
        name: c.name,
        type: c.type,
        status: c.status,
        stats,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      };
    }),
    whatsapp,
    autoReply,
  };
}

/** @deprecated Contenu conversations — non exposé. */
export async function listAdminUserMessages(): Promise<{ items: never[]; total: number }> {
  return { items: [], total: 0 };
}

export async function listAdminUserActivity(): Promise<{ items: never[] }> {
  return { items: [] };
}

export async function listAdminAudit(opts: {
  limit?: number;
  offset?: number;
  targetUserId?: number;
}) {
  await ensureAdminAuditSchema();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const target =
    opts.targetUserId != null && Number.isFinite(opts.targetUserId)
      ? Math.floor(opts.targetUserId)
      : null;

  const rows = await sql<
    {
      id: number;
      created_at: string;
      actor: string;
      action: string;
      target_user_id: number | null;
      payload: unknown;
      ip: string | null;
      total_count: number;
    }[]
  >`
    WITH filtered AS (
      SELECT *
      FROM admin_audit_log
      WHERE (${target}::int IS NULL OR target_user_id = ${target})
    ),
    counted AS (SELECT COUNT(*)::int AS total_count FROM filtered)
    SELECT
      f.id,
      f.created_at::text,
      f.actor,
      f.action,
      f.target_user_id,
      f.payload,
      f.ip,
      c.total_count
    FROM filtered f
    CROSS JOIN counted c
    ORDER BY f.id DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  return {
    total: rows[0] ? Number(rows[0].total_count) : 0,
    items: rows.map((r) => ({
      id: Number(r.id),
      createdAt: r.created_at,
      actor: r.actor,
      action: r.action,
      targetUserId: r.target_user_id != null ? Number(r.target_user_id) : null,
      payload: r.payload ?? {},
      ip: r.ip,
    })),
  };
}

export async function adminUpdateSubscription(
  userId: number,
  input: {
    status?: SubscriptionStatus;
    outreachLevel?: number;
    trialConversationsUsed?: number;
    resetTrial?: boolean;
  }
): Promise<UserRecord | null> {
  const user = await getUserById(userId);
  if (!user) return null;

  if (input.status) {
    await setSubscriptionStatus(userId, input.status);
  }

  if (input.outreachLevel != null) {
    const level = Math.min(5, Math.max(1, Math.floor(input.outreachLevel))) as OutreachLevel;
    await sql`UPDATE users SET outreach_level = ${level} WHERE id = ${userId}`;
  }

  if (input.resetTrial) {
    await sql`UPDATE users SET trial_conversations_used = 0 WHERE id = ${userId}`;
  } else if (input.trialConversationsUsed != null) {
    const n = Math.max(0, Math.floor(input.trialConversationsUsed));
    await sql`UPDATE users SET trial_conversations_used = ${n} WHERE id = ${userId}`;
  }

  return getUserById(userId);
}

export async function adminUpdateOutreach(
  userId: number,
  input: { outreachLevel?: number; totalMessagesSent?: number }
): Promise<UserRecord | null> {
  const user = await getUserById(userId);
  if (!user) return null;

  if (input.totalMessagesSent != null) {
    const total = Math.max(0, Math.floor(input.totalMessagesSent));
    await sql`UPDATE users SET total_messages_sent = ${total} WHERE id = ${userId}`;
  }
  if (input.outreachLevel != null) {
    const level = Math.min(5, Math.max(1, Math.floor(input.outreachLevel)));
    await sql`UPDATE users SET outreach_level = ${level} WHERE id = ${userId}`;
  }
  return getUserById(userId);
}

export async function adminCancelQueue(userId: number): Promise<number> {
  const viaApi = await cancelPendingSendQueue(userId);
  const extra = await sql`
    UPDATE send_queue
    SET status = 'cancelled', error = 'Annulé par admin', claimed_at = NULL
    WHERE user_id = ${userId} AND status IN ('pending', 'processing')
  `;
  return viaApi + Number(extra.count);
}

export async function adminStopOutbound(userId: number): Promise<{
  paused: number;
  queueCancelled: number;
}> {
  const paused = await pauseAllActiveAutomations(userId);
  const queueCancelled = await adminCancelQueue(userId);
  await setAutoReplyEnabled(userId, false);
  await sql`
    UPDATE contacts SET auto_reply = 0, updated_at = NOW()
    WHERE user_id = ${userId} AND auto_reply = 1
  `;
  await sql`
    UPDATE contact_sequences SET status = 'cancelled', next_step_at = NULL
    WHERE user_id = ${userId} AND status = 'active'
  `;
  return { paused, queueCancelled };
}
