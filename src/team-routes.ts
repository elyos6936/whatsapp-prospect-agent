import type { FastifyInstance } from "fastify";
import { requireActorUserId } from "./auth.js";
import {
  acceptTeamInvite,
  cancelTeamInvite,
  createTeamInvite,
  getInvitePreview,
  getTeamOverview,
  listWorkspacesForUser,
  removeTeamMember,
  setActiveWorkspace,
  updateMemberRole,
  type InviteRole,
} from "./team.js";

export async function registerTeamRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { token: string } }>("/api/team/invite/:token", async (request, reply) => {
    try {
      const preview = await getInvitePreview(request.params.token);
      return preview;
    } catch (err) {
      return reply.status(404).send({
        error: err instanceof Error ? err.message : "Invitation introuvable.",
      });
    }
  });

  app.get("/api/team/workspaces", async (request) => {
    const actorUserId = requireActorUserId(request);
    const workspaces = await listWorkspacesForUser(actorUserId);
    return { workspaces };
  });

  app.post<{ Body: { workspaceId?: number } }>(
    "/api/team/workspaces/switch",
    async (request, reply) => {
      const actorUserId = requireActorUserId(request);
      const workspaceId = Number(request.body?.workspaceId);
      if (!Number.isFinite(workspaceId)) {
        return reply.status(400).send({ error: "workspaceId requis." });
      }
      try {
        const workspace = await setActiveWorkspace(actorUserId, workspaceId);
        return { ok: true, workspace };
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Impossible de changer d'espace.",
        });
      }
    }
  );

  app.get("/api/team", async (request, reply) => {
    const actorUserId = requireActorUserId(request);
    try {
      return await getTeamOverview(actorUserId);
    } catch (err) {
      return reply.status(403).send({
        error: err instanceof Error ? err.message : "Équipe indisponible.",
      });
    }
  });

  app.post<{ Body: { email?: string; role?: InviteRole } }>(
    "/api/team/invite",
    async (request, reply) => {
      const actorUserId = requireActorUserId(request);
      const email = request.body?.email?.trim() ?? "";
      const role = request.body?.role ?? "member";
      try {
        const invite = await createTeamInvite(actorUserId, { email, role });
        return { invite };
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Impossible d'envoyer l'invitation.",
        });
      }
    }
  );

  app.post<{ Params: { token: string } }>(
    "/api/team/invite/:token/accept",
    async (request, reply) => {
      const actorUserId = requireActorUserId(request);
      try {
        const workspace = await acceptTeamInvite(actorUserId, request.params.token);
        return { ok: true, workspace };
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Impossible d'accepter l'invitation.",
        });
      }
    }
  );

  app.delete<{ Params: { inviteId: string } }>(
    "/api/team/invite/:inviteId",
    async (request, reply) => {
      const actorUserId = requireActorUserId(request);
      const inviteId = Number(request.params.inviteId);
      if (!Number.isFinite(inviteId)) {
        return reply.status(400).send({ error: "Identifiant invalide." });
      }
      try {
        await cancelTeamInvite(actorUserId, inviteId);
        return { ok: true };
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Impossible d'annuler l'invitation.",
        });
      }
    }
  );

  app.patch<{ Params: { userId: string }; Body: { role?: InviteRole } }>(
    "/api/team/members/:userId",
    async (request, reply) => {
      const actorUserId = requireActorUserId(request);
      const targetUserId = Number(request.params.userId);
      const role = request.body?.role;
      if (!Number.isFinite(targetUserId) || !role) {
        return reply.status(400).send({ error: "Paramètres invalides." });
      }
      try {
        await updateMemberRole(actorUserId, targetUserId, role);
        return { ok: true };
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Impossible de modifier le rôle.",
        });
      }
    }
  );

  app.delete<{ Params: { userId: string } }>(
    "/api/team/members/:userId",
    async (request, reply) => {
      const actorUserId = requireActorUserId(request);
      const targetUserId = Number(request.params.userId);
      if (!Number.isFinite(targetUserId)) {
        return reply.status(400).send({ error: "Identifiant invalide." });
      }
      try {
        await removeTeamMember(actorUserId, targetUserId);
        return { ok: true };
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Impossible de retirer ce membre.",
        });
      }
    }
  );
}
