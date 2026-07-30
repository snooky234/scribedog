import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

import i18n, { getCurrentLanguageEnglishName } from "@/i18n";
import { type AiProvider, type AiSettings, type AiThinkingMode } from "@/store/useAiSettingsStore";

export type AiActionMode = "insert" | "rewrite" | "check";

export type AiContentRequest = {
  mode: AiActionMode;
  prompt: string;
  selectedText: string;
  selectedMarkdown: string;
  documentMarkdown: string;
  includeDocument: boolean;
  preserveFormatting: boolean;
};

export type AiCheckIssue = {
  original: string;
  suggestion: string;
  explanation: string;
};

export type AiStreamHandlers = {
  onChunk: (chunk: string) => void;
  onThinking?: (chunk: string) => void;
  onFinal?: (content: string) => void;
};

export type AiStreamChunk = {
  content: string | null;
  thinking: string | null;
};

export const PROVIDER_DISPLAY_NAME: Record<AiProvider, string> = {
  ollama: "Ollama",
  jan: "Jan.ai",
  lmstudio: "LM Studio",
  openai: "OpenAI",
  anthropic: "Anthropic",
  mistral: "Mistral"
};

export const PROVIDER_DEFAULT_API_URL: Record<AiProvider, string> = {
  ollama: "http://localhost:11434",
  jan: "http://localhost:1337",
  lmstudio: "http://localhost:1234",
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
  mistral: "https://api.mistral.ai"
};

const CLOUD_PROVIDERS = new Set<AiProvider>(["openai", "anthropic", "mistral"]);

export function isCloudProvider(provider: AiProvider): boolean {
  return CLOUD_PROVIDERS.has(provider);
}

/**
 * Providers that can turn text into vectors, for the knowledge base's meaning
 * search.
 *
 * Anthropic is missing on purpose rather than by oversight: it has no
 * embeddings API at all. Offering it and letting the request fail would send
 * the user hunting for a wrong URL or a wrong key — the settings tab says
 * plainly that this provider cannot do it (see DOCS/wissensbasis-plan.md, K).
 */
export const EMBEDDING_PROVIDERS: AiProvider[] = ["ollama", "jan", "lmstudio", "openai", "mistral"];

export function supportsEmbeddings(provider: AiProvider): boolean {
  return EMBEDDING_PROVIDERS.includes(provider);
}

export function isLocalApiUrl(apiUrl: string): boolean {
  try {
    const url = new URL(apiUrl);

    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "[::1]" ||
        url.hostname.endsWith(".localhost"))
    );
  } catch {
    return false;
  }
}

export function isHttpsUrl(apiUrl: string): boolean {
  try {
    return new URL(apiUrl).protocol === "https:";
  } catch {
    return false;
  }
}

// Cloud providers require HTTPS + an API key; local providers must stay on
// localhost/127.0.0.1 (see README privacy notice).
export function assertValidEndpoint(provider: AiProvider, apiUrl: string, apiKey: string): void {
  if (isCloudProvider(provider)) {
    if (!isHttpsUrl(apiUrl)) {
      throw new Error(i18n.t("aiClient.urlMustBeHttps"));
    }

    if (!apiKey.trim()) {
      throw new Error(i18n.t("aiClient.apiKeyRequired"));
    }

    return;
  }

  if (!isLocalApiUrl(apiUrl)) {
    throw new Error(i18n.t("aiClient.urlMustBeLocal"));
  }
}

function bearerAuthHeaders(apiKey: string): Record<string, string> {
  return apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {};
}

function anthropicAuthHeaders(apiKey: string): Record<string, string> {
  return { "x-api-key": apiKey.trim(), "anthropic-version": "2023-06-01" };
}

export function stripThinkingBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

// Common LaTeX/KaTeX symbol macros mapped to their plain Unicode character.
// Safety net for the OCR path: despite being told not to, vision models
// occasionally still emit LaTeX for arrows/operators, which would otherwise
// show up as literal "\rightarrow" text in a document with no math renderer.
const LATEX_SYMBOL_MACROS: Record<string, string> = {
  "\\rightarrow": "→",
  "\\to": "→",
  "\\Rightarrow": "⇒",
  "\\leftarrow": "←",
  "\\Leftarrow": "⇐",
  "\\leftrightarrow": "↔",
  "\\Leftrightarrow": "⇔",
  "\\uparrow": "↑",
  "\\downarrow": "↓",
  "\\leq": "≤",
  "\\geq": "≥",
  "\\neq": "≠",
  "\\approx": "≈",
  "\\times": "×",
  "\\div": "÷",
  "\\pm": "±",
  "\\infty": "∞",
  "\\checkmark": "✓",
  "\\cdot": "·"
};

const LATEX_MACRO_PATTERN = new RegExp(
  Object.keys(LATEX_SYMBOL_MACROS)
    .map((macro) => macro.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&"))
    .join("|"),
  "g"
);

// Unwraps "$...$"/"$$...$$" math delimiters around a single known macro and
// replaces the macro itself, e.g. "$\rightarrow$" -> "→". Leaves untouched
// any math the model wrote for an actual formula this map doesn't cover.
export function replaceLatexSymbolMacros(text: string): string {
  const withoutDelimiters = text.replace(
    /\$\$?\s*(\\[a-zA-Z]+)\s*\$\$?/g,
    (match, macro: string) => LATEX_SYMBOL_MACROS[macro] ?? match
  );

  return withoutDelimiters.replace(LATEX_MACRO_PATTERN, (macro) => LATEX_SYMBOL_MACROS[macro] ?? macro);
}

// Splits the raw text streamed so far into answer and thinking parts. Always
// re-parses the full accumulated text (instead of per chunk) so a <think> tag
// split across a chunk boundary is still handled correctly; a truncated tag
// start (e.g. "<thi") is held back until the next chunk completes it.
export function splitThinkingTags(text: string): { answer: string; thinking: string } {
  let answer = "";
  let thinking = "";
  let rest = text;

  while (rest) {
    const openIndex = rest.toLowerCase().indexOf("<think>");

    if (openIndex === -1) {
      answer += rest;
      break;
    }

    answer += rest.slice(0, openIndex);
    rest = rest.slice(openIndex + "<think>".length);

    const closeIndex = rest.toLowerCase().indexOf("</think>");

    if (closeIndex === -1) {
      thinking += rest;
      return { answer, thinking };
    }

    thinking += rest.slice(0, closeIndex);
    rest = rest.slice(closeIndex + "</think>".length);
  }

  const partialTag = answer.match(/<\/?[a-z]{0,6}$/i)?.[0];

  if (
    partialTag &&
    ("<think>".startsWith(partialTag.toLowerCase()) || "</think>".startsWith(partialTag.toLowerCase()))
  ) {
    answer = answer.slice(0, -partialTag.length);
  }

  return { answer, thinking };
}

// Built-in system prompt core of the "Rewrite with AI" feature (rewrite/insert).
// This is internal and fixed — it is no longer tied to the user-selected
// assistant. Mode/formatting/thinking/language rules are appended dynamically
// in buildSystemPrompt.
export const DEFAULT_REWRITE_INSTRUCTION =
  "You are a local text tool. Respond only with plain Markdown text. " +
  "Execute the user's instructions directly without adding your own explanations or comments.";

// Default system prompt core of a chat assistant (the right-hand chat panel).
// The "Default" assistant is seeded from this string, and "Reset to default"
// restores it. Custom assistants replace it. The Markdown output rule is
// appended in buildChatSystemPrompt so users need not repeat it.
export const DEFAULT_CHAT_ASSISTANT_INSTRUCTION =
  "You are ScribeDog, the user's loyal writing companion — under the hood, a virtual dog. " +
  "Keep that identity in the background: only mention it if the user directly asks who or what you are, " +
  "and don't turn it into a running bit. You help the user revise and improve their text, " +
  "discuss specific passages with them, answer their questions, and give concrete, actionable tips. " +
  "Be concise and conversational. When the user shares a document or a passage, refer to it directly. " +
  "Respond in the same language the user writes in.";

// Markdown output rules. Always appended in buildSystemPrompt, for the default
// assistant as well as for custom assistants — the editor can only render
// Markdown, so users must not have to repeat these rules in their own prompts.
const MARKDOWN_OUTPUT_INSTRUCTION =
  "Do not wrap the entire response in a code block. " +
  "Use only Markdown syntax (e.g. blank lines for paragraphs, **bold**, _italic_, # headings, - for lists). " +
  "Never use HTML tags like <p>, <br>, <div>, or <span>.";

// The explanation is UI feedback, not content, so it follows the app's UI
// language rather than the language of the checked text — passed in as an
// English language name (e.g. "German") since that is what models honor most
// reliably. "original"/"suggestion" stay in the text's own language.
function buildCheckModeSystemPrompt(explanationLanguage: string): string {
  return (
    "You are a spelling and grammar checker. Analyze the given text and identify spelling and grammar mistakes only — do not suggest stylistic rewrites or wording changes beyond fixing actual errors. Respond ONLY with a single JSON array (no markdown code fences, no explanation text outside the JSON) of issue objects, each with exactly these fields: \"original\" (the exact original passage as it appears in the text, copied verbatim), \"suggestion\" (the corrected replacement text), and \"explanation\" (a short explanation of the issue). " +
    `Always write the \"explanation\" field in ${explanationLanguage}, regardless of the language of the checked text. ` +
    "List issues in the order they appear in the text. If there are no issues, respond with an empty JSON array: []."
  );
}

function buildSystemPrompt(request: AiContentRequest, thinkingMode: AiThinkingMode): string {
  if (request.mode === "check") {
    const thinkingInstruction =
      thinkingMode === "off" ? " Do not output any reasoning, notes, or intermediate steps." : "";

    return buildCheckModeSystemPrompt(getCurrentLanguageEnglishName()) + thinkingInstruction;
  }

  // Rewrite/insert always uses the fixed internal instruction; the
  // mode/formatting/thinking/language rules below stay appended so the
  // plumbing (stop sequences, output shape) can't break.
  const baseInstruction = DEFAULT_REWRITE_INSTRUCTION;

  const modeInstruction =
    request.mode === "insert"
      ? "Generate new content that fits at the cursor position."
      : "Rewrite the given text passage, replacing it with content that fits.";

  const formattingInstruction =
    request.mode === "rewrite"
      ? request.preserveFormatting
        ? "Preserve the original Markdown formatting of the marked text (e.g. headings, bold/italic, lists, structure) as closely as possible."
        : "Formatting may be adjusted if it makes sense for the content."
      : "";

  const thinkingInstruction =
    thinkingMode === "off" ? "Do not output any reasoning, notes, or intermediate steps." : "";

  // Output language rule: rewrite always mirrors the marked text; insert
  // mirrors the document when it's given as context, otherwise the user's
  // own instruction. An explicit language request in the user's prompt
  // always wins over this default.
  const languageInstruction =
    request.mode === "rewrite"
      ? "Write your response in the same language as the marked text shown below."
      : request.includeDocument
        ? "Write your response in the same language as the document shown below."
        : "Write your response in the same language as the user's instruction shown below.";

  // Narrow override: only an explicitly named target language counts. Models
  // otherwise treat the language the instruction happens to be written in as
  // an implicit request and translate the passage (e.g. a German "Kürzen
  // bitte" on an English passage returning German).
  const languageOverride =
    "If the user's instruction explicitly names a target language for the output " +
    "(e.g. \"translate to French\", \"answer in English\"), follow that instead — it overrides the language rule above. " +
    "The language the user's instruction happens to be written in is NOT such a request: " +
    "an instruction written in German about an English passage still produces English output.";

  return [
    baseInstruction,
    MARKDOWN_OUTPUT_INSTRUCTION,
    modeInstruction,
    formattingInstruction,
    thinkingInstruction,
    languageInstruction,
    languageOverride
  ]
    .filter(Boolean)
    .join(" ");
}

// Stop sequences matching our own prompt section markers (see buildUserPrompt).
// Weak/small local models with a generous max_tokens budget tend to keep going
// past the actual answer and echo the prompt pattern ("Aufgabe:\n…") instead of
// stopping; these sequences cut the output off when that happens.
const PROMPT_STOP_SEQUENCES = [
  "\nMarked text (Markdown):",
  "\nDocument:",
  "\nTask:",
  "\nImportant:"
];

// max_tokens/num_predict must not equal the full context length, or a large
// context (e.g. 32000) gives the model near-unlimited room to keep
// hallucinating past the actual answer.
export function resolveMaxOutputTokens(contextLength: number): number {
  return Math.max(256, Math.min(contextLength, 4096));
}

function buildUserPrompt(request: AiContentRequest): string {
  if (request.mode === "check") {
    return request.selectedText;
  }

  const contextSections: string[] = [];

  if (request.includeDocument) {
    contextSections.push(`Document:\n${request.documentMarkdown}`);
  }

  if (request.mode === "rewrite") {
    contextSections.push(`Marked text (Markdown):\n${request.selectedMarkdown || request.selectedText}`);
  }

  contextSections.push(`Task:\n${request.prompt}`);

  // The task is the last thing the model reads before generating, so a task
  // written in another language than the marked text pulls the output into
  // the task's language. Restating the language rule here — after the task,
  // not just in the system prompt — is what actually holds.
  if (request.mode === "insert") {
    contextSections.push("Important: Return only the content to be inserted.");
  } else {
    contextSections.push(
      "Important: Return only the revised version of the marked text, " +
        "written in the same language as the marked text above. " +
        "The task above may be written in a different language — that does not change the output language."
    );
  }

  return contextSections.join("\n\n");
}

export function extractResponseContent(payload: unknown, isOllamaShape: boolean): string {
  if (typeof payload !== "object" || payload === null) {
    throw new Error(i18n.t("aiClient.invalidResponse"));
  }

  if (isOllamaShape) {
    const typedPayload = payload as {
      message?: { content?: string };
      response?: string;
      done?: boolean;
    };

    return typedPayload.message?.content ?? typedPayload.response ?? "";
  }

  const typedPayload = payload as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return typedPayload.choices?.[0]?.message?.content ?? "";
}

export function extractAnthropicContent(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    throw new Error(i18n.t("aiClient.invalidResponse"));
  }

  const typedPayload = payload as { content?: Array<{ type?: string; text?: string }> };

  return (typedPayload.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
}

// A non-2xx response usually carries the actual reason in its JSON body (e.g.
// Ollama rejects `tools` on a model whose template doesn't support them with
// {"error": "<model> does not support tools"}; OpenAI-shaped APIs nest it as
// {"error": {"message": "..."}}). Falling back to the bare status code loses
// exactly the detail a user needs to understand *why* a request failed.
async function extractResponseErrorMessage(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();

    if (typeof payload === "object" && payload !== null) {
      const errorField = (payload as { error?: unknown }).error;

      if (typeof errorField === "string" && errorField.trim()) {
        return errorField.trim();
      }

      if (typeof errorField === "object" && errorField !== null) {
        const message = (errorField as { message?: unknown }).message;

        if (typeof message === "string" && message.trim()) {
          return message.trim();
        }
      }

      const message = (payload as { message?: unknown }).message;

      if (typeof message === "string" && message.trim()) {
        return message.trim();
      }
    }
  } catch {
    // Body wasn't JSON (or was empty) — fall through to the status message.
  }

  return i18n.t("aiClient.endpointStatus", { status: response.status });
}

