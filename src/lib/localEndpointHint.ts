import i18n from "@/i18n";
import { platform } from "@/platform";

import { isCloudProvider, PROVIDER_DISPLAY_NAME } from "@/lib/aiClient";
import { formatAiError } from "@/lib/editor/errorMessages";
import { isLoopbackHttpUrl, isPrivateNetworkHttpUrl } from "@/lib/networkAddress";
import type { AiProvider, AiSettings } from "@/store/useAiSettingsStore";

/**
 * What the model server on the user's machine has to allow before the
 * browser may talk to it: its CORS policy has to accept this page's origin.
 * One sentence per provider, naming the switch where it is.
 */
export function localOriginInstruction(provider: AiProvider, origin: string): string {
  const host = origin.replace(/^https?:\/\//, "");

  switch (provider) {
    case "ollama":
      return i18n.t("aiClient.localOriginOllama", { origin });
    case "jan":
      return i18n.t("aiClient.localOriginJan", { host });
    case "lmstudio":
      return i18n.t("aiClient.localOriginLmStudio");
    default:
      return "";
  }
}

const NETWORK_FAILURE = /failed to fetch|networkerror|network request failed|load failed/i;

/**
 * Turns the browser's "Failed to fetch" for a local model server into a
 * sentence that says what to do. Null when this is not that case: not the
 * browser, a cloud provider, a server in the network (the proxy explains its
 * own refusals), or an error that already says something.
 */
export async function explainLocalEndpointFailure(
  provider: AiProvider,
  apiUrl: string,
  error: unknown
): Promise<string | null> {
  const localModels = platform.localModels;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";

  // A model server elsewhere in the network is reached through the ScribeDog
  // server, so probing it from the tab would diagnose the wrong path.
  if (!localModels || isCloudProvider(provider) || isPrivateNetworkHttpUrl(apiUrl) || !NETWORK_FAILURE.test(message)) {
    return null;
  }

  const server = PROVIDER_DISPLAY_NAME[provider];
  const { origin } = localModels;

  switch (await localModels.diagnose(provider, apiUrl)) {
    case "permission":
      return i18n.t("aiClient.localBrowserPermission", { url: apiUrl });
    case "cors":
      return i18n.t("aiClient.localBrowserCors", {
        server,
        url: apiUrl,
        origin,
        instruction: localOriginInstruction(provider, origin)
      });
    case "unreachable":
      return i18n.t("aiClient.localBrowserUnreachable", { server, url: apiUrl });
    default:
      // It works now (the server came up in the meantime, or the user
      // answered the permission prompt): the plain error is the honest one.
      return null;
  }
}

/**
 * formatAiError, with the local-server explanation in front of it where one
 * applies. The generic tip ("check whether Ollama is running") is wrong in
 * the browser more often than not, so the diagnosis replaces it there.
 */
export async function describeAiError(error: unknown, settings: Pick<AiSettings, "provider" | "apiUrl">): Promise<string> {
  const explanation = await explainLocalEndpointFailure(settings.provider, settings.apiUrl, error).catch(() => null);

  return explanation ?? formatAiError(error, i18n.t);
}

/**
 * The line under an API key field. A cloud provider always needs the key; a
 * local model server only when it is set up to ask for one, and where it runs
 * decides what the user should know about it: in the network it travels over
 * plain http, and in the browser a server on this device never gets a stored
 * key, because the tab only holds a placeholder for it (see web/index.ts).
 */
export function apiKeyHint(provider: AiProvider, apiUrl: string): string {
  if (isCloudProvider(provider)) {
    return i18n.t(platform.features.session ? "settingsDialog.apiKeyServerHint" : "settingsDialog.apiKeyShort");
  }

  const name = PROVIDER_DISPLAY_NAME[provider];
  const url = apiUrl.trim();

  if (platform.localModels && isLoopbackHttpUrl(url)) {
    return i18n.t("settingsDialog.apiKeyLocalBrowserHint", { provider: name });
  }

  if (isPrivateNetworkHttpUrl(url)) {
    return i18n.t("settingsDialog.apiKeyNetworkHint", { provider: name });
  }

  return i18n.t("settingsDialog.apiKeyLocalHint", { provider: name });
}
