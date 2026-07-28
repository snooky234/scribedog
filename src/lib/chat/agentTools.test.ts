import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  beginChatTurn,
  executeTool,
  pendingProposalTurnNote,
  proposeComposedText,
  registerEditorToolBridge,
  type EditorToolBridge
} from "./agentTools";

// Everything a weak local model tends to send instead of the documented
// argument shape ends up in resizeImage's parsing — that is what these tests
// pin down, alongside the guard that keeps replace_passage from being pointed
// at an image (its markdown is not part of the document's text, so no text
// search can ever find it).

const setImageWidth = vi.fn<EditorToolBridge["setImageWidth"]>(() => ({
  src: "images/photo.png",
  width: 300,
  previousWidth: 219
}));

const proposePassageReplacement = vi.fn<EditorToolBridge["proposePassageReplacement"]>(() => "proposed");
const proposeInsertion = vi.fn<EditorToolBridge["proposeInsertion"]>(() => "proposed");
const listPendingProposals = vi.fn<EditorToolBridge["listPendingProposals"]>(() => []);
const acceptPendingProposals = vi.fn<EditorToolBridge["acceptPendingProposals"]>(() => 0);
const discardPendingProposals = vi.fn<EditorToolBridge["discardPendingProposals"]>(() => 0);

function registerBridge(sources: string[] = ["images/photo.png"], document = "Hello") {
  registerEditorToolBridge({
    getDocument: () => document,
    getSelection: () => "",
    listImageSources: () => sources,
    listPendingProposals,
    acceptPendingProposals,
    discardPendingProposals,
    proposeSelectionReplacement: () => "proposed",
    proposeInsertion,
    proposePassageReplacement,
    setImageWidth
  });
}

// Puts the module into the state a turn starts in: `open` is what the editor
// still has waiting for review from an earlier turn.
function startTurn(open: string[] = []) {
  listPendingProposals.mockReturnValue(open);
  beginChatTurn();
}

beforeEach(() => {
  setImageWidth.mockClear();
  proposePassageReplacement.mockClear();
  proposeInsertion.mockClear();
  listPendingProposals.mockClear();
  listPendingProposals.mockReturnValue([]);
  acceptPendingProposals.mockClear();
  acceptPendingProposals.mockReturnValue(0);
  discardPendingProposals.mockClear();
  discardPendingProposals.mockReturnValue(0);
  registerBridge();
  beginChatTurn();
});

describe("set_image_width", () => {
  it("passes an absolute width through", async () => {
    const result = await executeTool("set_image_width", { path: "images/photo.png", width: 300 });

    expect(setImageWidth).toHaveBeenCalledWith("images/photo.png", { width: 300 });
    expect(result.content).toContain("300 px wide (was 219 px)");
    expect(result.content).toContain("already applied");
  });

  it("accepts a width written as a pixel string", async () => {
    await executeTool("set_image_width", { path: "photo.png", width: "300px" });

    expect(setImageWidth).toHaveBeenCalledWith("images/photo.png", { width: 300 });
  });

  it("reads a percentage width as a scale factor", async () => {
    await executeTool("set_image_width", { path: "images/photo.png", width: "120%" });

    expect(setImageWidth).toHaveBeenCalledWith("images/photo.png", { scale: 1.2 });
  });

  it("reads a scale above 10 as a percentage", async () => {
    await executeTool("set_image_width", { path: "images/photo.png", scale: 150 });

    expect(setImageWidth).toHaveBeenCalledWith("images/photo.png", { scale: 1.5 });
  });

  it("resolves the only image when no path is given", async () => {
    await executeTool("set_image_width", { scale: 1.25 });

    expect(setImageWidth).toHaveBeenCalledWith("images/photo.png", { scale: 1.25 });
  });

  it("reports the images it knows when the path is unknown", async () => {
    const result = await executeTool("set_image_width", { path: "images/other.png", width: 300 });

    expect(setImageWidth).not.toHaveBeenCalled();
    expect(result.content).toContain("images/photo.png");
  });

  it("asks for a size instead of guessing one", async () => {
    const result = await executeTool("set_image_width", { path: "images/photo.png" });

    expect(setImageWidth).not.toHaveBeenCalled();
    expect(result.content.startsWith("Error:")).toBe(true);
  });

  it("restores the original size for width 0", async () => {
    setImageWidth.mockReturnValueOnce({ src: "images/photo.png", width: null, previousWidth: 300 });

    const result = await executeTool("set_image_width", { path: "images/photo.png", width: 0 });

    expect(setImageWidth).toHaveBeenCalledWith("images/photo.png", { width: 0 });
    expect(result.content).toContain("original size");
  });
});

