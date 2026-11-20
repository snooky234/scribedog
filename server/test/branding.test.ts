import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfigError, loadConfig, parseFavicon, parseTitleFormat } from "../src/config.js";
import {
  FAVICON_LINK_PATTERN,
  loadCustomFavicon,
  renderIndexHtml,
  TITLE_FORMAT_PLACEHOLDER,
  titleWithoutDoc
} from "../src/web/staticSite.js";
import { createTestContext, type TestContext } from "./helpers.js";

const SVG_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="8"/></svg>';

describe("parseTitleFormat", () => {
  it("is null when unset or blank", () => {
    expect(parseTitleFormat(undefined)).toBeNull();
    expect(parseTitleFormat("   ")).toBeNull();
    expect(loadConfig({}).titleFormat).toBeNull();
  });

  it("keeps the format as typed, trimmed", () => {
    expect(parseTitleFormat("  {doc}  ")).toBe("{doc}");
    expect(loadConfig({ SCRIBEDOG_TITLE_FORMAT: "{doc} | Team" }).titleFormat).toBe("{doc} | Team");
  });

  it("refuses control characters and overlong formats", () => {
    expect(() => parseTitleFormat("{doc}\n- ScribeDog")).toThrow(ConfigError);
    expect(() => parseTitleFormat("{doc}\t- ScribeDog")).toThrow(ConfigError);
    expect(() => parseTitleFormat("x".repeat(201))).toThrow(ConfigError);
  });
});

describe("parseFavicon", () => {
  it("is null when unset", () => {
    expect(parseFavicon(undefined)).toBeNull();
    expect(loadConfig({}).favicon).toBeNull();
  });

  it("takes the type from the extension", () => {
    expect(parseFavicon("/config/icon.SVG")).toEqual({ path: path.resolve("/config/icon.SVG"), contentType: "image/svg+xml" });
    expect(parseFavicon("/config/icon.png")?.contentType).toBe("image/png");
    expect(parseFavicon("/config/icon.ico")?.contentType).toBe("image/x-icon");
  });

  it("refuses other files", () => {
    for (const bad of ["/config/icon.jpg", "/config/icon", "/config/icon.html"]) {
      expect(() => parseFavicon(bad), bad).toThrow(ConfigError);
    }
  });
});

describe("titleWithoutDoc", () => {
  it("drops the placeholder and the separator next to it", () => {
    expect(titleWithoutDoc("{doc} - ScribeDog")).toBe("ScribeDog");
    expect(titleWithoutDoc("{doc} | Team")).toBe("Team");
    expect(titleWithoutDoc("Team: {doc}")).toBe("Team");
    expect(titleWithoutDoc("Notizen")).toBe("Notizen");
  });

  it("falls back to the app name when nothing is left", () => {
    expect(titleWithoutDoc("{doc}")).toBe("ScribeDog");
  });
});

describe("renderIndexHtml with branding", () => {
  const template =
    `<link rel="icon" type="image/svg+xml" href="./favicon.svg" /><title>ScribeDog</title>` +
    `<meta name="scribedog-title-format" content="${TITLE_FORMAT_PLACEHOLDER}" />`;

  it("leaves icon and title alone and empties the placeholder without settings", () => {
    expect(renderIndexHtml(template, { basePath: "" })).toBe(
      '<link rel="icon" type="image/svg+xml" href="./favicon.svg" /><title>ScribeDog</title><meta name="scribedog-title-format" content="" />'
    );
  });

  it("puts the escaped format into the meta tag and the initial title", () => {
    const html = renderIndexHtml(template, { basePath: "", titleFormat: '{doc} | "A&B" <x>' });

    expect(html).toContain('content="{doc} | &quot;A&amp;B&quot; &lt;x&gt;"');
    expect(html).toContain("<title>&quot;A&amp;B&quot; &lt;x&gt;</title>");
  });

  it("swaps the icon link for the custom one", () => {
    const html = renderIndexHtml(template, {
      basePath: "",
      favicon: { body: Buffer.from(SVG_ICON), contentType: "image/png", fileName: "custom-favicon.png", version: "abc123" }
    });

    expect(html).toContain('<link rel="icon" type="image/png" href="./custom-favicon.png?v=abc123" />');
    expect(html).not.toContain("favicon.svg");
  });

  it("matches the icon link of the real index.html", async () => {
    // The server finds the link by pattern; a changed link in index.html
    // would otherwise leave the dog in place without anyone noticing.
    const indexHtml = await readFile(fileURLToPath(new URL("../../index.html", import.meta.url)), "utf8");

    expect(indexHtml.match(new RegExp(FAVICON_LINK_PATTERN, "g"))).toHaveLength(1);
    expect(indexHtml).toMatch(/<title>[^<]*<\/title>/);
  });
});