// A request that never answers must not leave the chat spinning forever. The
// agent loop awaits postJson with no deadline of its own, so a stalled request
// — a multi-megabyte image body against a cloud endpoint is the case seen in
// practice — shows up as an endless typing indicator with nothing to report.
// Generous enough that a slow local model on CPU still finishes a full step.
const REQUEST_TIMEOUT_MS = 180_000;

// tauri-plugin-http stamps the calling webview's own origin onto every request,
// and on Windows a packaged build's webview lives at http://tauri.localhost — an
// origin Ollama does not have in its allowlist, so it answers 403 while
// `tauri dev` (http://localhost:1420) sails through. Local endpoints therefore
// get an explicit localhost origin; being allowed to override that header at all
// is what the plugin's `unsafe-headers` feature is turned on for in Cargo.toml.
//
// Only local endpoints: assertValidEndpoint has already pinned those to
// localhost/127.0.0.1, so the claim is true rather than forged. Cloud endpoints
// keep the webview origin — none of them inspect it.
const LOCAL_ENDPOINT_ORIGIN = "http://localhost";

type HttpFetchInit = Omit<RequestInit, "headers"> & { headers?: Record<string, string> };

async function httpFetch(url: string, init: HttpFetchInit): Promise<Response> {
  if (!isLocalApiUrl(url)) {
    return tauriFetch(url, init);
  }

  return tauriFetch(url, {
    ...init,
    headers: { ...init.headers, Origin: LOCAL_ENDPOINT_ORIGIN }
  });
}

async function postJson(url: string, body: unknown, extraHeaders?: Record<string, string>, signal?: AbortSignal) {
  // Own controller so the deadline and the user's cancel button can both stop
  // the request while staying distinguishable: only the timeout gets rewritten
  // into a message, a cancel stays an AbortError the caller swallows.
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  signal?.addEventListener("abort", forwardAbort);

  try {
    const response = await httpFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...extraHeaders
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(await extractResponseErrorMessage(response));
    }

    return await response.json();
  } catch (error) {
    if (timedOut) {
      throw new Error(i18n.t("aiClient.requestTimeout", { seconds: Math.round(REQUEST_TIMEOUT_MS / 1000) }));
    }

    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }
}

async function getJson(url: string, signal?: AbortSignal, extraHeaders?: Record<string, string>) {
  const response = await httpFetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders
    },
    signal
  });

  if (!response.ok) {
    throw new Error(await extractResponseErrorMessage(response));
  }

  return response.json();
}

async function fetchAvailableModelsInternal(
  provider: AiProvider,
  apiUrl: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<string[]> {
  assertValidEndpoint(provider, apiUrl, apiKey);

  if (provider === "ollama") {
    const payload = (await getJson(new URL("/api/tags", apiUrl).toString(), signal)) as {
      models?: Array<{ name?: string; model?: string }>;
    };

    return (payload.models ?? [])
      .map((entry) => entry.name ?? entry.model ?? "")
      .filter((name): name is string => Boolean(name));
  }

  if (provider === "anthropic") {
    const payload = (await getJson(
      new URL("/v1/models", apiUrl).toString(),
      signal,
      anthropicAuthHeaders(apiKey)
    )) as { data?: Array<{ id?: string }> };

    return (payload.data ?? []).map((entry) => entry.id ?? "").filter((id): id is string => Boolean(id));
  }

  const payload = (await getJson(
    new URL("/v1/models", apiUrl).toString(),
    signal,
    // Local providers (jan/lmstudio) deliberately never get an auth header: a
    // leftover cloud API key from a previously selected provider must not be
    // forwarded to the local server.
    isCloudProvider(provider) ? bearerAuthHeaders(apiKey) : {}
  )) as { data?: Array<{ id?: string }> };

  return (payload.data ?? []).map((entry) => entry.id ?? "").filter((id): id is string => Boolean(id));
}

export async function fetchAvailableModels(
  provider: AiProvider,
  apiUrl: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<string[]> {
  const models = await fetchAvailableModelsInternal(provider, apiUrl, apiKey, signal);

  // Some APIs (e.g. Mistral) list the same model multiple times (aliases as
  // separate entries). Duplicates must be removed because model names are
  // used as React keys — duplicate keys make <option> list reconciliation
  // undefined, which could leave stale entries from the previous provider in
  // the DOM after a provider switch.
  return Array.from(new Set(models));
}

/**
 * Feeds a response body to `onLine`, one text line at a time.
 *
 * Both wire formats this module reads are line-based — OpenAI-compatible SSE
 * ("data: {...}") and Ollama's newline-delimited JSON — and both need the same
 * carry-over buffer, because a chunk boundary lands mid-line often enough that
 * parsing chunks directly drops tokens. Kept in one place so the streaming
 * paths cannot drift apart in how they cut the stream up.
 */
async function forEachStreamLine(response: Response, onLine: (line: string) => void): Promise<void> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        onLine(line);
      }
    }

    // A stream that ends without a trailing newline leaves its last line in the
    // buffer — for Ollama that is the payload carrying done:true.
    if (buffer.trim()) {
      onLine(buffer);
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Splits a token stream into answer text and reasoning text as it arrives.
 *
 * Both deltas are derived from the full accumulated text each time instead of
 * being stripped per chunk: a `<think>` tag routinely straddles a chunk
 * boundary, and a per-chunk strip would let the two halves through as answer
 * text. Providers that report reasoning in a field of their own bypass this and
 * go straight to onThinking.
 */
function createThinkingSplitter(handlers: {
  onChunk: (chunk: string) => void;
  onThinking?: (chunk: string) => void;
}) {
  let fullContent = "";
  let emittedAnswer = "";
  let emittedThinking = "";

  return {
    push(content: string) {
      fullContent += content;

      const split = splitThinkingTags(fullContent);

      if (split.thinking.length > emittedThinking.length) {
        handlers.onThinking?.(split.thinking.slice(emittedThinking.length));
        emittedThinking = split.thinking;
      }

      // Only trim if a thinking block was actually removed — otherwise
      // legitimate leading spaces between word chunks would be lost.
      const answer = split.thinking ? split.answer.trimStart() : split.answer;

      if (answer.length > emittedAnswer.length) {
        handlers.onChunk(answer.slice(emittedAnswer.length));
        emittedAnswer = answer;
      }
    },
    raw(): string {
      return fullContent;
    },
    answer(): string {
      return stripThinkingBlocks(fullContent);
    }
  };
}

// The JSON payload of one stream line, or null for the lines that carry none
// (SSE event names, keep-alives, the "[DONE]" sentinel, a truncated tail).
function parseStreamLinePayload(line: string): Record<string, unknown> | null {
  const trimmedLine = line.trim();

  if (!trimmedLine) {
    return null;
  }

  const raw = trimmedLine.startsWith("data: ")
    ? trimmedLine.slice("data: ".length).trim()
    : trimmedLine.startsWith("{")
      ? trimmedLine
      : "";

  if (!raw || raw === "[DONE]") {
    return null;
  }

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function streamJsonLines(
  url: string,
  body: Record<string, unknown>,
  handlers: AiStreamHandlers,
  extractChunk: (payload: Record<string, unknown>) => AiStreamChunk,
  extractDoneContent: (payload: Record<string, unknown>) => string | null,
  signal?: AbortSignal,
  extraHeaders?: Record<string, string>
) {
  const response = await httpFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders
    },
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok || !response.body) {
    throw new Error(i18n.t("aiClient.endpointStatus", { status: response.status }));
  }

  const splitter = createThinkingSplitter(handlers);

  await forEachStreamLine(response, (line) => {
    const parsed = parseStreamLinePayload(line);

    if (!parsed) {
      return;
    }

    const { content, thinking } = extractChunk(parsed);

    if (thinking) {
      handlers.onThinking?.(thinking);
    }

    if (content) {
      splitter.push(content);
    }

    if (parsed.done === true) {
      const finalContent = extractDoneContent(parsed) ?? splitter.raw();
      handlers.onFinal?.(stripThinkingBlocks(finalContent));
    }
  });

  return splitter.answer();
}

async function requestOllama(
  settings: AiSettings,
  request: AiContentRequest,
  signal?: AbortSignal
): Promise<string> {
  const body: Record<string, unknown> = {
    model: settings.model,
    stream: false,
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(request, settings.thinkingMode)
      },
      {
        role: "user",
        content: buildUserPrompt(request)
      }
    ],
    options: {
      num_ctx: settings.contextLength,
      num_predict: resolveMaxOutputTokens(settings.contextLength),
      stop: PROMPT_STOP_SEQUENCES
    }
  };

  if (settings.thinkingMode === "off") {
    body.think = false;
  }

  const payload = await postJson(new URL("/api/chat", settings.apiUrl).toString(), body, undefined, signal);

  return extractResponseContent(payload, true);
}

