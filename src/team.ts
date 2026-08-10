import { randomBytes } from "node:crypto";
import { sql } from "./pg.js";
import { config } from "./config.js";
import { getUserByEmail, getUserById } from "./users.js";
import { sendEmail } from "./mail/resend.js";

export type TeamRole = "owner" | "admin" | "member";
export type BillingPlanId = "starter" | "pro" | "business";
export type InviteRole = "admin" | "member";

export const TEAM_INVITE_DAYS = 7;

export interface WorkspaceContext {
  workspaceId: number;
  ownerUserId: number;
  role: TeamRole;
  billingPlan: BillingPlanId;
  workspaceName: string;
}

export interface TeamMemberRow {
  userId: number;
  email: string;
  name: string;
  role: TeamRole;
  joinedAt: string;
}

export interface TeamInviteRow {
  id: number;
  email: string;
  role: InviteRole;
  expiresAt: string;
  createdAt: string;
  invitedByName: string;
}

export interface WorkspaceListItem {
  id: number;
  name: string;
  role: TeamRole;
  billingPlan: BillingPlanId;
  ownerUserId: number;
  ownerName: string;
  /** true = workspace dont l'utilisateur est le propriétaire (espace perso). */
  isPersonal: boolean;
}

let schemaReady = false;

export async function ensureTeamSchema(): Promise<void> {
  if (schemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS workspaces (
      id BIGSERIAL PRIMARY KEY,
      owner_user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT '',
      billing_plan TEXT NOT NULL DEFAULT 'starter',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, user_id)
    )
  `;
  // Anciennes installs : UNIQUE global user_id → une seule membership.
  await sql`ALTER TABLE workspace_members DROP CONSTRAINT IF EXISTS workspace_members_user_id_key`;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members (user_id)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS workspace_invites (
      id BIGSERIAL PRIMARY KEY,
      workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      token TEXT NOT NULL UNIQUE,
      invited_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      accepted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS active_workspace_id BIGINT
  `;
  schemaReady = true;
}

export function maxInviteSlots(plan: BillingPlanId): number | null {
  if (plan === "starter") return 2;
  if (plan === "pro") return 3;
  return null;
}

function normalizePlan(raw: string | null | undefined): BillingPlanId {
  if (raw === "pro" || raw === "business") return raw;
  return "starter";
}

function mapWorkspaceContext(row: Record<string, unknown>): WorkspaceContext {
  return {
    workspaceId: Number(row.workspace_id ?? row.id),
    ownerUserId: Number(row.owner_user_id),
    role: String(row.role ?? "owner") as TeamRole,
    billingPlan: normalizePlan(String(row.billing_plan ?? "starter")),
    workspaceName: String(row.workspace_name ?? row.name ?? "Mon équipe"),
  };
}

async function createWorkspaceForOwner(userId: number): Promise<WorkspaceContext> {
  await ensureTeamSchema();
  const user = await getUserById(userId);
  const name = (user?.name || user?.email?.split("@")[0] || "Mon équipe").trim();
  const rows = await sql<Record<string, unknown>[]>`
    INSERT INTO workspaces (owner_user_id, name, billing_plan)
    VALUES (${userId}, ${name}, 'starter')
    ON CONFLICT (owner_user_id) DO UPDATE SET name = EXCLUDED.name
    RETURNING id, owner_user_id, name, billing_plan
  `;
  const ws = rows[0];
  const workspaceId = Number(ws.id);
  await sql`
    INSERT INTO workspace_members (workspace_id, user_id, role)
    VALUES (${workspaceId}, ${userId}, 'owner')
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner'
  `;
  return {
    workspaceId,
    ownerUserId: userId,
    role: "owner",
    billingPlan: normalizePlan(String(ws.billing_plan)),
    workspaceName: String(ws.name || name),
  };
}