// Which failures the transcript is allowed to swallow. The model still reads
// "Error:" either way — the flag only separates "it will fix this itself on the
// next call" from "someone has to do something about this".
describe("retryable failures", () => {
  it("marks a passage the model quoted wrong", async () => {
    proposePassageReplacement.mockReturnValueOnce("not-found");

    const result = await executeTool("replace_passage", { old_text: "Hello", new_text: "Hi" });

    expect(result.content.startsWith("Error:")).toBe(true);
    expect(result.retryable).toBe(true);
  });

  it("marks an anchor that names nothing in the document", async () => {
    proposeInsertion.mockReturnValueOnce("anchor-not-found");

    const result = await executeTool("insert_at_cursor", { text: "Hi", after_text: "Hello" });

    expect(result.retryable).toBe(true);
  });

  it("marks a path that is not an image in this document", async () => {
    const result = await executeTool("set_image_width", { path: "images/other.png", width: 300 });

    expect(result.retryable).toBe(true);
  });

  // Nothing selected is the user's state, not the model's mistake: retrying
  // cannot change it, so this one stays visible.
  it("leaves a failure the model cannot retry its way out of unmarked", async () => {
    proposeInsertion.mockReturnValueOnce("failed");

    const result = await executeTool("insert_at_cursor", { text: "Hi" });

    expect(result.content.startsWith("Error:")).toBe(true);
    expect(result.retryable).toBeUndefined();
  });

  it("leaves a proposal that worked unmarked", async () => {
    const result = await executeTool("replace_passage", { old_text: "Hello", new_text: "Hi" });

    expect(result.content.startsWith("OK:")).toBe(true);
    expect(result.retryable).toBeUndefined();
  });
});

describe("replace_passage on an image", () => {
  it("points at set_image_width instead of searching for image markdown", async () => {
    const result = await executeTool("replace_passage", {
      old_text: '![image](images/photo.png "width=219")',
      new_text: '![image](images/photo.png "width=300")'
    });

    expect(proposePassageReplacement).not.toHaveBeenCalled();
    expect(result.content).toContain("set_image_width");
  });

  it("still handles a passage that only mentions an image alongside text", async () => {
    await executeTool("replace_passage", { old_text: "Here is ![image](images/photo.png)", new_text: "Here" });

    expect(proposePassageReplacement).toHaveBeenCalled();
  });
});

// Placing an insertion is where the agent used to fail hardest: it could only
// ever say "at the cursor", which is wherever the user last clicked in the
// document rather than the place they just described in the chat.
describe("insert_at_cursor", () => {
  it("passes the anchor along", async () => {
    await executeTool("insert_at_cursor", { text: "A poem", after_text: "images/photo.png" });

    expect(proposeInsertion).toHaveBeenCalledWith("A poem", "images/photo.png");
  });

  it("accepts the anchor under the names a model improvises", async () => {
    await executeTool("insert_at_cursor", { text: "A poem", anchor: "the last line" });

    expect(proposeInsertion).toHaveBeenCalledWith("A poem", "the last line");
  });

  it("inserts at the cursor when no anchor is given", async () => {
    await executeTool("insert_at_cursor", { text: "A poem", after_text: "   " });

    expect(proposeInsertion).toHaveBeenCalledWith("A poem", undefined);
  });

  it("names the anchor in the error so the model can pick a better one", async () => {
    proposeInsertion.mockReturnValueOnce("anchor-not-found");

    const result = await executeTool("insert_at_cursor", { text: "A poem", after_text: "nowhere" });

    expect(result.content).toContain("after_text");
  });

  it("tells a model re-proposing its own text that it is already pending", async () => {
    proposeInsertion.mockReturnValueOnce("duplicate");

    const result = await executeTool("insert_at_cursor", { text: "A poem" });

    expect(result.content).toContain("already proposed");
    expect(result.content).toContain("Do not propose it again");
  });
});

// The retry loop this note exists to break: propose → read the document to
// check → the proposal isn't in there (it is still under review) → propose the
// same thing again, and now the same text sits in the document twice.
describe("get_document with open proposals", () => {
  it("says that pending proposals are not part of the text", async () => {
    listPendingProposals.mockReturnValue(["A poem about a mouse"]);

    const result = await executeTool("get_document", {});

    expect(result.content).toContain("Hello");
    expect(result.content).toContain("A poem about a mouse");
    expect(result.content).toContain("NOT part of the text above");
  });

  it("stays silent when nothing is pending", async () => {
    const result = await executeTool("get_document", {});

    expect(result.content).toBe("Hello");
  });
});

// A note the user just created and saved. "(empty document)" on its own read as
// a dead end to the model, which then kept the text it had written in the chat
// instead of putting it into the document.
describe("get_document on an empty note", () => {
  it("says how to write into it instead of just reporting it is empty", async () => {
    registerBridge(["images/photo.png"], "");
    beginChatTurn();

    const result = await executeTool("get_document", {});

    expect(result.content).toContain("empty");
    expect(result.content).toContain("insert_at_cursor");
    expect(result.content).toContain("NO after_text");
  });

  it("treats a document of pure whitespace the same way", async () => {
    registerBridge(["images/photo.png"], "\n\n  \n");
    beginChatTurn();

    const result = await executeTool("get_document", {});

    expect(result.content).toContain("insert_at_cursor");
  });
});

