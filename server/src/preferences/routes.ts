import type { FastifyInstance } from "fastify";

import type { RequireSession } from "../auth/guard.js";
import { isPreferenceName, PreferenceStoreError, type PreferenceStore } from "./preferenceStore.js";

export type PreferenceRoutesOptions = {
  preferences: PreferenceStore;
  requireSession: RequireSession;
};

type NameParams = { name: string };
type ValueBody = { value?: unknown };

/**
 * The instance's settings that should follow the person from browser to
 * browser (see preferenceStore.ts). A name the server does not know is a 404,
 * so a typo in the frontend shows up instead of quietly storing nothing.
 */
export async function preferenceRoutes(app: FastifyInstance, options: PreferenceRoutesOptions): Promise<void> {
  const { preferences, requireSession } = options;

  app.addHook("onRequest", requireSession);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof PreferenceStoreError) {
      return reply.code(400).send({ error: "invalid_preference", message: error.message });
    }

    if (typeof (error as { statusCode?: number }).statusCode === "number") {
      return reply.send(error);
    }

    request.log.error(error);
    return reply.code(500).send({ error: "internal", message: "Internal server error." });
  });

  const nameSchema = {
    params: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string", maxLength: 64 } }
    }
  };

  app.get<{ Params: NameParams }>("/preferences/:name", { schema: nameSchema }, async (request, reply) => {
    const { name } = request.params;

    if (!isPreferenceName(name)) {
      return reply.code(404).send({ error: "unknown_preference", message: "Unknown preference." });
    }

    return { value: await preferences.get(name) };
  });

  app.put<{ Params: NameParams; Body: ValueBody }>(
    "/preferences/:name",
    {
      schema: {
        ...nameSchema,
        body: {
          type: "object",
          required: ["value"],
          properties: { value: { type: "object" } },
          additionalProperties: false
        }
      }
    },
    async (request, reply) => {
      const { name } = request.params;

      if (!isPreferenceName(name)) {
        return reply.code(404).send({ error: "unknown_preference", message: "Unknown preference." });
      }

      await preferences.set(name, request.body.value);

      return reply.code(204).send();
    }
  );
}
