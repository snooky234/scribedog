# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in ScribeDog, please report it privately —
**do not open a public issue**. Use [GitHub's private vulnerability reporting](https://github.com/snooky234/scribedog/security/advisories/new)
("Report a vulnerability" on the Security tab of this repository) and include a
description of the issue and, if possible, steps to reproduce.

## Supported versions

Only the **latest release** receives security fixes. ScribeDog is a desktop app
with an auto-update notice on Windows, so please keep it up to date.

## Scope — what ScribeDog protects against (and what it doesn't)

ScribeDog is designed to be private by architecture:

- **Offline by default** — no telemetry, no analytics, no account. The only
  automatic network call is an optional, disableable update check (Windows).
- **Network access is opt-in** — AI requests go only to the endpoint *you*
  configure, and only when you trigger an AI action. Cloud providers require
  HTTPS; local providers must resolve to localhost.
- **Scoped filesystem access** — Tauri capabilities limit file access to the
  folder you explicitly open, not the whole disk.
- **API keys in the OS credential store** — Windows Credential Manager, macOS
  Keychain, or Linux Secret Service; not in plain text on disk.

Out of scope (things ScribeDog cannot protect against):

- Malware or other software already running with your user's privileges on the
  same machine.
- The security practices of a cloud AI provider you choose to send text to.
- Physical access to an unlocked, unencrypted device.

Reports about hardening within scope are very welcome — especially anything
that violates the guarantees listed above.