export async function streamOllamaMarkdown(
  settings: AiSettings,
  request: AiContentRequest,
  handlers: AiStreamHandlers,
  signal?: AbortSignal
): Promise<string> {
  const body: Record<string, unknown> = {
    model: settings.model,
    stream: true,
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(request, settings.thinkingMode)
      },
      {
        role: "user",
        content: buildUserPrompt(request)
      }
    ],
    options: {
      num_ctx: settings.contextLength,
      num_predict: resolveMaxOutputTokens(settings.contextLength),
      stop: PROMPT_STOP_SEQUENCES
    }
  };

  if (settings.thinkingMode === "off") {
    body.think = false;
  }

  return streamJsonLines(
    new URL("/api/chat", settings.apiUrl).toString(),
    body,
    handlers,
    (payload) => {
      // Ollama returns the reasoning trace of thinking models in a separate
      // "thinking" field alongside "content".
      const message = payload.message as { content?: string; thinking?: string } | undefined;
      return {
        content: message?.content ?? null,
        thinking: message?.thinking ?? null
      };
    },
    (payload) => {
      const message = payload.message as { content?: string } | undefined;
      return message?.content ?? null;
    },
    signal
  );
}

// Covers Jan.ai, LM Studio, OpenAI, and Mistral — they all speak the same
// OpenAI-compatible /v1/chat/completions interface. The only differences are
// the base URL, the auth header, and the llama.cpp-specific "enable_thinking"
// extension, which only local backends (Jan/LM Studio) understand — cloud
// providers might reject an unknown field.
function buildOpenAiCompatibleAuthHeaders(settings: AiSettings): Record<string, string> {
  // See fetchAvailableModelsInternal: a cloud key must never be sent to a
  // local provider, even if left over in dialog state from a previously
  // selected cloud provider.
  return isCloudProvider(settings.provider) ? bearerAuthHeaders(settings.apiKey) : {};
}

function supportsThinkingExtension(provider: AiProvider): boolean {
  return provider === "jan" || provider === "lmstudio";
}

// OpenAI moved its newer model families off the legacy chat-completions
// parameters: `max_tokens` was replaced by `max_completion_tokens` and is
// rejected outright by gpt-5/o-series ("Unsupported parameter: 'max_tokens'"),
// while the reasoning models additionally accept only their default
// temperature and reject `stop` altogether. Every other OpenAI-compatible
// backend (Mistral, Jan, LM Studio) still expects the old shape, so the
// rewrite stays scoped to the openai provider.
function isOpenAiReasoningModel(model: string): boolean {
  return /^(o\d|gpt-5)/i.test(model.trim());
}

function withOpenAiParamCompat(settings: AiSettings, body: Record<string, unknown>): Record<string, unknown> {
  if (settings.provider !== "openai") {
    return body;
  }

  const { max_tokens: maxTokens, temperature, stop, ...rest } = body;
  const compatBody: Record<string, unknown> = { ...rest };

  if (maxTokens !== undefined) {
    compatBody.max_completion_tokens = maxTokens;
  }

  // The prompt stop sequences exist to rein in weak local models (see
  // PROMPT_STOP_SEQUENCES); dropping them for a reasoning model costs nothing.
  if (!isOpenAiReasoningModel(settings.model)) {
    if (temperature !== undefined) {
      compatBody.temperature = temperature;
    }

    if (stop !== undefined) {
      compatBody.stop = stop;
    }
  }

  return compatBody;
}

async function requestOpenAiCompatible(
  settings: AiSettings,
  request: AiContentRequest,
  signal?: AbortSignal
): Promise<string> {
  const requestBody: Record<string, unknown> = {
    model: settings.model,
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(request, settings.thinkingMode)
      },
      {
        role: "user",
        content: buildUserPrompt(request)
      }
    ],
    temperature: 0.2,
    max_tokens: resolveMaxOutputTokens(settings.contextLength),
    stop: PROMPT_STOP_SEQUENCES,
    stream: false
  };

  if (supportsThinkingExtension(settings.provider) && settings.thinkingMode === "off") {
    requestBody.chat_template_kwargs = {
      enable_thinking: false
    };
  }

  const payload = await postJson(
    new URL("/v1/chat/completions", settings.apiUrl).toString(),
    withOpenAiParamCompat(settings, requestBody),
    buildOpenAiCompatibleAuthHeaders(settings),
    signal
  );

  return extractResponseContent(payload, false);
}

export async function streamOpenAiCompatibleMarkdown(
  settings: AiSettings,
  request: AiContentRequest,
  handlers: AiStreamHandlers,
  signal?: AbortSignal
): Promise<string> {
  const requestBody: Record<string, unknown> = {
    model: settings.model,
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(request, settings.thinkingMode)
      },
      {
        role: "user",
        content: buildUserPrompt(request)
      }
    ],
    temperature: 0.2,
    max_tokens: resolveMaxOutputTokens(settings.contextLength),
    stop: PROMPT_STOP_SEQUENCES,
    stream: true
  };

  if (supportsThinkingExtension(settings.provider) && settings.thinkingMode === "off") {
    requestBody.chat_template_kwargs = {
      enable_thinking: false
    };
  }

  return streamJsonLines(
    new URL("/v1/chat/completions", settings.apiUrl).toString(),
    withOpenAiParamCompat(settings, requestBody),
    handlers,
    (payload) => {
      // OpenAI-compatible endpoints (Jan, llama.cpp, …) return the reasoning
      // trace as either "reasoning_content" or "reasoning", depending on backend.
      const choices = payload.choices as Array<{
        delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null };
        message?: { content?: string | null };
      }> | undefined;
      const choice = choices?.[0];
      return {
        content: choice?.delta?.content ?? choice?.message?.content ?? null,
        thinking: choice?.delta?.reasoning_content ?? choice?.delta?.reasoning ?? null
      };
    },
    (payload) => {
      const choices = payload.choices as Array<{
        message?: { content?: string | null };
      }> | undefined;
      return choices?.[0]?.message?.content ?? null;
    },
    signal,
    buildOpenAiCompatibleAuthHeaders(settings)
  );
}

async function requestAnthropic(
  settings: AiSettings,
  request: AiContentRequest,
  signal?: AbortSignal
): Promise<string> {
  const body = {
    model: settings.model,
    system: buildSystemPrompt(request, settings.thinkingMode),
    max_tokens: resolveMaxOutputTokens(settings.contextLength),
    stop_sequences: PROMPT_STOP_SEQUENCES,
    messages: [{ role: "user", content: buildUserPrompt(request) }]
  };

  const payload = await postJson(
    new URL("/v1/messages", settings.apiUrl).toString(),
    body,
    anthropicAuthHeaders(settings.apiKey),
    signal
  );

  return extractAnthropicContent(payload);
}

// Anthropic's Messages API streams named SSE events (content_block_delta,
// message_stop, …) instead of the plain "data: {...}" lines used by
// OpenAI-compatible endpoints, so it needs its own leaner parser instead of
// the shared streamJsonLines(). Shared by the rewrite (markdown) and chat
// paths — only the request body differs between them.
async function consumeAnthropicStream(
  url: string,
  body: Record<string, unknown>,
  apiKey: string,
  handlers: AiStreamHandlers,
  signal?: AbortSignal
): Promise<string> {
  const response = await httpFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...anthropicAuthHeaders(apiKey)
    },
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok || !response.body) {
    throw new Error(i18n.t("aiClient.endpointStatus", { status: response.status }));
  }

  let fullContent = "";
  let currentEventType = "";

  await forEachStreamLine(response, (line) => {
    if (line.startsWith("event: ")) {
      currentEventType = line.slice("event: ".length).trim();
      return;
    }

    if (!line.startsWith("data: ")) {
      return;
    }

    let parsed: Record<string, unknown>;

    try {
      parsed = JSON.parse(line.slice("data: ".length)) as Record<string, unknown>;
    } catch {
      return;
    }

    if (currentEventType === "error") {
      const errorPayload = parsed.error as { message?: string } | undefined;
      throw new Error(errorPayload?.message ?? i18n.t("aiClient.invalidResponse"));
    }

    if (currentEventType !== "content_block_delta") {
      return;
    }

    const delta = parsed.delta as { type?: string; text?: string; thinking?: string } | undefined;

    if (delta?.type === "text_delta" && delta.text) {
      fullContent += delta.text;
      handlers.onChunk(delta.text);
    } else if (delta?.type === "thinking_delta" && delta.thinking) {
      handlers.onThinking?.(delta.thinking);
    }
  });

  return stripThinkingBlocks(fullContent);
}

async function streamAnthropicMarkdown(
  settings: AiSettings,
  request: AiContentRequest,
  handlers: AiStreamHandlers,
  signal?: AbortSignal
): Promise<string> {
  const body = {
    model: settings.model,
    system: buildSystemPrompt(request, settings.thinkingMode),
    max_tokens: resolveMaxOutputTokens(settings.contextLength),
    stop_sequences: PROMPT_STOP_SEQUENCES,
    stream: true,
    messages: [{ role: "user", content: buildUserPrompt(request) }]
  };

  return consumeAnthropicStream(
    new URL("/v1/messages", settings.apiUrl).toString(),
    body,
    settings.apiKey,
    handlers,
    signal
  );
}

export async function streamAiMarkdown(
  settings: AiSettings,
  request: AiContentRequest,
  handlers: AiStreamHandlers,
  signal?: AbortSignal
): Promise<string> {
  assertValidEndpoint(settings.provider, settings.apiUrl, settings.apiKey);

  if (!settings.model.trim()) {
    throw new Error(i18n.t("aiClient.modelRequired"));
  }

  if (settings.provider === "ollama") {
    return streamOllamaMarkdown(settings, request, handlers, signal);
  }

  if (settings.provider === "anthropic") {
    return streamAnthropicMarkdown(settings, request, handlers, signal);
  }

  return streamOpenAiCompatibleMarkdown(settings, request, handlers, signal);
}

export async function generateAiMarkdown(
  settings: AiSettings,
  request: AiContentRequest,
  signal?: AbortSignal
): Promise<string> {
  assertValidEndpoint(settings.provider, settings.apiUrl, settings.apiKey);

  if (!settings.model.trim()) {
    throw new Error(i18n.t("aiClient.modelRequired"));
  }

  const rawResponse =
    settings.provider === "ollama"
      ? await requestOllama(settings, request, signal)
      : settings.provider === "anthropic"
        ? await requestAnthropic(settings, request, signal)
        : await requestOpenAiCompatible(settings, request, signal);

  const cleanedResponse = stripThinkingBlocks(rawResponse);

  if (!cleanedResponse) {
    throw new Error(i18n.t("aiClient.noUsableText"));
  }

  return cleanedResponse;
}

// --- Chat (right-hand assistant panel) -------------------------------------
//
// A conversational, multi-turn counterpart to the single-shot rewrite/insert
// path above. It reuses the same provider transports (streamJsonLines, the
// Anthropic SSE reader), security guards (assertValidEndpoint) and
// <think>-stripping, but sends a full user/assistant message history instead
// of one built-up user prompt, and is driven by the user-selected assistant's
// instruction rather than the fixed rewrite instruction.

export type AiChatRole = "user" | "assistant" | "tool";

export type ToolCall = { id: string; name: string; arguments: Record<string, unknown> };

// One image handed to a vision model, already downscaled and base64-encoded.
// Resolved from imagePaths per request and never persisted — see
// src/lib/chat/imageAttachments.ts for why the split exists.
export type AiChatImage = { path: string; base64: string; mimeType: string };

// Marks a user turn a chat action button generated instead of the user typing
// it. The wire payload is unaffected — the flag only tells the transcript to
// show what was clicked rather than the generated instruction, which quotes a
// whole assistant answer back at the model.
export type ChatUserAction = "applyToDocument";

