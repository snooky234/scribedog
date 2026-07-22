import { createLowlight } from "lowlight";
import bash from "highlight.js/lib/languages/bash";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
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
  { value: "markdown", label: "Markdown" }
] as const;

export type CodeLanguage = (typeof CODE_LANGUAGES)[number]["value"];

const lowlight = createLowlight();

lowlight.register({
  bash,
  csharp,
  css,
  go,
  java,
  javascript,
  json,
  markdown,
  php,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml
});

type HighlightRoot = ReturnType<typeof lowlight.highlightAuto>;

const EMPTY_RESULT = { type: "root", children: [], data: {} } as unknown as HighlightRoot;

/**
 * lowlight instance handed to the TipTap extension.
 *
 * `registered: () => true` forces the extension down the explicit-language path
 * whenever a block has a language attribute, so auto-detection stays what the
 * issue asks for: a fallback for blocks *without* a language only. A language
 * outside the curated set then renders unhighlighted instead of being guessed
 * at — the attribute itself is untouched either way and still serializes back
 * into the fence.
 */
export const codeBlockLowlight = {
  highlight: (language: string, value: string) =>
    lowlight.registered(language) ? lowlight.highlight(language, value) : EMPTY_RESULT,
  highlightAuto: (value: string) => lowlight.highlightAuto(value),
  listLanguages: () => lowlight.listLanguages(),
  registered: () => true
};
