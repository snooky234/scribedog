// Multi-step goals for the vault agent, in two modes that share one data model
// and one rendering in the chat — only the question "who writes the list" is
// answered differently:
//
//  - "auto":  a separate, tool-less planning call writes it (this file's
//             planTask / reviewPlan).
//  - "model": the model keeps the list itself through create_plan/update_plan/
//             complete_step, and the store just holds it (parsePlanToolSteps).
//
// A shared PlanStep and a shared display is what keeps the two modes from
// drifting into two features; separate data models would be the point where
// they stop looking like the same thing to the user.

import { generateAiChatStep, stripJsonCodeFence } from "@/lib/aiClient";
import { type AiSettings } from "@/store/useAiSettingsStore";

export type PlanStepStatus = "pending" | "running" | "done" | "failed";

export type PlanStep = {
  /** One line, for the chat's step list. */
  title: string;
  /** What this step is to do — the instruction the step's own loop runs with. */
  instruction: string;
  status: PlanStepStatus;
  /** One sentence on what came of it; feeds the next step's context. */
  result?: string;
};

const PLAN_STEP_STATUSES: PlanStepStatus[] = ["pending", "running", "done", "failed"];

const PLANNER_SYSTEM =
  "You break a request down into work steps and answer with nothing but JSON. You never do the work " +
  "itself and you never explain your answer.";

// How much of a long request the planner sees. What is being asked for is clear
// from the opening, and a pasted wall of text must not blow up a call whose
// whole purpose is to be cheap.
const REQUEST_EXCERPT_CHARS = 4000;

function excerpt(text: string, limit: number): string {
  const trimmed = text.trim();

  return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed;
}

/**
 * Reads a {steps:[…]} payload into PlanSteps, capped at `maxSteps`.
 *
 * Defensive throughout: this parses model output, and the answer to bad JSON is
 * the single-step path (see planTask), never an error the chat dies on.
 */
export function parsePlanSteps(raw: unknown, maxSteps: number): PlanStep[] {
  const list = Array.isArray(raw) ? raw : [];
  const steps: PlanStep[] = [];

  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }

    const candidate = entry as { title?: unknown; instruction?: unknown };
    const title = typeof candidate.title === "string" ? candidate.title.trim() : "";
    const instruction =
      typeof candidate.instruction === "string" ? candidate.instruction.trim() : "";

    // A step with neither is noise; a step with only one of them still says
    // what to do, so the missing half is filled from the other rather than
    // dropping work the model did intend.
    if (!title && !instruction) {
      continue;
    }

    steps.push({
      title: title || instruction.split(/\r?\n/, 1)[0].slice(0, 80),
      instruction: instruction || title,
      status: "pending"
    });
  }

  return steps.slice(0, Math.max(1, maxSteps));
}