// A tagged union rather than a flat {role, content} shape: the agent loop
// needs to carry tool_calls on assistant turns and tool_call_id/toolName on
// tool-result turns, which have no meaning on a plain user/assistant message.
export type AiChatMessage =
  | {
      role: "user";
      content: string;
      // Set when a button, not the user, wrote this turn's content (persisted).
      action?: ChatUserAction;
      // The passage the user had selected in the editor when they sent this
      // turn (persisted). Kept beside the content rather than inside it: the
      // transcript shows it as a quote, and it is folded into the content of
      // the newest such turn only per request — see
      // src/lib/chat/selectionContext.ts.
      selection?: string;
      // Document-relative paths of images attached to this turn (persisted).
      imagePaths?: string[];
      // Names of the files the user had attached to the chat when this turn was
      // sent (persisted). Only the names: the content lives in the chat store
      // while the file stays attached and is folded into the request from there
      // — see src/lib/chat/attachedFiles.ts.
      attachedFileNames?: string[];
      // The same images with their payload, filled in per request by
      // attachImageData. Absent in the stored history.
      images?: AiChatImage[];
    }
  | {
      role: "assistant";
      content: string;
      toolCalls?: ToolCall[];
      // The model flagged this reply as offering a change it has not proposed in
      // the editor, so the transcript shows the "apply to document" button on it
      // (persisted). Set from the model's own flag_pending_suggestion call —
      // either inside the turn or from the follow-up question the store asks
      // when a turn ends without one. See FLAG_SUGGESTION_TOOL_NAME.
      suggestsEdit?: boolean;
      // This reply's text was text the user had asked to have written, and the
      // model left it in the chat — so the store put it into the document as a
      // proposal after the fact (persisted). The transcript shows a status line
      // saying so instead of an "apply" button; see resolveUnflaggedReply.
      proposedEdit?: boolean;
      // Notes from the vault this answer drew on, collected from the knowledge
      // base tool calls of the same turn (persisted). The transcript lists them
      // as clickable sources under the reply — an answer assembled from files
      // the user did not open is only trustworthy if they can see which ones.
      sources?: VaultSourceRef[];
    }
  | {
      role: "tool";
      toolCallId: string;
      toolName: string;
      content: string;
      // This failure is one the model corrects on its own next attempt, not a
      // dead end (persisted). Set from ToolResult.retryable in
      // src/lib/chat/agentTools.ts; only the transcript reads it — the wire
      // payload carries the content and nothing else.
      retryable?: boolean;
    };

/** One note an answer was based on; see the assistant turn's `sources`. */
export type VaultSourceRef = { path: string; headingPath: string };

export type AiChatRequest = {
  // Conversation history already trimmed to the context budget by the caller
  // (see selectMessagesForModel). Ends with the latest user turn.
  messages: AiChatMessage[];
  // System prompt core from the selected assistant. Falls back to the built-in
  // chat default when empty.
  assistantInstruction: string;
  // Optional current document/selection markdown, injected into the system
  // prompt so the assistant can talk about "this passage". Not used in the
  // agent (tool-calling) path — the agent reads the document via its tools.
  documentContext?: string;
  // Replaces the whole system prompt (assistant persona + agent rules) instead
  // of being composed with it. For the one-question follow-up steps that are not
  // part of the conversation — see detectPendingSuggestion.
  systemOverride?: string;
  // Restricts which agent tools this request offers. Undefined means all of
  // them; a follow-up step that must not be able to touch the document narrows
  // it to the one tool it asks about.
  toolNames?: readonly string[];
  // Offers the knowledge base tools on top of the standard ones. Off unless the
  // user switched the feature on for the open vault — these tools read notes
  // the user never opened, so their availability is a consent decision, not a
  // capability one (see src/store/useRagSettingsStore.ts).
  vaultSearchEnabled?: boolean;
};

// Name of the tool the model calls to flag that its own reply text (not an
// editing-tool call) already contains a concrete rewrite the user could apply
// — see its spec below and the "In Text einarbeiten" button in ChatPanel,
// which only appears on a message whose toolCalls include this name.
export const FLAG_SUGGESTION_TOOL_NAME = "flag_pending_suggestion";

// The tool that puts new text into the document. Named because the recovery
// step in src/lib/chat/pendingSuggestion.ts offers exactly this one to get text
// the model wrote into the chat into the document after all.
export const INSERT_TOOL_NAME = "insert_at_cursor";

// The tools that open a red/green proposal in the editor. A turn that called one
// of these has already given the user something to accept, which is what makes
// the flag above redundant for it.
export const EDITING_TOOL_NAMES: readonly string[] = [
  "replace_selection",
  INSERT_TOOL_NAME,
  "replace_passage"
];

// One spec per agent tool, translated below into each provider family's wire
// format (OpenAI-compatible "function" tools vs. Anthropic's input_schema).
const AGENT_TOOL_SPECS = [
  {
    name: "get_document",
    description: "Read the full current document as Markdown. Call this before editing so you know the exact wording.",
    parameters: { type: "object", properties: {}, required: [] }
  },
  {
    name: "get_selection",
    description: "Return the text the user currently has selected, or an empty result if nothing is selected.",
    parameters: { type: "object", properties: {}, required: [] }
  },
  {
    name: "get_image",
    description:
      "Look at an image that is embedded in the document. You cannot see images from get_document alone — it only gives you the markdown, where an image appears as ![alt](path). Call this with that path to actually see the picture; it is then attached to the conversation as an image you can describe. Use it whenever the user asks what an image shows.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "The image path exactly as it appears in the document's markdown, e.g. images/photo.png."
        }
      },
      required: ["path"]
    }
  },
  {
    name: "set_image_width",
    description:
      "Change the display size of an image embedded in the document. This is the ONLY way to resize an image: an image is not text, so replace_passage can never find its ![alt](path) markdown. Pass width for an absolute size in pixels, or scale for a relative change (1.25 = 25 percent larger, 0.5 = half). width: 0 restores the image's original size. Unlike the editing tools this applies immediately — do not tell the user to accept anything.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The image path exactly as it appears in the document's markdown, e.g. images/photo.png."
        },
        width: { type: "integer", description: "New display width in pixels, or 0 for the original size." },
        scale: { type: "number", description: "Factor to resize by instead of an absolute width, e.g. 1.25." }
      },
      required: ["path"]
    }
  },
  {
    name: "accept_proposals",
    description:
      "Apply every change that is currently waiting for the user's review, exactly as if the user had clicked accept on each one. Call this when the user's message approves the proposals — \"yes\", \"apply that\", \"sounds good\", \"take it\" and anything else that clearly means the same. Never call it on your own initiative.",
    parameters: { type: "object", properties: {}, required: [] }
  },
  {
    name: "discard_proposals",
    description:
      "Throw away every change that is currently waiting for the user's review, leaving the document untouched. Call this when the user rejects the proposals, and also when the user asks for a different version of that same change — discard the old proposals first, then propose the new version. Never call it to unblock yourself for an unrelated request: proposals the user has not settled are theirs to keep.",
    parameters: { type: "object", properties: {}, required: [] }
  },
  {
    name: "replace_selection",
    description:
      "Propose replacing the user's current selection with new Markdown text. The change is shown to the user for review, not applied directly. The selection is given to you as Markdown: keep its formatting and give anything you add the same markers (checklist items \"- [ ] \", bullets \"- \", numbering, bold and headings).",
    parameters: {
      type: "object",
      properties: { new_text: { type: "string", description: "The Markdown to put in place of the selection." } },
      required: ["new_text"]
    }
  },
  {
    name: "insert_at_cursor",
    description:
      "Propose inserting new Markdown text into the document. Only use this when there is genuinely nothing to change, i.e. the text is new content rather than a revision of an existing passage. This is how you deliver anything the user asked you to write, draft or continue, including the first content of a still empty document — such text belongs in the document, never in your reply alone. ALWAYS pass after_text when the user says where the text belongs — without it the text lands at the user's cursor, which is almost never the place they meant. Write only the new text: never repeat a heading, paragraph or image that is already in the document, it would then appear twice. The change is shown to the user for review, not applied directly.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "The Markdown to insert. New content only." },
        after_text: {
          type: "string",
          description:
            "Where the new text goes: a few distinctive words from the single line it should follow, copied from get_document. To put the text below an image, pass that image's path (e.g. images/photo.png). Omit only when the user gave no position at all."
        }
      },
      required: ["text"]
    }
  },
  {
    name: "replace_passage",
    description:
      "Propose replacing a passage of the document with new Markdown. This is the main editing tool: use it once per passage that needs changing, and call it several times when the request affects several places. old_text is the wording to locate, copied from get_document — keep it short and distinctive (one line or sentence is usually enough); formatting differences are tolerated, so list bullets, table pipes and ** markers do not have to match exactly. To append to a list or table, pass its last row as old_text and that same row plus the new rows as new_text. The change is shown to the user for review, not applied directly.",
    parameters: {
      type: "object",
      properties: {
        old_text: { type: "string", description: "A short, distinctive passage of the document to locate." },
        new_text: { type: "string", description: "The Markdown that replaces it." }
      },
      required: ["old_text", "new_text"]
    }
  },
  {
    name: FLAG_SUGGESTION_TOOL_NAME,
    description:
      "Shows the user a button that turns the change your reply offers into a reviewable edit of their " +
      "document. Call this as the last action of a turn whose reply offers a change you did not propose with " +
      "replace_selection, insert_at_cursor or replace_passage: you wrote the new wording out in the reply, " +
      "you described a rewrite you are ready to make, or you asked whether you should apply it. Without this " +
      "call such an offer is dead text the user cannot act on. Do not call it when you already proposed that " +
      "same change with an editing tool (it has its own review widget), and not when your reply only answers " +
      "a question, explains something, or confirms a change that is already made.",
    parameters: { type: "object", properties: {}, required: [] }
  }
] as const;

// The knowledge base's tools ("Wissensbasis", see DOCS/wissensbasis-plan.md).
// Kept apart from the specs above because they are the only ones whose
// availability depends on a setting: they read files the user never opened, so
// they are offered only once the feature has been switched on for this vault.
export const VAULT_TOOL_NAMES: readonly string[] = ["search_vault", "read_note"];

const VAULT_TOOL_SPECS = [
  {
    name: "search_vault",
    description:
      "Search the user's other notes in this vault for passages that answer the question or supply the " +
      "material. Use it whenever the user refers to something that is not in the open document — an earlier " +
      "meeting, a decision, a person, a project, \"the other X\", or anything they say they wrote down " +
      "somewhere — including when they ask you to insert, continue or reuse it: search for it yourself " +
      "before asking them to paste or repeat it. It answers with the best matching " +
      "passages and the file each came from. A short passage comes back complete and you can work with it " +
      "as it stands; a passage the result marks as cut off is a preview, and you have to call read_note on " +
      "it before you rely on its wording. This is a keyword search: query with the distinctive words a " +
      "note would actually contain (names, project titles, terms), not with the user's whole sentence, and " +
      "search again with different words when the first attempt finds nothing. Do not use it for the " +
      "document the user currently has open — get_document gives you that one in full.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The distinctive words to search for, e.g. \"Kunde A Liefertermin\"."
        },
        limit: { type: "integer", description: "How many passages to return. Default 6, at most 20." }
      },
      required: ["query"]
    }
  },
  {
    name: "read_note",
    description:
      "Read one of the user's notes in full, or a single section of it. Call this whenever a search result " +
      "is marked as cut off and you need its wording, and whenever you need the note around a passage: a " +
      "preview is cut mid-sentence, so answering from one is how you end up quoting something the note does " +
      "not say. A result that is not marked as cut off you already have in full. Pass path " +
      "exactly as search_vault reported it, and section as that result's heading trail to get just that " +
      "part. Never guess a path that no search result mentioned.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The note's path exactly as search_vault reported it, e.g. Projekte/Kunde A.md."
        },
        section: {
          type: "string",
          description:
            "Optional heading trail of one passage, exactly as search_vault reported it, e.g. " +
            "\"Kunde A > Entscheidungen\". Omit to read the whole note."
        }
      },
      required: ["path"]
    }
  }
] as const;

