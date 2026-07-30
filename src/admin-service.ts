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

  const [msg24] = await sql<{
    entrant: number;
    sortant: number;
    sortant_quota: number;
  }[]>`
    SELECT
      COUNT(*) FILTER (WHERE direction = 'entrant')::int AS entrant,
      COUNT(*) FILTER (WHERE direction = 'sortant')::int AS sortant,
      COUNT(*) FILTER (
        WHERE direction = 'sortant' AND COALESCE(counts_toward_quota, 1) = 1
      )::int AS sortant_quota
    FROM messages
    WHERE created_at >= NOW() - INTERVAL '24 hours'
  `;

  const [msg7] = await sql<{
    entrant: number;
    sortant: number;
    sortant_quota: number;
  }[]>`
    SELECT
      COUNT(*) FILTER (WHERE direction = 'entrant')::int AS entrant,
      COUNT(*) FILTER (WHERE direction = 'sortant')::int AS sortant,
      COUNT(*) FILTER (
        WHERE direction = 'sortant' AND COALESCE(counts_toward_quota, 1) = 1
      )::int AS sortant_quota
    FROM messages
    WHERE created_at >= NOW() - INTERVAL '7 days'
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

  const [queue] = await sql<{
    pending: number;
    processing: number;
    failed: number;
    sent_24h: number;
  }[]>`
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
      COUNT(*) FILTER (
        WHERE status = 'sent' AND COALESCE(sent_at, send_at) >= NOW() - INTERVAL '24 hours'
      )::int AS sent_24h
    FROM send_queue
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

  let sequencesActive = 0;
  try {
    const [seq] = await sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM contact_sequences WHERE status = 'active'
    `;
    sequencesActive = Number(seq?.n ?? 0);
  } catch {
    sequencesActive = 0;
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
    { id: number; email: string; total_messages_sent: number; out_24h: number }[]
  >`
    SELECT
      u.id,
      u.email,
      u.total_messages_sent,
      COALESCE(m.out_24h, 0)::int AS out_24h
    FROM users u
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS out_24h
      FROM messages
      WHERE user_id = u.id
        AND direction = 'sortant'
        AND created_at >= NOW() - INTERVAL '24 hours'
    ) m ON true
    ORDER BY u.total_messages_sent DESC, out_24h DESC
    LIMIT 8
  `;

  return {
    users: {
      total: Number(usersRow?.total ?? 0),
      active: Number(usersRow?.active ?? 0),
      trial: Number(usersRow?.trial ?? 0),
      expired: Number(usersRow?.expired ?? 0),
      lifetimeOutbound: Number(usersRow?.lifetime_out ?? 0),
    },
    messages24h: {
      entrant: Number(msg24?.entrant ?? 0),
      sortant: Number(msg24?.sortant ?? 0),
      sortantQuota: Number(msg24?.sortant_quota ?? 0),
    },
    messages7d: {
      entrant: Number(msg7?.entrant ?? 0),
      sortant: Number(msg7?.sortant ?? 0),
      sortantQuota: Number(msg7?.sortant_quota ?? 0),
    },
    campaigns: {
      active: Number(campaigns?.active ?? 0),
      draft: Number(campaigns?.draft ?? 0),
      paused: Number(campaigns?.paused ?? 0),
      completed: Number(campaigns?.completed ?? 0),
    },
    queue: {
      pending: Number(queue?.pending ?? 0),
      processing: Number(queue?.processing ?? 0),
      failed: Number(queue?.failed ?? 0),
      sent24h: Number(queue?.sent_24h ?? 0),
    },
    errors24h,
    sequencesActive,
    recentUsers: recentUsers.map((u) => ({
      id: Number(u.id),
      email: u.email,
      name: u.name || "",
      createdAt: u.created_at,
    })),
    topOutbound: topOutbound.map((u) => ({
      id: Number(u.id),
      email: u.email,
      lifetimeSent: Number(u.total_messages_sent ?? 0),
      out24h: Number(u.out_24h ?? 0),
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
  messages24h: number;
  messagesOut24h: number;
  messagesIn24h: number;
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
      messages_24h: number;
      messages_out_24h: number;
      messages_in_24h: number;
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
      COALESCE(m.messages_24h, 0)::int AS messages_24h,
      COALESCE(m.messages_out_24h, 0)::int AS messages_out_24h,
      COALESCE(m.messages_in_24h, 0)::int AS messages_in_24h,
      COALESCE(a.active_campaigns, 0)::int AS active_campaigns,
      c.total_count
    FROM filtered f
    CROSS JOIN counted c
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS messages_24h,
        COUNT(*) FILTER (WHERE direction = 'sortant')::int AS messages_out_24h,
        COUNT(*) FILTER (WHERE direction = 'entrant')::int AS messages_in_24h
      FROM messages
      WHERE user_id = f.id AND created_at >= NOW() - INTERVAL '24 hours'
    ) m ON true
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
      totalMessagesSent: Number(r.total_messages_sent ?? 0),
      messages24h: Number(r.messages_24h ?? 0),
      messagesOut24h: Number(r.messages_out_24h ?? 0),
      messagesIn24h: Number(r.messages_in_24h ?? 0),
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
    sortant_quota: number;
    last_24h: number;
    last_7d: number;
    out_24h: number;
    in_24h: number;
  }[]>`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE direction = 'entrant')::int AS entrant,
      COUNT(*) FILTER (WHERE direction = 'sortant')::int AS sortant,
      COUNT(*) FILTER (
        WHERE direction = 'sortant' AND COALESCE(counts_toward_quota, 1) = 1
      )::int AS sortant_quota,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS last_24h,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS last_7d,
      COUNT(*) FILTER (
        WHERE direction = 'sortant' AND created_at >= NOW() - INTERVAL '24 hours'
      )::int AS out_24h,
      COUNT(*) FILTER (
        WHERE direction = 'entrant' AND created_at >= NOW() - INTERVAL '24 hours'
      )::int AS in_24h
    FROM messages
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

  const [queue] = await sql<{
    pending: number;
    processing: number;
    failed: number;
    sent_24h: number;
  }[]>`
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
      COUNT(*) FILTER (
        WHERE status = 'sent' AND COALESCE(sent_at, send_at) >= NOW() - INTERVAL '24 hours'
      )::int AS sent_24h
    FROM send_queue
    WHERE user_id = ${userId}
  `;

  let recentLogs: Array<{
    id: number;
    automation_id: number;
    level: string;
    message: string;
    created_at: string;
  }> = [];
  try {
    recentLogs = await sql`
      SELECT id, automation_id, level, message, created_at::text
      FROM automation_logs
      WHERE user_id = ${userId}
      ORDER BY id DESC
      LIMIT 30
    `;
  } catch {
    recentLogs = [];
  }

  let whatsapp: { connected: boolean; message: string } = {
    connected: false,
    message: "Non vérifié",
  };
  try {
    const state = await Promise.race([
      testEvolutionConnection(userId),
      new Promise<{ connected: boolean; message: string }>((resolve) =>
        setTimeout(
          () => resolve({ connected: false, message: "Timeout Evolution (3s)" }),
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

  let sequencesActive = 0;
  try {
    const [seq] = await sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n
      FROM contact_sequences
      WHERE user_id = ${userId} AND status = 'active'
    `;
    sequencesActive = Number(seq?.n ?? 0);
  } catch {
    sequencesActive = 0;
  }

  return {
    user: serializeUser(user),
    messages: {
      total: Number(msgStats?.total ?? 0),
      entrant: Number(msgStats?.entrant ?? 0),
      sortant: Number(msgStats?.sortant ?? 0),
      sortantQuota: Number(msgStats?.sortant_quota ?? 0),
      last_24h: Number(msgStats?.last_24h ?? 0),
      last_7d: Number(msgStats?.last_7d ?? 0),
      out24h: Number(msgStats?.out_24h ?? 0),
      in24h: Number(msgStats?.in_24h ?? 0),
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
    queue: {
      pending: Number(queue?.pending ?? 0),
      processing: Number(queue?.processing ?? 0),
      failed: Number(queue?.failed ?? 0),
      sent24h: Number(queue?.sent_24h ?? 0),
    },
    recentLogs: recentLogs.map((l) => ({
      id: Number(l.id),
      automationId: Number(l.automation_id),
      level: l.level,
      message: l.message,
      createdAt: l.created_at,
    })),
    whatsapp,
    autoReply,
    sequencesActive,
  };
}

export async function listAdminUserMessages(
  userId: number,
  opts: { limit?: number; offset?: number; direction?: string }
) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const direction = opts.direction === "entrant" || opts.direction === "sortant" ? opts.direction : "";

  const rows = await sql<
    {
      id: number;
      contact_phone: string;
      direction: string;
      body: string;
      sender_name: string | null;
      automation_id: number | null;
      created_at: string;
      total_count: number;
    }[]
  >`
    WITH filtered AS (
      SELECT *
      FROM messages
      WHERE user_id = ${userId}
        AND (${direction} = '' OR direction = ${direction})
    ),
    counted AS (SELECT COUNT(*)::int AS total_count FROM filtered)
    SELECT
      f.id,
      f.contact_phone,
      f.direction,
      f.body,
      f.sender_name,
      f.automation_id,
      f.created_at::text,
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
      contactPhone: r.contact_phone,
      direction: r.direction,
      body: r.body,
      senderName: r.sender_name,
      automationId: r.automation_id != null ? Number(r.automation_id) : null,
      createdAt: r.created_at,
    })),
  };
}

export async function listAdminUserActivity(userId: number, limit = 40) {
  const lim = Math.min(Math.max(limit, 1), 100);
  const agent = await sql<
    { id: number; role: string; content: string; created_at: string; kind: string }[]
  >`
    SELECT id, role, LEFT(content, 400) AS content, created_at::text, 'agent' AS kind
    FROM agent_conversation
    WHERE user_id = ${userId}
    ORDER BY id DESC
    LIMIT ${lim}
  `;
  const logs = await sql<
    { id: number; role: string; content: string; created_at: string; kind: string }[]
  >`
    SELECT id, level AS role, LEFT(message, 400) AS content, created_at::text, 'automation_log' AS kind
    FROM automation_logs
    WHERE user_id = ${userId}
    ORDER BY id DESC
    LIMIT ${lim}
  `;

  const merged = [...agent, ...logs]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, lim)
    .map((r) => ({
      id: Number(r.id),
      kind: r.kind,
      role: r.role,
      content: r.content,
      createdAt: r.created_at,
    }));

  return { items: merged };
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
