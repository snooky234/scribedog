import i18n from "@/i18n";
import { guessImageMimeType } from "@/lib/imageMimeTypes";
import { isPrivateNetworkHttpUrl, serverAllowlistLine } from "@/lib/networkAddress";
import { SessionError } from "@/platform/errors";
import { containsSecretRef, secretRef } from "@/platform/secretRef";
import type { CredentialsStatus, Platform } from "@/platform/types";

import { browserDownloads } from "./downloads";
import { subscribeToVaultChanges, watchRoot } from "./liveUpdates";
import { getStartupVault, rememberOpenedVault } from "./lastVault";
import { browserLocalModels } from "./localModels";
import { posixPaths } from "@/platform/remote/paths";
import { REMOTE_VAULT_ROOT, remoteVaultStorage } from "./remoteStorage";
import { sharedVaultIdOf, sharedVaultScope } from "./sharedVaultRoot";
import { webSharedVaults } from "./sharedVaults";
import {
  ApiError,
  getBasePath,
  llmProxyUrl,
  LLM_TARGET_HEADER,
  onUnauthorized,
  serverApi,
  type RemoteSecretStatus
} from "./serverApi";

/**
 * Which ids hold a key, cached for the tab. The values are never part of it:
 * the server does not hand them out, and the frontend works with placeholders
 * (see @/platform/secretRef).
 */
let secretStatus: Promise<RemoteSecretStatus> | null = null;

function loadSecretStatus(): Promise<RemoteSecretStatus> {
  secretStatus ??= serverApi.secretStatus().catch((error: unknown) => {
    secretStatus = null;
    throw error;
  });

  return secretStatus;
}

async function readSecretStatus(): Promise<RemoteSecretStatus> {
  try {
    return await loadSecretStatus();
  } catch {
    return { state: "locked", ids: [], discardedAt: null };
  }
}

/**
 * A request to a cloud AI provider cannot leave the tab directly: the browser
 * would block it (CORS) and the API key would have to be in the page to send
 * it. Anything aimed at another https host therefore goes to the server's LLM
 * proxy, which fills in the key and streams the answer back.
 *
 * So does a model server on another machine in the network: a page served over
 * https may not call a plain-http address at all (mixed content), and the
 * proxy is also where the server admin decides which of those machines may be
 * reached. Same-origin requests and loopback endpoints (a model running on the
 * user's own machine) stay in the browser.
 */
function llmTarget(url: string): string | null {
  try {
    const target = new URL(url, window.location.href);
    const crossOriginHttps = target.protocol === "https:" && target.host !== window.location.host;

    return crossOriginHttps || isPrivateNetworkHttpUrl(target.toString()) ? target.toString() : null;
  } catch {
    return null;
  }
}

/**
 * A request the tab sends itself (a model server on the user's own machine)
 * cannot carry a stored key: only the server knows it, and the tab holds the
 * placeholder. Sending that would hand the model server a string that is not
 * a key, so the header is left out and the server sees an unauthenticated
 * request. The settings dialog says so where the key is entered.
 */
function withoutSecretRefs(init: RequestInit | undefined): RequestInit | undefined {
  if (!init?.headers) {
    return init;
  }

  const headers = new Headers(init.headers);
  const placeholders = [...headers].filter(([, value]) => containsSecretRef(value)).map(([name]) => name);

  for (const name of placeholders) {
    headers.delete(name);
  }

  return { ...init, headers };
}

/**
 * The proxy refuses a target the server's allowlist does not name and says
 * which entry would allow it. That reaches the user as one sentence with the
 * exact line for the server's .env, instead of a bare status code: the person
 * reading it is often the one who runs the server.
 */
async function explainRefusedTarget(response: Response, target: string): Promise<Response> {
  if (response.status !== 400) {
    return response;
  }

  const payload: unknown = await response
    .clone()
    .json()
    .catch(() => null);

  if (typeof payload !== "object" || payload === null) {
    return response;
  }

  const { error, entry } = payload as { error?: unknown; entry?: unknown };

  if (error !== "endpoint_not_allowed" || typeof entry !== "string") {
    return response;
  }

  throw new Error(
    i18n.t("aiClient.serverEndpointNotAllowed", { host: new URL(target).host, line: serverAllowlistLine(entry) })
  );
}

/**
 * The browser talking to a ScribeDog server. Everything vault-related goes
 * over the server API; everything the desktop shell provides natively is
 * either replaced by a browser equivalent (fullscreen, window.open, CSS
 * zoom) or declared unavailable so the UI hides it.
 */
