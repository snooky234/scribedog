# API

Everything the web app and the desktop app do goes through this API, so a
script or a tool of your own can do the same. All routes live under the base
path (`/api/...`, or `/anna/api/...` with `SCRIBEDOG_BASE_PATH=/anna`).

## Authentication

Every route except login, session, health and the access-key request needs
one of two things:

- the **session cookie** a browser gets from `POST /api/auth/login`, or
- an **access key** in the `Authorization: Bearer sdt_...` header, as the
  desktop app sends it. Get one from `POST /api/auth/tokens`.

For a script, an access key is the simpler way: request it once with the
password, keep it somewhere safe, revoke it from the device list when the
script is retired.

```bash
# once
curl -s https://notes.example.com/api/auth/tokens \
  -H 'content-type: application/json' \
  -d '{"password":"...","name":"backup script"}'
# -> {"id":"...","name":"backup script","token":"sdt_...","createdAt":"..."}

# from then on
curl -s https://notes.example.com/api/files -H 'authorization: Bearer sdt_...'

# the whole vault as a ZIP, for a copy on your own machine
curl -s 'https://notes.example.com/api/export/zip?path=' -H 'authorization: Bearer sdt_...' -o notes.zip
```

## Routes

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/login` | `{ "password": "..." }` sets the session cookie |
| `POST` | `/api/auth/logout` | clears the cookie |
| `GET` | `/api/auth/session` | `{ "authenticated": true\|false, "via": "cookie"\|"token" }` |
| `POST` | `/api/auth/password` | `{ "currentPassword": "...", "newPassword": "..." }`: new password, every other session and every access key ends. Cookie session only. |
| `POST` | `/api/auth/tokens` | `{ "password": "...", "name": "..." }` issues an access key; the response is the only time the key is shown. Counts toward the login lock. |
| `GET` | `/api/auth/tokens` | the signed-in devices: id, name, created, last used, `current` for the key making the request; never the keys themselves |
| `DELETE` | `/api/auth/tokens/:id` | revokes one access key |
| `GET` | `/api/files` | list of `.md` files with modification times |
| `GET` | `/api/fs/entries?path=Notes` | directory listing (`path=` for the root) |
| `GET` | `/api/fs/stat?path=…` | size, times, kind of one entry |
| `GET` | `/api/fs/exists?path=…` | `{ "exists": true\|false }` |
| `POST` | `/api/fs/mkdir` | `{ "path": "…", "recursive": true }` |
| `GET` | `/api/fs/text?path=…` | `{ "content": "…", "version": "…" }` reads a text file; see [Conditional writes](#conditional-writes) |
| `PUT` | `/api/fs/text` | `{ "path": "…", "content": "…" }` creates or overwrites (parent folder must exist); with `"ifMatch"` only while the file is still that version. Answers `{ "mtimeMs": …, "version": "…" }` |
| `GET` | `/api/fs/file?path=…` | read a binary file (images get their content type) |
| `PUT` | `/api/fs/file?path=…` | body as `application/octet-stream` creates or overwrites |
| `POST` | `/api/fs/rename` | `{ "from": "…", "to": "…" }` (files and folders) |
| `POST` | `/api/fs/remove` | `{ "path": "…", "recursive": true }` (a folder without `recursive` must be empty) |
| `GET` | `/api/export/zip?path=Notes` | the folder's files as a ZIP archive (`path=` for the whole vault), streamed; `.scribedog` metadata and symlinks are left out |
| `GET` | `/api/secrets` | which API keys are stored, never their values |
| `PUT` | `/api/secrets/:id` | `{ "value": "..." }` stores a key (an empty value removes it) |
| `DELETE` | `/api/secrets/:id` | removes a key |
| `GET`/`POST` | `/api/llm/request` | forwards one request to the AI provider named in `X-Scribedog-Llm-Url` |
| `GET` | `/api/events` | WebSocket; sends `{"type":"files-changed"}` when the vault changes on disk. A socket opened with an access key is closed when that key is revoked. |
| `GET` | `/api/health` | liveness probe |
| `GET` | `/api/shared` | `{ "enabled": false }`, or the [shared vaults](#shared-vaults) of this instance's person: `me`, `people`, `vaults`, `trash`, `notices` |
| `POST` | `/api/shared/vaults` | `{ "name": "…", "members": ["bob"] }` creates a shared vault (201) |
| `PATCH` | `/api/shared/vaults/:id` | `{ "name": "…", "members": […] }` renames or changes members (creator only) |
| `POST` | `/api/shared/vaults/:id/leave` | leaves the vault (members, not the creator) |
| `DELETE` | `/api/shared/vaults/:id` | moves it to the trash (creator only); answers `{ "purgeAt": … }` |
| `POST` | `/api/shared/vaults/:id/restore` | takes it back out of the trash (creator only) |
| `POST` | `/api/shared/notices/:id/dismiss` | hides a "vault was deleted" notice for this person |
| | `/api/v/:id/…` | the shared vault's own `/files`, `/fs/*`, `/export/zip` and `/events`, same shapes as above |

## Paths

The `/fs` routes are the app's filesystem layer, one call per primitive.
Paths are relative to the vault and may not point outside it (symlinks
included) or into `.scribedog/server/`; the vault root, `.scribedog` itself
and the data-version marker cannot be renamed or removed.

`/export/zip` is not one of those primitives: it packs a folder the way you
would copy it, so the archive has the notes, the images and any other file
in real subfolders, but no `.scribedog` directory at any level and nothing
reached through a symlink. The rendered formats (PDF, DOCX, ODT, EPUB) are
made in the browser or the desktop app, not on the server, so there is no
route for them.

## Conditional writes

A text file's `version` is the SHA-256 of its bytes, as lowercase hex. Send
it back as `ifMatch` to write only while nobody else has changed the file
since you read it:

```json
{ "path": "Notes/Idea.md", "content": "…", "ifMatch": "3b1f…" }
```

`"ifMatch": null` means "create, the file must not exist yet". Without
`ifMatch` the write is unconditional, as before.

The comparison and the write are one step, under a lock that also holds
between several server instances writing to the same disk. When the file is
no longer that version, nothing is written and the answer is 409 with what
is there now, so a client can merge without asking again:

```json
{ "error": "version_conflict", "message": "…", "current": { "content": "…", "version": "…" } }
```

`current` is `null` when the file has been deleted in the meantime. Only
`/fs/text` takes `ifMatch`; images and the app's own files in `.scribedog/`
are written unconditionally.

## Shared vaults

On an instance that is part of a [shared-vault setup](multiuser.md#shared-vaults),
every request speaks for that instance's person. A shared vault answers the
same file API as the instance's own vault, under `/api/v/<id>/`: reading
takes membership, everything else takes the right to write (in this version
every member has it). A vault the person is not in answers 404, exactly like
one that does not exist, so the API does not tell anyone which vaults the
others have. A deleted one answers 410 with `vault_deleted`.

Inside a shared vault `.scribedog/users/<name>/` holds each person's own
files (chat history, pending agent proposals); the other people's folders
there are refused like `.scribedog/server/`.

The `/events` socket of a shared vault closes with code `4003` when the
person is taken off the vault (or leaves it on another device) and `4004`
when it is deleted; `4001` still means the access key was revoked.

## Errors

Errors come back as JSON: `{ "error": "<code>", "message": "..." }`. The
codes you will meet: `unauthorized` (401), `invalid_password` (401),
`too_many_attempts` (429, with `retryAfterSeconds`), `forbidden_origin`
(403), `not_found` (404), `weak_password` (400), `version_conflict` (409,
see [Conditional writes](#conditional-writes)), `locked` (503: the file
was being written by someone else for longer than two seconds; try again),
and for shared vaults `forbidden` (403: only the creator may do that) and
`vault_deleted` (410).

## Cross-site requests

Requests that change something must come from this instance: the session
cookie is `SameSite=Lax`, and the server rejects a request whose `Origin` or
`Referer` names another site. A request with neither header (curl, a script)
is accepted, and so is one that carries an access key and no cookie; see
[Security](security.md).
