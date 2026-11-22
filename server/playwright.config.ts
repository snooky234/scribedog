import { defineConfig } from "@playwright/test";

// Browser end-to-end run against an already running instance (typically the
// docker compose stack). Point SCRIBEDOG_E2E_URL at the app, base path
// included, e.g. https://localhost/ or https://localhost:9443/anna/, and
// SCRIBEDOG_E2E_PASSWORD at its password. The installation's own CA is
// usually not in the test machine's trust store, hence ignoreHTTPSErrors;
// TLS itself is covered by test/makeCerts.test.ts.
const baseURL = process.env.SCRIBEDOG_E2E_URL ?? "https://localhost/";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  // One worker: the specs share a single live instance, one vault and one
  // password, and account.spec.ts changes that password mid-run.
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    // Every test starts in a fresh browser, which the app takes for a new
    // installation and turns folder notes on for: a click on a folder then
    // opens its note instead of expanding it. The specs walk the tree by
    // expanding folders, so they run as an installation from before that
    // default, with folder notes off.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: new URL(baseURL).origin,
          localStorage: [{ name: "scribedog-folder-notes-default", value: "off" }]
        }
      ]
    }
  }
});
