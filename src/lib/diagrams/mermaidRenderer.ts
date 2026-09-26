import type { MermaidConfig } from "mermaid";

type MermaidModule = typeof import("mermaid").default;

// Mermaid plus its diagram grammars weigh several megabytes. Nobody who never
// writes a diagram should pay for that, so it is loaded on the first render.
let mermaidPromise: Promise<MermaidModule> | null = null;

function loadMermaid(): Promise<MermaidModule> {
  mermaidPromise ??= import("mermaid").then((module) => module.default);
  return mermaidPromise;
}

export type MermaidRenderMode = "light" | "dark" | "export";

// `securityLevel: "strict"` is not negotiable: the source can come from a
// language model, and strict is what disables click handlers and HTML in
// labels and runs the result through DOMPurify.
const BASE_CONFIG: MermaidConfig = {
  startOnLoad: false,
  securityLevel: "strict",
  suppressErrorRendering: true,
  deterministicIds: true
};

function configFor(mode: MermaidRenderMode): MermaidConfig {
  if (mode === "export") {
    // SVG labels instead of <foreignObject>: an image with foreignObject taints
    // the canvas the paged exporters rasterize through, and pdfmake cannot
    // draw it either. A system font, because an SVG loaded as an <img> never
    // sees the app's web fonts and the text would be measured against one
    // font and drawn in another.
    return {
      ...BASE_CONFIG,
      theme: "default",
      htmlLabels: false,
      fontFamily: "Arial, Helvetica, sans-serif"
    };
  }

  return { ...BASE_CONFIG, theme: mode === "dark" ? "dark" : "default" };
}

// mermaid.initialize is global state, so renders run one after another; two
// interleaved renders with different modes would draw with each other's theme.
let queue: Promise<unknown> = Promise.resolve();
let renderCounter = 0;

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

export function currentMermaidMode(): MermaidRenderMode {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** The diagram as an SVG string; throws with Mermaid's own message on a syntax error. */
export function renderMermaidSvg(source: string, mode: MermaidRenderMode): Promise<string> {
  return enqueue(async () => {
    const mermaid = await loadMermaid();
    mermaid.initialize(configFor(mode));
    renderCounter += 1;
    const { svg } = await mermaid.render(`scribedog-mermaid-${renderCounter}`, source);
    return svg;
  });
}

/** Mermaid's error message for a diagram that does not parse, or null when it is valid. */
export function validateMermaid(source: string): Promise<string | null> {
  return enqueue(async () => {
    const mermaid = await loadMermaid();
    mermaid.initialize(configFor("light"));

    try {
      await mermaid.parse(source);
      return null;
    } catch (error) {
      return mermaidErrorMessage(error);
    }
  });
}

export function mermaidErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  // Mermaid's parser messages carry a multi-line ASCII pointer; the first two
  // lines ("Parse error on line 3:" plus the offending line) are what helps.
  return message.split("\n").slice(0, 4).join("\n").trim() || "unknown syntax error";
}
