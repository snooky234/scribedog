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
  "You are a helpful writing assistant. You help the user revise and improve their text, " +
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
    const response = await tauriFetch(url, {
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
  const response = await tauriFetch(url, {
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

async function streamJsonLines(
  url: string,
  body: Record<string, unknown>,
  handlers: AiStreamHandlers,
  extractChunk: (payload: Record<string, unknown>) => AiStreamChunk,
  extractDoneContent: (payload: Record<string, unknown>) => string | null,
  signal?: AbortSignal,
  extraHeaders?: Record<string, string>
) {
  const response = await tauriFetch(url, {
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

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";
  let emittedAnswer = "";
  let emittedThinking = "";

  // Answer/thinking deltas are derived from the full accumulated text each
  // time (instead of stripped per chunk) so <think> tags split across chunk
  // boundaries are handled correctly.
  const handleParsedPayload = (parsed: Record<string, unknown>) => {
    const { content, thinking } = extractChunk(parsed);

    if (thinking) {
      handlers.onThinking?.(thinking);
    }

    if (content) {
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
    }

    if (parsed.done === true) {
      const finalContent = extractDoneContent(parsed) ?? fullContent;
      handlers.onFinal?.(stripThinkingBlocks(finalContent));
    }
  };

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
        const trimmedLine = line.trim();

        if (!trimmedLine) {
          continue;
        }

        if (trimmedLine.startsWith("data: ")) {
          const rawData = trimmedLine.slice(6).trim();

          if (rawData === "[DONE]") {
            continue;
          }

          let parsed: Record<string, unknown>;

          try {
            parsed = JSON.parse(rawData) as Record<string, unknown>;
          } catch {
            continue;
          }

          handleParsedPayload(parsed);
        }

        if (trimmedLine.startsWith("{")) {
          let parsed: Record<string, unknown>;

          try {
            parsed = JSON.parse(trimmedLine) as Record<string, unknown>;
          } catch {
            continue;
          }

          handleParsedPayload(parsed);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return stripThinkingBlocks(fullContent);
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
  const response = await tauriFetch(url, {
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

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";
  let currentEventType = "";

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
        if (line.startsWith("event: ")) {
          currentEventType = line.slice("event: ".length).trim();
          continue;
        }

        if (!line.startsWith("data: ")) {
          continue;
        }

        let parsed: Record<string, unknown>;

        try {
          parsed = JSON.parse(line.slice("data: ".length)) as Record<string, unknown>;
        } catch {
          continue;
        }

        if (currentEventType === "error") {
          const errorPayload = parsed.error as { message?: string } | undefined;
          throw new Error(errorPayload?.message ?? i18n.t("aiClient.invalidResponse"));
        }

        if (currentEventType !== "content_block_delta") {
          continue;
        }

        const delta = parsed.delta as { type?: string; text?: string; thinking?: string } | undefined;

        if (delta?.type === "text_delta" && delta.text) {
          fullContent += delta.text;
          handlers.onChunk(delta.text);
        } else if (delta?.type === "thinking_delta" && delta.thinking) {
          handlers.onThinking?.(delta.thinking);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

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
      // Notes from the vault this answer drew on, collected from the knowledge
      // base tool calls of the same turn (persisted). The transcript lists them
      // as clickable sources under the reply — an answer assembled from files
      // the user did not open is only trustworthy if they can see which ones.
      sources?: VaultSourceRef[];
    }
  | { role: "tool"; toolCallId: string; toolName: string; content: string };

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

// The tools that open a red/green proposal in the editor. A turn that called one
// of these has already given the user something to accept, which is what makes
// the flag above redundant for it.
export const EDITING_TOOL_NAMES: readonly string[] = [
  "replace_selection",
  "insert_at_cursor",
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
      "Propose inserting new Markdown text into the document. Only use this when there is genuinely nothing to change, i.e. the text is new content rather than a revision of an existing passage. ALWAYS pass after_text when the user says where the text belongs — without it the text lands at the user's cursor, which is almost never the place they meant. Write only the new text: never repeat a heading, paragraph or image that is already in the document, it would then appear twice. The change is shown to the user for review, not applied directly.",
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
// format. Deliberately non-streaming (see generateAiChatStep) — tool_calls
// arguments arrive fragmented across many SSE chunks when streamed, which is
// the single biggest source of tool-parsing bugs across providers, so the
// agent loop avoids streaming entirely.

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
    } else if (message.images?.length) {
      const blocks: unknown[] = [
        ...message.images.map((image) => ({
          type: "image",
          source: { type: "base64", media_type: image.mimeType, data: image.base64 }
        })),
        { type: "text", text: message.content }
      ];
      const last = out[out.length - 1];

      // An image turn follows the tool results that produced it, and Anthropic
      // rejects two consecutive user turns — so merge into the open user turn
      // holding those tool_result blocks instead of pushing a second one.
      if (last && last.role === "user" && Array.isArray(last.content)) {
        (last.content as unknown[]).push(...blocks);
      } else {
        out.push({ role: "user", content: blocks });
      }
    } else {
      out.push({ role: "user", content: message.content });
    }
  }

  return out;
}

export type AiChatStep = { text: string; toolCalls: ToolCall[] };

// Non-streaming per-turn agent step: sends the tool specs, executes at most
// one round trip, and returns either tool calls to run or final text. See the
// module comment above toOpenAiCompatMessages for why this stays non-streaming.
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
    const body = {
      model: settings.model,
      system: buildChatSystemPrompt(request, settings.thinkingMode, true),
      max_tokens: resolveMaxOutputTokens(settings.contextLength),
      tools: requestTools(AGENT_TOOLS_ANTHROPIC, VAULT_TOOLS_ANTHROPIC, request),
      messages: toAnthropicMessages(request)
    };

    const payload = (await postJson(
      new URL("/v1/messages", settings.apiUrl).toString(),
      body,
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
    const body: Record<string, unknown> = {
      model: settings.model,
      stream: false,
      messages: toOpenAiCompatMessages(request, settings.thinkingMode, true),
      tools: requestTools(AGENT_TOOLS_OPENAI, VAULT_TOOLS_OPENAI, request),
      options: { num_ctx: settings.contextLength, num_predict: resolveMaxOutputTokens(settings.contextLength) }
    };

    if (settings.thinkingMode === "off") {
      body.think = false;
    }

    const payload = (await postJson(new URL("/api/chat", settings.apiUrl).toString(), body, undefined, signal)) as {
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
  const body: Record<string, unknown> = {
    model: settings.model,
    messages: toOpenAiCompatMessages(request, settings.thinkingMode, false),
    tools: requestTools(AGENT_TOOLS_OPENAI, VAULT_TOOLS_OPENAI, request),
    tool_choice: "auto",
    temperature: 0.2,
    max_tokens: resolveMaxOutputTokens(settings.contextLength),
    stream: false
  };

  if (supportsThinkingExtension(settings.provider) && settings.thinkingMode === "off") {
    body.chat_template_kwargs = { enable_thinking: false };
  }

  const payload = (await postJson(
    new URL("/v1/chat/completions", settings.apiUrl).toString(),
    withOpenAiParamCompat(settings, body),
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
