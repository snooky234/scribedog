import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiChatRequest } from "./aiClient";
import type { AiSettings } from "@/store/useAiSettingsStore";

// The module under test talks to the endpoint through Tauri's http plugin,
// which has no implementation outside the app shell.
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: fetchMock }));

const { streamAiChatStep } = await import("./aiClient");

/**
 * A streaming Response whose body arrives in exactly these pieces.
 *
 * The split points are the interesting part: real endpoints cut the stream at
 * byte boundaries that have nothing to do with line ends, so several tests
 * below deliberately break a line in half to check it still gets read whole.
 */
function streamResponse(pieces: string[]): Response {
  const encoder = new TextEncoder();
  let index = 0;

  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          index < pieces.length
            ? { done: false, value: encoder.encode(pieces[index++]) }
            : { done: true, value: undefined },
        releaseLock: () => {}
      })
    }
  } as unknown as Response;
}

function jsonResponse(payload: unknown): Response {
  return { ok: true, status: 200, json: async () => payload } as unknown as Response;
}

/** What an endpoint answers when it refuses the request outright. */
function errorResponse(payload: unknown, status = 400): Response {
  return { ok: false, status, json: async () => payload } as unknown as Response;
}

/** A stream that delivers its pieces and then breaks off mid-answer. */
function brokenStreamResponse(pieces: string[], message: string): Response {
  const encoder = new TextEncoder();
  let index = 0;

  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          if (index < pieces.length) {
            return { done: false, value: encoder.encode(pieces[index++]) };
          }

          throw new Error(message);
        },
        releaseLock: () => {}
      })
    }
  } as unknown as Response;
}

const OLLAMA: AiSettings = {
  provider: "ollama",
  apiUrl: "http://localhost:11434",
  apiKey: "",
  model: "qwen3",
  contextLength: 8192,
  thinkingMode: "default"
};

const OPENAI: AiSettings = {
  provider: "openai",
  apiUrl: "https://api.openai.com",
  apiKey: "sk-test",
  model: "gpt-4o",
  contextLength: 8192,
  thinkingMode: "off"
};

const ANTHROPIC: AiSettings = {
  provider: "anthropic",
  apiUrl: "https://api.anthropic.com",
  apiKey: "sk-ant-test",
  model: "claude-opus-5",
  contextLength: 8192,
  thinkingMode: "off"
};

const REQUEST: AiChatRequest = {
  messages: [{ role: "user", content: "what is in my notes about otters?" }],
  assistantInstruction: ""
};

// The shape the agent loop sends after get_image resolved a picture: the image
// rides on a user turn of its own, following the tool results that produced it.
const IMAGE_REQUEST: AiChatRequest = {
  messages: [
    { role: "user", content: "how could the poem be improved?" },
    {
      role: "user",
      content: "Here is the image you requested (images/mouse.png). Look at it and answer my question.",
      imagePaths: ["images/mouse.png"],
      images: [{ path: "images/mouse.png", base64: "aW1n", mimeType: "image/png" }]
    }
  ],
  assistantInstruction: ""
};

function requestBodyOf(call: number) {
  return JSON.parse((fetchMock.mock.calls[call][1] as { body: string }).body);
}

