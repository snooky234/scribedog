import { layoutPageMapRequest, type PageMapRequest } from "./pageMapLayout";

// Lays out the page map off the main thread: pdfmake needs a few hundred
// milliseconds for a long note, which would stall typing. The client sends a
// request only when the previous one has been answered.

type Incoming = { id: number; request: PageMapRequest };

// Typed narrowly instead of through the "webworker" lib, which clashes with
// the DOM lib the rest of the project compiles against.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Incoming>) => void) | null;
  postMessage: (message: unknown) => void;
};

scope.onmessage = (event) => {
  const { id, request } = event.data;

  layoutPageMapRequest(request).then(
    (map) => scope.postMessage({ id, map }),
    (error: unknown) => scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  );
};
