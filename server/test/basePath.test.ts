import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SESSION_COOKIE_NAME } from "../src/auth/session.js";
import { ConfigError, loadConfig, normalizeBasePath, parseTrustProxy } from "../src/config.js";
import { BASE_PATH_PLACEHOLDER, renderIndexHtml } from "../src/web/staticSite.js";
import { createTestContext, TEST_PASSWORD, type TestContext } from "./helpers.js";

describe("normalizeBasePath", () => {
  it("treats empty and root as the root", () => {
    expect(normalizeBasePath(undefined)).toBe("");
    expect(normalizeBasePath("")).toBe("");
    expect(normalizeBasePath("   ")).toBe("");
    expect(normalizeBasePath("/")).toBe("");
    expect(normalizeBasePath("//")).toBe("");
  });

  it("adds the leading slash and strips trailing ones", () => {
    expect(normalizeBasePath("anna")).toBe("/anna");
    expect(normalizeBasePath("/anna")).toBe("/anna");
    expect(normalizeBasePath("/anna/")).toBe("/anna");
    expect(normalizeBasePath("anna/")).toBe("/anna");
    expect(normalizeBasePath("/anna//notes/")).toBe("/anna/notes");
    expect(normalizeBasePath("\\anna\\")).toBe("/anna");
    expect(normalizeBasePath(" /team-a.v2_x ")).toBe("/team-a.v2_x");
  });

  it("rejects segments that would need escaping", () => {
    for (const bad of ["/an na", "/anna?x", "/a/../b", "/./a", "/a#b", "/anna;x", "/ünicode", "/a%20b"]) {
      expect(() => normalizeBasePath(bad), bad).toThrow(ConfigError);
    }
  });

  it("feeds into loadConfig", () => {
    expect(loadConfig({ SCRIBEDOG_BASE_PATH: "bob/" }).basePath).toBe("/bob");
    expect(loadConfig({}).basePath).toBe("");
  });

  it("resolves the web build directory from the environment or next to the package", () => {
    expect(loadConfig({ SCRIBEDOG_WEB_DIST_DIR: "/srv/scribedog/web" }).webDistDir).toBe(path.resolve("/srv/scribedog/web"));
    expect(loadConfig({}).webDistDir).toBe(path.resolve(process.cwd(), "..", "dist-web"));
  });

  it("reads the person and the shared folder, both optional", () => {
    expect(loadConfig({})).toMatchObject({ user: null, sharedPath: null });
    expect(loadConfig({ SCRIBEDOG_USER: " anna ", SCRIBEDOG_SHARED_PATH: "/shared" })).toMatchObject({
      user: "anna",
      sharedPath: path.resolve("/shared")
    });
    // Without a name sharing stays off at startup instead of refusing to start.
    expect(loadConfig({ SCRIBEDOG_SHARED_PATH: "/shared" })).toMatchObject({ user: null });
  });

  it("refuses a user name that could not be a folder name", () => {
    for (const name of ["Anna", "../anna", "anna bob", ".anna"]) {
      expect(() => loadConfig({ SCRIBEDOG_USER: name }), name).toThrow(ConfigError);
    }
  });
});

describe("renderIndexHtml", () => {
  const template = `<meta name="scribedog-base-path" content="${BASE_PATH_PLACEHOLDER}"><script type="module" src="./assets/index-abc.js"></script>`;

  it("substitutes the placeholder with the prefix and leaves relative asset URLs alone", () => {
    expect(renderIndexHtml(template, "/anna")).toBe(
      '<meta name="scribedog-base-path" content="/anna"><script type="module" src="./assets/index-abc.js"></script>'
    );
  });

  it("removes the placeholder for the root", () => {
    expect(renderIndexHtml(template, "")).toBe(
      '<meta name="scribedog-base-path" content=""><script type="module" src="./assets/index-abc.js"></script>'
    );
  });

  it("replaces every occurrence", () => {
    expect(renderIndexHtml(`${BASE_PATH_PLACEHOLDER}|${BASE_PATH_PLACEHOLDER}`, "/x")).toBe("/x|/x");
  });
});
/**
 * A stand-in for the real web build: the same three kinds of files the
 * server has to treat differently (the templated page, hashed bundles under
 * assets/, unhashed files next to the page).
 */
async function createWebDist(): Promise<string> {
  const webDistDir = await mkdtemp(path.join(os.tmpdir(), "scribedog-web-dist-"));
  await mkdir(path.join(webDistDir, "assets"), { recursive: true });
  await writeFile(
    path.join(webDistDir, "index.html"),
    `<!doctype html><html><head><meta name="scribedog-base-path" content="${BASE_PATH_PLACEHOLDER}"><script type="module" src="./assets/app.js"></script></head><body></body></html>`
  );
  await writeFile(path.join(webDistDir, "assets", "app.js"), "console.log('app');\n");
  await writeFile(path.join(webDistDir, "theme-boot.js"), "document.documentElement.classList.add('dark');\n");
  return webDistDir;
}

