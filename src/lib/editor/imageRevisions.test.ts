import { describe, expect, it, vi } from "vitest";

import { notifyImageFileChanged, subscribeImageFileChanged } from "./imageRevisions";

describe("imageRevisions", () => {
  it("reaches every subscriber until it unsubscribes", () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribeImageFileChanged(first);
    const unsubscribeSecond = subscribeImageFileChanged(second);

    notifyImageFileChanged("/vault/images/drawing.svg");
    unsubscribeFirst();
    notifyImageFileChanged("/vault/images/other.svg");
    unsubscribeSecond();

    expect(first.mock.calls).toEqual([["/vault/images/drawing.svg"]]);
    expect(second.mock.calls).toEqual([["/vault/images/drawing.svg"], ["/vault/images/other.svg"]]);
  });
});
