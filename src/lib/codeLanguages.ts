import { createLowlight } from "lowlight";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import dart from "highlight.js/lib/languages/dart";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import graphql from "highlight.js/lib/languages/graphql";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import latex from "highlight.js/lib/languages/latex";
import lua from "highlight.js/lib/languages/lua";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import nginx from "highlight.js/lib/languages/nginx";
import php from "highlight.js/lib/languages/php";
import powershell from "highlight.js/lib/languages/powershell";
import properties from "highlight.js/lib/languages/properties";
import python from "highlight.js/lib/languages/python";
import r from "highlight.js/lib/languages/r";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scala from "highlight.js/lib/languages/scala";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

// A curated set instead of lowlight's "common"/"all" presets: "all" pulls in
// roughly 190 grammars and neither preset can be tree-shaken down to the
// languages actually offered in the picker.
export const CODE_LANGUAGES = [
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" },
  { value: "rust", label: "Rust" },
  { value: "go", label: "Go" },
  { value: "java", label: "Java" },
  { value: "csharp", label: "C#" },
  { value: "php", label: "PHP" },
  { value: "bash", label: "Bash" },
  { value: "sql", label: "SQL" },
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
  { value: "css", label: "CSS" },
  { value: "xml", label: "HTML / XML" },
  { value: "markdown", label: "Markdown" },
  { value: "powershell", label: "PowerShell" },
  { value: "ini", label: "INI / TOML" },
  { value: "properties", label: "Properties" },
  { value: "dockerfile", label: "Dockerfile" },
  { value: "nginx", label: "Nginx" },
  { value: "makefile", label: "Makefile" },
  { value: "diff", label: "Diff" },
  { value: "c", label: "C" },
  { value: "cpp", label: "C++" },
  { value: "kotlin", label: "Kotlin" },
  { value: "swift", label: "Swift" },
  { value: "ruby", label: "Ruby" },
  { value: "lua", label: "Lua" },
  { value: "r", label: "R" },
  { value: "scala", label: "Scala" },
  { value: "dart", label: "Dart" },
  { value: "graphql", label: "GraphQL" },
  { value: "latex", label: "LaTeX" },
  // No grammar: the block renders as a diagram (CodeBlockView), not as highlighted code.
  { value: "mermaid", label: "Mermaid" }
] as const;

export type CodeLanguage = (typeof CODE_LANGUAGES)[number]["value"];

const lowlight = createLowlight();

lowlight.register({
  bash,
  c,
  cpp,
  csharp,
  css,
  dart,
  diff,
  dockerfile,
  go,
  graphql,
  ini,
  java,
  javascript,
  json,
  kotlin,
  latex,
  lua,
  makefile,
  markdown,
  nginx,
  php,
  powershell,
  properties,
  python,
  r,
  ruby,
  rust,
  scala,
  sql,
  swift,
  typescript,
  xml,
  yaml
});

type HighlightRoot = ReturnType<typeof lowlight.highlightAuto>;

const EMPTY_RESULT = { type: "root", children: [], data: {} } as unknown as HighlightRoot;

// Spellings people put behind a fence that are not the picker's own value.
// highlight.js knows most of them already (lowlight registers a grammar's
// aliases), but the badge and the picker only know the values above, so
// without this a "```sh" block would show "sh" instead of "Bash".
const LANGUAGE_ALIASES: Record<string, CodeLanguage> = {
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  rs: "rust",
  golang: "go",
  cs: "csharp",
  "c#": "csharp",
  yml: "yaml",
  html: "xml",
  svg: "xml",
  md: "markdown",
  ps1: "powershell",
  pwsh: "powershell",
  toml: "ini",
  docker: "dockerfile",
  "c++": "cpp",
  kt: "kotlin",
  rb: "ruby",
  patch: "diff",
  make: "makefile",
  tex: "latex",
  gql: "graphql"
};

/**
 * The picker value a fence language stands for ("sh" → "bash"), or null for a
 * language outside the curated set. Case-insensitive, like the fence itself.
 */
