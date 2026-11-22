// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

/** Stands in for the browser's WebSocket; the test drives its events. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  send(): void {}

  close(): void {}
}

vi.stubGlobal("WebSocket", FakeSocket);

afterEach(() => {
  FakeSocket.instances = [];
});

describe("live updates", () => {
  it("refreshes once when the socket opens, so a change made before it connected is not lost", async () => {
    const { subscribeToVaultChanges, watchRoot } = await import("./liveUpdates");
    const handler = vi.fn();

    const unsubscribe = subscribeToVaultChanges(handler);
    watchRoot("/vault", "");
    const socket = FakeSocket.instances[FakeSocket.instances.length - 1];

    expect(handler).not.toHaveBeenCalled();
    socket.open();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("/vault");

    socket.onmessage?.({ data: JSON.stringify({ type: "files-changed" }) });
    expect(handler).toHaveBeenCalledTimes(2);

    unsubscribe();
  });
});
