import { expect, test, type Page } from "@playwright/test";

/**
 * The vault agent in the browser, against the scripted model of the e2e
 * stack (docker-compose.e2e.yml, e2e/mock-llm). Every request the agent
 * makes travels the real way: browser → ScribeDog server → LLM proxy →
 * https://llm.e2e.internal, and the tool calls it gets back run against the
 * server's vault. What the tests check is the chain around the model: the
 * streamed answer, the tool loop, the staging layer, the review in the
 * editor, checkpoints and revert, and that chat sessions land in the vault.
 *
 * The mock's request log is read through SCRIBEDOG_E2E_MOCK_URL (the port the
 * compose file publishes, 9081 by default).
 */

const PASSWORD = process.env.SCRIBEDOG_E2E_PASSWORD ?? "e2e-test-password";
const MOCK_URL = (process.env.SCRIBEDOG_E2E_MOCK_URL ?? "http://localhost:9081").replace(/\/$/, "");
const NOTE = process.env.SCRIBEDOG_E2E_NOTE ?? "Projects/Roadmap.md";

// The provider the tests use: the mock behind the LLM proxy, with the
// agent's file access switched on. The key itself is stored on the server
// (see signInWithAgent); this is only the non-secret part.
const AI_SETTINGS = {
  provider: "openai",
  apiUrl: "https://llm.e2e.internal",
  model: "mock-model",
  agentFileAccess: true,
  agentAllowDelete: true,
  agentPlanning: "auto"
};

test.beforeEach(async ({ context }) => {
  await context.addInitScript((settings) => {
    window.localStorage.setItem("scribedog-language", "en");
    window.localStorage.setItem("scribedog-ai-settings", JSON.stringify(settings));
  }, AI_SETTINGS);
});

function basePath(page: Page): string {
  return new URL(page.url()).pathname.replace(/\/$/, "");
}

const fsUrl = (page: Page, route: string, path: string) => `${basePath(page)}/api/fs/${route}?path=${encodeURIComponent(path)}`;

async function existsOnServer(page: Page, path: string): Promise<boolean> {
  const response = await page.request.get(fsUrl(page, "exists", path));
  expect(response.ok()).toBe(true);

  return ((await response.json()) as { exists: boolean }).exists;
}

async function readOnServer(page: Page, path: string): Promise<string> {
  const response = await page.request.get(fsUrl(page, "text", path));
  expect(response.ok()).toBe(true);

  return ((await response.json()) as { content: string }).content;
}

async function writeOnServer(page: Page, path: string, content: string): Promise<void> {
  const response = await page.request.put(`${basePath(page)}/api/fs/text`, { data: { path, content } });
  expect(response.ok()).toBe(true);
}

/**
 * Signs in, stores a key for the mock provider and reloads so the app starts
 * with the key known. Ends with the chat panel open.
 */
async function signInWithAgent(page: Page): Promise<void> {
  await page.goto("./");
  await page.getByTestId("password").fill(PASSWORD);
  await page.getByTestId("login").click();
  await expect(page.getByTestId("logout")).toBeVisible();

  const stored = await page.request.put(`${basePath(page)}/api/secrets/openai`, { data: { value: "sk-mock" } });
  expect(stored.ok()).toBe(true);
  // The server's copy of the AI settings wins over the browser's, so the
  // mock provider has to be stored there as well.
  const settings = await page.request.put(`${basePath(page)}/api/preferences/ai-settings`, { data: { value: AI_SETTINGS } });
  expect(settings.ok()).toBe(true);
  await clearStagedChanges(page);
  await page.reload();
  await expect(page.getByTestId("logout")).toBeVisible();

  await openNote(page, NOTE);
  await page.getByRole("button", { name: "AI assistant", exact: true }).click();
  await expect(page.getByPlaceholder(/Write a message/)).toBeVisible();
}

/** Opens a note through the tree, expanding the folders on the way (they start collapsed). */
async function openNote(page: Page, relativePath: string): Promise<void> {
  const segments = relativePath.split("/");

  for (let depth = 1; depth < segments.length; depth += 1) {
    const folder = treeRow(page, segments.slice(0, depth).join("/"));

    if ((await folder.getAttribute("aria-expanded")) !== "true") {
      await folder.click();
    }
  }

  await treeRow(page, relativePath).click();
  await expect(page.getByTestId("note-title")).toHaveText(relativePath.replace(/\.md$/i, ""));
}

