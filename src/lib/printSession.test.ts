import { describe, expect, it } from "vitest";

import { QUEUED_CLOSE_GRACE_MS, isCloseRequestFromPrintPreview, runPrintDialog } from "./printSession";

describe("print session close guard", () => {
  it("lets a close request through when nothing was printed", () => {
    expect(isCloseRequestFromPrintPreview(0)).toBe(false);
  });

  it("drops a close request while the print dialog is open", () => {
    let duringPrint: boolean | null = null;

    runPrintDialog(
      () => {
        duringPrint = isCloseRequestFromPrintPreview(5_000);
      },
      () => 10_000
    );

    expect(duringPrint).toBe(true);
  });

  it("drops the close request queued during the preview and allows the next one", () => {
    runPrintDialog(() => undefined, () => 20_000);

    expect(isCloseRequestFromPrintPreview(20_000 + 50)).toBe(true);
    expect(isCloseRequestFromPrintPreview(20_000 + QUEUED_CLOSE_GRACE_MS)).toBe(false);
  });

  it("ends the print session even when the dialog throws", () => {
    expect(() =>
      runPrintDialog(
        () => {
          throw new Error("no printer");
        },
        () => 30_000
      )
    ).toThrow("no printer");

    expect(isCloseRequestFromPrintPreview(30_000 + QUEUED_CLOSE_GRACE_MS + 1)).toBe(false);
  });
});
