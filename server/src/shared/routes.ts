import type { FastifyInstance } from "fastify";

import type { RequireSession } from "../auth/guard.js";
import { vaultErrorHandler } from "../vault/routes.js";
import { MAX_MEMBERS, MAX_NAME_LENGTH } from "./model.js";
import type { SharedVaults } from "./service.js";

export type SharedRoutesOptions = {
  /** Null when this instance is not part of a shared setup. */
  shared: SharedVaults | null;
  requireSession: RequireSession;
};

type IdParams = { id: string };
type CreateBody = { name: string; members?: string[] };
type UpdateBody = { name?: string; members?: string[] };

const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", maxLength: 64 } }
};

const nameSchema = { type: "string", minLength: 1, maxLength: MAX_NAME_LENGTH * 2 };
const membersSchema = { type: "array", maxItems: MAX_MEMBERS, items: { type: "string", maxLength: 64 } };

/**
 * Managing shared vaults, mounted under `${basePath}/api/shared` behind
 * requireSession. Every answer is about the person this instance serves:
 * the overview lists only vaults they are in, and the rules of who may
 * rename, change members, leave, delete or restore live in shared/model.ts.
 *
 * `GET /` always answers, with `enabled: false` on an instance that is not
 * set up for sharing, so the client can tell "off" from "broken".
 */
export async function sharedRoutes(app: FastifyInstance, options: SharedRoutesOptions): Promise<void> {
  const { shared, requireSession } = options;

  app.addHook("onRequest", requireSession);
  app.setErrorHandler(vaultErrorHandler);

  app.get("/", async () => (shared ? { enabled: true, ...(await shared.overview()) } : { enabled: false }));

  if (!shared) {
    return;
  }

  app.post<{ Body: CreateBody }>(
    "/vaults",
    {
      schema: {
        body: {
          type: "object",
          required: ["name"],
          properties: { name: nameSchema, members: membersSchema },
          additionalProperties: false
        }
      }
    },
    async (request, reply) => {
      const vault = await shared.create({ name: request.body.name, members: request.body.members ?? [] });
      return reply.code(201).send(vault);
    }
  );

  app.patch<{ Params: IdParams; Body: UpdateBody }>(
    "/vaults/:id",
    {
      schema: {
        params: idParams,
        body: {
          type: "object",
          properties: { name: nameSchema, members: membersSchema },
          additionalProperties: false
        }
      }
    },
    async (request) => shared.update(request.params.id, request.body)
  );

  app.post<{ Params: IdParams }>("/vaults/:id/leave", { schema: { params: idParams } }, async (request, reply) => {
    await shared.leave(request.params.id);
    return reply.code(204).send();
  });

  app.delete<{ Params: IdParams }>("/vaults/:id", { schema: { params: idParams } }, async (request) =>
    shared.remove(request.params.id)
  );

  app.post<{ Params: IdParams }>("/vaults/:id/restore", { schema: { params: idParams } }, async (request) =>
    shared.restore(request.params.id)
  );

  app.post<{ Params: IdParams }>("/notices/:id/dismiss", { schema: { params: idParams } }, async (request, reply) => {
    await shared.dismissNotice(request.params.id);
    return reply.code(204).send();
  });
}