/** Parses the JSON body of a planning answer. Returns null for anything unusable. */
function parsePlanPayload(text: string): Record<string, unknown> | null {
  const stripped = stripJsonCodeFence(text).trim();

  if (!stripped) {
    return null;
  }

  // Models like to wrap the object in a sentence. Falling back to the outermost
  // braces recovers the common case instead of discarding a usable plan.
  const candidates = [stripped];
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");

  if (first !== -1 && last > first) {
    candidates.push(stripped.slice(first, last + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);

      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

function planQuestion(userMessage: string, maxSteps: number, fileAccess: boolean): string {
  return [
    "A writing assistant works on the user's notes. Decide whether the request below needs to be split " +
      "into work steps.",
    "",
    `The user asked:\n"""\n${excerpt(userMessage, REQUEST_EXCERPT_CHARS)}\n"""`,
    "",
    "Answer with JSON and nothing else.",
    "",
    'If the request is a single piece of work — rewriting a passage, answering a question, shortening a ' +
      'paragraph, writing one note — answer exactly: {"steps":[]}',
    "",
    // Observed failure, and the expensive one: a planner splits "write a poem
    // into a new note" into create-the-file / compose-the-text / insert-it, and
    // the assistant duly creates an empty note, writes the text into the chat
    // twice, and only fills the file on the last step — if it gets that far.
    "Writing one note is a SINGLE step however long its text, and so is rewriting one. Creating a file " +
      "and writing what goes in it are never two steps, and neither are drafting something and then " +
      "putting it where it belongs. Steps are pieces of work on the user's notes, not the stages of " +
      "composing a text.",
    "",
    // What the assistant can actually do, spelled out. Without it the planner
    // writes steps the assistant has no tool for — "create the summary file"
    // while file access is switched off — and the turn ends in a failure the
    // user reads as a broken agent rather than as a switch they can flip.
    fileAccess
      ? "The assistant can read, create, rewrite, rename and delete notes anywhere in the vault."
      : "The assistant can ONLY change the note that is currently open in the editor. It cannot create, " +
        "rename, move or delete files, and it cannot write into any other note. Never plan a step that " +
        "does one of those — if the request needs them, answer {\"steps\":[]} and let the assistant " +
        "explain that to the user.",
    "",
    `If it genuinely takes several steps${
      fileAccess ? " (several notes, or work that has to happen in order)" : ""
    }, answer: {"steps":[{"title":"…","instruction":"…"}, …]} with between 2 and ${maxSteps} steps. ` +
      "title is one short line for the user to read; instruction is what the assistant is to do in that " +
      "step, self-contained enough to work from on its own.",
    "",
    "Do not do the work. Do not explain. Output only the JSON object."
  ].join("\n");
}

/**
 * What the planning call came back with.
 *
 * "single" and "unusable" both lead to the ordinary one-step turn, but they are
 * not the same thing and the caller has to tell them apart: "single" is the
 * normal, correct answer for most requests, while "unusable" means this model
 * cannot produce a plan at all — and paying for that call on every multi-step
 * request from then on is waste (see noPlanModels in useChatStore).
 */
export type PlanOutcome =
  | { kind: "steps"; steps: PlanStep[] }
  | { kind: "single" }
  | { kind: "unusable" };

/**
 * The "auto" mode's planning call.
 *
 * A separate request with systemOverride and `toolNames: []` — with no tools
 * offered, the model demonstrably has no way to change anything while planning.
 * A planner that creates files on the side is not a planner.
 */
export async function planTask(
  settings: AiSettings,
  userMessage: string,
  options: { maxSteps: number; fileAccess: boolean },
  signal?: AbortSignal
): Promise<PlanOutcome> {
  try {
    const step = await generateAiChatStep(
      settings,
      {
        messages: [
          { role: "user", content: planQuestion(userMessage, options.maxSteps, options.fileAccess) }
        ],
        assistantInstruction: "",
        systemOverride: PLANNER_SYSTEM,
        toolNames: []
      },
      signal
    );

    const payload = parsePlanPayload(step.text);

    if (!payload || !Array.isArray(payload.steps)) {
      return { kind: "unusable" };
    }

    const steps = parsePlanSteps(payload.steps, options.maxSteps);

    // One step is not a plan — it is the ordinary single-turn path with an
    // extra round trip and a list nobody needs.
    return steps.length >= 2 ? { kind: "steps", steps } : { kind: "single" };
  } catch {
    // Including an aborted request: the turn's own abort handling takes it from
    // here, and a planning failure must never be what the chat reports. Not
    // counted as "unusable" either — a dropped connection says nothing about
    // whether the model can plan.
    return { kind: "single" };
  }
}

export type PlanReview = { keep: true } | { keep: false; steps: PlanStep[] };

function reviewQuestion(userMessage: string, steps: PlanStep[], maxSteps: number): string {
  const done = steps
    .filter((step) => step.status === "done")
    .map((step) => `- ${step.title}${step.result ? `: ${step.result}` : ""}`);
  const remaining = steps
    .filter((step) => step.status === "pending")
    .map((step) => `- ${step.title}: ${step.instruction}`);

  return [
    "A writing assistant is working through a plan for the user's notes.",
    "",
    `The goal:\n"""\n${excerpt(userMessage, REQUEST_EXCERPT_CHARS)}\n"""`,
    "",
    `Done so far:\n${done.length > 0 ? done.join("\n") : "(nothing yet)"}`,
    "",
    `Still planned:\n${remaining.length > 0 ? remaining.join("\n") : "(nothing left)"}`,
    "",
    "Do the remaining steps still fit what has been learned?",
    "",
    'If they do, answer exactly: {"keep":true}',
    `If they do not, answer: {"keep":false,"steps":[{"title":"…","instruction":"…"}, …]} with the steps ` +
      `that should replace them (at most ${maxSteps}). Only the outstanding steps — never repeat what is done.`,
    "",
    "Output only the JSON object."
  ].join("\n");
}

/**
 * The between-steps check of the "auto" mode. Anything unusable means "keep",
 * so a model that cannot answer this simply works the plan it was given.
 */
export async function reviewPlan(
  settings: AiSettings,
  userMessage: string,
  steps: PlanStep[],
  maxSteps: number,
  signal?: AbortSignal
): Promise<PlanReview> {
  try {
    const step = await generateAiChatStep(
      settings,
      {
        messages: [{ role: "user", content: reviewQuestion(userMessage, steps, maxSteps) }],
        assistantInstruction: "",
        systemOverride: PLANNER_SYSTEM,
        toolNames: []
      },
      signal
    );

    const payload = parsePlanPayload(step.text);

    if (!payload || payload.keep !== false) {
      return { keep: true };
    }

    const next = parsePlanSteps(payload.steps, maxSteps);

    return next.length > 0 ? { keep: false, steps: next } : { keep: true };
  } catch {
    return { keep: true };
  }
}

/**
 * The context a step is run with when agentCompactContext is on: the goal, the
 * list with its statuses, and one sentence of outcome per finished step —
 * rather than every previous step's full transcript. That is what keeps the
 * window constant over ten steps instead of growing with each one.
 */
export function stepContext(userMessage: string, steps: PlanStep[], index: number): string {
  const lines = steps.map((step, at) => {
    const marker = at === index ? "→" : step.status === "done" ? "✓" : step.status === "failed" ? "✗" : "·";
    const result = step.result ? ` — ${step.result}` : "";

    return `${marker} ${at + 1}. ${step.title}${result}`;
  });

  return [
    `You are working through a plan for this request:\n"""\n${excerpt(userMessage, REQUEST_EXCERPT_CHARS)}\n"""`,
    "",
    `The plan:\n${lines.join("\n")}`,
    "",
    `Do step ${index + 1} now, and only that step:\n${steps[index].instruction}`,
    "",
    "Use your tools to do the work. Do not summarize the plan back, and do not start the next step."
  ].join("\n");
}

/** Reads a create_plan / update_plan tool argument. */
export function parsePlanToolSteps(args: Record<string, unknown>, maxSteps: number): PlanStep[] {
  return parsePlanSteps(args.steps, maxSteps);
}

/** Defensive normalization for a plan coming off disk (see chatSessions.ts). */
export function normalizePlan(raw: unknown): PlanStep[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }

  const steps: PlanStep[] = [];

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }

    const candidate = entry as Partial<PlanStep>;

    if (typeof candidate.title !== "string" || typeof candidate.instruction !== "string") {
      continue;
    }

    steps.push({
      title: candidate.title,
      instruction: candidate.instruction,
      status: PLAN_STEP_STATUSES.includes(candidate.status as PlanStepStatus)
        ? (candidate.status as PlanStepStatus)
        : "pending",
      ...(typeof candidate.result === "string" && candidate.result ? { result: candidate.result } : {})
    });
  }

  return steps.length > 0 ? steps : undefined;
}