async function loadMembershipContext(
  actorUserId: number,
  workspaceId: number
): Promise<WorkspaceContext | null> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT
      w.id AS workspace_id,
      w.owner_user_id,
      w.billing_plan,
      w.name AS workspace_name,
      m.role
    FROM workspace_members m
    JOIN workspaces w ON w.id = m.workspace_id
    WHERE m.user_id = ${actorUserId}
      AND m.workspace_id = ${workspaceId}
    LIMIT 1
  `;
  if (!rows.length) return null;
  return mapWorkspaceContext(rows[0]);
}

/** Résout le workspace actif (active_workspace_id) ou fallback perso / première membership. */
export async function resolveWorkspaceContext(actorUserId: number): Promise<WorkspaceContext> {
  await ensureTeamSchema();

  const activeRows = await sql<{ active_workspace_id: number | null }[]>`
    SELECT active_workspace_id FROM users WHERE id = ${actorUserId} LIMIT 1
  `;
  const activeId = activeRows[0]?.active_workspace_id;
  if (activeId != null && Number.isFinite(Number(activeId))) {
    const activeCtx = await loadMembershipContext(actorUserId, Number(activeId));
    if (activeCtx) return activeCtx;
  }

  const ownedRows = await sql<Record<string, unknown>[]>`
    SELECT
      w.id AS workspace_id,
      w.owner_user_id,
      w.billing_plan,
      w.name AS workspace_name,
      COALESCE(m.role, 'owner') AS role
    FROM workspaces w
    LEFT JOIN workspace_members m
      ON m.workspace_id = w.id AND m.user_id = ${actorUserId}
    WHERE w.owner_user_id = ${actorUserId}
    LIMIT 1
  `;
  if (ownedRows.length) {
    const ctx = mapWorkspaceContext(ownedRows[0]);
    await sql`
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES (${ctx.workspaceId}, ${actorUserId}, 'owner')
      ON CONFLICT (workspace_id, user_id) DO NOTHING
    `;
    await sql`
      UPDATE users SET active_workspace_id = ${ctx.workspaceId}
      WHERE id = ${actorUserId}
        AND (active_workspace_id IS NULL OR active_workspace_id <> ${ctx.workspaceId})
    `;
    return ctx;
  }

  const memberRows = await sql<Record<string, unknown>[]>`
    SELECT
      w.id AS workspace_id,
      w.owner_user_id,
      w.billing_plan,
      w.name AS workspace_name,
      m.role
    FROM workspace_members m
    JOIN workspaces w ON w.id = m.workspace_id
    WHERE m.user_id = ${actorUserId}
    ORDER BY m.joined_at ASC
    LIMIT 1
  `;
  if (memberRows.length) {
    const ctx = mapWorkspaceContext(memberRows[0]);
    await sql`
      UPDATE users SET active_workspace_id = ${ctx.workspaceId}
      WHERE id = ${actorUserId}
    `;
    return ctx;
  }

  const created = await createWorkspaceForOwner(actorUserId);
  await sql`
    UPDATE users SET active_workspace_id = ${created.workspaceId}
    WHERE id = ${actorUserId}
  `;
  return created;
}

export async function listWorkspacesForUser(actorUserId: number): Promise<WorkspaceListItem[]> {
  await ensureTeamSchema();
  // Garantit qu'un workspace perso owned existe.
  await resolveWorkspaceContext(actorUserId);

  const rows = await sql<Record<string, unknown>[]>`
    SELECT
      w.id,
      w.name,
      w.billing_plan,
      w.owner_user_id,
      m.role,
      COALESCE(NULLIF(TRIM(ou.name), ''), ou.email, '') AS owner_name
    FROM workspace_members m
    JOIN workspaces w ON w.id = m.workspace_id
    JOIN users ou ON ou.id = w.owner_user_id
    WHERE m.user_id = ${actorUserId}
    ORDER BY
      CASE WHEN w.owner_user_id = ${actorUserId} THEN 0 ELSE 1 END,
      m.joined_at ASC
  `;

  return rows.map((row) => {
    const ownerUserId = Number(row.owner_user_id);
    return {
      id: Number(row.id),
      name: String(row.name || "Mon équipe"),
      role: String(row.role) as TeamRole,
      billingPlan: normalizePlan(String(row.billing_plan)),
      ownerUserId,
      ownerName: String(row.owner_name || ""),
      isPersonal: ownerUserId === actorUserId,
    };
  });
}

export async function setActiveWorkspace(
  actorUserId: number,
  workspaceId: number
): Promise<WorkspaceContext> {
  await ensureTeamSchema();
  if (!Number.isFinite(workspaceId)) {
    throw new Error("Espace invalide.");
  }
  const ctx = await loadMembershipContext(actorUserId, workspaceId);
  if (!ctx) {
    throw new Error("Vous n'êtes pas membre de cet espace.");
  }
  await sql`
    UPDATE users SET active_workspace_id = ${workspaceId}
    WHERE id = ${actorUserId}
  `;
  return ctx;
}

export async function setWorkspaceBillingPlan(
  ownerUserId: number,
  planId: BillingPlanId
): Promise<void> {
  await ensureTeamSchema();
  await sql`
    UPDATE workspaces
    SET billing_plan = ${planId}
    WHERE owner_user_id = ${ownerUserId}
  `;
}


export async function getTeamOverview(actorUserId: number): Promise<{
  workspace: WorkspaceContext;
  members: TeamMemberRow[];
  invites: TeamInviteRow[];
  limits: {
    maxInvites: number | null;
    usedInvites: number;
    totalMembers: number;
  };
}> {
  const workspace = await resolveWorkspaceContext(actorUserId);
  await assertPaidTeamAccess(workspace.ownerUserId);
  const maxInvites = maxInviteSlots(workspace.billingPlan);

  const memberRows = await sql<Record<string, unknown>[]>`
    SELECT m.user_id, m.role, m.joined_at, u.email, u.name
    FROM workspace_members m
    JOIN users u ON u.id = m.user_id
    WHERE m.workspace_id = ${workspace.workspaceId}
    ORDER BY
      CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
      m.joined_at ASC
  `;

  const inviteRows = await sql<Record<string, unknown>[]>`
    SELECT
      i.id, i.email, i.role, i.expires_at, i.created_at,
      u.name AS invited_by_name
    FROM workspace_invites i
    JOIN users u ON u.id = i.invited_by_user_id
    WHERE i.workspace_id = ${workspace.workspaceId}
      AND i.accepted_at IS NULL
      AND i.expires_at > NOW()
    ORDER BY i.created_at DESC
  `;

  const totalMembers = memberRows.length;
  const pendingInvites = inviteRows.length;
  const usedInvites = Math.max(0, totalMembers - 1 + pendingInvites);

  return {
    workspace,
    members: memberRows.map((r) => ({
      userId: Number(r.user_id),
      email: String(r.email),
      name: String(r.name || ""),
      role: String(r.role) as TeamRole,
      joinedAt: String(r.joined_at),
    })),
    invites: inviteRows.map((r) => ({
      id: Number(r.id),
      email: String(r.email),
      role: String(r.role) as InviteRole,
      expiresAt: String(r.expires_at),
      createdAt: String(r.created_at),
      invitedByName: String(r.invited_by_name || ""),
    })),
    limits: {
      maxInvites,
      usedInvites,
      totalMembers,
    },
  };
}

function canManageTeam(role: TeamRole): boolean {
  return role === "owner" || role === "admin";
}

function inviteUrl(token: string): string {
  const base = config.appUrl.replace(/\/$/, "");
  return `${base}/invite/${token}`;
}

async function sendTeamInviteEmail(input: {
  to: string;
  workspaceName: string;
  inviterName: string;
  role: InviteRole;
  token: string;
}): Promise<void> {
  const url = inviteUrl(input.token);
  const roleLabel = input.role === "admin" ? "administrateur" : "membre";
  const text =
    `Bonjour,\n\n` +
    `${input.inviterName} vous invite à rejoindre l'équipe « ${input.workspaceName} » sur Klanvio en tant que ${roleLabel}.\n\n` +
    `Acceptez l'invitation (valable ${TEAM_INVITE_DAYS} jours) :\n${url}\n\n` +
    `Si vous n'avez pas encore de compte Klanvio, créez-en un avec cette adresse email puis rouvrez le lien.\n\n` +
    `— L'équipe Klanvio`;

  const result = await sendEmail({
    to: input.to,
    subject: `Invitation équipe Klanvio — ${input.workspaceName}`,
    text,
  });
  if (!result.ok) {
    console.warn("[team] email invite non envoyé:", result.error);
  }
}