type ToolSpec = {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
};

function toOpenAiTools(specs: readonly ToolSpec[]) {
  return specs.map((spec) => ({
    type: "function",
    function: { name: spec.name, description: spec.description, parameters: spec.parameters }
  }));
}

function toAnthropicTools(specs: readonly ToolSpec[]) {
  return specs.map((spec) => ({
    name: spec.name,
    description: spec.description,
    input_schema: spec.parameters
  }));
}

const AGENT_TOOLS_OPENAI = toOpenAiTools(AGENT_TOOL_SPECS as readonly ToolSpec[]);
const AGENT_TOOLS_ANTHROPIC = toAnthropicTools(AGENT_TOOL_SPECS as readonly ToolSpec[]);
const VAULT_TOOLS_OPENAI = toOpenAiTools(VAULT_TOOL_SPECS as readonly ToolSpec[]);
const VAULT_TOOLS_ANTHROPIC = toAnthropicTools(VAULT_TOOL_SPECS as readonly ToolSpec[]);

// Applies request.toolNames. Narrowing the offered tools is the guard that lets
// a follow-up step ask the model a question without giving it the means to
// propose or change anything while answering.
function offeredTools<T extends { name: string } | { function: { name: string } }>(
  all: T[],
  toolNames: readonly string[] | undefined
): T[] {
  if (!toolNames) {
    return all;
  }

  return all.filter((tool) => toolNames.includes("name" in tool ? tool.name : tool.function.name));
}

/**
 * The tools one request offers: the standard set, plus the knowledge base's
 * when the vault has it switched on, narrowed by request.toolNames.
 *
 * Composing here rather than at the call sites keeps the three provider
 * families from drifting — a tool added to only two of them is a bug that only
 * shows up on whichever provider the developer happened not to test.
 */
function requestTools<T extends { name: string } | { function: { name: string } }>(
  base: T[],
  vault: T[],
  request: AiChatRequest
): T[] {
  return offeredTools(request.vaultSearchEnabled ? [...base, ...vault] : base, request.toolNames);
}

// Ollama's tool_calls arguments already arrive as an object; OpenAI-compatible
// endpoints send them as a JSON string. Passing either through this one
// function covers both without the callers needing to know which.
function safeParseJson(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }

  if (typeof value !== "string") {
    return {};
  }

  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const AGENT_INSTRUCTION =
  "You work on the user's document by calling tools.\n" +
  "0. An open review comes before everything else. When the turn says changes you proposed earlier are " +
  "still waiting for the user's review, settle them first: the message approves them (\"yes\", \"apply " +
  "that\", \"sounds good\") — call accept_proposals. It rejects them (\"no\", \"drop that\", \"forget " +
  "it\") — call discard_proposals. It asks for a different version of that same change (\"shorter\", " +
  "\"a bit less\", \"without the last one\") — call discard_proposals first, then propose the new " +
  "version; the old proposals must never stay open beside the new ones. It is about something else " +
  "entirely — propose nothing, discard nothing, and reply that the earlier proposals are still open and " +
  "you need the user to accept or discard them first. Only the user's own message settles a review: " +
  "never call discard_proposals just to get the editing tools working again.\n" +
  "1. ALWAYS start every request by calling get_document (and get_selection when the user refers " +
  "to \"this\", \"here\" or the selection), even for questions — never answer about the text, and " +
  "never propose a change, without having read the current wording first. One exception: when the " +
  "user's message already carries their selected passage as context, that passage IS the current " +
  "wording — a question aimed only at it can be answered straight away, and you read the document " +
  "only when you genuinely need the surrounding context.\n" +
  "2. Decide what the user actually wants for THIS text. Requests like \"shorten\", \"add examples\", " +
  "\"make it friendlier\" mean revising the existing passages, not writing a separate new block.\n" +
  "2a. A request to WRITE something — \"write me an introduction\", \"draft a section about X\", " +
  "\"continue this\", \"add a paragraph on Y\" — is a request to write it INTO the document. Deliver the " +
  "text with insert_at_cursor (or replace_passage when it takes the place of an existing passage), and " +
  "never write it out in your reply instead: text that only exists in the chat is text the user has to " +
  "copy over by hand, which is exactly the work they asked you to do for them. An empty document is the " +
  "normal case for this, not an obstacle — call insert_at_cursor with the complete text and no " +
  "after_text. The only time such a request stays in the chat is when the user explicitly asked for it " +
  "there (\"just show me\", \"don't change anything yet\").\n" +
  "3. Propose the changes with replace_passage (or replace_selection when the user is working on a " +
  "selection). Work passage by passage: change only what the request affects, keep the rest of the " +
  "wording, and call the tool once per affected passage — several proposals in one turn are normal " +
  "and expected when the request touches several places. Only use insert_at_cursor for genuinely " +
  "new content that doesn't revise anything.\n" +
  "3a. Every tool argument is Markdown, and the formatting is part of the passage. When you rewrite " +
  "a passage or extend it with further entries, keep its markup and give the new entries the same " +
  "one: checklist items stay \"- [ ] \", bullets stay \"- \", numbered items keep their numbering, " +
  "and bold, italic or heading markup around the wording stays. Never answer a checklist or list " +
  "with bare sentences — text you add has to look like the entries that are already there.\n" +
  "4. The tools do NOT change the document: each call shows the user a red/green proposal that they " +
  "accept or discard. So do not ask for permission first, and do not repeat the revised text in " +
  `your reply — propose it with a tool and then confirm in one short sentence what you proposed. If ` +
  `you nevertheless end a turn without having proposed the change, rule 9 applies.\n` +
  "5. A proposal stays out of the document until the user accepts it, so a get_document after your " +
  "own proposal shows the OLD text — that is correct and never means the call failed. Never call a " +
  "tool a second time for a change you already proposed: a second proposal means the text ends up in " +
  "the document twice.\n" +
  "6. Say where new text goes: with insert_at_cursor pass after_text (a few distinctive words of the " +
  "line it should follow, or an image path for \"below the image\"). And write ONLY the new text — " +
  "copying the surrounding heading, paragraph or ![alt](path) along with it duplicates them.\n" +
  "7. When the request is about an image in the document, call get_image with the path from the " +
  "![alt](path) markdown. Never claim you cannot see images and never describe an image from its " +
  "file name or alt text — call get_image first and describe what you actually see.\n" +
  "8. To make an image bigger or smaller, call set_image_width with that same path — never try to " +
  "edit an image's markdown with replace_passage, it cannot work. \"A bit bigger\" is scale 1.25, " +
  "\"much bigger\" scale 1.75, and the same factors below 1 for smaller. One call is enough: the new " +
  "size is applied immediately, so confirm it in one sentence instead of proposing anything.\n" +
  `9. Before you finish a turn, check what you are leaving behind. If your reply offers the user a change ` +
  `to their text that you did NOT propose with an editing tool in this turn — you wrote the new wording out ` +
  `in the reply itself, you described a rewrite you are ready to make, or you asked whether you should apply ` +
  `it ("would you like me to …?", "shall I apply that?") — then your last action of the turn is to call ` +
  `${FLAG_SUGGESTION_TOOL_NAME}. That gives the user a button to apply it, and is the only way they can act ` +
  `on it: an offer left in your reply text unflagged is one the user cannot accept. Do not call it when you ` +
  `already proposed the change with an editing tool, and not when your reply merely answers a question, ` +
  `explains something or confirms a change you have already made.\n` +
  "If the user only asks a question, answer it normally after reading the document.";

// Added on top of AGENT_INSTRUCTION only when the vault's knowledge base is on.
// Its whole job is the two failure modes that make a "search my notes" feature
// untrustworthy: answering from a preview snippet, and answering from memory
// while claiming the notes said it.
const VAULT_INSTRUCTION =
  "You can also look things up in the user's other notes in this vault.\n" +
  "V1. When the user refers to something that is not in the open document — an earlier meeting, a " +
  "decision, a person, a project, \"the other X\", \"what did I write about …\", \"when did we agree …\" — " +
  "call search_vault yourself before answering or before asking the user to repeat, paste or describe it. " +
  "This applies just as much to edit requests as to questions: \"attach the other poem here\", \"continue " +
  "from what I wrote about X\", \"use the notes from that meeting\" all name something you can look up, so " +
  "search for it first — only ask the user to supply it themselves once a search (and a retry with " +
  "different words) has come back empty. Do not answer, or ask the user to hand you the material, from " +
  "memory: you have no knowledge of this user's notes beyond what the tools return.\n" +
  "V2. search_vault is a keyword search. Query with the distinctive words the note itself would contain, " +
  "not with the user's sentence. If nothing comes back, try again with other words (a synonym, a name, a " +
  "shorter query) before you conclude there is nothing.\n" +
  "V3. A search result that is marked as cut off is a preview, ending mid-sentence at an arbitrary point. " +
  "Never quote one, never treat its last words as the end of the text, and call read_note for that result " +
  "before you state anything from it as fact. A result not marked as cut off is the passage in full — use " +
  "it as it stands instead of calling read_note again for the same text.\n" +
  "V4. Name the note you took an answer from, in your reply, the way a person would (\"in Projekte/Kunde " +
  "A.md you noted …\"). The user sees the sources listed under your answer as well, but a claim whose " +
  "source is not visible in the sentence itself is one they cannot check.\n" +
  "V5. When the notes do not contain the answer, say so plainly. Do not fill the gap with general " +
  "knowledge and do not imply it came from their notes.";

function buildChatSystemPrompt(
  request: AiChatRequest,
  thinkingMode: AiThinkingMode,
  toolsEnabled = false
): string {
  if (request.systemOverride) {
    return request.systemOverride;
  }

  const baseInstruction = request.assistantInstruction.trim() || DEFAULT_CHAT_ASSISTANT_INSTRUCTION;

  const thinkingInstruction =
    thinkingMode === "off" ? "Do not output any reasoning, notes, or intermediate steps." : "";

  // In the agent (tool-calling) path the document is deliberately not
  // embedded upfront — the agent reads it itself via get_document/
  // get_selection, which saves context and avoids stale duplicates.
  const documentSection =
    !toolsEnabled && request.documentContext?.trim()
      ? "The user is currently working on the following document. Use it as context when the " +
        `conversation refers to it:\n\n${request.documentContext.trim()}`
      : "";

  const agentSection = toolsEnabled ? AGENT_INSTRUCTION : "";
  const vaultSection = toolsEnabled && request.vaultSearchEnabled ? VAULT_INSTRUCTION : "";

  return [
    baseInstruction,
    MARKDOWN_OUTPUT_INSTRUCTION,
    agentSection,
    vaultSection,
    thinkingInstruction,
    documentSection
  ]
    .filter(Boolean)
    .join("\n\n");
}

function chatMessages(request: AiChatRequest, systemContent: string) {
  return [{ role: "system", content: systemContent }, ...request.messages];
}

// --- Agent tool-calling wire mapping ----------------------------------------
//
// Translates the tagged AiChatMessage union into each provider family's wire
// format. The same mapping serves the streaming and non-streaming step (see
// streamAiChatStep and generateAiChatStep): only the response side differs
// between them, and the fragmented tool_calls the streaming side has to put
// back together are handled there, in createToolCallBuffer.

// Images ride along on user turns, and the two OpenAI-ish families disagree on
// how: Ollama takes a flat `images: [base64]` alongside the text, while
// OpenAI-compatible endpoints (OpenAI, Mistral, Jan, LM Studio) take a content
// array of text/image_url parts with a data: URL. Same split as the OCR path.
function toOpenAiCompatUserMessage(
  message: Extract<AiChatMessage, { role: "user" }>,
  isOllamaShape: boolean
): Record<string, unknown> {
  if (!message.images?.length) {
    return { role: "user", content: message.content };
  }

  if (isOllamaShape) {
    return {
      role: "user",
      content: message.content,
      images: message.images.map((image) => image.base64)
    };
  }

  return {
    role: "user",
    content: [
      { type: "text", text: message.content },
      ...message.images.map((image) => ({
        type: "image_url",
        image_url: { url: `data:${image.mimeType};base64,${image.base64}` }
      }))
    ]
  };
}