export function resolveCodeLanguage(language: string | null | undefined): CodeLanguage | null {
  const key = (language ?? "").trim().toLowerCase();

  if (CODE_LANGUAGES.some((entry) => entry.value === key)) {
    return key as CodeLanguage;
  }

  return LANGUAGE_ALIASES[key] ?? null;
}

// Candidates for the guess, narrower than what can be highlighted: highlight.js
// scores every grammar and the loose ones win on anything. "properties" took
// YAML, Dockerfiles and Nginx configs; "makefile", "markdown" and "latex" took
// prose and plain commands. Those stay available by naming them in the fence.
const AUTO_DETECT_SUBSET = [
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "dart",
  "diff",
  "dockerfile",
  "go",
  "ini",
  "java",
  "javascript",
  "json",
  "kotlin",
  "lua",
  "nginx",
  "php",
  "powershell",
  "python",
  "ruby",
  "rust",
  "scala",
  "sql",
  "swift",
  "typescript",
  "xml",
  "yaml"
];

// Below this score highlight.js is guessing: a one-line "npm install" or a
// German sentence still gets a "best" grammar, and colouring it would
// misrepresent it. Measured on short snippets, real code scores 4 and up.
const AUTO_DETECT_MIN_RELEVANCE = 4;

// A guess only reads the start of a block: the cost stays flat however long
// the block gets, and a keystroke does not run every grammar over the whole
// text again.
const AUTO_DETECT_SAMPLE_LENGTH = 2000;
const AUTO_DETECT_CACHE_LIMIT = 100;

const detectionCache = new Map<string, CodeLanguage | null>();

// highlight.js rates a small HTML fragment below a stylesheet and JSON below
// almost anything, so the two shapes that can be recognised outright are.
function detectByShape(sample: string): CodeLanguage | null {
  const trimmed = sample.trim();

  if (/^[{[]/.test(trimmed)) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      // A truncated sample or JSON with comments: left to the scoring.
    }
  }

  if (/^<(!doctype\s|\?xml[\s?]|[a-z][\w:-]*[\s/>])/i.test(trimmed) && trimmed.endsWith(">")) {
    return "xml";
  }

  return null;
}

/**
 * Best guess for the language of unlabelled code, or null when nothing scores
 * high enough. Only the badge and the colouring use it: it is never written
 * into the document, so the fence of a block without a language stays bare.
 */
export function detectCodeLanguage(value: string): CodeLanguage | null {
  const sample = value.slice(0, AUTO_DETECT_SAMPLE_LENGTH);

  if (!sample.trim()) {
    return null;
  }

  const cached = detectionCache.get(sample);

  if (cached !== undefined) {
    return cached;
  }

  let detected = detectByShape(sample);

  if (!detected) {
    const result = lowlight.highlightAuto(sample, { subset: AUTO_DETECT_SUBSET });
    const relevance = result.data?.relevance ?? 0;

    detected = relevance >= AUTO_DETECT_MIN_RELEVANCE ? resolveCodeLanguage(result.data?.language as string) : null;
  }

  if (detectionCache.size >= AUTO_DETECT_CACHE_LIMIT) {
    detectionCache.clear();
  }

  detectionCache.set(sample, detected);

  return detected;
}

/**
 * lowlight instance handed to the TipTap extension.
 *
 * `registered: () => true` forces the extension down the explicit-language path
 * whenever a block has a language attribute, so auto-detection stays a
 * fallback for blocks *without* a language only. A language outside the
 * curated set then renders unhighlighted instead of being guessed at — the
 * attribute itself is untouched either way and still serializes back into the
 * fence.
 */
export const codeBlockLowlight = {
  highlight: (language: string, value: string) => {
    const name = resolveCodeLanguage(language) ?? language.trim().toLowerCase();

    return lowlight.registered(name) ? lowlight.highlight(name, value) : EMPTY_RESULT;
  },
  highlightAuto: (value: string) => {
    const detected = detectCodeLanguage(value);

    return detected ? lowlight.highlight(detected, value) : EMPTY_RESULT;
  },
  listLanguages: () => lowlight.listLanguages(),
  registered: () => true
};