/** Équipe réservée aux workspaces dont le propriétaire a un abonnement actif. */
async function assertPaidTeamAccess(ownerUserId: number): Promise<void> {
  const owner = await getUserById(ownerUserId);
  if (!owner || owner.subscription_status !== "active") {
    throw new Error(
      "L'équipe est réservée aux comptes abonnés. Passez à Klanvio pour inviter des collaborateurs.",
    );
  }
}

export async function createTeamInvite(
  actorUserId: number,
  input: { email: string; role: InviteRole }
): Promise<TeamInviteRow> {
  const email = input.email.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Adresse email invalide.");
  }
  if (input.role !== "admin" && input.role !== "member") {
    throw new Error("Rôle invalide.");
  }

  const workspace = await resolveWorkspaceContext(actorUserId);
  await assertPaidTeamAccess(workspace.ownerUserId);
  if (!canManageTeam(workspace.role)) {
    throw new Error("Seuls le propriétaire et les admins peuvent inviter.");
  }

  const actor = await getUserById(actorUserId);
  if (!actor) throw new Error("Utilisateur introuvable.");
  if (email === actor.email.toLowerCase()) {
    throw new Error("Vous ne pouvez pas vous inviter vous-même.");
  }

  const existingUser = await getUserByEmail(email);
  if (existingUser) {
    const alreadyInThis = await sql<{ user_id: number }[]>`
      SELECT user_id FROM workspace_members
      WHERE workspace_id = ${workspace.workspaceId}
        AND user_id = ${existingUser.id}
      LIMIT 1
    `;
    if (alreadyInThis.length) {
      throw new Error("Cette personne est déjà membre de votre équipe.");
    }
  }

  const maxInvites = maxInviteSlots(workspace.billingPlan);
  const overview = await getTeamOverview(actorUserId);
  if (maxInvites != null && overview.limits.usedInvites >= maxInvites) {
    throw new Error(
      `Limite atteinte pour votre palier (${maxInvites} invité${maxInvites > 1 ? "s" : ""} max).`
    );
  }

  const pending = await sql<Record<string, unknown>[]>`
    SELECT id FROM workspace_invites
    WHERE workspace_id = ${workspace.workspaceId}
      AND lower(email) = ${email}
      AND accepted_at IS NULL
      AND expires_at > NOW()
    LIMIT 1
  `;
  if (pending.length) {
    throw new Error("Une invitation est déjà en attente pour cet email.");
  }

  const token = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + TEAM_INVITE_DAYS * 24 * 60 * 60 * 1000);

  const rows = await sql<Record<string, unknown>[]>`
    INSERT INTO workspace_invites (
      workspace_id, email, role, token, invited_by_user_id, expires_at
    )
    VALUES (
      ${workspace.workspaceId},
      ${email},
      ${input.role},
      ${token},
      ${actorUserId},
      ${expiresAt.toISOString()}
    )
    RETURNING id, email, role, expires_at, created_at
  `;
  const row = rows[0];

  void sendTeamInviteEmail({
    to: email,
    workspaceName: workspace.workspaceName,
    inviterName: actor.name || actor.email,
    role: input.role,
    token,
  });

  return {
    id: Number(row.id),
    email: String(row.email),
    role: String(row.role) as InviteRole,
    expiresAt: String(row.expires_at),
    createdAt: String(row.created_at),
    invitedByName: actor.name || actor.email,
  };
}

