import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import { openAuthStore, type AuthStore } from "../src/auth/authStore.js";
import { SESSION_COOKIE_NAME } from "../src/auth/session.js";
import { openTokenStore, type TokenStore } from "../src/auth/tokenStore.js";
import { loadConfig, type ServerConfig } from "../src/config.js";
import { KEY_COOKIE_NAME } from "../src/secrets/keyCookie.js";
import { openSecretStore, type SecretStore } from "../src/secrets/secretStore.js";
import { openSharedVaults, type SharedVaults } from "../src/shared/service.js";
import { openVault, type Vault } from "../src/vault/files.js";
import { createVaultWatcher, type VaultWatcher } from "../src/vault/watcher.js";

export const TEST_PASSWORD = "correct horse battery";

const silentLog = { info: () => {}, warn: () => {} };

export type TestContext = {
  vaultPath: string;
  config: ServerConfig;
  vault: Vault;
  authStore: AuthStore;
  secrets: SecretStore;
  tokens: TokenStore;
  app: FastifyInstance;
  /** Only when created with `watch: true`. */
  watcher: VaultWatcher | null;
  /** Only when created with `shared`. */
  shared: SharedVaults | null;
  /**
   * Logs in and returns the Cookie header value for subsequent requests,
   * session token and key cookie together, the way a browser sends them.
   */
  login(password?: string): Promise<string>;
  cleanup(): Promise<void>;
};

export async function createTempVault(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "scribedog-server-test-"));
  await writeFile(path.join(root, "Welcome.md"), "# Welcome\n\nHello.\n");
  await mkdir(path.join(root, "Notes"), { recursive: true });
  await writeFile(path.join(root, "Notes", "Idea.md"), "# Idea\n");
  await writeFile(path.join(root, "Notes", "not-markdown.txt"), "plain\n");
  await mkdir(path.join(root, ".scribedog"), { recursive: true });
  await writeFile(path.join(root, ".scribedog", "secret.md"), "# not for the API\n");
  return root;
}

export async function createTestContext(
  env: NodeJS.ProcessEnv = {},
  options: {
    webDistDir?: string;
    watch?: boolean;
    /** Join a shared-vault setup at `root` as `user` (one instance per person). */
    shared?: { root: string; user: string; now?: () => number; accessPollMs?: number };
  } = {}
): Promise<TestContext> {
  const vaultPath = await createTempVault();
  const config = loadConfig({
    SCRIBEDOG_VAULT_PATH: vaultPath,
    SCRIBEDOG_INIT_PASSWORD: TEST_PASSWORD,
    SCRIBEDOG_COOKIE_SECURE: "false",
    ...env
  });
  const vault = await openVault(config.vaultPath);
  const authStore = await openAuthStore({ vaultPath: vault.realPath, initPassword: config.initPassword, log: silentLog });
  const secrets = openSecretStore(vault.realPath);
  const tokens = await openTokenStore({ vaultPath: vault.realPath, log: silentLog });
  const watcher = options.watch ? createVaultWatcher(vault.realPath, silentLog) : null;
  const shared = options.shared ? await openSharedVaults({ ...options.shared, log: silentLog }) : null;
  const app = await buildApp({
    config,
    authStore,
    secrets,
    tokens,
    vault,
    watcher: watcher ?? undefined,
    shared,
    webDistDir: options.webDistDir
  });

  return {
    vaultPath,
    config,
    vault,
    authStore,
    secrets,
    tokens,
    app,
    watcher,
    shared,
    async login(password = TEST_PASSWORD) {
      const response = await app.inject({
        method: "POST",
        url: `${config.basePath}/api/auth/login`,
        payload: { password }
      });

      if (response.statusCode !== 200) {
        throw new Error(`login failed: ${response.statusCode} ${response.body}`);
      }

      const cookie = response.cookies.find((entry) => entry.name === SESSION_COOKIE_NAME);

      if (!cookie) {
        throw new Error("login did not set a session cookie");
      }

      const keyCookie = response.cookies.find((entry) => entry.name === KEY_COOKIE_NAME && entry.value.length > 0);

      return [`${cookie.name}=${cookie.value}`, keyCookie ? `${keyCookie.name}=${keyCookie.value}` : null]
        .filter((entry): entry is string => entry !== null)
        .join("; ");
    },
    async cleanup() {
      watcher?.close();
      shared?.close();
      await app.close();
      await rm(vaultPath, { recursive: true, force: true });
    }
  };
}
