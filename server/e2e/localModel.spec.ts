import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * A model server on the user's own device, reached by the browser itself.
 *
 * The scripted model of the e2e stack plays that server here: the tests
 * point the app at its published port (SCRIBEDOG_E2E_MOCK_URL) as an
 * OpenAI-compatible endpoint, so the request goes straight from the tab,
 * not through the ScribeDog server. What is checked is that direct path,
 * and the explanations the app gives when the server refuses the page's
 * origin or is not there at all. The browser's own local network permission
 * is not part of this: page and mock are both on localhost, where no
 * browser asks.
 */

const PASSWORD = process.env.SCRIBEDOG_E2E_PASSWORD ?? "e2e-test-password";
const MOCK_URL = (process.env.SCRIBEDOG_E2E_MOCK_URL ?? "http://localhost:9081").replace(/\/$/, "");
const NOTE = process.env.SCRIBEDOG_E2E_NOTE ?? "Projects/Roadmap.md";

// LM Studio's shape: OpenAI-compatible on a local port, no key. Set per
// describe block by seedSettings, and stored on the server by signIn, since
// the server's copy of the AI settings wins over the browser's.
let aiSettings: Record<string, unknown> = {};

function seedSettings(apiUrl: string) {
  return ({ context }: { context: BrowserContext }) => {
    aiSettings = { provider: "lmstudio", apiUrl, model: "mock-model", agentFileAccess: false, agentPlanning: "off" };
    return context.addInitScript((settings) => {
      window.localStorage.setItem("scribedog-language", "en");
      window.localStorage.setItem("scribedog-ai-settings", JSON.stringify(settings));
    }, aiSettings);
  };
}

const treeRow = (page: Page, title: string) => page.getByRole("treeitem").and(page.getByTitle(title, { exact: true }));

async function signIn(page: Page): Promise<void> {
  await page.goto("./");
  await page.getByTestId("password").fill(PASSWORD);
  await page.getByTestId("login").click();
  await expect(page.getByTestId("logout")).toBeVisible();

  const basePath = new URL(page.url()).pathname.replace(/\/$/, "");
  const stored = await page.request.put(`${basePath}/api/preferences/ai-settings`, { data: { value: aiSettings } });
  expect(stored.ok()).toBe(true);
  await page.reload();
  await expect(page.getByTestId("logout")).toBeVisible();

  const segments = NOTE.split("/");

  for (let depth = 1; depth < segments.length; depth += 1) {
    const folder = treeRow(page, segments.slice(0, depth).join("/"));

    if ((await folder.getAttribute("aria-expanded")) !== "true") {
      await folder.click();
    }
  }

  await treeRow(page, NOTE).click();
  await expect(page.getByTestId("note-title")).toHaveText(NOTE.replace(/\.md$/i, ""));
}

async function openChatAndAsk(page: Page, message: string): Promise<void> {
  await page.getByRole("button", { name: "AI assistant", exact: true }).click();
  await page.getByPlaceholder(/Write a message/).fill(message);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.request.post(`${MOCK_URL}/__mock/reset`);
});

test.afterEach(async ({ page }) => {
  await page.request.post(`${MOCK_URL}/__mock/cors?enabled=true`);
});

test.describe("with the model server reachable", () => {
  test.beforeEach(seedSettings(MOCK_URL));

  test("the browser talks to the model on this device directly", async ({ page }) => {
    await signIn(page);
    await openChatAndAsk(page, "e2e:echo direct");

    await expect(page.locator(".chat-message--assistant").filter({ hasText: "Mock reply to: e2e:echo direct" })).toBeVisible({
      timeout: 15_000
    });

    // The request carried the page's origin, which only a browser sends;
    // the server's proxy never saw it (it forwards no Origin, and would
    // refuse a plain-http target anyway).
    const state = (await (await page.request.get(`${MOCK_URL}/__mock/state`)).json()) as {
      requests: Array<{ origin: string | null; stream: boolean }>;
    };
    const steps = state.requests.filter((request) => request.stream);

    expect(steps.length).toBeGreaterThanOrEqual(1);
    expect(steps.every((request) => request.origin === new URL(page.url()).origin)).toBe(true);
  });

  test("the settings say what the server has to allow", async ({ page }) => {
    await signIn(page);
    await page.getByTestId("settings").click();
    await page.getByRole("tab", { name: "AI settings", exact: true }).click();

    const note = page.getByRole("note").filter({ hasText: "LM Studio runs on this device" });

    await expect(note).toBeVisible();
    await expect(note).toContainText(new URL(page.url()).origin);
    await expect(note).toContainText("enable CORS in the server settings");
  });

  test("explains a server that refuses the page's origin", async ({ page }) => {
    await page.request.post(`${MOCK_URL}/__mock/cors?enabled=false`);
    await signIn(page);
    await openChatAndAsk(page, "e2e:echo refused");

    const error = page.getByRole("region", { name: "AI chat" }).getByText(/does not accept requests from this page/);

    await expect(error).toBeVisible({ timeout: 15_000 });
    await expect(error).toContainText(new URL(page.url()).origin);
    await expect(error).toContainText("enable CORS in the server settings");
  });
});

test.describe("with nothing listening", () => {
  test.beforeEach(seedSettings("http://localhost:9099"));

  test("explains a server that is not running", async ({ page }) => {
    await signIn(page);
    await openChatAndAsk(page, "e2e:echo nobody");

    const error = page.getByRole("region", { name: "AI chat" }).getByText(/Nothing answered at http:\/\/localhost:9099/);

    await expect(error).toBeVisible({ timeout: 15_000 });
    await expect(error).toContainText("LM Studio is running on this device");
  });
});