// Bridges a user turn that would otherwise follow tool results directly.
// Mistral validates the role order strictly and rejects that sequence with
// "Unexpected role 'user' after role 'tool'" — it wants an assistant turn in
// between — while OpenAI, Jan and LM Studio accept it either way. The image
// turn the agent loop appends after get_image is exactly this case, so the
// bridge goes in for every OpenAI-compatible provider rather than for Mistral
// alone: one wire shape that all of them accept beats a per-provider special
// case (same reasoning as the merge in toAnthropicMessages).
const TOOL_TO_USER_BRIDGE = "Let me take a look.";

// Exported for aiChatWire.test.ts: the three provider families disagree on
// where images and tool results go, which is exactly the part worth pinning
// down in tests rather than only against a live endpoint.
export function toOpenAiCompatMessages(
  request: AiChatRequest,
  thinkingMode: AiThinkingMode,
  isOllamaShape: boolean
) {
  const out: Record<string, unknown>[] = [
    { role: "system", content: buildChatSystemPrompt(request, thinkingMode, true) }
  ];

  for (const message of request.messages) {
    if (message.role === "user") {
      if (out[out.length - 1]?.role === "tool") {
        out.push({ role: "assistant", content: TOOL_TO_USER_BRIDGE });
      }

      out.push(toOpenAiCompatUserMessage(message, isOllamaShape));
    } else if (message.role === "assistant") {
      const wireMessage: Record<string, unknown> = { role: "assistant", content: message.content || "" };

      if (message.toolCalls?.length) {
        wireMessage.tool_calls = message.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: "function",
          function: { name: toolCall.name, arguments: JSON.stringify(toolCall.arguments) }
        }));
      }

      out.push(wireMessage);
    } else {
      out.push({ role: "tool", tool_call_id: message.toolCallId, content: message.content });
    }
  }

  return out;
}

// Anthropic keeps the system prompt separate from the message list and
// requires tool results to come back as tool_result blocks inside a *user*
// turn — several results after one assistant turn must be merged into a
// single user message, not sent as several.
export function toAnthropicMessages(request: AiChatRequest) {
  const out: Record<string, unknown>[] = [];

  for (const message of request.messages) {
    if (message.role === "tool") {
      const block = { type: "tool_result", tool_use_id: message.toolCallId, content: message.content };
      const last = out[out.length - 1];

      if (last && last.role === "user" && Array.isArray(last.content)) {
        (last.content as unknown[]).push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
    } else if (message.role === "assistant") {
      const content: unknown[] = [];

      if (message.content) {
        content.push({ type: "text", text: message.content });
      }

      for (const toolCall of message.toolCalls ?? []) {
        content.push({ type: "tool_use", id: toolCall.id, name: toolCall.name, input: toolCall.arguments });
      }

      out.push({ role: "assistant", content: content.length ? content : message.content });
    } else {
      const blocks: unknown[] = [
        ...(message.images ?? []).map((image) => ({
          type: "image",
          source: { type: "base64", media_type: image.mimeType, data: image.base64 }
        })),
        { type: "text", text: message.content }
      ];
      const last = out[out.length - 1];

      // An image turn follows the tool results that produced it, and Anthropic
      // rejects two consecutive user turns — so merge into the open user turn
      // holding those tool_result blocks instead of pushing a second one. Same
      // for a turn whose image was dropped again (see stripChatImages): the
      // position in the history is what forces the merge, not the image.
      if (last && last.role === "user" && Array.isArray(last.content)) {
        (last.content as unknown[]).push(...blocks);
      } else if (message.images?.length) {
        out.push({ role: "user", content: blocks });
      } else {
        out.push({ role: "user", content: message.content });
      }
    }
  }

  return out;
}

export type AiChatStep = {
  text: string;
  toolCalls: ToolCall[];
  // The step only got an answer after its images were dropped: the model has no
  // vision. Tells the agent loop to stop attaching images for the rest of the
  // conversation instead of paying for the same rejection once per step — see
  // sendMessage in src/store/useChatStore.ts.
  imagesDropped?: boolean;
};

// --- Models without vision ---------------------------------------------------
//
// A model that cannot take an image does not skip it: llama.cpp answers "image
// input is not supported - hint: … provide the mmproj", Ollama and LM Studio
// reject the request just as flatly. That kills the whole turn over one picture
// in the document, which is not what the user asked about — so the request is
// retried without the image and the model is told, in the history, that it
// cannot see it.

// Replaces an image in the history when it cannot be sent. Model-facing English
// like the tool results, and deliberately blunt about not inventing a
// description: a turn saying "here is the image you requested" with no image
// attached is exactly the setup a model happily hallucinates from.
export const IMAGE_UNSUPPORTED_NOTE =
  "[The image could not be shown: this model cannot process images. Do not describe the picture and do " +
  "not guess what it shows — say plainly that you cannot see images, then answer from the document's text.]";

// What get_image reports once the model is known to have no vision, instead of
// promising an image that the next request would only be rejected for. The
// "Error:" prefix is what the chat panel renders as the failed-tool line.
export const IMAGE_UNSUPPORTED_TOOL_RESULT =
  "Error: this model cannot process images, so the picture cannot be shown to you. Tell the user their " +
  "model has no vision support, and answer from the document's text instead.";

// Matched against the endpoint's own error text, which differs per backend —
// hence the spread of wordings rather than one exact string.
const IMAGE_UNSUPPORTED_PATTERNS = [
  // llama.cpp / LM Studio, with and without the mmproj hint.
  /image input is not supported/i,
  /mmproj/i,
  // Ollama, LM Studio: "model does not support images".
  /(does not|doesn't|do not|don't|cannot|can't|unable to) support (image|vision|multimodal)/i,
  // OpenAI ("image_url is only supported by certain models"), Anthropic
  // ("image content blocks are not supported by this model"), Mistral.
  /(image|image_url|vision|multimodal)[^\n]{0,60}(not supported|only supported by|unsupported)/i,
  // Ollama rejecting the `images` field outright.
  /invalid input:? *images/i
];

/** Whether an endpoint error says the model cannot take the images we sent. */
export function isImageUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");

  return IMAGE_UNSUPPORTED_PATTERNS.some((pattern) => pattern.test(message));
}

export function hasChatImages(messages: AiChatMessage[]): boolean {
  return messages.some((message) => message.role === "user" && Boolean(message.images?.length));
}

/**
 * The same history with every image taken out and IMAGE_UNSUPPORTED_NOTE put in
 * its place. Keyed on imagePaths as well as on the resolved payload, so a
 * caller that never attached the images in the first place (because the model
 * is already known to have none) produces the identical history.
 */
export function stripChatImages(messages: AiChatMessage[]): AiChatMessage[] {
  return messages.map((message) => {
    if (message.role !== "user" || !(message.images?.length || message.imagePaths?.length)) {
      return message;
    }

    return {
      ...message,
      content: `${message.content}\n\n${IMAGE_UNSUPPORTED_NOTE}`,
      images: undefined
    };
  });
}

// The request body of one agent step, per provider family. Pulled out of
// generateAiChatStep so the streaming variant below sends byte-for-byte the
// same request with `stream` flipped: a tool the streaming path did not offer,
// or a context length it forgot to pass, would show up as the agent behaving
// differently depending on which path answered.
function anthropicChatStepBody(settings: AiSettings, request: AiChatRequest): Record<string, unknown> {
  return {
    model: settings.model,
    system: buildChatSystemPrompt(request, settings.thinkingMode, true),
    max_tokens: resolveMaxOutputTokens(settings.contextLength),
    tools: requestTools(AGENT_TOOLS_ANTHROPIC, VAULT_TOOLS_ANTHROPIC, request),
    messages: toAnthropicMessages(request)
  };
}

function ollamaChatStepBody(settings: AiSettings, request: AiChatRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: settings.model,
    messages: toOpenAiCompatMessages(request, settings.thinkingMode, true),
    tools: requestTools(AGENT_TOOLS_OPENAI, VAULT_TOOLS_OPENAI, request),
    options: { num_ctx: settings.contextLength, num_predict: resolveMaxOutputTokens(settings.contextLength) }
  };

  if (settings.thinkingMode === "off") {
    body.think = false;
  }

  return body;
}

function openAiCompatibleChatStepBody(settings: AiSettings, request: AiChatRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: settings.model,
    messages: toOpenAiCompatMessages(request, settings.thinkingMode, false),
    tools: requestTools(AGENT_TOOLS_OPENAI, VAULT_TOOLS_OPENAI, request),
    tool_choice: "auto",
    temperature: 0.2,
    max_tokens: resolveMaxOutputTokens(settings.contextLength)
  };

  if (supportsThinkingExtension(settings.provider) && settings.thinkingMode === "off") {
    body.chat_template_kwargs = { enable_thinking: false };
  }

  return withOpenAiParamCompat(settings, body);
}

// Non-streaming per-turn agent step: sends the tool specs, executes at most
// one round trip, and returns either tool calls to run or final text. Kept
// alongside streamAiChatStep as the fallback for an endpoint whose streaming
// tool calls cannot be trusted — see streamAiChatStep's comment.
export async function generateAiChatStep(
  settings: AiSettings,
  request: AiChatRequest,
  signal?: AbortSignal
): Promise<AiChatStep> {
  assertValidEndpoint(settings.provider, settings.apiUrl, settings.apiKey);

  if (!settings.model.trim()) {
    throw new Error(i18n.t("aiClient.modelRequired"));
  }

  if (settings.provider === "anthropic") {
    const payload = (await postJson(
      new URL("/v1/messages", settings.apiUrl).toString(),
      anthropicChatStepBody(settings, request),
      anthropicAuthHeaders(settings.apiKey),
      signal
    )) as { content?: Array<Record<string, unknown>> };

    const blocks = payload.content ?? [];
    const toolCalls = blocks
      .filter((block) => block.type === "tool_use")
      .map((block) => ({
        id: String(block.id),
        name: String(block.name),
        arguments: safeParseJson(block.input)
      }));
    const text = stripThinkingBlocks(
      blocks
        .filter((block) => block.type === "text")
        .map((block) => String(block.text ?? ""))
        .join("")
    );

    return { text, toolCalls };
  }

  if (settings.provider === "ollama") {
    const payload = (await postJson(
      new URL("/api/chat", settings.apiUrl).toString(),
      { ...ollamaChatStepBody(settings, request), stream: false },
      undefined,
      signal
    )) as {
      message?: {
        content?: string;
        tool_calls?: Array<{ id?: string; function: { name: string; arguments: unknown } }>;
      };
    };

    const message = payload.message;
    const toolCalls = (message?.tool_calls ?? []).map((toolCall, index) => ({
      id: toolCall.id ?? `call_${Date.now()}_${index}`,
      name: toolCall.function.name,
      // Ollama already hands back an object here; safeParseJson passes it through unchanged.
      arguments: safeParseJson(toolCall.function.arguments)
    }));

    return { text: stripThinkingBlocks(message?.content ?? ""), toolCalls };
  }

  // OpenAI-compatible (OpenAI, Mistral, Jan, LM Studio)
  const payload = (await postJson(
    new URL("/v1/chat/completions", settings.apiUrl).toString(),
    { ...openAiCompatibleChatStepBody(settings, request), stream: false },
    buildOpenAiCompatibleAuthHeaders(settings),
    signal
  )) as {
    choices?: Array<{
      message?: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
    }>;
  };

  const message = payload.choices?.[0]?.message;
  const toolCalls = (message?.tool_calls ?? []).map((toolCall) => ({
    id: toolCall.id,
    name: toolCall.function.name,
    arguments: safeParseJson(toolCall.function.arguments)
  }));

  return { text: stripThinkingBlocks(message?.content ?? ""), toolCalls };
}

