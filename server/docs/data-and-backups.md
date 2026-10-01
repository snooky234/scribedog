# Your data and backups

## Where your data is

`./scribedog-data` is bind-mounted into the container as `/data`. It holds:

- your notes, as ordinary `.md` files in whatever folders you like;
- a folder's own note, where you use folder notes: `.scribedog-foldernote.md`
  inside that folder. It is a normal Markdown file, only the file tree shows
  it on the folder row instead of listing it next to its siblings;
- `images/` for pictures inserted, pasted or dropped into notes;
- `.scribedog/` with the same sidecars the desktop app keeps (version
  history, manual sort order, the icons picked for files and folders, chat
  sessions, the agent's pending proposals and checkpoints, and the settings
  that belong to the folder rather than to the app, such as heading numbering
  and the folder-notes switch), written by
  the app through the server, plus `.scribedog/server-data-version`, which
  says which layout the folder is in (see [Updating](updating.md));
- `.scribedog/server/` with the server's own files: `auth.json` (the
  password hash), `session-secret` (signs session cookies), `secrets.json`
  (the encrypted API keys) and `tokens.json` (fingerprints of the desktop
  apps' access keys). It is created on first start with mode `0600` and is
  the one place the file API never reaches.

Because it is a plain folder, everything that works with folders works with
it: open it in another editor over SSH, grep it, put it under version
control, sync it with another tool. Changes made on the host show up in open
browser tabs and desktop apps within a second: the server watches the folder
and pushes a signal, the app rescans.

Deleting `.scribedog/server/auth.json` resets the password: set
`SCRIBEDOG_INIT_PASSWORD` again and restart (see [Security](security.md) for
what that means for the stored API keys).

## Editing from more than one place

The same vault can be open in several browsers and desktop apps at once, and
each sees the others' changes live. A note is never locked, but no save
overwrites another one unnoticed: the server writes a note only while it is
still the version the app read, and checks that in the same step as the
write, so two saves arriving at once cannot both get through. When the note
has moved on, the app merges the two versions line by line:

- Different notes in different places: fine.
- The same note, edits at different places: merged and saved without a
  question, in the browser as in the desktop app.
- The same note, edits to the same lines: whoever saves second is asked.
  **Review passages** shows each overlapping passage in the editor, the other
  version in red and yours in green, to accept or discard one by one;
  **Keep my version** overwrites the other one. While versioning is on,
  both versions end up in the version history either way.

An auto-save never asks. It pauses for that note, and the save button says
**Resolve conflict** until you click it.

There is no live co-editing: you see the other person's change when your
next save merges it in, or when the note is reloaded, not keystroke by
keystroke.

Unsaved edits are a different matter: a note you have typed into but not
saved is kept as a draft, and the draft stays in the browser (or desktop
app) you typed it in, not on the server. Close the tab, come back the next
day, and the note is still marked as changed with your edits in place; the
other devices see the saved note only. The desktop app does the same for a
local folder, but there the draft lives in the vault's `.scribedog/drafts/`;
for a server vault nothing of the kind is written to the server, so two
people editing the same vault never see each other's half-written text.

## Backups

Because it is a plain folder, back it up like any other folder with the tool
you already use; ScribeDog brings no backup feature of its own. Two things
matter in the choice: the copy should be encrypted (the notes are plain
Markdown), and it should keep history (a note deleted by mistake is only in
yesterday's copy). [restic](https://restic.net) and [kopia](https://kopia.io)
do both and run from a cron job or systemd timer on the host, outside Docker,
for example every night:

```bash
# once: restic init --repo /backup/scribedog   (or an S3/SFTP/rclone target)
0 3 * * * restic --repo /backup/scribedog backup /srv/scribedog/scribedog-data && restic --repo /backup/scribedog forget --keep-daily 14 --keep-weekly 8 --prune
```

Backing up while the app is running is fine: the folder holds small text and
JSON files that are written one at a time, there is no database with locks or
a write-ahead log, so the worst case is one note caught between two saves.

If the host cannot run a cron job (some NAS appliances), a backup container
in the compose file is the alternative: a `restic` or `kopia` image with
`./scribedog-data` mounted read-only and the repository mounted or reachable
over the network, scheduled by its own entrypoint. It is the same backup,
just a heavier way to schedule it.

**A copy on your own machine** without a backup tool: in the browser or the
desktop app, right-click the vault name at the top of the file tree and
choose **Download as ZIP (Markdown files)**. That is the folder as it is on
the server (notes, images, subfolders) without the `.scribedog` metadata,
so it is a copy of your notes, not a backup of the instance; a script can
fetch the same ZIP from `GET /api/export/zip?path=` with an access key, see
[API](api.md).

**Restoring** is copying the folder back and starting the server. Sessions
and access keys are in the folder too (`.scribedog/server/`), so everyone
stays signed in; if you restore only the notes, they sign in again.

## What a backup does not cover

The notes are not encrypted at rest on purpose (they stay readable with any
editor, greppable, free of lock-in), so whoever gets the disk gets the notes.
If that matters where the box stands, encrypt below the folder rather than
in it: full-disk encryption (LUKS on a server, the SD card of a Raspberry Pi
included) or a transparent layer such as
[gocryptfs](https://nuetzlich.net/gocryptfs/) mounted at the bind-mount path.
Both are invisible to ScribeDog. What no file system setting covers is root
on the same host, who can read everything by definition; see
[Security](security.md).
