// Recovers a tool call a model wrote into its answer text instead of sending it
// as a tool call.
//
// Not a convenience: a small local model that has seen a few thousand agent
// transcripts reproduces the *shape* of a call from memory and prints it as
// JSON, usually in a ```json fence, while the tool-call channel of the request
// stays empty. The turn then ends with the model announcing "I have written it
// into the file" and nothing whatsoever having happened — the failure that is
// impossible for the user to tell apart from a real edit, because the reply
// says the same thing either way.
//
// gemma-4-E4B does this on roughly every other turn (the same model the
// Mermaid repair in agentTools.ts was written for). The alternative to
// recovering the call is the safety net in pendingSuggestion.ts, which costs a
// second full request — 22 seconds on that model, during which the turn already
// looks finished — and then answers "none" anyway, because the reply it is
// asked to judge is a JSON blob rather than prose it can classify.
//
// What is NOT done here: inventing arguments, or accepting a call whose name is
// not a real tool. A recovered call goes through exactly the same dispatch,
// alias resolution and consent gates as one that arrived properly (see
// canonicalToolName and setAgentCapabilities) — this only changes where the
// call was read from, never what it is allowed to do.

import type { ToolCall } from "@/lib/aiClient";

/** The shapes models print. Every one of these was seen in a real transcript. */
const NAME_KEYS = ["tool_name", "tool", "name", "function", "function_name", "action"];
const ARGUMENT_KEYS = ["params", "parameters", "arguments", "args", "input", "tool_input"];

// A fenced block, with or without a language tag. The JSON is taken from the
// first fence that parses — a model that prints two of them has usually written
// the call once and then an example.
const FENCE_PATTERN = /```(?:json|tool_code|tool_call|python)?\s*\n([\s\S]*?)```/g;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Pulls the tool name out of a printed call. Accepts both the flat shape
 * ({tool_name, params}) and OpenAI's nested one ({function: {name, arguments}}),
 * because models reproduce whichever they saw more of.
 */
function readName(record: Record<string, unknown>): string | null {
  for (const key of NAME_KEYS) {
    const value = record[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    // {"function": {"name": "...", "arguments": {...}}}
    const nested = asRecord(value);

    if (nested && typeof nested.name === "string" && nested.name.trim()) {
      return nested.name.trim();
    }
  }

  return null;
}

function readArguments(record: Record<string, unknown>): Record<string, unknown> {
  for (const key of ARGUMENT_KEYS) {
    const direct = asRecord(record[key]);

    if (direct) {
      return direct;
    }

    // Arguments as a JSON *string*, which is how OpenAI puts them on the wire
    // and therefore how a model reproduces them.
    if (typeof record[key] === "string") {
      try {
        const parsed = asRecord(JSON.parse(record[key] as string));

        if (parsed) {
          return parsed;
        }
      } catch {
        // Not JSON after all — fall through to the next key.
      }
    }
  }

  // The nested shape carries its arguments inside the function object.
  for (const key of NAME_KEYS) {
    const nested = asRecord(record[key]);

    if (nested) {
      const nestedArgs = readArguments(nested);

      if (Object.keys(nestedArgs).length > 0) {
        return nestedArgs;
      }
    }
  }

  // A call printed with its arguments spread across the top level
  // ({"tool_name": "insert_at_cursor", "text": "..."}) — the remaining keys are
  // the arguments.
  const rest: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (!NAME_KEYS.includes(key) && !ARGUMENT_KEYS.includes(key)) {
      rest[key] = value;
    }
  }

  return rest;
}

/** Every JSON object a text carries, fenced ones first. */
function candidateObjects(text: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];

  for (const match of text.matchAll(FENCE_PATTERN)) {
    try {
      const record = asRecord(JSON.parse(match[1].trim()));

      if (record) {
        found.push(record);
      }
    } catch {
      // Not JSON: a prose or code fence, which is the normal case.
    }
  }

  if (found.length > 0) {
    return found;
  }

  // Unfenced, which smaller models also do. Only a text that is *nothing but*
  // the object is accepted: scanning prose for brace pairs would turn a reply
  // that merely quotes JSON into a tool call.
  const trimmed = text.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const record = asRecord(JSON.parse(trimmed));

      if (record) {
        found.push(record);
      }
    } catch {
      // Malformed: leave it as text.
    }
  }

  return found;
}

export type RecoveredToolCall = {
  call: ToolCall;
  /** The answer with the printed call removed, so the chat shows prose only. */
  text: string;
};

/**
 * Reads a tool call out of an answer's text.
 *
 * `isKnownTool` is passed in rather than imported so this module stays free of
 * the tool registry (and of the import cycle that would come with it). It is
 * the gate that keeps prose from becoming a call: a JSON object naming
 * something that is not an offered tool is left in the text, where the existing
 * "invented tool" handling deals with it.
 */
export function recoverInlineToolCall(
  text: string,
  isKnownTool: (name: string) => boolean
): RecoveredToolCall | null {
  if (!text.includes("{")) {
    return null;
  }

  for (const record of candidateObjects(text)) {
    const name = readName(record);

    if (!name || !isKnownTool(name)) {
      continue;
    }

    const args = readArguments(record);

    // A call with no arguments at all is not one worth running: every writing
    // tool needs at least its text, and a bare {"tool_name": "..."} is a model
    // describing what it would do.
    if (Object.keys(args).length === 0) {
      continue;
    }

    return {
      call: { id: `recovered-${Date.now()}`, name, arguments: args },
      text: stripPrintedCall(text)
    };
  }

  return null;
}

/**
 * Removes the printed call from the answer. What is left is the sentence the
 * model wrote around it ("I have inserted the text …"), which is what the chat
 * should show — the call itself is about to be run, and showing its JSON as
 * well would tell the user twice, once unreadably.
 */
function stripPrintedCall(text: string): string {
  const withoutFences = text.replace(FENCE_PATTERN, "").trim();

  if (withoutFences) {
    return withoutFences;
  }

  // The whole answer was the call: the tool's own status line in the transcript
  // is what tells the user what happened, so no text is the honest answer here.
  return "";
}