export type AiChatStepHandlers = {
  onText: (chunk: string) => void;
  onThinking: (chunk: string) => void;
  // Fires once per tool call, as soon as its *name* is known — well before its
  // arguments have finished streaming. What the chat turns into "searching your
  // notes …" while the model is still writing the call.
  onToolCall: (name: string) => void;
};

type StreamedToolCall = { id: string; name: string; args: unknown };

/**
 * Reassembles tool calls that arrive in pieces.
 *
 * All three provider families stream a call as a name first and its arguments
 * as a run of JSON fragments afterwards, keyed by the call's position in the
 * turn — that index is the only thing tying a fragment to the call it belongs
 * to, which is why it, and not arrival order, is what the slots are keyed by.
 */
function createToolCallBuffer(onToolCall: (name: string) => void) {
  const calls = new Map<number, StreamedToolCall>();
  const announced = new Set<number>();

  const slot = (index: number): StreamedToolCall => {
    const existing = calls.get(index);

    if (existing) {
      return existing;
    }

    const created: StreamedToolCall = { id: "", name: "", args: undefined };
    calls.set(index, created);

    return created;
  };

  return {
    open(index: number, id: string | undefined, name: string | undefined) {
      const call = slot(index);

      if (id) {
        call.id = id;
      }

      if (name && !call.name) {
        call.name = name;
      }

      if (call.name && !announced.has(index)) {
        announced.add(index);
        onToolCall(call.name);
      }
    },
    // OpenAI and Anthropic both fragment the argument JSON across chunks.
    appendArguments(index: number, fragment: string) {
      const call = slot(index);
      call.args = `${typeof call.args === "string" ? call.args : ""}${fragment}`;
    },
    // Ollama sends the arguments as one finished object instead.
    setArguments(index: number, value: unknown) {
      slot(index).args = value;
    },
    toToolCalls(): ToolCall[] {
      return Array.from(calls.entries())
        .sort(([left], [right]) => left - right)
        // A call whose name never arrived cannot be executed; dropping it beats
        // sending the agent loop after a tool called "".
        .filter(([, call]) => call.name)
        .map(([index, call]) => ({
          // Ollama sends no id, and a history whose tool result names no call is
          // rejected by OpenAI and Anthropic alike — so one is made up here.
          id: call.id || `call_${Date.now()}_${index}`,
          name: call.name,
          arguments: safeParseJson(call.args)
        }));
    }
  };
}

/**
 * POSTs a streaming request and hands its lines to `onLine`.
 *
 * The deadline is an *idle* one, re-armed on every line that arrives: unlike
 * postJson's, which caps the whole request, this one has to let a long answer
 * run for as long as tokens keep coming while still catching an endpoint that
 * accepted the request and then went quiet.
 */
async function consumeChatStepStream(
  url: string,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> | undefined,
  signal: AbortSignal | undefined,
  onLine: (line: string) => void
): Promise<void> {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  let stalled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const armDeadline = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
  };

  signal?.addEventListener("abort", forwardAbort);
  armDeadline();

  try {
    const response = await httpFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...extraHeaders },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(await extractResponseErrorMessage(response));
    }

    if (!response.body) {
      throw new Error(i18n.t("aiClient.invalidResponse"));
    }

    await forEachStreamLine(response, (line) => {
      armDeadline();
      onLine(line);
    });
  } catch (error) {
    if (stalled) {
      throw new Error(i18n.t("aiClient.requestTimeout", { seconds: Math.round(REQUEST_TIMEOUT_MS / 1000) }));
    }

    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }
}

async function streamAnthropicChatStep(
  settings: AiSettings,
  request: AiChatRequest,
  handlers: AiChatStepHandlers,
  signal?: AbortSignal
): Promise<AiChatStep> {
  const splitter = createThinkingSplitter({ onChunk: handlers.onText, onThinking: handlers.onThinking });
  const tools = createToolCallBuffer(handlers.onToolCall);
  let currentEventType = "";

  await consumeChatStepStream(
    new URL("/v1/messages", settings.apiUrl).toString(),
    { ...anthropicChatStepBody(settings, request), stream: true },
    anthropicAuthHeaders(settings.apiKey),
    signal,
    (line) => {
      if (line.startsWith("event: ")) {
        currentEventType = line.slice("event: ".length).trim();
        return;
      }

      if (!line.startsWith("data: ")) {
        return;
      }

      let parsed: Record<string, unknown>;

      try {
        parsed = JSON.parse(line.slice("data: ".length)) as Record<string, unknown>;
      } catch {
        return;
      }

      if (currentEventType === "error") {
        const errorPayload = parsed.error as { message?: string } | undefined;
        throw new Error(errorPayload?.message ?? i18n.t("aiClient.invalidResponse"));
      }

      // Anthropic numbers the content blocks of a turn, and a tool call's
      // arguments come in under the index of the block that opened it.
      const index = typeof parsed.index === "number" ? parsed.index : 0;

      if (currentEventType === "content_block_start") {
        const block = parsed.content_block as { type?: string; id?: string; name?: string } | undefined;

        if (block?.type === "tool_use") {
          tools.open(index, block.id, block.name);
        }

        return;
      }

      if (currentEventType !== "content_block_delta") {
        return;
      }

      const delta = parsed.delta as
        | { type?: string; text?: string; thinking?: string; partial_json?: string }
        | undefined;

      if (delta?.type === "text_delta" && delta.text) {
        splitter.push(delta.text);
      } else if (delta?.type === "thinking_delta" && delta.thinking) {
        handlers.onThinking(delta.thinking);
      } else if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
        tools.appendArguments(index, delta.partial_json);
      }
    }
  );

  return { text: splitter.answer(), toolCalls: tools.toToolCalls() };
}

async function streamOllamaChatStep(
  settings: AiSettings,
  request: AiChatRequest,
  handlers: AiChatStepHandlers,
  signal?: AbortSignal
): Promise<AiChatStep> {
  const splitter = createThinkingSplitter({ onChunk: handlers.onText, onThinking: handlers.onThinking });
  const tools = createToolCallBuffer(handlers.onToolCall);
  // Ollama sends whole tool calls and numbers none of them, so the buffer's
  // slots are handed out in arrival order.
  let nextIndex = 0;

  await consumeChatStepStream(
    new URL("/api/chat", settings.apiUrl).toString(),
    { ...ollamaChatStepBody(settings, request), stream: true },
    undefined,
    signal,
    (line) => {
      const parsed = parseStreamLinePayload(line);

      if (!parsed) {
        return;
      }

      const message = parsed.message as
        | {
            content?: string;
            thinking?: string;
            tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: unknown } }>;
          }
        | undefined;

      if (message?.thinking) {
        handlers.onThinking(message.thinking);
      }

      if (message?.content) {
        splitter.push(message.content);
      }

      for (const call of message?.tool_calls ?? []) {
        const index = nextIndex;
        nextIndex += 1;

        tools.open(index, call.id, call.function?.name);
        tools.setArguments(index, call.function?.arguments);
      }
    }
  );

  return { text: splitter.answer(), toolCalls: tools.toToolCalls() };
}

async function streamOpenAiCompatibleChatStep(
  settings: AiSettings,
  request: AiChatRequest,
  handlers: AiChatStepHandlers,
  signal?: AbortSignal
): Promise<AiChatStep> {
  const splitter = createThinkingSplitter({ onChunk: handlers.onText, onThinking: handlers.onThinking });
  const tools = createToolCallBuffer(handlers.onToolCall);

  await consumeChatStepStream(
    new URL("/v1/chat/completions", settings.apiUrl).toString(),
    { ...openAiCompatibleChatStepBody(settings, request), stream: true },
    buildOpenAiCompatibleAuthHeaders(settings),
    signal,
    (line) => {
      const parsed = parseStreamLinePayload(line);

      if (!parsed) {
        return;
      }

      const choice = (
        parsed.choices as
          | Array<{
              delta?: Record<string, unknown>;
              message?: Record<string, unknown>;
            }>
          | undefined
      )?.[0];

      // Some local backends answer a streaming request with whole `message`
      // objects rather than deltas; both carry the same fields, so either does.
      const delta = (choice?.delta ?? choice?.message) as
        | {
            content?: string | null;
            reasoning_content?: string | null;
            reasoning?: string | null;
            tool_calls?: Array<{
              index?: number;
              id?: string;
              function?: { name?: string; arguments?: unknown };
            }>;
          }
        | undefined;

      const thinking = delta?.reasoning_content ?? delta?.reasoning;

      if (thinking) {
        handlers.onThinking(thinking);
      }

      if (delta?.content) {
        splitter.push(delta.content);
      }

      (delta?.tool_calls ?? []).forEach((call, position) => {
        // Parallel calls are told apart by `index`; the fallback covers the
        // whole-message case above, where the array position is the index.
        const index = typeof call.index === "number" ? call.index : position;

        tools.open(index, call.id, call.function?.name);

        const args = call.function?.arguments;

        if (typeof args === "string") {
          tools.appendArguments(index, args);
        } else if (args !== undefined) {
          tools.setArguments(index, args);
        }
      });
    }
  );

  return { text: splitter.answer(), toolCalls: tools.toToolCalls() };
}

/**
 * Streaming per-turn agent step: same request as generateAiChatStep, with the
 * answer reported token by token and each tool call announced the moment its
 * name arrives.
 *
 * Streaming exists here for the waiting, not for the wire: an agent step can
 * take half a minute on a local model, and the whole of it used to be a row of
 * dots. The result is identical to the non-streaming step — the loop in
 * useChatStore acts on the returned step, never on what was streamed.
 *
 * A step that yields neither text nor tool calls is retried without streaming.
 * Some OpenAI-compatible backends accept `stream: true` together with `tools`
 * and then send empty deltas, which as a silent empty answer would look like
 * the model had nothing to say.
 *
 * A step carrying images that the model turns out not to accept is retried
 * without them (see IMAGE_UNSUPPORTED_NOTE): one picture in the document must
 * not cost the user the whole answer.
 */
export async function streamAiChatStep(
  settings: AiSettings,
  request: AiChatRequest,
  handlers: AiChatStepHandlers,
  signal?: AbortSignal
): Promise<AiChatStep> {
  assertValidEndpoint(settings.provider, settings.apiUrl, settings.apiKey);

  if (!settings.model.trim()) {
    throw new Error(i18n.t("aiClient.modelRequired"));
  }

  const runStep = async (
    stepRequest: AiChatRequest,
    stepHandlers: AiChatStepHandlers
  ): Promise<AiChatStep> => {
    const step =
      settings.provider === "anthropic"
        ? await streamAnthropicChatStep(settings, stepRequest, stepHandlers, signal)
        : settings.provider === "ollama"
          ? await streamOllamaChatStep(settings, stepRequest, stepHandlers, signal)
          : await streamOpenAiCompatibleChatStep(settings, stepRequest, stepHandlers, signal);

    if (!step.text.trim() && step.toolCalls.length === 0 && !signal?.aborted) {
      return generateAiChatStep(settings, stepRequest, signal);
    }

    return step;
  };

  if (!hasChatImages(request.messages)) {
    return runStep(request, handlers);
  }

  // Only a request that produced nothing may be retried: a model that streamed
  // half an answer and then failed would have that half written twice.
  let streamedAnything = false;
  const watched: AiChatStepHandlers = {
    onText: (chunk) => {
      streamedAnything = true;
      handlers.onText(chunk);
    },
    onThinking: (chunk) => {
      streamedAnything = true;
      handlers.onThinking(chunk);
    },
    onToolCall: handlers.onToolCall
  };

  try {
    return await runStep(request, watched);
  } catch (error) {
    if (streamedAnything || signal?.aborted || !isImageUnsupportedError(error)) {
      throw error;
    }

    const step = await runStep({ ...request, messages: stripChatImages(request.messages) }, handlers);

    return { ...step, imagesDropped: true };
  }
}

