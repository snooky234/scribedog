// Regenerates THIRD_PARTY_LICENSES.md from the installed npm packages
// (production tree, with full license texts) and the Rust dependency graph
// (cargo metadata, Windows target). Run from anywhere: node scripts/gen-licenses.mjs
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const NOTO_EMOJI_OFL = `Copyright 2013 Google LLC

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.`;

// --- npm ---
const raw = execSync('npx --yes license-checker --production --json', {
  cwd: root,
  maxBuffer: 64 * 1024 * 1024,
  shell: true
}).toString();
const pkgs = JSON.parse(raw);

let out = `# Third-Party Licenses\n\nScribeDog bundles the following third-party software. Each component is the property of its respective authors and is licensed under the terms below.\n\n## JavaScript / npm packages\n\n`;

const names = Object.keys(pkgs).sort();
let npmCount = 0;
for (const name of names) {
  const p = pkgs[name];
  if (p.path && resolve(p.path).toLowerCase() === root.toLowerCase()) continue; // scribedog itself
  npmCount++;
  out += `### ${name}\n\n`;
  out += `- License: ${p.licenses}\n`;
  if (p.repository) out += `- Repository: ${p.repository}\n`;
  if (p.publisher) out += `- Publisher: ${p.publisher}\n`;
  out += `\n`;
  if (p.licenseFile && !/readme/i.test(p.licenseFile)) {
    try {
      const text = readFileSync(p.licenseFile, 'utf8').trim();
      out += '<details><summary>License text</summary>\n\n```\n' + text + '\n```\n\n</details>\n\n';
    } catch {}
  }
}

// --- Bundled fonts (not tracked by npm/cargo) ---
// The PDF exporter embeds a monochrome Noto Emoji subset (see
// src/lib/export/notoEmojiFont.ts); OFL-1.1 requires shipping its notice.
out += `## Bundled fonts\n\n`;
out += `### Noto Emoji\n\n`;
out += `A monochrome subset of the Noto Emoji font is embedded in the app and used only by the PDF export to render emoji glyphs (PDF viewers cannot substitute a system emoji font the way HTML/DOCX/ODT viewers do). Generated from the static weight-400 instance of \`NotoEmoji[wght].ttf\`.\n\n`;
out += `- License: OFL-1.1\n- Repository: https://github.com/googlefonts/noto-emoji\n- Publisher: Google LLC\n\n`;
out += '<details><summary>License text</summary>\n\n```\n' + NOTO_EMOJI_OFL + '\n```\n\n</details>\n\n';

// --- Rust ---
const meta = JSON.parse(
  execSync('cargo metadata --format-version 1 --filter-platform x86_64-pc-windows-msvc', {
    cwd: resolve(root, 'src-tauri'),
    maxBuffer: 256 * 1024 * 1024,
    shell: true
  }).toString()
);
out += `## Rust crates (Tauri backend)\n\n| Crate | Version | License |\n|---|---|---|\n`;
const seen = new Set();
for (const p of meta.packages.sort((a, b) => a.name.localeCompare(b.name))) {
  if (p.name === 'scribedog') continue;
  const key = p.name + p.version;
  if (seen.has(key)) continue;
  seen.add(key);
  out += `| ${p.name} | ${p.version} | ${p.license || p.license_file || 'see repository'} |\n`;
}

writeFileSync(resolve(root, 'THIRD_PARTY_LICENSES.md'), out);
console.log(`done: ${npmCount} npm packages, ${seen.size} crates`);
