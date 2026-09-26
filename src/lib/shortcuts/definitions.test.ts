import { describe, expect, it } from "vitest";

import { requiresAiFeatures, SHORTCUT_DEFINITIONS } from "@/lib/shortcuts/definitions";

describe("requiresAiFeatures", () => {
  it("covers the actions that talk to a language model", () => {
    for (const id of ["toggleChat", "newChat", "aiEditDialog", "aiVoiceDialog", "aiCheckDialog"] as const) {
      expect(requiresAiFeatures(id)).toBe(true);
    }
  });

  it("leaves dictation alone, which runs on the local speech model", () => {
    expect(requiresAiFeatures("dictation")).toBe(false);
  });

  it("only ever hides actions from the AI category", () => {
    const hidden = SHORTCUT_DEFINITIONS.filter((definition) => requiresAiFeatures(definition.id));

    expect(hidden.every((definition) => definition.category === "ai")).toBe(true);
  });
});