export async function cancelTeamInvite(actorUserId: number, inviteId: number): Promise<void> {
  const workspace = await resolveWorkspaceContext(actorUserId);
  await assertPaidTeamAccess(workspace.ownerUserId);
  if (!canManageTeam(workspace.role)) {
    throw new Error("Permission refusée.");
  }
  await sql`
    DELETE FROM workspace_invites
    WHERE id = ${inviteId}
      AND workspace_id = ${workspace.workspaceId}
      AND accepted_at IS NULL
  `;
}

export async function updateMemberRole(
  actorUserId: number,
  targetUserId: number,
  role: InviteRole
): Promise<void> {
  const workspace = await resolveWorkspaceContext(actorUserId);
  await assertPaidTeamAccess(workspace.ownerUserId);
  if (workspace.role !== "owner") {
    throw new Error("Seul le propriétaire peut modifier les rôles.");
  }
  if (targetUserId === workspace.ownerUserId) {
    throw new Error("Le rôle du propriétaire ne peut pas être modifié.");
  }
  if (role !== "admin" && role !== "member") {
    throw new Error("Rôle invalide.");
  }
  await sql`
    UPDATE workspace_members
    SET role = ${role}
    WHERE workspace_id = ${workspace.workspaceId}
      AND user_id = ${targetUserId}
      AND role <> 'owner'
  `;
}

