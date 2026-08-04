import { describe, expect, it, vi } from "vitest";

import { defaultAiSettings } from "@/store/useAiSettingsStore";

// planTask/reviewPlan ask the model one extra question; only that call is
// mocked, so the parsing and the fallbacks around it are the real thing.
const { generateAiChatStep } = vi.hoisted(() => ({ generateAiChatStep: vi.fn() }));

vi.mock("@/lib/aiClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/aiClient")>("@/lib/aiClient");

  return { ...actual, generateAiChatStep };
});

const { normalizePlan, parsePlanSteps, planTask, reviewPlan, stepContext } = await import("./agentPlan");

function answer(text: string) {
  return { text, toolCalls: [], imagesDropped: false };
}

describe("parsePlanSteps", () => {
  it("reads title and instruction", () => {
    expect(
      parsePlanSteps([{ title: "Sammeln", instruction: "Alle Notizen zu X lesen" }], 15)
    ).toEqual([{ title: "Sammeln", instruction: "Alle Notizen zu X lesen", status: "pending" }]);
  });

  // A step with only one of the two still says what to do; dropping it would
  // throw away work the model did intend.
  it("fills a missing half from the other", () => {
    expect(parsePlanSteps([{ instruction: "Index.md verlinken" }], 15)[0]).toMatchObject({
      title: "Index.md verlinken",
      instruction: "Index.md verlinken"
    });
    expect(parsePlanSteps([{ title: "Aufräumen" }], 15)[0]).toMatchObject({
      title: "Aufräumen",
      instruction: "Aufräumen"
    });
  });

  it("skips junk entries", () => {
    expect(parsePlanSteps([null, 42, {}, "nope", { title: "Echt" }], 15)).toHaveLength(1);
  });

  it("caps at maxSteps", () => {
    const many = Array.from({ length: 30 }, (_, index) => ({ title: `S${index}`, instruction: "x" }));

    expect(parsePlanSteps(many, 5)).toHaveLength(5);
  });

  it("answers with nothing for a non-array", () => {
    expect(parsePlanSteps(undefined, 15)).toEqual([]);
    expect(parsePlanSteps("steps", 15)).toEqual([]);
  });
});

describe("planTask", () => {
  it("reads a plain JSON object", async () => {
    generateAiChatStep.mockResolvedValueOnce(
      answer('{"steps":[{"title":"A","instruction":"a"},{"title":"B","instruction":"b"}]}')
    );

    const outcome = await planTask(defaultAiSettings, "tu etwas grosses", {
      maxSteps: 15,
      fileAccess: true
    });

    expect(outcome.kind).toBe("steps");
    expect(outcome.kind === "steps" && outcome.steps).toHaveLength(2);
  });

  it("strips a code fence", async () => {
    generateAiChatStep.mockResolvedValueOnce(
      answer('```json\n{"steps":[{"title":"A","instruction":"a"},{"title":"B","instruction":"b"}]}\n```')
    );

    expect((await planTask(defaultAiSettings, "x", { maxSteps: 15, fileAccess: true })).kind).toBe("steps");
  });

  // Models like to wrap the object in a sentence; recovering the braces beats
  // throwing a usable plan away.
  it("recovers an object embedded in prose", async () => {
    generateAiChatStep.mockResolvedValueOnce(
      answer('Sure! Here you go: {"steps":[{"title":"A","instruction":"a"},{"title":"B","instruction":"b"}]} Hope that helps.')
    );

    expect((await planTask(defaultAiSettings, "x", { maxSteps: 15, fileAccess: true })).kind).toBe("steps");
  });

  it("treats an empty list as a single-step request", async () => {
    generateAiChatStep.mockResolvedValueOnce(answer('{"steps":[]}'));

    expect((await planTask(defaultAiSettings, "kürze das", { maxSteps: 15, fileAccess: true })).kind).toBe(
      "single"
    );
  });

  // One step is not a plan — it is the ordinary turn with an extra round trip.
  it("treats a one-step list as a single-step request", async () => {
    generateAiChatStep.mockResolvedValueOnce(answer('{"steps":[{"title":"A","instruction":"a"}]}'));

    expect((await planTask(defaultAiSettings, "x", { maxSteps: 15, fileAccess: true })).kind).toBe("single");
  });

  // "unusable" is what drives the self-disable, so it must not fire for a model
  // that answered correctly.
  it("reports unparsable output as unusable", async () => {
    generateAiChatStep.mockResolvedValueOnce(answer("Ich würde das so machen: zuerst …"));

    expect((await planTask(defaultAiSettings, "x", { maxSteps: 15, fileAccess: true })).kind).toBe(
      "unusable"
    );
  });

  it("caps the plan at maxSteps", async () => {
    const many = Array.from({ length: 40 }, (_, index) => ({ title: `S${index}`, instruction: "x" }));
    generateAiChatStep.mockResolvedValueOnce(answer(JSON.stringify({ steps: many })));

    const outcome = await planTask(defaultAiSettings, "x", { maxSteps: 6, fileAccess: true });

    expect(outcome.kind === "steps" && outcome.steps).toHaveLength(6);
  });

  // A failed extra request must never be what the chat reports, and says
  // nothing about whether the model can plan.
  it("falls back to single on a request failure", async () => {
    generateAiChatStep.mockRejectedValueOnce(new Error("network"));

    expect((await planTask(defaultAiSettings, "x", { maxSteps: 15, fileAccess: true })).kind).toBe("single");
  });

  it("offers the planner no tools at all", async () => {
    generateAiChatStep.mockResolvedValueOnce(answer('{"steps":[]}'));

    await planTask(defaultAiSettings, "x", { maxSteps: 15, fileAccess: true });

    expect(generateAiChatStep).toHaveBeenLastCalledWith(
      defaultAiSettings,
      expect.objectContaining({ toolNames: [] }),
      undefined
    );
  });
});

