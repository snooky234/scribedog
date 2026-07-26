import { join } from "@tauri-apps/api/path";
import { exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

import type { AiChatMessage, AiChatRole, ChatUserAction, ToolCall } from "@/lib/aiClient";
import { VAULT_META_DIR_NAME } from "@/lib/fileSystem";

export type ChatSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  // The assistant the session was started with (for display/context); the
  // active assistant at send time still governs each turn.
  assistantId: string;
  messages: AiChatMessage[];
};

const SESSIONS_FILE_NAME = "chat-sessions.json";

// FIFO cap: only the most recently updated sessions are kept, on disk and in
// memory. Older ones fall off the end.
export const MAX_SESSIONS = 100;

async function vaultMetaDirPath(folderPath: string): Promise<string> {
  return join(folderPath, VAULT_META_DIR_NAME);
}

const CHAT_ROLES: AiChatRole[] = ["user", "assistant", "tool"];

const CHAT_USER_ACTIONS: ChatUserAction[] = ["applyToDocument"];

function normalizeToolCall(raw: unknown): ToolCall | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const candidate = raw as { id?: unknown; name?: unknown; arguments?: unknown };

  if (typeof candidate.id !== "string" || typeof candidate.name !== "string") {
    return null;
  }

  const args =
    typeof candidate.arguments === "object" && candidate.arguments !== null
      ? (candidate.arguments as Record<string, unknown>)
      : {};

  return { id: candidate.id, name: candidate.name, arguments: args };
}

// Defensive by design: v1 sessions on disk only ever have user/assistant
// messages with plain content and must keep loading unchanged, while v2
// sessions can additionally carry a "tool" role and toolCalls on assistant
// turns. Anything that doesn't match a known shape is dropped rather than
// rejecting the whole session.
function normalizeMessage(raw: unknown): AiChatMessage | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const candidate = raw as {
    role?: unknown;
    content?: unknown;
    toolCalls?: unknown;
    toolCallId?: unknown;
    toolName?: unknown;
    imagePaths?: unknown;
    action?: unknown;
    selection?: unknown;
    suggestsEdit?: unknown;
  };

  if (typeof candidate.role !== "string" || !(CHAT_ROLES as string[]).includes(candidate.role)) {
    return null;
  }

  if (candidate.role === "tool") {
    if (
      typeof candidate.content !== "string" ||
      typeof candidate.toolCallId !== "string" ||
      typeof candidate.toolName !== "string"
    ) {
      return null;
    }

    return {
      role: "tool",
      toolCallId: candidate.toolCallId,
      toolName: candidate.toolName,
      content: candidate.content
    };
  }

  if (typeof candidate.content !== "string") {
    return null;
  }

  if (candidate.role === "assistant") {
    const toolCalls = Array.isArray(candidate.toolCalls)
      ? candidate.toolCalls.map(normalizeToolCall).filter((call): call is ToolCall => call !== null)
      : undefined;

    // A session written before the flag existed simply has no flag — its
    // replies reopen without an "apply" button, which is the safe default.
    return {
      role: "assistant",
      content: candidate.content,
      ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
      ...(candidate.suggestsEdit === true ? { suggestsEdit: true } : {})
    };
  }

  // Only the paths are stored, never the base64 payload — a reopened session
  // re-reads each image from disk when it is sent again (see attachImageData).
  const imagePaths = Array.isArray(candidate.imagePaths)
    ? candidate.imagePaths.filter((path): path is string => typeof path === "string" && path.length > 0)
    : undefined;

  // A session written before action turns existed simply has no flag — those
  // turns keep rendering as the plain user bubble they were saved as.
  const action = (CHAT_USER_ACTIONS as string[]).includes(candidate.action as string)
    ? (candidate.action as ChatUserAction)
    : undefined;

  // The editor passage the turn was asked about, if any — see
  // src/lib/chat/selectionContext.ts.
  const selection =
    typeof candidate.selection === "string" && candidate.selection.trim() ? candidate.selection : undefined;

  return {
    role: "user",
    content: candidate.content,
    ...(action ? { action } : {}),
    ...(selection ? { selection } : {}),
    ...(imagePaths && imagePaths.length > 0 ? { imagePaths } : {})
  };
}

function normalizeSession(raw: unknown): ChatSession | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const candidate = raw as Partial<ChatSession> & { messages?: unknown };

  if (typeof candidate.id !== "string" || !candidate.id) {
    return null;
  }

  const messages = Array.isArray(candidate.messages)
    ? candidate.messages
        .map(normalizeMessage)
        .filter((message): message is AiChatMessage => message !== null)
    : [];

  const now = Date.now();

  return {
    id: candidate.id,
    title: typeof candidate.title === "string" ? candidate.title : "",
    createdAt: typeof candidate.createdAt === "number" ? candidate.createdAt : now,
    updatedAt: typeof candidate.updatedAt === "number" ? candidate.updatedAt : now,
    assistantId: typeof candidate.assistantId === "string" ? candidate.assistantId : "default",
    messages
  };
}

// Newest-first, capped at MAX_SESSIONS. Used both on read and write so the two
// sides can never diverge.
export function orderAndCapSessions(sessions: ChatSession[]): ChatSession[] {
  return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SESSIONS);
}

export async function readSessions(folderPath: string): Promise<ChatSession[]> {
  try {
    const filePath = await join(await vaultMetaDirPath(folderPath), SESSIONS_FILE_NAME);

    if (!(await exists(filePath))) {
      return [];
    }

    const parsed: unknown = JSON.parse(await readTextFile(filePath));

    if (!Array.isArray(parsed)) {
      return [];
    }

    const sessions = parsed
      .map(normalizeSession)
      .filter((session): session is ChatSession => session !== null);

    return orderAndCapSessions(sessions);
  } catch {
    return [];
  }
}

export async function writeSessions(folderPath: string, sessions: ChatSession[]): Promise<void> {
  const dirPath = await vaultMetaDirPath(folderPath);
  await mkdir(dirPath, { recursive: true });
  await writeTextFile(
    await join(dirPath, SESSIONS_FILE_NAME),
    JSON.stringify(orderAndCapSessions(sessions), null, 2)
  );
}
