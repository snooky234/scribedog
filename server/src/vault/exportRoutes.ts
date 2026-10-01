import type { FastifyInstance } from "fastify";

import type { RequireSession } from "../auth/guard.js";
import { archiveBaseName, collectExportEntries, createZipStream } from "./exportZip.js";
import type { Vault } from "./files.js";
import { attachVault, vaultErrorHandler, type VaultResolver } from "./routes.js";

export type ExportRoutesOptions = {
  vault: Vault | VaultResolver;
  requireSession: RequireSession;
};

type PathQuery = { path?: string };

/**
 * `Content-Disposition` with the name in both spellings: the ASCII fallback
 * for old clients, the RFC 5987 form for a folder called "Rezepte & Ideen".
 * The app's clients name the file themselves; this is for curl and scripts.
 */
function attachment(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");

  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * `GET /api/export/zip?path=<folder>`: the folder's raw files as a ZIP
 * (`path=` for the whole vault). Not one of the `/fs` primitives, because
 * it is not a vault operation the desktop mirrors on a local folder; it
 * exists for the client that has no file manager next to the notes.
 * Mounted under `${basePath}/api`, behind requireSession like the file API.
 */
export async function exportRoutes(app: FastifyInstance, options: ExportRoutesOptions): Promise<void> {
  const { requireSession } = options;

  app.addHook("onRequest", requireSession);
  app.setErrorHandler(vaultErrorHandler);
  attachVault(app, options.vault);

  app.get<{ Querystring: PathQuery }>(
    "/export/zip",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["path"],
          properties: { path: { type: "string" } }
        }
      }
    },
    async (request, reply) => {
      const { relativePath, entries } = await collectExportEntries(request.vault!.realPath, request.query.path);

      return reply
        .header("cache-control", "no-store")
        .header("content-disposition", attachment(`${archiveBaseName(relativePath)}.zip`))
        .type("application/zip")
        .send(createZipStream(entries));
    }
  );
}
