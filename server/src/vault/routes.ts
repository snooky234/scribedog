import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { RequireSession } from "../auth/guard.js";
import { FileLockTimeoutError } from "./fileLock.js";
import { contentVersion, EntryConflictError, EntryNotFoundError, type Vault } from "./files.js";
import { VaultPathError } from "./paths.js";

export type FileRoutesOptions = {
  vault: Vault;
  requireSession: RequireSession;
};

type PathQuery = { path?: string };
type TextBody = { path?: unknown; content?: unknown; ifMatch?: string | null };
type MkdirBody = { path?: unknown; recursive?: unknown };
type RenameBody = { from?: unknown; to?: unknown };
type RemoveBody = { path?: unknown; recursive?: unknown };

const pathQuerySchema = {
  querystring: {
    type: "object",
    required: ["path"],
    properties: { path: { type: "string" } }
  }
};

/**
 * Content types the binary routes accept and hand out for vault files. The
 * frontend only ever asks for images (paste, drop, the image node view);
 * anything else is served opaque rather than guessed.
 */
const MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp"
};

function contentTypeFor(relativePath: string): string {
  const extension = relativePath.split(".").pop()?.toLowerCase() ?? "";

  return MIME_TYPE_BY_EXTENSION[extension] ?? "application/octet-stream";
}

/**
 * Maps the vault layer's errors onto status codes, for every route group
 * that touches the vault (the file API here, the export in exportRoutes.ts).
 */
export function vaultErrorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof VaultPathError) {
    return reply.code(400).send({ error: "invalid_path", message: error.message });
  }

  if (error instanceof EntryNotFoundError) {
    return reply.code(404).send({ error: "not_found", message: error.message });
  }

  if (error instanceof EntryConflictError) {
    return reply.code(409).send({ error: "conflict", message: error.message });
  }

  if (error instanceof FileLockTimeoutError) {
    return reply.code(503).send({ error: "locked", message: error.message });
  }

  if (typeof (error as { statusCode?: number }).statusCode === "number") {
    // Fastify's own validation and body errors already carry a status.
    return reply.send(error);
  }

  request.log.error(error);
  return reply.code(500).send({ error: "internal", message: "Internal server error." });
}

/**
 * The file API. `/files` lists the notes; everything under `/fs` is the
 * frontend's filesystem layer (`VaultStorage` in src/platform/types.ts)
 * one call per primitive, on any path inside the vault except the server's
 * own `.scribedog/server/`. Mounted under `${basePath}/api`; every route runs
 * behind requireSession.
 */
export async function fileRoutes(app: FastifyInstance, options: FileRoutesOptions): Promise<void> {
  const { vault, requireSession } = options;

  app.addHook("onRequest", requireSession);
  app.setErrorHandler(vaultErrorHandler);

  // Raw bodies for the binary write; JSON stays the default for everything else.
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });

  app.get("/files", async () => {
    const files = await vault.listMarkdownFiles();
    return { files };
  });

  app.get<{ Querystring: PathQuery }>("/fs/entries", { schema: pathQuerySchema }, async (request) => {
    return { entries: await vault.readDir(request.query.path) };
  });

  app.get<{ Querystring: PathQuery }>("/fs/stat", { schema: pathQuerySchema }, async (request) => {
    return vault.stat(request.query.path);
  });

  app.get<{ Querystring: PathQuery }>("/fs/exists", { schema: pathQuerySchema }, async (request) => {
    return { exists: await vault.exists(request.query.path) };
  });

  app.post<{ Body: MkdirBody }>(
    "/fs/mkdir",
    {
      schema: {
        body: {
          type: "object",
          required: ["path"],
          properties: { path: { type: "string" }, recursive: { type: "boolean" } },
          additionalProperties: false
        }
      }
    },
    async (request, reply) => {
      await vault.mkdir(request.body.path, request.body.recursive === true);
      return reply.code(204).send();
    }
  );

  // The version is the token a later conditional write hands back as
  // `ifMatch` (see PUT below).
  app.get<{ Querystring: PathQuery }>("/fs/text", { schema: pathQuerySchema }, async (request) => {
    return vault.readTextVersioned(request.query.path);
  });

  app.put<{ Body: TextBody }>(
    "/fs/text",
    {
      schema: {
        body: {
          type: "object",
          required: ["path", "content"],
          properties: {
            path: { type: "string" },
            content: { type: "string" },
            ifMatch: { type: "string", nullable: true }
          },
          additionalProperties: false
        }
      }
    },
    async (request, reply) => {
      const { path, content, ifMatch } = request.body;

      // Without ifMatch the write is unconditional, as it always was: the
      // sidecars stay last-writer-wins on purpose, and an older client keeps
      // working. With it, the write goes through only while the file is still
      // the version the client built on (null: still absent); otherwise 409
      // with what is there now, so the client can merge at once.
      if (ifMatch === undefined) {
        const { mtimeMs } = await vault.writeText(path, content as string);
        return { mtimeMs, version: contentVersion(content as string) };
      }

      const result = await vault.writeTextIfMatch(path, content as string, ifMatch);

      if (!result.ok) {
        return reply.code(409).send({
          error: "version_conflict",
          message: "The file was changed by someone else since it was read.",
          current: result.current
        });
      }

      return { mtimeMs: result.mtimeMs, version: result.version };
    }
  );

  app.get<{ Querystring: PathQuery }>("/fs/file", { schema: pathQuerySchema }, async (request, reply) => {
    const bytes = await vault.readBytes(request.query.path);

    return reply.header("cache-control", "no-cache").type(contentTypeFor(request.query.path ?? "")).send(bytes);
  });

  app.put<{ Querystring: PathQuery; Body: Buffer }>("/fs/file", { schema: pathQuerySchema }, async (request, reply) => {
    if (!Buffer.isBuffer(request.body)) {
      return reply.code(415).send({ error: "unsupported_media_type", message: "Send the file as application/octet-stream." });
    }

    return vault.writeBytes(request.query.path, request.body);
  });

  app.post<{ Body: RenameBody }>(
    "/fs/rename",
    {
      schema: {
        body: {
          type: "object",
          required: ["from", "to"],
          properties: { from: { type: "string" }, to: { type: "string" } },
          additionalProperties: false
        }
      }
    },
    async (request, reply) => {
      await vault.rename(request.body.from, request.body.to);
      return reply.code(204).send();
    }
  );

  app.post<{ Body: RemoveBody }>(
    "/fs/remove",
    {
      schema: {
        body: {
          type: "object",
          required: ["path"],
          properties: { path: { type: "string" }, recursive: { type: "boolean" } },
          additionalProperties: false
        }
      }
    },
    async (request, reply) => {
      await vault.remove(request.body.path, request.body.recursive === true);
      return reply.code(204).send();
    }
  );
}