export const platform: Platform = {
  kind: "web",
  features: {
    localFolders: false,
    importFiles: false,
    exportFiles: false,
    downloads: true,
    updater: false,
    voiceInput: false,
    portableMode: false,
    knowledgeIndex: false,
    spellcheckDictionary: false,
    session: true,
    browserLocalModels: true,
    remoteVaults: false,
    sharedVaults: true,
    cameraCapture: true
  },

  vaultStorage: remoteVaultStorage,
  localFs: null,
  paths: posixPaths,

  vault: {
    allowFolderAccess: async () => undefined,
    allowFileAccess: async () => undefined,
    // One change stream per tab, pointed at the vault that was just opened:
    // the instance's own, or a shared one under its id. Called once per
    // successful open, which is also when the next start's vault is noted.
    watchFolder: async (folderPath) => {
      rememberOpenedVault(folderPath);
      const sharedId = sharedVaultIdOf(folderPath);
      watchRoot(folderPath, sharedId ? sharedVaultScope(sharedId) : "");
    },
    // There are no local folders in the browser, so nothing ever goes missing.
    folderExists: async () => true,
    // The shared vault the tab was in last, while the person is still in it;
    // otherwise the instance's own vault.
    getStartupFolderPath: () => getStartupVault(() => webSharedVaults.overview(REMOTE_VAULT_ROOT)),
    onFolderFilesChanged: async (handler) => subscribeToVaultChanges(handler),
    // A shared vault's own name is added by formatFolderLabel; this is the
    // instance the browser is talking to.
    displayName: () => `${window.location.host}${getBasePath()}`
  },

  app: {
    getVersion: async () => __SCRIBEDOG_VERSION__
  },
  shell: {
    openUrl: async (url) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    openFolderInFileManager: null
  },
  http: {
    fetch: (url, init) => {
      const target = llmTarget(url);

      if (!target) {
        return window.fetch(url, withoutSecretRefs(init));
      }

      const headers = new Headers(init?.headers);
      headers.set(LLM_TARGET_HEADER, target);

      return window
        .fetch(llmProxyUrl(), { ...init, headers, credentials: "same-origin" })
        .then((response) => explainRefusedTarget(response, target));
    }
  },
  window: {
    setZoom: async (factor) => {
      // The stylesheet decides what the factor scales (responsive.css): the
      // whole page on a wide viewport, only the document text on a narrow
      // one, where a body-level zoom fights the pinch zoom and the viewport.
      document.documentElement.style.setProperty("--app-zoom", String(factor));
    },
    reveal: async () => undefined,
    // A tab has no close request to intercept; hooks that need the moment
    // before unload listen to pagehide themselves.
    onCloseRequested: async () => () => undefined,
    // The browser's own print preview; no window button waits on the page.
    setPrintPreviewOpen: async () => undefined,
    isFullscreen: async () => document.fullscreenElement !== null,
    setFullscreen: async (fullscreen) => {
      if (fullscreen) {
        await document.documentElement.requestFullscreen();
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    }
  },
  credentials: {
    storeApiKey: async (id, apiKey) => {
      await serverApi.storeSecret(id, apiKey);
      secretStatus = null;
    },
    // The key itself stays on the server; what comes back stands for it.
    getApiKey: async (id) => ((await readSecretStatus()).ids.includes(id) ? secretRef(id) : ""),
    getStatus: async (): Promise<CredentialsStatus> => {
      const status = await readSecretStatus();

      return { state: status.state, discardedAt: status.discardedAt };
    }
  },
  portable: {
    getStatus: async () => ({ mode: "off", configDir: "" })
  },
  spellcheck: {
    // The browser brings its own dictionaries; there is nothing to install.
    checkDictionary: async () => ({ available: true, installCommand: null })
  },

  dialogs: null,
  imagePicker: {
    pickImages: ({ extensions, source }) =>
      new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";

        if (source === "camera") {
          // Straight to the rear camera; the browser hands back one JPEG.
          input.accept = "image/*";
          input.capture = "environment";
        } else {
          input.multiple = true;
          // The extensions keep a desktop browser to what the editor renders;
          // "image/*" is what makes a phone offer its photo library.
          input.accept = [...extensions.map((extension) => `.${extension}`), "image/*"].join(",");
        }
        input.addEventListener("change", () => {
          resolve(
            Array.from(input.files ?? []).map((file) => ({
              fileName: file.name,
              read: async () => ({
                mimeType: file.type || guessImageMimeType(file.name),
                data: new Uint8Array(await file.arrayBuffer())
              })
            }))
          );
        });
        // Dismissing the picker: browsers have fired this since 2023; where
        // one does not, the promise simply never settles, and nothing waits
        // on it but the click handler.
        input.addEventListener("cancel", () => resolve([]));
        input.click();
      })
  },
  downloads: browserDownloads,
  voice: null,
  updater: null,
  knowledgeIndex: null,
  session: {
    getStatus: () => serverApi.session(),
    login: async (password) => {
      try {
        await serverApi.login(password);
      } catch (error) {
        if (error instanceof SessionError) {
          throw error;
        }

        throw new SessionError("error", error instanceof Error ? error.message : String(error));
      }

      // A new session brings a new key cookie, so whatever was known about
      // the stored keys was answered under the old one.
      secretStatus = null;
    },
    logout: async () => {
      await serverApi.logout();
      secretStatus = null;
    },
    changePassword: async (currentPassword, newPassword) => {
      try {
        await serverApi.changePassword(currentPassword, newPassword);
      } catch (error) {
        if (error instanceof SessionError) {
          throw error;
        }

        if (error instanceof ApiError) {
          throw new SessionError(error.code === "weak_password" ? "weak_password" : "error", error.message);
        }

        throw new SessionError("error", error instanceof Error ? error.message : String(error));
      }

      secretStatus = null;
    },
    listDevices: () => serverApi.listTokens(),
    revokeDevice: (id) => serverApi.revokeToken(id),
    onUnauthorized
  },
  localModels: browserLocalModels,
  remoteVaults: null,
  sharedVaults: webSharedVaults
};