async function ask(page: Page, message: string): Promise<void> {
  await page.getByPlaceholder(/Write a message/).fill(message);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

const treeRow = (page: Page, title: string) => page.getByRole("treeitem").and(page.getByTitle(title, { exact: true }));
const pendingChanges = (page: Page) => page.getByLabel(/^Pending changes \(\d+\)$/);

async function mockState(page: Page): Promise<{ requests: Array<{ stream: boolean; tools: string[]; lastRole: string | null; scenario: string }>; aborted: number }> {
  const response = await page.request.get(`${MOCK_URL}/__mock/state`);
  expect(response.ok()).toBe(true);

  return (await response.json()) as never;
}

test.beforeEach(async ({ page }) => {
  await page.request.post(`${MOCK_URL}/__mock/reset`);
});

/**
 * Proposals live in the vault (.scribedog/staged-changes.json), so a run that
 * failed halfway leaves them for the next one. Each test starts without any.
 */
async function clearStagedChanges(page: Page): Promise<void> {
  await page.request.post(`${basePath(page)}/api/fs/remove`, { data: { path: ".scribedog/staged-changes.json" } });
}

test("proposes a new note through the proxy, applies it, and takes it back", async ({ page }) => {
  await signInWithAgent(page);
  const title = `Agent note ${Date.now().toString(36)}`;
  const path = `${title}.md`;

  await ask(page, `e2e:create ${title}`);

  // The turn ends with the model's closing text, and the proposal sits in the
  // pending-changes card rather than on disk.
  await expect(page.getByText("Done.", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(pendingChanges(page)).toContainText(path);
  await expect(pendingChanges(page)).toContainText("new file");
  expect(await existsOnServer(page, path)).toBe(false);

  // The requests went the real way: streamed agent steps carrying the file
  // tools, then the closing step with the tool result.
  const state = await mockState(page);
  const agentSteps = state.requests.filter((request) => request.tools.includes("write_file"));

  expect(agentSteps.length).toBeGreaterThanOrEqual(2);
  expect(agentSteps[0].stream).toBe(true);
  expect(agentSteps[agentSteps.length - 1].lastRole).toBe("tool");

  // Opening the entry shows the proposal as a review and locks the editor.
  await pendingChanges(page).getByRole("button", { name: path }).click();
  await expect(page.getByTestId("note-title")).toHaveText(path.replace(/\.md$/i, ""));
  await expect(page.getByText("This note will be created.")).toBeVisible();
  await expect(page.getByTestId("editor")).toContainText("Written by the mock model.");
  await expect(page.getByTestId("editor")).toHaveAttribute("contenteditable", "false");

  // Apply: the file is written through the server, the card empties, and
  // the turn gains an undo.
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(pendingChanges(page)).toHaveCount(0);
  await expect.poll(() => existsOnServer(page, path)).toBe(true);
  expect(await readOnServer(page, path)).toContain("Written by the mock model.");
  await expect(treeRow(page, path)).toBeVisible();
  await expect(page.getByTestId("editor")).toHaveAttribute("contenteditable", "true");
  // The applied content is what the editor holds, nothing is left unsaved.
  await expect(page.getByTestId("status")).toHaveAttribute("data-dirty", "false");

  // The checkpoint and the chat session are in the vault, not in the tab.
  await expect.poll(() => existsOnServer(page, ".scribedog/checkpoints/index.json")).toBe(true);
  expect(await readOnServer(page, ".scribedog/checkpoints/index.json")).toContain(path);
  await expect.poll(() => readOnServer(page, ".scribedog/chat-sessions.json")).toContain(`e2e:create ${title}`);

  // Undo the revision: the note the agent created is gone again.
  // The chat turn's undo, not the editor toolbar's button of the same name.
  await page.getByTitle("Take this revision back", { exact: true }).click();
  await page.getByRole("button", { name: "Take back", exact: true }).click();
  await expect.poll(() => existsOnServer(page, path)).toBe(false);
  await expect(treeRow(page, path)).toHaveCount(0);
});

test("an edit to a note that is not open is reviewed when that note is opened", async ({ page }) => {
  await signInWithAgent(page);
  const stamp = Date.now().toString(36);
  const path = `Projects/Edited ${stamp}.md`;
  const before = `# Edited\n\nThe old wording ${stamp} lives here.\n\nA second paragraph.\n`;

  await writeOnServer(page, path, before);
  // The live update has to bring the note into the tree before the agent
  // can find it.
  await expect(treeRow(page, path)).toBeVisible();

  await ask(page, `e2e:edit ${path} | The old wording ${stamp} lives here. | The new wording ${stamp} lives here.`);
  await expect(page.getByText("Done.", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(pendingChanges(page)).toContainText("edited");
  expect(await readOnServer(page, path)).toBe(before);

  // Opening the note in the tree renders the proposal as a red/green review.
  await openNote(page, path);
  await expect(page.getByText("Proposed changes: 1")).toBeVisible();
  await expect(page.getByTestId("editor")).toContainText(`The new wording ${stamp} lives here.`);
  await expect(page.getByTestId("editor")).toHaveAttribute("contenteditable", "false");

  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(pendingChanges(page)).toHaveCount(0);
  await expect.poll(() => readOnServer(page, path)).toContain(`The new wording ${stamp} lives here.`);
  expect(await readOnServer(page, path)).not.toContain("The old wording");
  await expect(page.getByTestId("editor")).toHaveAttribute("contenteditable", "true");

  // Undo restores the wording from the checkpoint's copy. (Compared by
  // wording, not byte for byte: the note was open in the editor, and the
  // copy is the editor's canonical form of it, without the trailing newline.)
  // The chat turn's undo, not the editor toolbar's button of the same name.
  await page.getByTitle("Take this revision back", { exact: true }).click();
  await page.getByRole("button", { name: "Take back", exact: true }).click();
  await expect.poll(() => readOnServer(page, path)).toContain(`The old wording ${stamp} lives here.`);
  expect(await readOnServer(page, path)).not.toContain("The new wording");
  await expect(page.getByTestId("editor")).toContainText(`The old wording ${stamp} lives here.`);
  await expect(page.getByTestId("status")).toHaveAttribute("data-dirty", "false");

  await page.request.post(`${basePath(page)}/api/fs/remove`, { data: { path } });
});

test("a discarded proposal changes nothing", async ({ page }) => {
  await signInWithAgent(page);
  const path = `Discarded ${Date.now().toString(36)}.md`;

  await ask(page, `e2e:create ${path.slice(0, -3)}`);
  await expect(pendingChanges(page)).toContainText(path, { timeout: 15_000 });

  await page.getByRole("button", { name: "Discard all", exact: true }).click();
  await expect(pendingChanges(page)).toHaveCount(0);
  expect(await existsOnServer(page, path)).toBe(false);
  await expect(treeRow(page, path)).toHaveCount(0);
});

test("a run of many tool calls goes back and forth through the proxy", async ({ page }) => {
  await signInWithAgent(page);

  await ask(page, "e2e:chain 12");
  await expect(page.getByText("Done after 12 tool calls.", { exact: true })).toBeVisible({ timeout: 60_000 });

  // Thirteen agent steps: twelve answered with a tool call, the last with
  // text. Every one of them was streamed.
  const state = await mockState(page);
  const agentSteps = state.requests.filter((request) => request.tools.includes("list_files"));

  expect(agentSteps).toHaveLength(13);
  expect(agentSteps.every((request) => request.stream)).toBe(true);
  expect(agentSteps.filter((request) => request.lastRole === "tool")).toHaveLength(12);
});

test("stopping a streamed answer reaches the model behind the proxy", async ({ page }) => {
  await signInWithAgent(page);

  await ask(page, "e2e:slow");

  // Tokens arrive one at a time; stop in the middle of them.
  await expect(page.getByText(/token3 /)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/token30 /)).toHaveCount(0);
  await page.getByRole("button", { name: "Stop", exact: true }).click();

  // The server hangs up on the mock, which notices the closed connection.
  await expect.poll(async () => (await mockState(page)).aborted, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
  await expect(page.getByText(/token39 /)).toHaveCount(0);
});

test("the knowledge base stays off in the browser even when the vault switched it on", async ({ page }) => {
  await signInWithAgent(page);

  // rag.json travels with the vault; a vault prepared on the desktop brings
  // the switch along. The browser has no index, so nothing may offer it.
  await writeOnServer(page, ".scribedog/rag.json", JSON.stringify({ enabled: true, rootIncluded: true, overrides: {} }));
  await page.reload();
  await expect(page.getByTestId("logout")).toBeVisible();
  await openNote(page, NOTE);
  await page.getByRole("button", { name: "AI assistant", exact: true }).click();
  await expect(page.getByPlaceholder(/Write a message/)).toBeVisible();

  await expect(page.getByRole("button", { name: "Knowledge base" })).toHaveCount(0);
  await page.getByTestId("settings").click();
  await expect(page.getByRole("tab", { name: "AI settings" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Knowledge base" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tab", { name: "AI settings" })).toHaveCount(0);

  await ask(page, "e2e:list");
  await expect(page.getByText("Done.", { exact: true })).toBeVisible({ timeout: 15_000 });

  const state = await mockState(page);
  const offered = new Set(state.requests.flatMap((request) => request.tools));

  expect(offered.has("list_files")).toBe(true);
  expect(offered.has("search_vault")).toBe(false);
  expect(offered.has("read_note")).toBe(false);

  await page.request.post(`${basePath(page)}/api/fs/remove`, { data: { path: ".scribedog/rag.json" } });
});
