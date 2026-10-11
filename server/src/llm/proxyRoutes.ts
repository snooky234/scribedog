import { Readable } from "node:stream";

import type { FastifyInstance } from "fastify";

import type { AuthStore } from "../auth/authStore.js";
import type { RequireSession } from "../auth/guard.js";
import type { SessionConfig } from "../auth/session.js";
import { dataKeyFor } from "../secrets/routes.js";
import { resolveSecretRefs, secretRefIds } from "../secrets/secretRef.js";
import type { SecretStore } from "../secrets/secretStore.js";
import { resolvesToPrivateNetwork } from "./privateAddress.js";
import { assertAllowedTarget, forwardableRequestHeaders, forwardableResponseHeaders, LlmTargetError } from "./target.js";

export type LlmRoutesOptions = {
  allowedHosts: readonly string[];
  secrets: SecretStore;
  authStore: AuthStore;
  session: SessionConfig;
  requireSession: RequireSession;
};

/** The client names its target here rather than in the path, so the body stays untouched. */
export const TARGET_HEADER = "x-scribedog-llm-url";

/**
 * Ceiling for one provider call. The frontend gives up after three minutes
 * (REQUEST_TIMEOUT_MS in src/lib/aiClient.ts); this sits just above it so the
 * client's own message is the one the user sees, and nothing is left holding
 * a socket if the client vanishes without saying so.
 */
const UPSTREAM_TIMEOUT_MS = 200_000;

/**
 * Forwards one request to a cloud AI provider, or to a model server elsewhere
 * in the server's network that the admin allowed.
 *
 * Everything about the request is the frontend's: `src/lib/aiClient.ts` builds
 * it exactly as it does on the desktop, and the web platform sends it here
 * instead of into the network. The proxy adds two things and changes nothing
 * else: it checks the target against the allowlist, and it substitutes the
 * real API key for the placeholder the browser carries (secretRef.ts).
 *
 * The response is streamed back as it arrives, so token-by-token output keeps
 * working; server-sent events would otherwise arrive in one lump at the end.
 */
export async function llmRoutes(app: FastifyInstance, options: LlmRoutesOptions): Promise<void> {
  const { allowedHosts, secrets, authStore, session, requireSession } = options;

  app.addHook("onRequest", requireSession);

  // The body is forwarded verbatim; parsing it into an object and serializing
  // it again would be work with nothing to gain and a chance to alter it.
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });

  app.route({
    method: ["GET", "POST"],
    url: "/llm/request",
    handler: async (request, reply) => {
      let target: URL;

      try {
        target = assertAllowedTarget(request.headers[TARGET_HEADER], allowedHosts);
      } catch (error) {
        if (error instanceof LlmTargetError) {
          return error.entry
            ? reply.code(400).send({ error: "endpoint_not_allowed", message: error.message, entry: error.entry })
            : reply.code(400).send({ error: "invalid_endpoint", message: error.message });
        }

        throw error;
      }

      if (target.protocol === "http:" && (await resolvesToPrivateNetwork(target.hostname)) === false) {
        return reply.code(400).send({
          error: "invalid_endpoint",
          message: `${target.hostname} resolves to an address outside your network, so it is not reached over plain http.`
        });
      }

      const headers = forwardableRequestHeaders(request.headers);
      const referencedIds = secretRefIds(Object.values(headers));

      if (referencedIds.length > 0) {
        const dataKey = dataKeyFor(request, session, authStore);

        if (!dataKey) {
          return reply.code(409).send({ error: "secrets_locked", message: "Sign in again to use the stored API key." });
        }

        const values = new Map<string, string>();

        for (const id of referencedIds) {
          const value = await secrets.get(dataKey, id).catch(() => null);

          if (value) {
            values.set(id, value);
          }
        }

        for (const [name, value] of Object.entries(headers)) {
          headers[name] = resolveSecretRefs(value, values);
        }
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
      // A closed browser connection (the user pressed cancel) has to reach the
      // provider too, or the request runs on and is billed for nothing. The
      // signal for that is the *response* closing before it was finished. The
      // request stream is no use here: Node closes it, and emits its "close",
      // as soon as the body has been read, which for a POST is before this
      // handler even runs or a tick into it. Listening there would abort the
      // upstream call the moment it starts and leave the browser waiting.
      const onClose = () => {
        if (!reply.raw.writableFinished) {
          controller.abort();
        }
      };
      // Undone when the answer is through, not when this handler returns:
      // a streamed answer is still on its way then, and the hang-up it has
      // to watch for comes later.
      const settle = () => {
        clearTimeout(timer);
        reply.raw.off("close", onClose);
      };

      reply.raw.on("close", onClose);

      try {
        const response = await fetch(target, {
          method: request.method,
          headers,
          body: request.method === "GET" ? undefined : (request.body as Buffer | undefined),
          signal: controller.signal,
          redirect: "error"
        });

        reply.code(response.status).headers(forwardableResponseHeaders(response.headers));

        if (!response.body) {
          const buffer = Buffer.from(await response.arrayBuffer());

          settle();

          return reply.send(buffer);
        }

        const stream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);

        stream.on("close", settle);

        return reply.send(stream);
      } catch (error) {
        settle();

        if (controller.signal.aborted && reply.raw.destroyed) {
          // The client hung up; there is nobody left to answer.
          return reply;
        }

        request.log.warn({ err: error, host: target.hostname }, "AI request failed");

        return reply.code(502).send({
          error: "upstream_unreachable",
          message: `The AI provider (${target.hostname}) could not be reached.`
        });
      }
    }
  });
}
