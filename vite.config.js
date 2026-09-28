var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
// "vitest/config" re-exports vite's defineConfig and additionally accepts the
// `test` block below, so the dev/build config and the test config share one
// source of truth (notably the "@" alias).
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { Agent } from "node:http";
import { fileURLToPath, URL } from "node:url";
// @ts-expect-error process is a nodejs global
var host = process.env.TAURI_DEV_HOST;
var packageVersion = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"))
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
var BASE_PATH_PLACEHOLDER = "/__SCRIBEDOG_BASE_PATH__";
function webIndexHtml() {
    return {
        name: "scribedog-web-index-html",
        transformIndexHtml: {
            order: "pre",
            handler: function (html) {
                return html.replace("<title>", "<meta name=\"scribedog-base-path\" content=\"".concat(BASE_PATH_PLACEHOLDER, "\" />\n    <title>"));
            }
        }
    };
}
// https://vite.dev/config/
export default defineConfig(function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
    var isWeb;
    var mode = _b.mode;
    return __generator(this, function (_c) {
        isWeb = mode === "web";
        return [2 /*return*/, {
                base: isWeb ? "./" : "/",
                plugins: __spreadArray([react(), tailwindcss()], (isWeb ? [webIndexHtml()] : []), true),
                resolve: {
                    alias: {
                        "@": fileURLToPath(new URL("./src", import.meta.url)),
                        "@platform-impl": fileURLToPath(new URL(isWeb ? "./src/platform/web/index.ts" : "./src/platform/desktop/index.ts", import.meta.url))
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
                    format: "es"
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
                                configure: function (proxy) {
                                    proxy.on("error", function (error) {
                                        console.warn("[dev:web] proxy: ".concat(error.message));
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
                                host: host,
                                port: 1421,
                            }
                            : undefined,
                        watch: {
                            // 3. tell Vite to ignore watching `src-tauri`
                            ignored: ["**/src-tauri/**"],
                        },
                    },
            }];
    });
}); });