export async function removeTeamMember(
  actorUserId: number,
  targetUserId: number
): Promise<void> {
  const workspace = await resolveWorkspaceContext(actorUserId);
  await assertPaidTeamAccess(workspace.ownerUserId);
  if (!canManageTeam(workspace.role)) {
    throw new Error("Permission refusée.");
  }
  if (targetUserId === workspace.ownerUserId) {
    throw new Error("Le propriétaire ne peut pas être retiré.");
  }
  if (workspace.role === "admin") {
    const targetRows = await sql<{ role: string }[]>`
      SELECT role FROM workspace_members
      WHERE workspace_id = ${workspace.workspaceId} AND user_id = ${targetUserId}
    `;
    const targetRole = targetRows[0]?.role;
    if (targetRole === "admin" || targetRole === "owner") {
      throw new Error("Un admin ne peut retirer que des membres.");
    }
  }

  await sql`
    DELETE FROM workspace_members
    WHERE workspace_id = ${workspace.workspaceId}
      AND user_id = ${targetUserId}
      AND role <> 'owner'
  `;

  // Reset actif vers le perso si on quittait l'espace actif.
  const activeRows = await sql<{ active_workspace_id: number | null }[]>`
    SELECT active_workspace_id FROM users WHERE id = ${targetUserId} LIMIT 1
  `;
  if (Number(activeRows[0]?.active_workspace_id) === workspace.workspaceId) {
    const personal = await sql<{ id: number }[]>`
      SELECT id FROM workspaces WHERE owner_user_id = ${targetUserId} LIMIT 1
    `;
    if (personal.length) {
      await sql`
        UPDATE users SET active_workspace_id = ${Number(personal[0].id)}
        WHERE id = ${targetUserId}
      `;
    } else {
      const created = await createWorkspaceForOwner(targetUserId);
      await sql`
        UPDATE users SET active_workspace_id = ${created.workspaceId}
        WHERE id = ${targetUserId}
      `;
    }
  } else {
    // S'assurer qu'un workspace owned existe toujours (perso).
    const owned = await sql<{ id: number }[]>`
      SELECT id FROM workspaces WHERE owner_user_id = ${targetUserId} LIMIT 1
    `;
    if (!owned.length) {
      await createWorkspaceForOwner(targetUserId);
    }
  }
}