// Collects everything the panel would have shown while the step ran.
function recorder() {
  const text: string[] = [];
  const thinking: string[] = [];
  const toolCalls: string[] = [];

  return {
    text,
    thinking,
    toolCalls,
    handlers: {
      onText: (chunk: string) => text.push(chunk),
      onThinking: (chunk: string) => thinking.push(chunk),
      onToolCall: (name: string) => toolCalls.push(name)
    }
  };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("streamAiChatStep — OpenAI-compatible", () => {
  it("streams answer text and reassembles a tool call split across chunks", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        'data: {"choices":[{"delta":{"content":"Let me "}}]}\n',
        'data: {"choices":[{"delta":{"content":"look."}}]}\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"search_vault","arguments":"{\\"query\\":"}}]}}]}\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"otters\\"}"}}]}}]}\n',
        "data: [DONE]\n"
      ])
    );

    const seen = recorder();
    const step = await streamAiChatStep(OPENAI, REQUEST, seen.handlers);

    expect(seen.text.join("")).toBe("Let me look.");
    expect(step.text).toBe("Let me look.");
    expect(step.toolCalls).toEqual([
      { id: "call_1", name: "search_vault", arguments: { query: "otters" } }
    ]);
  });

  // The name is what the chat turns into "searching your notes …", so it has to
  // be reported while the arguments are still arriving — not once they are in.
  it("announces a tool call as soon as its name arrives", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_note","arguments":""}}]}}]}\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":\\"a.md\\"}"}}]}}]}\n'
      ])
    );

    const seen = recorder();
    await streamAiChatStep(OPENAI, REQUEST, seen.handlers);

    expect(seen.toolCalls).toEqual(["read_note"]);
  });

  it("keeps parallel tool calls apart by their index", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"a","function":{"name":"read_note","arguments":"{\\"path\\":"}},{"index":1,"id":"b","function":{"name":"read_note","arguments":"{\\"path\\":"}}]}}]}\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"function":{"arguments":"\\"second.md\\"}"}}]}}]}\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"first.md\\"}"}}]}}]}\n'
      ])
    );

    const step = await streamAiChatStep(OPENAI, REQUEST, recorder().handlers);

    expect(step.toolCalls).toEqual([
      { id: "a", name: "read_note", arguments: { path: "first.md" } },
      { id: "b", name: "read_note", arguments: { path: "second.md" } }
    ]);
  });

  it("reads a line that the transport split in half", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse(['data: {"choices":[{"delta":{"con', 'tent":"whole"}}]}\n'])
    );

    const seen = recorder();
    const step = await streamAiChatStep(OPENAI, REQUEST, seen.handlers);

    expect(step.text).toBe("whole");
    expect(seen.text.join("")).toBe("whole");
  });

  it("reports reasoning tokens separately from the answer", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        'data: {"choices":[{"delta":{"reasoning_content":"hmm"}}]}\n',
        'data: {"choices":[{"delta":{"content":"Yes."}}]}\n'
      ])
    );

    const seen = recorder();
    const step = await streamAiChatStep(OPENAI, REQUEST, seen.handlers);

    expect(seen.thinking).toEqual(["hmm"]);
    expect(step.text).toBe("Yes.");
  });

  // Some local backends accept `stream: true` alongside `tools` and then send
  // nothing at all; a silent empty bubble would look like the model had no
  // answer, so the step is retried without streaming.
  it("falls back to a non-streaming step when the stream yields nothing", async () => {
    fetchMock
      .mockResolvedValueOnce(streamResponse(["data: [DONE]\n"]))
      .mockResolvedValueOnce(
        jsonResponse({ choices: [{ message: { content: "answered without streaming" } }] })
      );

    const step = await streamAiChatStep(OPENAI, REQUEST, recorder().handlers);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(step.text).toBe("answered without streaming");
  });

  it("sends the same tools with stream turned on", async () => {
    fetchMock.mockResolvedValueOnce(streamResponse(['data: {"choices":[{"delta":{"content":"hi"}}]}\n']));

    await streamAiChatStep(OPENAI, REQUEST, recorder().handlers);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);

    expect(body.stream).toBe(true);
    expect(body.tools.length).toBeGreaterThan(0);
  });
});

describe("streamAiChatStep — Ollama", () => {
  it("splits <think> blocks out of the answer as they stream", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        '{"message":{"content":"<think>the user asks"}}\n',
        '{"message":{"content":" about otters</think>They swim."}}\n',
        '{"message":{"content":""},"done":true}\n'
      ])
    );

    const seen = recorder();
    const step = await streamAiChatStep(OLLAMA, REQUEST, seen.handlers);

    expect(step.text).toBe("They swim.");
    expect(seen.text.join("")).toBe("They swim.");
    expect(seen.thinking.join("")).toContain("the user asks about otters");
  });

  // Ollama sends finished calls with object arguments and no id of its own.
  it("takes whole tool calls and invents the missing id", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        '{"message":{"content":"","tool_calls":[{"function":{"name":"search_vault","arguments":{"query":"otters"}}}]}}\n'
      ])
    );

    const seen = recorder();
    const step = await streamAiChatStep(OLLAMA, REQUEST, seen.handlers);

    expect(seen.toolCalls).toEqual(["search_vault"]);
    expect(step.toolCalls).toHaveLength(1);
    expect(step.toolCalls[0].name).toBe("search_vault");
    expect(step.toolCalls[0].arguments).toEqual({ query: "otters" });
    expect(step.toolCalls[0].id).toBeTruthy();
  });

  it("reads the last payload of a stream that ends without a newline", async () => {
    fetchMock.mockResolvedValueOnce(streamResponse(['{"message":{"content":"tail"},"done":true}']));

    const step = await streamAiChatStep(OLLAMA, REQUEST, recorder().handlers);

    expect(step.text).toBe("tail");
  });
});

