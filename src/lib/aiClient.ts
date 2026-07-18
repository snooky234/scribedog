import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

import i18n from "@/i18n";
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

function isLocalApiUrl(apiUrl: string): boolean {
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

function isHttpsUrl(apiUrl: string): boolean {
  try {
    return new URL(apiUrl).protocol === "https:";
  } catch {
    return false;
  }
}

// Cloud providers require HTTPS + an API key; local providers must stay on
// localhost/127.0.0.1 (see README privacy notice).
function assertValidEndpoint(provider: AiProvider, apiUrl: string, apiKey: string): void {
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

function stripThinkingBlocks(text: string): string {
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
function replaceLatexSymbolMacros(text: string): string {
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
function splitThinkingTags(text: string): { answer: string; thinking: string } {
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

const CHECK_MODE_SYSTEM_PROMPT =
  "You are a spelling and grammar checker. Analyze the given text and identify spelling and grammar mistakes only — do not suggest stylistic rewrites or wording changes beyond fixing actual errors. Respond ONLY with a single JSON array (no markdown code fences, no explanation text outside the JSON) of issue objects, each with exactly these fields: \"original\" (the exact original passage as it appears in the text, copied verbatim), \"suggestion\" (the corrected replacement text), and \"explanation\" (a short explanation of the issue, written in the same language as the checked text). List issues in the order they appear in the text. If there are no issues, respond with an empty JSON array: [].";

function buildSystemPrompt(request: AiContentRequest, thinkingMode: AiThinkingMode): string {
  if (request.mode === "check") {
    const thinkingInstruction =
      thinkingMode === "off" ? " Do not output any reasoning, notes, or intermediate steps." : "";

    return CHECK_MODE_SYSTEM_PROMPT + thinkingInstruction;
  }

  const baseInstruction =
    "You are a local text tool. Respond only with plain Markdown text — no explanations, and do not wrap the entire response in a code block.";

  const noHtmlInstruction =
    "Use only Markdown syntax (e.g. blank lines for paragraphs, **bold**, _italic_, # headings, - for lists). Never use HTML tags like <p>, <br>, <div>, or <span>.";

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

  const languageOverride =
    "If the user's instruction explicitly requests a specific output language, follow that instead — it overrides the language rule above.";

  return [
    baseInstruction,
    noHtmlInstruction,
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
function resolveMaxOutputTokens(contextLength: number): number {
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

  if (request.mode === "insert") {
    contextSections.push("Important: Return only the content to be inserted.");
  } else {
    contextSections.push("Important: Return only the revised version of the marked text.");
  }

  return contextSections.join("\n\n");
}

function extractResponseContent(payload: unknown, isOllamaShape: boolean): string {
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

function extractAnthropicContent(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    throw new Error(i18n.t("aiClient.invalidResponse"));
  }

  const typedPayload = payload as { content?: Array<{ type?: string; text?: string }> };

  return (typedPayload.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
}

async function postJson(url: string, body: unknown, extraHeaders?: Record<string, string>, signal?: AbortSignal) {
  const response = await tauriFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders
    },
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok) {
    throw new Error(i18n.t("aiClient.endpointStatus", { status: response.status }));
  }

  return response.json();
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
    throw new Error(i18n.t("aiClient.endpointStatus", { status: response.status }));
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
    requestBody,
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
    requestBody,
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
// the shared streamJsonLines().
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

  const response = await tauriFetch(new URL("/v1/messages", settings.apiUrl).toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...anthropicAuthHeaders(settings.apiKey)
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

// Strips a leading/trailing ```json ... ``` (or plain ``` ... ```) fence some
// models wrap JSON output in despite the system prompt asking for raw JSON.
function stripJsonCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);

  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

function parseCheckIssues(rawResponse: string): AiCheckIssue[] {
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
      requestBody,
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
