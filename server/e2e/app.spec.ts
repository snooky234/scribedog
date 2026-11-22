import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.SCRIBEDOG_E2E_PASSWORD ?? "e2e-test-password";
const NOTE = process.env.SCRIBEDOG_E2E_NOTE ?? "Projects/Roadmap.md";

// The UI language defaults to German and follows the stored choice; the
// assertions below check English text, so pin the language for every page.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.localStorage.setItem("scribedog-language", "en");
  });
});

/** Path prefix the instance runs under, derived from the configured base URL. */
function basePath(page: Page): string {
  return new URL(page.url()).pathname.replace(/\/$/, "");
}

async function signIn(page: Page): Promise<void> {
  await page.goto("./");
  await page.getByTestId("password").fill(PASSWORD);
  await page.getByTestId("login").click();
  await expect(page.getByTestId("logout")).toBeVisible();
}

/**
 * Opens a note through the file tree, expanding the folders on the way.
 * Rows carry their vault-relative path as the title, folders are collapsed
 * until clicked.
 */
async function openNote(page: Page, relativePath: string): Promise<void> {
  const segments = relativePath.split("/");

  for (let depth = 1; depth < segments.length; depth += 1) {
    const folder = page.getByRole("treeitem").and(page.getByTitle(segments.slice(0, depth).join("/"), { exact: true }));

    if ((await folder.getAttribute("aria-expanded")) !== "true") {
      await folder.click();
    }
  }

  await page.getByRole("treeitem").and(page.getByTitle(relativePath, { exact: true })).click();
  await expect(page.getByTestId("note-title")).toHaveText(relativePath.replace(/\.md$/i, ""));
}

test("rejects a wrong password", async ({ page }) => {
  await page.goto("./");
  await page.getByTestId("password").fill("definitely-not-it");
  await page.getByTestId("login").click();
  await expect(page.getByRole("alert")).toHaveText("Wrong password.");
  await expect(page.getByTestId("logout")).toHaveCount(0);
});

test("prefix without trailing slash redirects to the page", async ({ page, baseURL }) => {
  const prefix = new URL(baseURL ?? "https://localhost/").pathname.replace(/\/$/, "");
  test.skip(prefix === "", "instance runs at the root");

  const response = await page.request.get(new URL(prefix, baseURL).toString(), { maxRedirects: 0 });
  expect(response.status()).toBe(308);
  expect(response.headers().location).toBe(`${prefix}/`);
});

const SEED = ["# Roadmap", "", "- [x] ship stage one", "- [x] write tests", "", "Seeded by the e2e run.", ""].join("\n");

test("login, tree, open, edit in the editor, save, reload, logout", async ({ page, context }) => {
  await signIn(page);

  // Known starting content, written through the API the UI itself uses.
  const seeded = await page.request.put(`${basePath(page)}/api/fs/text`, { data: { path: NOTE, content: SEED } });
  expect(seeded.ok()).toBe(true);
  await page.reload();
  await expect(page.getByTestId("logout")).toBeVisible();

  // The session cookie is scoped to the base path, not the whole host.
  const cookie = (await context.cookies()).find((entry) => entry.name === "scribedog_session");
  expect(cookie).toBeDefined();
  expect(cookie?.path).toBe(basePath(page) || "/");
  expect(cookie?.httpOnly).toBe(true);
  // Only over TLS; the local development server runs plain http.
  expect(cookie?.secure).toBe(new URL(page.url()).protocol === "https:");
  expect(cookie?.sameSite).toBe("Lax");

  // The sidebar names the server vault, not a local folder, and offers no
  // folder menu (nothing to switch to).
  await expect(page.getByTestId("vault-name")).toContainText(new URL(page.url()).host);
  await expect(page.getByRole("button", { name: "Import files" })).toHaveCount(0);

  // Open the note from the tree; the editor shows its rendered markdown.
  await openNote(page, NOTE);
  const editor = page.getByTestId("editor");
  await expect(editor.locator("h1")).toHaveText("Roadmap");
  await expect(page.getByTestId("status")).toHaveAttribute("data-dirty", "false");

  // Edit inside the editor: type at the end of the last paragraph. Waiting
  // for ProseMirror to report focus keeps the keystrokes from landing before
  // its selection is in sync with the click.
  const marker = `Edited in the browser at ${new Date().toISOString()}`;
  const lastParagraph = editor.locator("p").last();
  await expect(lastParagraph).toHaveText("Seeded by the e2e run.");
  await lastParagraph.click();
  await expect(editor).toHaveClass(/ProseMirror-focused/);
  await page.keyboard.press("End");
  await page.keyboard.type(` ${marker}`);
  await expect(lastParagraph).toHaveText(`Seeded by the e2e run. ${marker}`);
  await expect(page.getByTestId("status")).toHaveAttribute("data-dirty", "true");

  // Save with the shortcut, then confirm through the API that the markdown
  // on disk contains the new text.
  await page.keyboard.press("Control+s");
  await expect(page.getByTestId("status")).toHaveAttribute("data-dirty", "false");

  const saved = await page.request.get(`${basePath(page)}/api/fs/text?path=${encodeURIComponent(NOTE)}`);
  expect(saved.ok()).toBe(true);
  const body = (await saved.json()) as { content: string };
  expect(body.content).toContain(marker);
  expect(body.content.startsWith("# Roadmap")).toBe(true);

  // A reload keeps the session (cookie) and shows the saved content again.
  await page.reload();
  await expect(page.getByTestId("logout")).toBeVisible();
  await openNote(page, NOTE);
  await expect(editor).toContainText(marker);

  // Logout drops the cookie and brings the login form back.
  await page.getByTestId("logout").click();
  await expect(page.getByTestId("password")).toBeVisible();
  expect((await context.cookies()).find((entry) => entry.name === "scribedog_session")).toBeUndefined();

  const afterLogout = await page.request.get(`${basePath(page)}/api/files`);
  expect(afterLogout.status()).toBe(401);
});

test("an expired session brings the login form back over the app", async ({ page, context }) => {
  await signIn(page);
  await openNote(page, NOTE);

  // Make an unsaved edit first, then take the cookie away behind the app's
  // back, as an expiry would: the next save runs into a 401. In this order
  // because any background request after the cookie is gone already brings
  // the login form up, which would then cover the editor before the click.
  const editor = page.getByTestId("editor");
  await editor.locator("p").last().click();
  await expect(editor).toHaveClass(/ProseMirror-focused/);
  await page.keyboard.type(" x");
  await context.clearCookies();
  await page.keyboard.press("Control+s");

  await expect(page.getByTestId("password")).toBeVisible();
  // Signing in again continues with the document (and its unsaved edit) still open.
  await page.getByTestId("password").fill(PASSWORD);
  await page.getByTestId("login").click();
  await expect(page.getByTestId("logout")).toBeVisible();
  await expect(page.getByTestId("note-title")).toHaveText(NOTE.replace(/\.md$/i, ""));
  await expect(page.getByTestId("status")).toHaveAttribute("data-dirty", "true");
});

test("bare host root answers 404 when a base path is configured", async ({ page, baseURL }) => {
  test.skip(new URL(baseURL ?? "https://localhost/").pathname === "/", "instance runs at the root");

  const root = new URL("/", baseURL);
  const response = await page.request.get(root.toString());
  expect(response.status()).toBe(404);
});
