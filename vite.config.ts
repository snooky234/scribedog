// "vitest/config" re-exports vite's defineConfig and additionally accepts the
// `test` block below, so the dev/build config and the test config share one
// source of truth (notably the "@" alias).
import { defineConfig, type PluginOption } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { Agent } from "node:http";
import { fileURLToPath, URL } from "node:url";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const packageVersion = (JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string })
  .version;

/**
 * The server edition builds the web client once and ships it in one Docker
 * image, but every installation may run under its own path prefix
 * (SCRIBEDOG_BASE_PATH). Vite bakes `base` into asset URLs at build time,
 * so the web build uses a relative base and the page itself learns its
 * prefix from this meta tag, which the server fills in when it serves
 * index.html (server/src/web/staticSite.ts). The placeholder must look like a
 * path so nothing else in the build ever matches it; it also has to stay in
 * step with BASE_PATH_PLACEHOLDER on the server side.
 */
const BASE_PATH_PLACEHOLDER = "/__SCRIBEDOG_BASE_PATH__";

function webIndexHtml(): PluginOption {
  return {
    name: "scribedog-web-index-html",
    transformIndexHtml: {
      order: "pre",
      handler: (html) =>
        html.replace(
          "<title>",
          `<meta name="scribedog-base-path" content="${BASE_PATH_PLACEHOLDER}" />\n    <title>`
        )
    }
  };
}

// https://vite.dev/config/
export default defineConfig(async ({ mode }) => {
  // Two build targets from one project: the Tauri desktop app (default) and
  // the web client of the server edition (`--mode web`). They differ only in
  // which platform implementation the `@platform-impl` alias resolves to,
  // the asset base and the output directory; the application code is shared.
  const isWeb = mode === "web";

  return {
    base: isWeb ? "./" : "/",
    plugins: [react(), tailwindcss(), ...(isWeb ? [webIndexHtml()] : [])],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        "@platform-impl": fileURLToPath(
          new URL(isWeb ? "./src/platform/web/index.ts" : "./src/platform/desktop/index.ts", import.meta.url)
        )
      },
    },
    define: {
      __SCRIBEDOG_VERSION__: JSON.stringify(packageVersion)
    },
    build: {
      outDir: isWeb ? "dist-web" : "dist",
      emptyOutDir: true
    },
    // The page map worker (src/lib/export/pageMapWorker.ts) loads pdfmake on
    // demand, and only ES workers can split code.
    worker: {
      format: "es" as const
    },

    // Only pure logic is covered (no component rendering), so node is the right
    // default; the few suites that parse markdown through a DOM opt into jsdom
    // per file with a "@vitest-environment jsdom" comment.
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
    },

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent Vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: isWeb
      ? {
          // `npm run dev:web` against a locally running server
          // (`npm run dev` in server/), which answers the API on port 3000.
          port: 5173,
          strictPort: true,
          proxy: {
            "/api": {
              target: "http://127.0.0.1:3000",
              // /api/events is a WebSocket (the live-update channel). Without
              // `ws` the upgrade is not forwarded, and without the error
              // handler a client that drops the socket hard (a closed tab, a
              // browser test ending) takes the whole dev server down with an
              // unhandled ECONNRESET.
              ws: true,
              // Without an agent the proxy opens a fresh connection per
              // request and asks the server to close it afterwards. Node on
              // Windows then resets the socket before the send buffer has
              // drained on larger responses, so about one image in six
              // arrived truncated and the editor waited forever for it.
              // Keep-alive connections are closed by nobody mid-response.
              agent: new Agent({ keepAlive: true }),
              configure: (proxy) => {
                proxy.on("error", (error) => {
                  console.warn(`[dev:web] proxy: ${error.message}`);
                });
              }
            }
          }
        }
      : {
          port: 1420,
          strictPort: true,
          host: host || false,
          hmr: host
            ? {
                protocol: "ws",
                host,
                port: 1421,
              }
            : undefined,
          watch: {
            // 3. tell Vite to ignore watching `src-tauri`
            ignored: ["**/src-tauri/**"],
          },
        },
  };
});