describe("custom favicon", () => {
  let dir: string;
  let webDistDir: string;
  let context: TestContext | null = null;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "scribedog-favicon-"));
    webDistDir = await mkdtemp(path.join(os.tmpdir(), "scribedog-web-dist-"));
    await writeFile(
      path.join(webDistDir, "index.html"),
      `<!doctype html><html><head><link rel="icon" type="image/svg+xml" href="./favicon.svg" />` +
        `<meta name="scribedog-title-format" content="${TITLE_FORMAT_PLACEHOLDER}" /><title>ScribeDog</title></head></html>`
    );
    await writeFile(path.join(webDistDir, "favicon.svg"), "<svg/>");
    await writeFile(path.join(dir, "team.svg"), SVG_ICON);
  });

  afterEach(async () => {
    await context?.cleanup();
    context = null;
    await rm(dir, { recursive: true, force: true });
    await rm(webDistDir, { recursive: true, force: true });
  });

  it("is served next to the page and linked from it", async () => {
    context = await createTestContext(
      { SCRIBEDOG_BASE_PATH: "/anna", SCRIBEDOG_FAVICON: path.join(dir, "team.svg"), SCRIBEDOG_TITLE_FORMAT: "{doc}" },
      { webDistDir }
    );

    const page = await context.app.inject({ method: "GET", url: "/anna/" });
    const link = /href="\.\/(custom-favicon\.svg)\?v=[0-9a-f]{12}"/.exec(page.body);
    expect(link).not.toBeNull();
    expect(page.body).toContain('content="{doc}"');

    const icon = await context.app.inject({ method: "GET", url: `/anna/${link![1]}` });
    expect(icon.statusCode).toBe(200);
    expect(icon.headers["content-type"]).toMatch(/^image\/svg\+xml/);
    expect(icon.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(icon.headers["x-content-type-options"]).toBe("nosniff");
    expect(icon.body).toBe(SVG_ICON);
  });

  it("is not served when none is configured", async () => {
    context = await createTestContext({}, { webDistDir });

    expect((await context.app.inject({ method: "GET", url: "/custom-favicon.svg" })).statusCode).toBe(404);
  });

  it("stops the start when the file is missing, empty or far too big", async () => {
    await expect(loadCustomFavicon({ path: path.join(dir, "missing.png"), contentType: "image/png" })).rejects.toThrow(ConfigError);

    await writeFile(path.join(dir, "empty.png"), "");
    await expect(loadCustomFavicon({ path: path.join(dir, "empty.png"), contentType: "image/png" })).rejects.toThrow(/empty/);

    await writeFile(path.join(dir, "huge.png"), Buffer.alloc(1024 * 1024 + 1));
    await expect(loadCustomFavicon({ path: path.join(dir, "huge.png"), contentType: "image/png" })).rejects.toThrow(/1 MB/);
  });

  it("names the variable when the app cannot start because of it", async () => {
    await expect(
      createTestContext({ SCRIBEDOG_FAVICON: path.join(dir, "missing.png") }, { webDistDir })
    ).rejects.toThrow(/SCRIBEDOG_FAVICON/);
  });
});
