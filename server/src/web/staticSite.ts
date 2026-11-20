import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

import { ConfigError, type FaviconConfig } from "../config.js";

/** Must match BASE_PATH_PLACEHOLDER in the root vite.config.ts. */
export const BASE_PATH_PLACEHOLDER = "/__SCRIBEDOG_BASE_PATH__";

/** Must match TITLE_FORMAT_PLACEHOLDER in the root vite.config.ts. */
export const TITLE_FORMAT_PLACEHOLDER = "__SCRIBEDOG_TITLE_FORMAT__";

/**
 * The icon link of the root index.html. Matched rather than templated, so
 * the desktop build and `vite dev` keep a working icon without a server to
 * fill in a placeholder; a test checks it still matches that file.
 */
export const FAVICON_LINK_PATTERN = /<link\s+rel="icon"[^>]*>/;

/** Where an icon of the operator's own is served, next to index.html. */
const CUSTOM_FAVICON_BASENAME = "custom-favicon";

/** A tab icon is a few kilobytes; anything near this is the wrong file. */
const FAVICON_MAX_BYTES = 1024 * 1024;

export type CustomFavicon = {
  body: Buffer;
  contentType: string;
  /** File name it is served under, relative to the page. */
  fileName: string;
  /** Content hash, appended to the link so a new icon is not cached as the old one. */
  version: string;
};

export type IndexHtmlOptions = {
  basePath: string;
  titleFormat?: string | null;
  favicon?: CustomFavicon | null;
};

export type StaticSiteOptions = {
  /** Directory of the built web client (`npm run build:web` in the repo root, i.e. dist-web). */
  webDistDir: string;
  basePath: string;
  titleFormat?: string | null;
  favicon?: FaviconConfig | null;
};

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * The format with nothing open: "{doc} - Team" reads "Team", a bare "{doc}"
 * "ScribeDog". Mirrors buildDocumentTitle in src/lib/documentTitle.ts, which
 * takes over as soon as the app runs.
 */
export function titleWithoutDoc(format: string): string {
  return (
    format
      .split("{doc}")
      .join("")
      .replace(/^[\s\-\u2013\u2014|:\u00b7\u2022,/]+|[\s\-\u2013\u2014|:\u00b7\u2022,/]+$/g, "") || "ScribeDog"
  );
}

/**
 * One image, any installation: the web client is built once and learns its
 * prefix and tab title format from meta tags that carry placeholders; this
 * substitutes the real values when index.html is served. The substitution
 * runs once at startup, not per request, since none of them can change while
 * the process runs.
 *
 * Only index.html needs it. The bundles reference each other and their
 * assets relatively (Vite `base: "./"`), so they work under any prefix as
 * they are, which is also why the page must be reached at `${basePath}/` with
 * the trailing slash (see the redirect below).
 */
export function renderIndexHtml(template: string, options: IndexHtmlOptions): string {
  let html = template
    .split(BASE_PATH_PLACEHOLDER)
    .join(options.basePath)
    .split(TITLE_FORMAT_PLACEHOLDER)
    .join(escapeHtmlAttribute(options.titleFormat ?? ""));

  if (options.titleFormat) {
    // What the tab shows until the app has loaded and knows the note.
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtmlAttribute(titleWithoutDoc(options.titleFormat))}</title>`);
  }

  if (options.favicon) {
    const { contentType, fileName, version } = options.favicon;
    html = html.replace(
      FAVICON_LINK_PATTERN,
      `<link rel="icon" type="${contentType}" href="./${fileName}?v=${version}" />`
    );
  }

  return html;
}

/**
 * Reads the operator's icon once at startup. A file that is missing or far
 * too big stops the start with a message naming the variable, rather than
 * the dog quietly staying in the tab.
 */
export async function loadCustomFavicon(favicon: FaviconConfig): Promise<CustomFavicon> {
  let body: Buffer;

  try {
    body = await readFile(favicon.path);
  } catch (error) {
    throw new ConfigError(
      `SCRIBEDOG_FAVICON "${favicon.path}" cannot be read (${(error as NodeJS.ErrnoException).code ?? (error as Error).message}). Under Docker the path is the one inside the container, so the file has to be mounted there.`
    );
  }

  if (body.length === 0 || body.length > FAVICON_MAX_BYTES) {
    throw new ConfigError(
      `SCRIBEDOG_FAVICON "${favicon.path}" is ${body.length === 0 ? "empty" : "larger than 1 MB"}; a tab icon is usually a few kilobytes.`
    );
  }

  return {
    body,
    contentType: favicon.contentType,
    fileName: `${CUSTOM_FAVICON_BASENAME}${path.extname(favicon.path).toLowerCase()}`,
    version: createHash("sha256").update(body).digest("hex").slice(0, 12)
  };
}

export async function staticSite(app: FastifyInstance, options: StaticSiteOptions): Promise<void> {
  const favicon = options.favicon ? await loadCustomFavicon(options.favicon) : null;
  const template = await readFile(path.join(options.webDistDir, "index.html"), "utf8");
  const indexHtml = renderIndexHtml(template, { basePath: options.basePath, titleFormat: options.titleFormat, favicon });

  // Everything in the build directory except index.html, which must go
  // through the template step above. Hashed bundles under assets/ are
  // immutable; the handful of unhashed files next to index.html (favicon,
  // theme-boot.js) get revalidated on every load so an image update reaches
  // the browser.
  await app.register(fastifyStatic, {
    root: options.webDistDir,
    prefix: "/",
    index: false,
    decorateReply: false,
    cacheControl: false,
    allowedPath: (pathName) => pathName !== "/index.html",
    setHeaders: (response, filePath) => {
      const isHashedAsset = path.relative(options.webDistDir, filePath).split(path.sep)[0] === "assets";
      response.header("cache-control", isHashedAsset ? "public, max-age=31536000, immutable" : "no-cache");
    }
  });

  if (favicon) {
    app.get(`/${favicon.fileName}`, async (_request, reply) => {
      return (
        reply
          .header("cache-control", "no-cache")
          .header("x-content-type-options", "nosniff")
          // An SVG opened directly would run as a page of this origin; the
          // icon has no business running scripts or loading anything.
          .header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
          .type(favicon.contentType)
          .send(favicon.body)
      );
    });
  }

  app.get("/", { prefixTrailingSlash: "slash" }, async (_request, reply) => {
    return reply.header("cache-control", "no-cache").type("text/html; charset=utf-8").send(indexHtml);
  });

  if (options.basePath) {
    // "/anna" without the slash: the relative asset URLs in index.html would
    // resolve against "/" instead of "/anna/", so send the browser to the
    // canonical address rather than serving a page that cannot load.
    app.get("/", { prefixTrailingSlash: "no-slash" }, async (_request, reply) => {
      return reply.redirect(`${options.basePath}/`, 308);
    });
  }
}