describe("app under a base path", () => {
  let context: TestContext;
  let webDistDir: string;

  beforeEach(async () => {
    webDistDir = await createWebDist();
    context = await createTestContext({ SCRIBEDOG_BASE_PATH: "/anna/" }, { webDistDir });
  });

  afterEach(async () => {
    await context.cleanup();
    await rm(webDistDir, { recursive: true, force: true });
  });

  it("serves nothing at the bare root", async () => {
    expect((await context.app.inject({ method: "GET", url: "/" })).statusCode).toBe(404);
    expect((await context.app.inject({ method: "GET", url: "/api/files" })).statusCode).toBe(404);
    expect((await context.app.inject({ method: "POST", url: "/api/auth/login", payload: { password: TEST_PASSWORD } })).statusCode).toBe(
      404
    );
    expect((await context.app.inject({ method: "GET", url: "/assets/app.js" })).statusCode).toBe(404);
    expect((await context.app.inject({ method: "GET", url: "/theme-boot.js" })).statusCode).toBe(404);
  });

  it("serves the templated index.html under the prefix", async () => {
    const response = await context.app.inject({ method: "GET", url: "/anna/" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/text\/html/);
    expect(response.headers["cache-control"]).toBe("no-cache");
    expect(response.body).toContain('content="/anna"');
    expect(response.body).toContain('src="./assets/app.js"');
    expect(response.body).not.toContain(BASE_PATH_PLACEHOLDER);
  });

  it("redirects the prefix without a trailing slash to the page", async () => {
    // The page references its assets relatively, so "/anna" would resolve
    // them against "/" and load nothing.
    const response = await context.app.inject({ method: "GET", url: "/anna" });

    expect(response.statusCode).toBe(308);
    expect(response.headers.location).toBe("/anna/");
  });

  it("serves assets under the prefix with long caching", async () => {
    const response = await context.app.inject({ method: "GET", url: "/anna/assets/app.js" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toMatch(/immutable/);
    expect(response.body).toContain("console.log");
  });

  it("serves unhashed files next to the page with revalidation", async () => {
    const response = await context.app.inject({ method: "GET", url: "/anna/theme-boot.js" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-cache");
    expect(response.body).toContain("classList");
  });

  it("never serves the raw index.html template", async () => {
    expect((await context.app.inject({ method: "GET", url: "/anna/index.html" })).statusCode).toBe(404);
  });

  it("does not let the static handler reach outside the build directory", async () => {
    expect((await context.app.inject({ method: "GET", url: "/anna/assets/../index.html" })).statusCode).not.toBe(200);
    expect((await context.app.inject({ method: "GET", url: "/anna/assets/..%2Findex.html" })).statusCode).not.toBe(200);
    expect((await context.app.inject({ method: "GET", url: "/anna/../package.json" })).statusCode).not.toBe(200);
    expect((await context.app.inject({ method: "GET", url: "/anna/..%2Fpackage.json" })).statusCode).not.toBe(200);
  });

  it("scopes the session cookie to the prefix and mounts the API under it", async () => {
    const login = await context.app.inject({ method: "POST", url: "/anna/api/auth/login", payload: { password: TEST_PASSWORD } });

    expect(login.statusCode).toBe(200);
    const cookie = login.cookies.find((entry) => entry.name === SESSION_COOKIE_NAME);
    expect(cookie?.path).toBe("/anna");

    const cookieHeader = `${cookie?.name}=${cookie?.value}`;
    const files = await context.app.inject({ method: "GET", url: "/anna/api/files", headers: { cookie: cookieHeader } });
    expect(files.statusCode).toBe(200);
    expect(files.json().files.map((file: { relativePath: string }) => file.relativePath)).toEqual(["Notes/Idea.md", "Welcome.md"]);

    const logout = await context.app.inject({ method: "POST", url: "/anna/api/auth/logout", headers: { cookie: cookieHeader } });
    expect(logout.statusCode).toBe(204);
    expect(logout.cookies.find((entry) => entry.name === SESSION_COOKIE_NAME)?.path).toBe("/anna");
  });
});

describe("app at the root", () => {
  let context: TestContext;
  let webDistDir: string;

  beforeEach(async () => {
    webDistDir = await createWebDist();
    context = await createTestContext({}, { webDistDir });
  });

  afterEach(async () => {
    await context.cleanup();
    await rm(webDistDir, { recursive: true, force: true });
  });

  it("serves index.html and assets at the root", async () => {
    const index = await context.app.inject({ method: "GET", url: "/" });
    expect(index.statusCode).toBe(200);
    expect(index.body).toContain('content=""');
    expect(index.body).toContain('src="./assets/app.js"');

    expect((await context.app.inject({ method: "GET", url: "/assets/app.js" })).statusCode).toBe(200);
    expect((await context.app.inject({ method: "GET", url: "/theme-boot.js" })).statusCode).toBe(200);
    expect((await context.app.inject({ method: "GET", url: "/index.html" })).statusCode).toBe(404);
  });
});

describe("trust proxy", () => {
  it("defaults to the one proxy the compose file puts in front", () => {
    expect(parseTrustProxy(undefined)).toBe(1);
    expect(parseTrustProxy("")).toBe(1);
    // "true" must not become "trust every hop the client claims": that is
    // what would let a forged X-Forwarded-For pick its own rate-limit bucket.
    expect(parseTrustProxy("true")).toBe(1);
  });

  it("takes a hop count, a switch-off, or a list of proxy addresses", () => {
    expect(parseTrustProxy("2")).toBe(2);
    expect(parseTrustProxy("false")).toBe(false);
    expect(parseTrustProxy("10.0.0.0/8")).toBe("10.0.0.0/8");
  });
});
