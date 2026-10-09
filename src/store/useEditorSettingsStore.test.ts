// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// The store reads localStorage at import, so every test imports a fresh copy
// after arranging it.

async function loadStore() {
  vi.resetModules();
  return (await import("./useEditorSettingsStore")).useEditorSettingsStore;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("plain table header", () => {
  it("is off until it is switched on", async () => {
    expect((await loadStore()).getState().plainTableHeader).toBe(false);
  });

  it("is kept across a restart", async () => {
    (await loadStore()).getState().setPlainTableHeader(true);

    expect((await loadStore()).getState().plainTableHeader).toBe(true);
  });

  it("can be switched off again", async () => {
    const store = await loadStore();
    store.getState().setPlainTableHeader(true);
    store.getState().setPlainTableHeader(false);

    expect((await loadStore()).getState().plainTableHeader).toBe(false);
  });
});

describe("view text size", () => {
  it("follows the document size until the view is zoomed", async () => {
    const store = await loadStore();

    expect(store.getState().viewFontSizePt).toBeNull();

    store.getState().setViewFontSizePt(14);
    expect(store.getState().viewFontSizePt).toBe(14);
  });

  it("is kept across a restart", async () => {
    (await loadStore()).getState().setViewFontSizePt(15.5);

    expect((await loadStore()).getState().viewFontSizePt).toBe(15.5);
  });

  it("goes back to the document size when the slider moves, and stays there", async () => {
    const store = await loadStore();
    store.getState().setViewFontSizePt(18);
    store.getState().setFontSizePt(12);

    expect(store.getState().viewFontSizePt).toBeNull();
    expect((await loadStore()).getState().viewFontSizePt).toBeNull();
  });

  it("leaves the Zen size alone", async () => {
    const store = await loadStore();
    store.getState().setZenFontSizePt(20);
    store.getState().setFontSizePt(12);

    expect(store.getState().zenFontSizePt).toBe(20);
  });
});