// A review the user has not settled outranks whatever they typed next: the
// agent either applies it, drops it, or asks — but it never proposes on top of
// it (see beginChatTurn).
describe("a turn that starts with an open review", () => {
  it("tells the model what is open and how to settle it", () => {
    startTurn(["A poem about a mouse"]);

    const note = pendingProposalTurnNote();

    expect(note).toContain("A poem about a mouse");
    expect(note).toContain("accept_proposals");
    expect(note).toContain("discard_proposals");
  });

  it("says nothing when the previous review was already settled", () => {
    startTurn();

    expect(pendingProposalTurnNote()).toBe("");
  });

  it("refuses a new proposal while the old one is open", async () => {
    startTurn(["A poem about a mouse"]);

    const result = await executeTool("replace_passage", { old_text: "Hello", new_text: "Hi" });

    expect(proposePassageReplacement).not.toHaveBeenCalled();
    expect(result.content).toContain("still waiting for the user's review");
    expect(result.content).toContain("discard_proposals");
  });

  it("keeps reading tools available so the model can still work out the request", async () => {
    startTurn(["A poem about a mouse"]);

    const result = await executeTool("get_document", {});

    expect(result.content).toContain("Hello");
  });

  it("lets the refinement case propose again once the old review is discarded", async () => {
    startTurn(["A poem about a mouse"]);
    discardPendingProposals.mockReturnValue(1);

    const discarded = await executeTool("discard_proposals", {});
    const result = await executeTool("replace_passage", { old_text: "Hello", new_text: "Hi" });

    expect(discarded.content).toContain("1 proposal(s) discarded");
    expect(proposePassageReplacement).toHaveBeenCalledWith("Hello", "Hi");
    expect(result.content).toContain("OK:");
  });

  it("applies the whole review when the user approves it", async () => {
    startTurn(["A poem about a mouse", "Another line"]);
    acceptPendingProposals.mockReturnValue(2);

    const result = await executeTool("accept_proposals", {});

    expect(acceptPendingProposals).toHaveBeenCalled();
    expect(result.content).toContain("2 proposal(s) accepted");
  });

  it("stops refusing once the user settles the review in the editor", async () => {
    startTurn(["A poem about a mouse"]);
    listPendingProposals.mockReturnValue([]);

    await executeTool("replace_passage", { old_text: "Hello", new_text: "Hi" });

    expect(proposePassageReplacement).toHaveBeenCalled();
  });

  it("says so when there is nothing to accept", async () => {
    startTurn();

    const result = await executeTool("accept_proposals", {});

    expect(result.content).toContain("no proposals waiting");
  });
});

// The turn's own proposals must not block each other: one request routinely
// touches several passages.
describe("several proposals in one turn", () => {
  it("does not refuse the second one", async () => {
    startTurn();
    listPendingProposals.mockReturnValue(["the first proposal"]);

    await executeTool("replace_passage", { old_text: "Hello", new_text: "Hi" });
    await executeTool("replace_passage", { old_text: "World", new_text: "Earth" });

    expect(proposePassageReplacement).toHaveBeenCalledTimes(2);
  });
});

// The recovery path for a turn that wrote the user's text into the chat instead
// of into the document (see src/lib/chat/pendingSuggestion.ts). It runs after
// the turn ended, so nothing downstream can react to a failure — the outcome has
// to come back as a value, and the open-review guard still has to hold.
describe("proposeComposedText", () => {
  it("proposes the text at the caret, without an anchor", () => {
    startTurn();

    expect(proposeComposedText("# Reisebericht\n\nDer erste Tag …")).toBe(true);
    expect(proposeInsertion).toHaveBeenCalledWith("# Reisebericht\n\nDer erste Tag …");
  });

  it("normalizes escaped checkboxes like the editing tools do", () => {
    startTurn();

    proposeComposedText("- \[ \] Zelt einpacken");

    expect(proposeInsertion).toHaveBeenCalledWith("- [ ] Zelt einpacken");
  });

  it("refuses while an earlier turn's review is still open", () => {
    startTurn(["A poem about a mouse"]);

    expect(proposeComposedText("Ein neuer Absatz")).toBe(false);
    expect(proposeInsertion).not.toHaveBeenCalled();
  });

  it("reports failure when the editor could not open a proposal", () => {
    startTurn();
    proposeInsertion.mockReturnValueOnce("duplicate");

    expect(proposeComposedText("Ein neuer Absatz")).toBe(false);
  });

  it("ignores empty text", () => {
    startTurn();

    expect(proposeComposedText("   ")).toBe(false);
    expect(proposeInsertion).not.toHaveBeenCalled();
  });
});
