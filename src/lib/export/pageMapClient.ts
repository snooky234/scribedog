import type { PageMap } from "./pageMap";
import type { PageMapRequest } from "./pageMapLayout";

// Hands page map requests to the worker (pageMapWorker.ts), one at a time.
// While one is being laid out, only the newest waiting request is kept: an
// older one describes text that has changed since, and its answer would only
// be replaced. A superseded request resolves to null.
//
// Where a worker cannot be started, or dies, the layout runs on the main
// thread instead; slower to come back, but the page lines still appear.

type Pending = { request: PageMapRequest; resolve: (map: PageMap | null) => void; reject: (error: Error) => void };

let worker: Worker | null = null;
let workerUnavailable = false;
let nextId = 0;
let inFlight: (Pending & { id: number }) | null = null;
let mainThreadBusy = false;
let waiting: Pending | null = null;

function startWorker(): Worker | null {
  if (worker || workerUnavailable) {
    return worker;
  }

  try {
    worker = new Worker(new URL("./pageMapWorker.ts", import.meta.url), { type: "module" });
  } catch {
    workerUnavailable = true;
    return null;
  }

  worker.onmessage = (event: MessageEvent<{ id: number; map?: PageMap; error?: string }>) => {
    const current = inFlight;

    if (!current || current.id !== event.data.id) {
      return;
    }

    inFlight = null;

    if (event.data.map) {
      current.resolve(event.data.map);
    } else {
      current.reject(new Error(event.data.error ?? "Page map layout failed"));
    }

    sendNext();
  };

  // A worker that fails to load (a blocked script, a broken chunk) takes the
  // main thread route from then on, including for the request it was given.
  worker.onerror = (event) => {
    event.preventDefault();
    worker?.terminate();
    worker = null;
    workerUnavailable = true;

    const current = inFlight;
    inFlight = null;

    if (current) {
      runOnMainThread(current);
    } else {
      sendNext();
    }
  };

  return worker;
}

function runOnMainThread(pending: Pending): void {
  mainThreadBusy = true;

  void import("./pageMapLayout")
    .then(({ layoutPageMapRequest }) => layoutPageMapRequest(pending.request))
    .then(pending.resolve, pending.reject)
    .finally(() => {
      mainThreadBusy = false;
      sendNext();
    });
}

function sendNext(): void {
  if (inFlight || mainThreadBusy || !waiting) {
    return;
  }

  const next = waiting;
  waiting = null;
  const target = startWorker();

  if (!target) {
    runOnMainThread(next);
    return;
  }

  nextId += 1;
  inFlight = { ...next, id: nextId };
  target.postMessage({ id: nextId, request: next.request });
}

/** Where the pages of the PDF export break, laid out in the background. */
export function requestPageMap(request: PageMapRequest): Promise<PageMap | null> {
  return new Promise((resolve, reject) => {
    waiting?.resolve(null);
    waiting = { request, resolve, reject };
    sendNext();
  });
}
