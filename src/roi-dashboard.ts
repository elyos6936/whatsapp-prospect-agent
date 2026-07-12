import { listAutomations, listContacts, getWhatsAppMessageStats } from "./db.js";

export interface RoiDashboard {
  automations: Array<{
    id: number;
    name: string;
    type: string;
    status: string;
    budgetFcfa: number;
    stats: Record<string, unknown>;
    roiPercent: number | null;
    costPerReply: number | null;
  }>;
  totals: {
    contacted: number;
    replied: number;
    interested: number;
    conversions: number;
    revenueFcfa: number;
    budgetFcfa: number;
    messagesToday: number;
    hotLeads: number;
  };
  abSummary: Array<{ automationId: number; name: string; variants: Record<string, unknown> }>;
}

export async function getRoiDashboard(userId: number): Promise<RoiDashboard> {
  const autos = await listAutomations(userId, { limit: 100 });
  const contacts = await listContacts(userId, { limit: 500 });

  let contacted = 0;
  let replied = 0;
  let interested = 0;
  let conversions = 0;
  let revenueFcfa = 0;
  let budgetFcfa = 0;
  const abSummary: RoiDashboard["abSummary"] = [];

  const automationRows = autos.map((a) => {
    const s = a.stats;
    contacted += s.contacted ?? 0;
    replied += s.replied ?? 0;
    interested += s.interested ?? 0;
    conversions += s.conversions ?? 0;
    revenueFcfa += s.revenueFcfa ?? 0;
    budgetFcfa += a.budget_fcfa ?? 0;

    const cost = a.budget_fcfa || 0;
    const rev = s.revenueFcfa ?? 0;
    const roiPercent = cost > 0 ? Math.round(((rev - cost) / cost) * 100) : null;
    const costPerReply =
      (s.replied ?? 0) > 0 && cost > 0 ? Math.round(cost / (s.replied ?? 1)) : null;

    if (s.abResults && Object.keys(s.abResults).length) {
      abSummary.push({ automationId: a.id, name: a.name, variants: s.abResults });
    }

    return {
      id: a.id,
      name: a.name,
      type: a.type,
      status: a.status,
      budgetFcfa: a.budget_fcfa,
      stats: s as Record<string, unknown>,
      roiPercent,
      costPerReply,
    };
  });

  const msgStats = await getWhatsAppMessageStats(userId);
  const hotLeads = contacts.filter((c) => (c.lead_score ?? 0) >= 70).length;

  return {
    automations: automationRows,
    totals: {
      contacted,
      replied,
      interested,
      conversions,
      revenueFcfa,
      budgetFcfa,
      messagesToday: msgStats.outgoingToday,
      hotLeads,
    },
    abSummary,
  };
}