export async function getInvitePreview(token: string): Promise<{
  workspaceName: string;
  email: string;
  role: InviteRole;
  expired: boolean;
  accepted: boolean;
}> {
  await ensureTeamSchema();
  const rows = await sql<Record<string, unknown>[]>`
    SELECT i.email, i.role, i.expires_at, i.accepted_at, w.name AS workspace_name
    FROM workspace_invites i
    JOIN workspaces w ON w.id = i.workspace_id
    WHERE i.token = ${token}
    LIMIT 1
  `;
  if (!rows.length) throw new Error("Invitation introuvable.");
  const row = rows[0];
  const expired = new Date(String(row.expires_at)).getTime() < Date.now();
  return {
    workspaceName: String(row.workspace_name || "Équipe Klanvio"),
    email: String(row.email),
    role: String(row.role) as InviteRole,
    expired,
    accepted: row.accepted_at != null,
  };
}

export async function acceptTeamInvite(
  actorUserId: number,
  token: string
): Promise<WorkspaceContext> {
  await ensureTeamSchema();
  const actor = await getUserById(actorUserId);
  if (!actor) throw new Error("Utilisateur introuvable.");

  const rows = await sql<Record<string, unknown>[]>`
    SELECT i.*, w.owner_user_id, w.name AS workspace_name, w.billing_plan
    FROM workspace_invites i
    JOIN workspaces w ON w.id = i.workspace_id
    WHERE i.token = ${token}
    LIMIT 1
  `;
  if (!rows.length) throw new Error("Invitation introuvable.");
  const invite = rows[0];

  if (invite.accepted_at != null) throw new Error("Cette invitation a déjà été acceptée.");
  if (new Date(String(invite.expires_at)).getTime() < Date.now()) {
    throw new Error("Cette invitation a expiré.");
  }

  const inviteEmail = String(invite.email).trim().toLowerCase();
  if (actor.email.toLowerCase() !== inviteEmail) {
    throw new Error(
      `Connectez-vous avec l'adresse ${inviteEmail} pour accepter cette invitation.`
    );
  }

  if (actorUserId === Number(invite.owner_user_id)) {
    throw new Error("Vous êtes déjà le propriétaire de cet espace.");
  }

  const workspaceId = Number(invite.workspace_id);
  const role = String(invite.role) as InviteRole;

  // Garde le workspace perso ; ajoute seulement la membership équipe.
  await createWorkspaceForOwner(actorUserId);

  await sql`
    INSERT INTO workspace_members (workspace_id, user_id, role)
    VALUES (${workspaceId}, ${actorUserId}, ${role})
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role
  `;
  await sql`
    UPDATE workspace_invites
    SET accepted_at = NOW()
    WHERE id = ${Number(invite.id)}
  `;
  await sql`
    UPDATE users SET active_workspace_id = ${workspaceId}
    WHERE id = ${actorUserId}
  `;

  return {
    workspaceId,
    ownerUserId: Number(invite.owner_user_id),
    role,
    billingPlan: normalizePlan(String(invite.billing_plan)),
    workspaceName: String(invite.workspace_name || "Équipe Klanvio"),
  };
}

/** Accepte automatiquement une invitation en attente pour l'email du compte (inscription / Google). */
export async function tryAcceptPendingInviteByEmail(
  userId: number
): Promise<WorkspaceContext | null> {
  await ensureTeamSchema();
  const user = await getUserById(userId);
  if (!user) return null;
  const email = user.email.trim().toLowerCase();
  const rows = await sql<{ token: string }[]>`
    SELECT token
    FROM workspace_invites
    WHERE lower(email) = ${email}
      AND accepted_at IS NULL
      AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 1
  `;
  if (!rows.length) return null;
  try {
    return await acceptTeamInvite(userId, String(rows[0].token));
  } catch (err) {
    console.warn(
      "[team] auto-accept invite failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
