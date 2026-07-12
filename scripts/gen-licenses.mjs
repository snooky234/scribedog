// Regenerates THIRD_PARTY_LICENSES.md from the installed npm packages
// (production tree, with full license texts) and the Rust dependency graph
// (cargo metadata, Windows target). Run from anywhere: node scripts/gen-licenses.mjs
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
