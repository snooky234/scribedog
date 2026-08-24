import { describe, expect, it } from "vitest";

import {
  toAnthropicMessages,
  toOpenAiCompatMessages,
  type AiChatMessage,
  type AiChatRequest
} from "./aiClient";

const IMAGE = { path: "images/photo.png", base64: "QUJD", mimeType: "image/png" };

function requestOf(messages: AiChatMessage[]): AiChatRequest {
  return { messages, assistantInstruction: "" };
}

// One get_image call, as the store records it: an assistant turn with the call,
// the text tool result, then the image on a user turn (see sendMessage in
// src/store/useChatStore.ts for why the image cannot ride in the tool result).
const IMAGE_TURN: AiChatMessage[] = [
  { role: "user", content: "what is in the picture?" },
  {
    role: "assistant",
    content: "",
    toolCalls: [{ id: "call_1", name: "get_image", arguments: { path: "images/photo.png" } }]
  },
  { role: "tool", toolCallId: "call_1", toolName: "get_image", content: "OK: the image is attached." },
  { role: "user", content: "Here is the image you requested.", imagePaths: [IMAGE.path], images: [IMAGE] }
];

describe("toOpenAiCompatMessages", () => {
  it("sends images as a flat images array for Ollama", () => {
    const [, , , , , imageTurn] = toOpenAiCompatMessages(requestOf(IMAGE_TURN), "off", true);

    expect(imageTurn).toEqual({
      role: "user",
      content: "Here is the image you requested.",
      images: [IMAGE.base64]
    });
  });

  it("sends images as text/image_url content parts for OpenAI-compatible endpoints", () => {
    const [, , , , , imageTurn] = toOpenAiCompatMessages(requestOf(IMAGE_TURN), "off", false);

    expect(imageTurn).toEqual({
      role: "user",
      content: [
        { type: "text", text: "Here is the image you requested." },
        { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } }
      ]
    });
  });

  // Mistral rejects a user turn straight after a tool result ("Unexpected role
  // 'user' after role 'tool'"), which is exactly how the image turn arrives.
  it("bridges the image turn with an assistant turn so it never follows a tool result", () => {
    for (const isOllamaShape of [true, false]) {
      const messages = toOpenAiCompatMessages(requestOf(IMAGE_TURN), "off", isOllamaShape);

      expect(messages.map((message) => message.role)).toEqual([
        "system",
        "user",
        "assistant",
        "tool",
        "assistant",
        "user"
      ]);
      expect(messages[4]).toEqual({ role: "assistant", content: "Let me take a look." });
    }
  });

  // Ollama 400s on the stringified form ("Value looks like object, but can't
  // find closing '}' symbol"), OpenAI-compatible endpoints on the object.
  it("sends tool-call arguments as an object for Ollama and as a string otherwise", () => {
    const [, , ollamaCall] = toOpenAiCompatMessages(requestOf(IMAGE_TURN), "off", true);
    const [, , openAiCall] = toOpenAiCompatMessages(requestOf(IMAGE_TURN), "off", false);

    expect(ollamaCall).toEqual({
      role: "assistant",
      content: "",
      tool_calls: [
        { id: "call_1", type: "function", function: { name: "get_image", arguments: { path: "images/photo.png" } } }
      ]
    });
    expect(openAiCall).toEqual({
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "get_image", arguments: '{"path":"images/photo.png"}' }
        }
      ]
    });
  });

  it("leaves a user turn without images as a plain string in both shapes", () => {
    const plain = requestOf([{ role: "user", content: "hello" }]);

    expect(toOpenAiCompatMessages(plain, "off", true)[1]).toEqual({ role: "user", content: "hello" });
    expect(toOpenAiCompatMessages(plain, "off", false)[1]).toEqual({ role: "user", content: "hello" });
  });
});

describe("toAnthropicMessages", () => {
  // Anthropic rejects two consecutive user turns, and the tool_result block
  // already occupies one — so the image has to join it instead of following it.
  it("merges the image into the user turn holding the tool result", () => {
    const messages = toAnthropicMessages(requestOf(IMAGE_TURN));

    expect(messages).toHaveLength(3);
    expect(messages[2]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "call_1", content: "OK: the image is attached." },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } },
        { type: "text", text: "Here is the image you requested." }
      ]
    });
  });

  it("opens its own user turn when no tool result precedes the image", () => {
    const messages = toAnthropicMessages(
      requestOf([{ role: "user", content: "look", imagePaths: [IMAGE.path], images: [IMAGE] }])
    );

    expect(messages).toEqual([
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } },
          { type: "text", text: "look" }
        ]
      }
    ]);
  });

  it("keeps a user turn without images a plain string", () => {
    expect(toAnthropicMessages(requestOf([{ role: "user", content: "hello" }]))).toEqual([
      { role: "user", content: "hello" }
    ]);
  });
});
