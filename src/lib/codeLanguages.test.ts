import { describe, expect, it } from "vitest";

import { CODE_LANGUAGES, codeBlockLowlight, detectCodeLanguage, resolveCodeLanguage } from "@/lib/codeLanguages";

describe("resolveCodeLanguage", () => {
  it("passes the picker's own values through", () => {
    for (const { value } of CODE_LANGUAGES) {
      expect(resolveCodeLanguage(value)).toBe(value);
    }
  });

  it("maps common fence spellings onto the picker value", () => {
    expect(resolveCodeLanguage("sh")).toBe("bash");
    expect(resolveCodeLanguage("zsh")).toBe("bash");
    expect(resolveCodeLanguage("ps1")).toBe("powershell");
    expect(resolveCodeLanguage("toml")).toBe("ini");
    expect(resolveCodeLanguage("html")).toBe("xml");
    expect(resolveCodeLanguage("yml")).toBe("yaml");
    expect(resolveCodeLanguage("c++")).toBe("cpp");
  });

  it("ignores case and surrounding blanks", () => {
    expect(resolveCodeLanguage(" PowerShell ")).toBe("powershell");
    expect(resolveCodeLanguage("JS")).toBe("javascript");
  });

  it("returns null for a language outside the curated set", () => {
    expect(resolveCodeLanguage("haskell")).toBeNull();
    expect(resolveCodeLanguage("")).toBeNull();
    expect(resolveCodeLanguage(null)).toBeNull();
  });
});

describe("codeBlockLowlight.highlight", () => {
  const colored = (language: string, code: string) => codeBlockLowlight.highlight(language, code).children.length > 0;

  it("colours every language the picker offers, except diagrams", () => {
    const samples: Record<string, string> = {
      powershell: "Get-ChildItem -Path C:\\ | Where-Object { $_.Length -gt 1MB }",
      ini: "[wsl2]\nmemory=4GB",
      dockerfile: "FROM node:20\nRUN npm ci",
      nginx: "server {\n  listen 80;\n}",
      diff: "--- a/x\n+++ b/x\n-foo\n+bar",
      c: "#include <stdio.h>\nint main(void) { return 0; }",
      cpp: "#include <vector>\nstd::vector<int> v;",
      kotlin: "fun main() { println(\"hi\") }",
      swift: "let x: Int = 1\nfunc f() {}",
      ruby: "def f\n  puts 'hi'\nend",
      lua: "local x = 1\nprint(x)",
      r: "x <- c(1, 2, 3)\nprint(x)",
      scala: "object Main { def main(args: Array[String]): Unit = {} }",
      dart: "void main() { print('hi'); }",
      graphql: "query { user(id: 1) { name } }",
      latex: "\\begin{document}\\section{A}\\end{document}",
      makefile: "all:\n\tgcc -o a a.c",
      properties: "a.b=1\nc.d=2"
    };

    for (const [language, code] of Object.entries(samples)) {
      expect(colored(language, code), language).toBe(true);
    }
  });

  it("highlights through an alias", () => {
    expect(colored("sh", "echo $HOME")).toBe(true);
    expect(colored("PS1", "Get-Item $x")).toBe(true);
  });

  it("leaves an unknown language unhighlighted", () => {
    expect(colored("haskell", "main = putStrLn \"hi\"")).toBe(false);
  });
});

describe("detectCodeLanguage", () => {
  it("recognises code by its grammar", () => {
    expect(detectCodeLanguage("[wsl2]\nmemory=4GB\nswap=2GB\n\n[experimental]\nautoMemoryReclaim=gradual")).toBe("ini");
    expect(detectCodeLanguage("Get-ChildItem -Path C:\\ -Recurse | Where-Object { $_.Length -gt 1MB }\n$x = \"a\"")).toBe(
      "powershell"
    );
    expect(detectCodeLanguage("def f(x):\n    return [i for i in range(x)]\nprint(f(3))")).toBe("python");
    expect(detectCodeLanguage("FROM node:20\nWORKDIR /app\nCOPY . .\nRUN npm ci\nCMD [\"node\",\"index.js\"]")).toBe(
      "dockerfile"
    );
    expect(detectCodeLanguage("--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n-foo\n+bar")).toBe("diff");
  });

  it("recognises JSON and HTML by their shape", () => {
    expect(detectCodeLanguage('{"a": 1, "b": [1, 2, 3]}')).toBe("json");
    expect(detectCodeLanguage('<div class="a"><p>Hi</p></div>')).toBe("xml");
    expect(detectCodeLanguage("<!DOCTYPE html>\n<html></html>")).toBe("xml");
  });

  it("does not guess at prose or a bare command", () => {
    expect(detectCodeLanguage("Das ist ein ganz normaler Satz ohne Code, der nur Text enthält.")).toBeNull();
    expect(detectCodeLanguage("npm install")).toBeNull();
    expect(detectCodeLanguage("")).toBeNull();
    expect(detectCodeLanguage("  \n ")).toBeNull();
  });

  it("only offers languages the picker knows", () => {
    const detected = detectCodeLanguage("SELECT id, name FROM users WHERE age > 18 ORDER BY name;");

    expect(CODE_LANGUAGES.some((entry) => entry.value === detected)).toBe(true);
  });
});

describe("codeBlockLowlight.highlightAuto", () => {
  it("colours a guessed block and leaves an unrecognised one plain", () => {
    expect(codeBlockLowlight.highlightAuto("[a]\nb=1\n\n[c]\nd=2").children.length).toBeGreaterThan(0);
    expect(codeBlockLowlight.highlightAuto("npm install").children).toHaveLength(0);
  });
});
