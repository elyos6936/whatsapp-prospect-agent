import { sql } from "./pg.js";

export type SupportTicketStatus = "open" | "pending" | "done";
export type SupportMessageRole = "user" | "assistant" | "ops" | "system";

export type SupportTicket = {
  id: number;
  user_id: number;
  status: SupportTicketStatus;
  subject: string;
  summary: string | null;
  handoff_reason: string | null;
  client_phone: string | null;
  last_message_at: string;
  created_at: string;
  updated_at: string;
  user_email?: string | null;
  user_name?: string | null;
};

export type SupportMessage = {
  id: number;
  ticket_id: number;
  role: SupportMessageRole;
  content: string;
  image_urls: string[];
  created_at: string;
};

let supportSchemaReady: Promise<void> | null = null;

export async function ensureSupportSchema(): Promise<void> {
  if (!supportSchemaReady) {
    supportSchemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS support_tickets (
          id BIGSERIAL PRIMARY KEY,
          user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('open', 'pending', 'done')),
          subject TEXT NOT NULL DEFAULT 'Support Klanvio',
          summary TEXT,
          handoff_reason TEXT,
          client_phone TEXT,
          last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_support_tickets_user_status
          ON support_tickets(user_id, status, last_message_at DESC)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_support_tickets_status_last
          ON support_tickets(status, last_message_at DESC)
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS support_messages (
          id BIGSERIAL PRIMARY KEY,
          ticket_id BIGINT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'ops', 'system')),
          content TEXT NOT NULL DEFAULT '',
          image_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_support_messages_ticket
          ON support_messages(ticket_id, id)
      `;
    })().catch((err) => {
      supportSchemaReady = null;
      throw err;
    });
  }
  await supportSchemaReady;
}

function parseImageUrls(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      /* ignore */
    }
  }
  return [];
}

function mapTicket(row: Record<string, unknown>): SupportTicket {
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    status: String(row.status) as SupportTicketStatus,
    subject: String(row.subject ?? "Support Klanvio"),
    summary: row.summary != null ? String(row.summary) : null,
    handoff_reason: row.handoff_reason != null ? String(row.handoff_reason) : null,
    client_phone: row.client_phone != null ? String(row.client_phone) : null,
    last_message_at: String(row.last_message_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    user_email: row.user_email != null ? String(row.user_email) : undefined,
    user_name: row.user_name != null ? String(row.user_name) : undefined,
  };
}

function mapMessage(row: Record<string, unknown>): SupportMessage {
  return {
    id: Number(row.id),
    ticket_id: Number(row.ticket_id),
    role: String(row.role) as SupportMessageRole,
    content: String(row.content ?? ""),
    image_urls: parseImageUrls(row.image_urls),
    created_at: String(row.created_at),
  };
}

export async function getSupportTicketById(ticketId: number): Promise<SupportTicket | null> {
  await ensureSupportSchema();
  const rows = await sql<Record<string, unknown>[]>`
    SELECT t.*, u.email AS user_email, u.name AS user_name
    FROM support_tickets t
    LEFT JOIN users u ON u.id = t.user_id
    WHERE t.id = ${ticketId}
    LIMIT 1
  `;
  return rows[0] ? mapTicket(rows[0]) : null;
}

export async function listSupportTicketsForUser(
  userId: number,
  status?: SupportTicketStatus | "active"
): Promise<SupportTicket[]> {
  await ensureSupportSchema();
  // Uniquement les tickets qui ont au moins un message (évite les coquilles vides).
  if (status === "active") {
    const rows = await sql<Record<string, unknown>[]>`
      SELECT t.* FROM support_tickets t
      WHERE t.user_id = ${userId}
        AND t.status IN ('open', 'pending')
        AND EXISTS (SELECT 1 FROM support_messages m WHERE m.ticket_id = t.id)
      ORDER BY t.last_message_at DESC, t.id DESC
      LIMIT 50
    `;
    return rows.map(mapTicket);
  }
  if (status === "done") {
    const rows = await sql<Record<string, unknown>[]>`
      SELECT t.* FROM support_tickets t
      WHERE t.user_id = ${userId}
        AND t.status = 'done'
        AND EXISTS (SELECT 1 FROM support_messages m WHERE m.ticket_id = t.id)
      ORDER BY t.last_message_at DESC, t.id DESC
      LIMIT 50
    `;
    return rows.map(mapTicket);
  }
  if (status) {
    const rows = await sql<Record<string, unknown>[]>`
      SELECT t.* FROM support_tickets t
      WHERE t.user_id = ${userId}
        AND t.status = ${status}
        AND EXISTS (SELECT 1 FROM support_messages m WHERE m.ticket_id = t.id)
      ORDER BY t.last_message_at DESC, t.id DESC
      LIMIT 50
    `;
    return rows.map(mapTicket);
  }
  const rows = await sql<Record<string, unknown>[]>`
    SELECT t.* FROM support_tickets t
    WHERE t.user_id = ${userId}
      AND EXISTS (SELECT 1 FROM support_messages m WHERE m.ticket_id = t.id)
    ORDER BY t.last_message_at DESC, t.id DESC
    LIMIT 50
  `;
  return rows.map(mapTicket);
}

export async function listSupportTicketsOps(
  status?: SupportTicketStatus | "active"
): Promise<SupportTicket[]> {
  await ensureSupportSchema();
  if (status === "active" || !status) {
    const rows = await sql<Record<string, unknown>[]>`
      SELECT t.*, u.email AS user_email, u.name AS user_name
      FROM support_tickets t
      LEFT JOIN users u ON u.id = t.user_id
      WHERE t.status IN ('open', 'pending')
      ORDER BY
        CASE WHEN t.status = 'open' THEN 0 ELSE 1 END,
        t.last_message_at DESC,
        t.id DESC
      LIMIT 200
    `;
    return rows.map(mapTicket);
  }
  if (status === "done") {
    const rows = await sql<Record<string, unknown>[]>`
      SELECT t.*, u.email AS user_email, u.name AS user_name
      FROM support_tickets t
      LEFT JOIN users u ON u.id = t.user_id
      WHERE t.status = 'done'
      ORDER BY t.last_message_at DESC, t.id DESC
      LIMIT 200
    `;
    return rows.map(mapTicket);
  }
  const rows = await sql<Record<string, unknown>[]>`
    SELECT t.*, u.email AS user_email, u.name AS user_name
    FROM support_tickets t
    LEFT JOIN users u ON u.id = t.user_id
    WHERE t.status = ${status}
    ORDER BY t.last_message_at DESC, t.id DESC
    LIMIT 200
  `;
  return rows.map(mapTicket);
}

export async function getOrCreateActiveSupportTicket(
  userId: number,
  opts?: { subject?: string; clientPhone?: string | null }
): Promise<SupportTicket> {
  await ensureSupportSchema();
  const existing = await sql<Record<string, unknown>[]>`
    SELECT * FROM support_tickets
    WHERE user_id = ${userId} AND status IN ('open', 'pending')
    ORDER BY last_message_at DESC, id DESC
    LIMIT 1
  `;
  if (existing[0]) {
    const ticket = mapTicket(existing[0]);
    if (opts?.clientPhone && !ticket.client_phone) {
      await sql`
        UPDATE support_tickets
        SET client_phone = ${opts.clientPhone}, updated_at = NOW()
        WHERE id = ${ticket.id}
      `;
      ticket.client_phone = opts.clientPhone;
    }
    const nextSubject = (opts?.subject ?? "").trim().slice(0, 120);
    if (
      nextSubject &&
      (!ticket.subject || /^support klanvio$/i.test(ticket.subject.trim()))
    ) {
      await sql`
        UPDATE support_tickets
        SET subject = ${nextSubject}, updated_at = NOW()
        WHERE id = ${ticket.id}
      `;
      ticket.subject = nextSubject;
    }
    return ticket;
  }

  const subject = (opts?.subject ?? "Support Klanvio").trim().slice(0, 120) || "Support Klanvio";
  const phone = opts?.clientPhone ?? null;
  const rows = await sql<Record<string, unknown>[]>`
    INSERT INTO support_tickets (user_id, status, subject, client_phone)
    VALUES (${userId}, 'pending', ${subject}, ${phone})
    RETURNING *
  `;
  return mapTicket(rows[0]!);
}

export async function listSupportMessages(ticketId: number): Promise<SupportMessage[]> {
  await ensureSupportSchema();
  const rows = await sql<Record<string, unknown>[]>`
    SELECT * FROM support_messages
    WHERE ticket_id = ${ticketId}
    ORDER BY id ASC
    LIMIT 500
  `;
  return rows.map(mapMessage);
}

export async function appendSupportMessage(input: {
  ticketId: number;
  role: SupportMessageRole;
  content: string;
  imageUrls?: string[];
}): Promise<SupportMessage> {
  await ensureSupportSchema();
  const content = String(input.content ?? "").slice(0, 8000);
  const urls = (input.imageUrls ?? []).map(String).filter(Boolean).slice(0, 8);
  const rows = await sql<Record<string, unknown>[]>`
    INSERT INTO support_messages (ticket_id, role, content, image_urls)
    VALUES (${input.ticketId}, ${input.role}, ${content}, ${sql.json(urls)})
    RETURNING *
  `;
  await sql`
    UPDATE support_tickets
    SET last_message_at = NOW(), updated_at = NOW()
    WHERE id = ${input.ticketId}
  `;
  return mapMessage(rows[0]!);
}

export async function updateSupportTicket(
  ticketId: number,
  patch: {
    status?: SupportTicketStatus;
    summary?: string | null;
    handoffReason?: string | null;
    clientPhone?: string | null;
    subject?: string;
  }
): Promise<SupportTicket | null> {
  await ensureSupportSchema();
  const current = await getSupportTicketById(ticketId);
  if (!current) return null;

  const status = patch.status ?? current.status;
  const summary =
    patch.summary !== undefined ? patch.summary : current.summary;
  const handoffReason =
    patch.handoffReason !== undefined ? patch.handoffReason : current.handoff_reason;
  const clientPhone =
    patch.clientPhone !== undefined ? patch.clientPhone : current.client_phone;
  const subject = patch.subject ?? current.subject;

  const rows = await sql<Record<string, unknown>[]>`
    UPDATE support_tickets
    SET
      status = ${status},
      summary = ${summary},
      handoff_reason = ${handoffReason},
      client_phone = ${clientPhone},
      subject = ${subject},
      updated_at = NOW()
    WHERE id = ${ticketId}
    RETURNING *
  `;
  return rows[0] ? mapTicket(rows[0]) : null;
}

export async function assertTicketOwnedByUser(
  ticketId: number,
  userId: number
): Promise<SupportTicket | null> {
  const ticket = await getSupportTicketById(ticketId);
  if (!ticket || ticket.user_id !== userId) return null;
  return ticket;
}