async function streamOllamaChat(
  settings: AiSettings,
  request: AiChatRequest,
  handlers: AiStreamHandlers,
  signal?: AbortSignal
): Promise<string> {
  const body: Record<string, unknown> = {
    model: settings.model,
    stream: true,
    messages: chatMessages(request, buildChatSystemPrompt(request, settings.thinkingMode)),
    options: {
      num_ctx: settings.contextLength,
      num_predict: resolveMaxOutputTokens(settings.contextLength)
    }
  };

  if (settings.thinkingMode === "off") {
    body.think = false;
  }

  return streamJsonLines(
    new URL("/api/chat", settings.apiUrl).toString(),
    body,
    handlers,
    (payload) => {
      const message = payload.message as { content?: string; thinking?: string } | undefined;
      return {
        content: message?.content ?? null,
        thinking: message?.thinking ?? null
      };
    },
    (payload) => {
      const message = payload.message as { content?: string } | undefined;
      return message?.content ?? null;
    },
    signal
  );
}

async function streamOpenAiCompatibleChat(
  settings: AiSettings,
  request: AiChatRequest,
  handlers: AiStreamHandlers,
  signal?: AbortSignal
): Promise<string> {
  const requestBody: Record<string, unknown> = {
    model: settings.model,
    messages: chatMessages(request, buildChatSystemPrompt(request, settings.thinkingMode)),
    temperature: 0.4,
    max_tokens: resolveMaxOutputTokens(settings.contextLength),
    stream: true
  };

  if (supportsThinkingExtension(settings.provider) && settings.thinkingMode === "off") {
    requestBody.chat_template_kwargs = {
      enable_thinking: false
    };
  }

  return streamJsonLines(
    new URL("/v1/chat/completions", settings.apiUrl).toString(),
    withOpenAiParamCompat(settings, requestBody),
    handlers,
    (payload) => {
      const choices = payload.choices as Array<{
        delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null };
        message?: { content?: string | null };
      }> | undefined;
      const choice = choices?.[0];
      return {
        content: choice?.delta?.content ?? choice?.message?.content ?? null,
        thinking: choice?.delta?.reasoning_content ?? choice?.delta?.reasoning ?? null
      };
    },
    (payload) => {
      const choices = payload.choices as Array<{
        message?: { content?: string | null };
      }> | undefined;
      return choices?.[0]?.message?.content ?? null;
    },
    signal,
    buildOpenAiCompatibleAuthHeaders(settings)
  );
}

async function streamAnthropicChat(
  settings: AiSettings,
  request: AiChatRequest,
  handlers: AiStreamHandlers,
  signal?: AbortSignal
): Promise<string> {
  const body = {
    model: settings.model,
    system: buildChatSystemPrompt(request, settings.thinkingMode),
    max_tokens: resolveMaxOutputTokens(settings.contextLength),
    stream: true,
    messages: request.messages
  };

  return consumeAnthropicStream(
    new URL("/v1/messages", settings.apiUrl).toString(),
    body,
    settings.apiKey,
    handlers,
    signal
  );
}

export async function streamAiChat(
  settings: AiSettings,
  request: AiChatRequest,
  handlers: AiStreamHandlers,
  signal?: AbortSignal
): Promise<string> {
  assertValidEndpoint(settings.provider, settings.apiUrl, settings.apiKey);

  if (!settings.model.trim()) {
    throw new Error(i18n.t("aiClient.modelRequired"));
  }

  if (settings.provider === "ollama") {
    return streamOllamaChat(settings, request, handlers, signal);
  }

  if (settings.provider === "anthropic") {
    return streamAnthropicChat(settings, request, handlers, signal);
  }

  return streamOpenAiCompatibleChat(settings, request, handlers, signal);
}

// Strips a leading/trailing ```json ... ``` (or plain ``` ... ```) fence some
// models wrap JSON output in despite the system prompt asking for raw JSON.
export function stripJsonCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);

  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

export function parseCheckIssues(rawResponse: string): AiCheckIssue[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(stripJsonCodeFence(rawResponse));
  } catch {
    throw new Error(i18n.t("aiClient.invalidCheckResponse"));
  }

  if (!Array.isArray(parsed)) {
    throw new Error(i18n.t("aiClient.invalidCheckResponse"));
  }

  return parsed.filter(
    (entry): entry is AiCheckIssue =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as AiCheckIssue).original === "string" &&
      (entry as AiCheckIssue).original.length > 0 &&
      typeof (entry as AiCheckIssue).suggestion === "string"
  ).map((issue) => ({
    original: issue.original,
    suggestion: issue.suggestion,
    explanation: typeof issue.explanation === "string" ? issue.explanation : ""
  }));
}

export async function checkGrammar(
  settings: AiSettings,
  selectedText: string,
  signal?: AbortSignal
): Promise<AiCheckIssue[]> {
  const request: AiContentRequest = {
    mode: "check",
    prompt: "",
    selectedText,
    selectedMarkdown: selectedText,
    documentMarkdown: "",
    includeDocument: false,
    preserveFormatting: false
  };

  const rawResponse = await generateAiMarkdown(settings, request, signal);

  return parseCheckIssues(rawResponse);
}

const OCR_SYSTEM_PROMPT =
  "You are an OCR engine. Transcribe the full content of the given image as clean Markdown. Preserve the structure of the source (headings, lists, tables, emphasis) as far as it is recognizable. Write symbols (arrows, checkmarks, math operators, etc.) as their plain Unicode character (e.g. →, ⇒, ≤, ✓) — never as LaTeX/KaTeX markup (e.g. never \\rightarrow, \\Rightarrow, \\leq, or wrap anything in $...$), since the target document has no formula renderer and would show the raw markup as literal text. Respond ONLY with the transcribed Markdown — no commentary, no code fences around the whole answer, no descriptions of the image beyond its textual content.";

const OCR_USER_PROMPT = "Transcribe this image as Markdown.";

// Vision request shapes differ per provider family, so the OCR path builds
// its own messages instead of reusing the text-only request builders. There
// is deliberately no upfront vision-capability check: if the configured model
// cannot handle images, the provider's error surfaces per file in the import
// dialog.
export async function generateOcrMarkdown(
  settings: AiSettings,
  imageBase64: string,
  mimeType: string,
  signal?: AbortSignal
): Promise<string> {
  assertValidEndpoint(settings.provider, settings.apiUrl, settings.apiKey);

  if (!settings.model.trim()) {
    throw new Error(i18n.t("aiClient.modelRequired"));
  }

  let rawResponse: string;

  // OCR always runs with thinking disabled, regardless of the user's
  // thinking-mode setting: transcription gains nothing from reasoning and
  // thinking-capable vision models get several times slower with it on.
  if (settings.provider === "ollama") {
    const payload = await postJson(
      new URL("/api/chat", settings.apiUrl).toString(),
      {
        model: settings.model,
        stream: false,
        think: false,
        messages: [
          { role: "system", content: OCR_SYSTEM_PROMPT },
          { role: "user", content: OCR_USER_PROMPT, images: [imageBase64] }
        ],
        options: {
          num_ctx: settings.contextLength
        }
      },
      undefined,
      signal
    );

    rawResponse = extractResponseContent(payload, true);
  } else if (settings.provider === "anthropic") {
    const payload = await postJson(
      new URL("/v1/messages", settings.apiUrl).toString(),
      {
        model: settings.model,
        system: OCR_SYSTEM_PROMPT,
        max_tokens: resolveMaxOutputTokens(settings.contextLength),
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mimeType, data: imageBase64 }
              },
              { type: "text", text: OCR_USER_PROMPT }
            ]
          }
        ]
      },
      anthropicAuthHeaders(settings.apiKey),
      signal
    );

    rawResponse = extractAnthropicContent(payload);
  } else {
    const requestBody: Record<string, unknown> = {
      model: settings.model,
      stream: false,
      temperature: 0,
      max_tokens: resolveMaxOutputTokens(settings.contextLength),
      messages: [
        { role: "system", content: OCR_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: OCR_USER_PROMPT },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${imageBase64}` }
            }
          ]
        }
      ]
    };

    if (supportsThinkingExtension(settings.provider)) {
      requestBody.chat_template_kwargs = {
        enable_thinking: false
      };
    }

    const payload = await postJson(
      new URL("/v1/chat/completions", settings.apiUrl).toString(),
      withOpenAiParamCompat(settings, requestBody),
      buildOpenAiCompatibleAuthHeaders(settings),
      signal
    );

    rawResponse = extractResponseContent(payload, false);
  }

  const cleanedResponse = replaceLatexSymbolMacros(stripThinkingBlocks(rawResponse));

  if (!cleanedResponse) {
    throw new Error(i18n.t("aiClient.noUsableText"));
  }

  return cleanedResponse;
}

/**
 * The knowledge base's own connection (see DOCS/wissensbasis-plan.md, J): a
 * different service than the chat may use, so that notes can be made
 * searchable locally while the chat runs in the cloud, or the other way round.
 */
export type EmbeddingSettings = {
  provider: AiProvider;
  apiUrl: string;
  apiKey: string;
  model: string;
};

function parseEmbeddingVectors(payload: unknown, expectedCount: number): number[][] {
  const isVector = (value: unknown): value is number[] =>
    Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === "number" && Number.isFinite(entry));

  const container = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};

  // Ollama answers { embeddings: [[…]] }; every OpenAI-compatible endpoint
  // answers { data: [{ index, embedding }] } — and the index matters, because
  // the order of that array is not promised to match the input.
  let vectors: number[][] = [];

  if (Array.isArray(container.embeddings)) {
    vectors = container.embeddings.filter(isVector);
  } else if (Array.isArray(container.data)) {
    const entries = container.data
      .map((entry, position) => {
        const record = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
        const index = typeof record.index === "number" ? record.index : position;

        return { index, embedding: record.embedding };
      })
      .filter((entry): entry is { index: number; embedding: number[] } => isVector(entry.embedding))
      .sort((a, b) => a.index - b.index);

    vectors = entries.map((entry) => entry.embedding);
  }

  // A short answer would silently shift every following passage's vector onto
  // the wrong text, and nothing downstream could ever notice. Refuse instead.
  if (vectors.length !== expectedCount) {
    throw new Error(i18n.t("aiClient.embeddingsMalformed"));
  }

  const dimensions = vectors[0]?.length ?? 0;

  if (vectors.some((vector) => vector.length !== dimensions)) {
    throw new Error(i18n.t("aiClient.embeddingsMalformed"));
  }

  return vectors;
}

/**
 * Turns passages into vectors, one request per batch.
 *
 * Routed through this file rather than through Rust for one reason:
 * assertValidEndpoint below is the same guard the chat gets — cloud means
 * HTTPS plus a key, local means localhost. A second endpoint check somewhere
 * else is the likeliest place for this feature to grow a security hole.
 */
export async function embedTexts(
  settings: EmbeddingSettings,
  texts: string[],
  signal?: AbortSignal
): Promise<number[][]> {
  assertValidEndpoint(settings.provider, settings.apiUrl, settings.apiKey);

  if (!settings.model.trim()) {
    throw new Error(i18n.t("aiClient.modelRequired"));
  }

  if (!supportsEmbeddings(settings.provider)) {
    throw new Error(i18n.t("aiClient.embeddingsUnsupported", { provider: PROVIDER_DISPLAY_NAME[settings.provider] }));
  }

  if (texts.length === 0) {
    return [];
  }

  if (settings.provider === "ollama") {
    const payload = await postJson(
      new URL("/api/embed", settings.apiUrl).toString(),
      { model: settings.model, input: texts },
      undefined,
      signal
    );

    return parseEmbeddingVectors(payload, texts.length);
  }

  const payload = await postJson(
    new URL("/v1/embeddings", settings.apiUrl).toString(),
    { model: settings.model, input: texts },
    // Local providers never get an auth header — a leftover cloud key must not
    // travel to the local server (same rule as fetchAvailableModelsInternal).
    isCloudProvider(settings.provider) ? bearerAuthHeaders(settings.apiKey) : {},
    signal
  );

  return parseEmbeddingVectors(payload, texts.length);
}