describe("reviewPlan", () => {
  const steps = parsePlanSteps(
    [
      { title: "A", instruction: "a" },
      { title: "B", instruction: "b" }
    ],
    15
  );

  it("keeps the plan on {keep:true}", async () => {
    generateAiChatStep.mockResolvedValueOnce(answer('{"keep":true}'));

    expect(await reviewPlan(defaultAiSettings, "x", steps, 15)).toEqual({ keep: true });
  });

  it("replaces the outstanding steps on {keep:false}", async () => {
    generateAiChatStep.mockResolvedValueOnce(
      answer('{"keep":false,"steps":[{"title":"C","instruction":"c"}]}')
    );

    const review = await reviewPlan(defaultAiSettings, "x", steps, 15);

    expect(review.keep).toBe(false);
    expect(review.keep === false && review.steps).toHaveLength(1);
  });

  it("keeps the plan when the answer is unusable", async () => {
    generateAiChatStep.mockResolvedValueOnce(answer("hmm"));

    expect(await reviewPlan(defaultAiSettings, "x", steps, 15)).toEqual({ keep: true });
  });
});

describe("stepContext", () => {
  it("carries the goal, the list with its statuses and each finished step's result", () => {
    const steps = parsePlanSteps(
      [
        { title: "Sammeln", instruction: "lesen" },
        { title: "Schreiben", instruction: "schreiben" }
      ],
      15
    );
    steps[0] = { ...steps[0], status: "done", result: "Drei Notizen gefunden." };

    const context = stepContext("Bau eine Zusammenfassung", steps, 1);

    expect(context).toContain("Bau eine Zusammenfassung");
    expect(context).toContain("Drei Notizen gefunden.");
    expect(context).toContain("schreiben");
    expect(context).toContain("step 2");
  });
});

describe("normalizePlan", () => {
  it("drops entries without title or instruction", () => {
    expect(normalizePlan([{ title: "A" }, { title: "B", instruction: "b" }])).toHaveLength(1);
  });

  it("falls back to pending for an unknown status", () => {
    expect(normalizePlan([{ title: "A", instruction: "a", status: "weird" }])?.[0].status).toBe("pending");
  });

  // Sessions written before plans existed have none, and must reopen unchanged.
  it("answers undefined for anything that is not a list", () => {
    expect(normalizePlan(undefined)).toBeUndefined();
    expect(normalizePlan([])).toBeUndefined();
    expect(normalizePlan("plan")).toBeUndefined();
  });
});