describe("streamAiChatStep — Anthropic", () => {
  it("assembles a tool_use block from its input_json_delta run", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        'event: content_block_start\ndata: {"index":0,"content_block":{"type":"text","text":""}}\n',
        'event: content_block_delta\ndata: {"index":0,"delta":{"type":"text_delta","text":"Looking."}}\n',
        'event: content_block_start\ndata: {"index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"read_note"}}\n',
        'event: content_block_delta\ndata: {"index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":"}}\n',
        'event: content_block_delta\ndata: {"index":1,"delta":{"type":"input_json_delta","partial_json":"\\"notes/a.md\\"}"}}\n',
        "event: message_stop\ndata: {}\n"
      ])
    );

    const seen = recorder();
    const step = await streamAiChatStep(ANTHROPIC, REQUEST, seen.handlers);

    expect(step.text).toBe("Looking.");
    expect(seen.toolCalls).toEqual(["read_note"]);
    expect(step.toolCalls).toEqual([
      { id: "toolu_1", name: "read_note", arguments: { path: "notes/a.md" } }
    ]);
  });

  it("routes thinking_delta to the reasoning handler", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        'event: content_block_delta\ndata: {"index":0,"delta":{"type":"thinking_delta","thinking":"weighing it up"}}\n',
        'event: content_block_delta\ndata: {"index":1,"delta":{"type":"text_delta","text":"Done."}}\n'
      ])
    );

    const seen = recorder();
    const step = await streamAiChatStep(ANTHROPIC, REQUEST, seen.handlers);

    expect(seen.thinking).toEqual(["weighing it up"]);
    expect(step.text).toBe("Done.");
  });

  it("surfaces an error event as a thrown error", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse(['event: error\ndata: {"error":{"message":"overloaded"}}\n'])
    );

    await expect(streamAiChatStep(ANTHROPIC, REQUEST, recorder().handlers)).rejects.toThrow(
      "overloaded"
    );
  });
});

// A picture in the open document must not cost the user the answer: a model
// without vision rejects the whole request rather than ignoring the image, so
// the step goes out again without it. See IMAGE_UNSUPPORTED_NOTE.
describe("streamAiChatStep — models without vision", () => {
  it("retries without the image when the endpoint rejects image input", async () => {
    fetchMock
      .mockResolvedValueOnce(
        errorResponse({
          error: {
            message:
              "image input is not supported - hint: if this is unexpected, you may need to provide the mmproj"
          }
        })
      )
      .mockResolvedValueOnce(
        streamResponse(['data: {"choices":[{"delta":{"content":"I cannot see images."}}]}\n'])
      );

    const step = await streamAiChatStep(OPENAI, IMAGE_REQUEST, recorder().handlers);

    expect(step.text).toBe("I cannot see images.");
    expect(step.imagesDropped).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const retried = requestBodyOf(1);
    const imageTurn = retried.messages[retried.messages.length - 1];

    // Plain text again, no image_url part — and the model is told why.
    expect(typeof imageTurn.content).toBe("string");
    expect(imageTurn.content).toContain("cannot process images");
    expect(JSON.stringify(retried)).not.toContain("aW1n");
  });

  it("drops the flat images field for the Ollama shape too", async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse({ error: "model does not support images" }))
      .mockResolvedValueOnce(streamResponse(['{"message":{"content":"no picture here"}}\n']));

    const step = await streamAiChatStep(OLLAMA, IMAGE_REQUEST, recorder().handlers);

    expect(step.imagesDropped).toBe(true);

    const retried = requestBodyOf(1);

    expect(retried.messages[retried.messages.length - 1].images).toBeUndefined();
  });

  it("takes the images out of an Anthropic content array", async () => {
    fetchMock
      .mockResolvedValueOnce(
        errorResponse({
          error: { message: "messages.1.content.0.image: image content blocks are not supported by this model" }
        })
      )
      .mockResolvedValueOnce(
        streamResponse([
          'event: content_block_delta\ndata: {"index":0,"delta":{"type":"text_delta","text":"Text only."}}\n'
        ])
      );

    const step = await streamAiChatStep(ANTHROPIC, IMAGE_REQUEST, recorder().handlers);

    expect(step.text).toBe("Text only.");
    expect(step.imagesDropped).toBe(true);
    expect(JSON.stringify(requestBodyOf(1))).not.toContain("aW1n");
  });

  // Only an image rejection is worth a second request; every other failure is
  // the user's to see, and retrying it would just double the wait.
  it("lets an unrelated error through untouched", async () => {
    fetchMock.mockResolvedValueOnce(
      errorResponse({ error: { message: "context length exceeded" } })
    );

    await expect(streamAiChatStep(OPENAI, IMAGE_REQUEST, recorder().handlers)).rejects.toThrow(
      "context length exceeded"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // A model that wrote half an answer and only then failed would have that half
  // written a second time by the retry.
  it("does not retry once the answer has started streaming", async () => {
    fetchMock.mockResolvedValueOnce(
      brokenStreamResponse(
        ['data: {"choices":[{"delta":{"content":"The mouse "}}]}\n'],
        "image input is not supported"
      )
    );

    await expect(streamAiChatStep(OPENAI, IMAGE_REQUEST, recorder().handlers)).rejects.toThrow(
      "image input is not supported"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("leaves a request without images on the single request it needs", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse(['data: {"choices":[{"delta":{"content":"hi"}}]}\n'])
    );

    const step = await streamAiChatStep(OPENAI, REQUEST, recorder().handlers);

    expect(step.imagesDropped).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
