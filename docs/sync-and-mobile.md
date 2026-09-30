# Sync and mobile access

[Documentation](README.md) / Sync and mobile access

ScribeDog keeps everything as plain `.md` files in a normal folder. Making
your notes available on other devices is therefore just a matter of syncing
that folder with a service **you** choose. There is no ScribeDog account.

There are two ways to reach your notes on the go:

| | Sync the folder | Run the Server Edition |
|---|---|---|
| How | A sync service plus a Markdown app on the phone | Your own server, used in any browser |
| Editor on the phone | A third-party Markdown app | The ScribeDog editor itself |
| Needs | A sync service | A server, Docker host, NAS or Raspberry Pi |
| Guide | Below | [Server Edition guide](../server/docs/README.md) |

## Sync the folder

### Self-hosted (recommended for privacy)

A self-hosted [Nextcloud](https://nextcloud.com/), or another private cloud,
keeps your files on infrastructure you control. On mobile, open and edit
them with **Nextcloud Notes** or any Markdown editor that syncs with your
provider.

### Any other cloud

OneDrive, iCloud Drive, Dropbox and similar services work too. Point the
service at your vault folder, then edit on mobile with a compatible Markdown
app, for example Obsidian, Markor on Android or iA Writer.

## Things to watch

> **Sync the whole folder, not just the `.md` files.**

- ScribeDog keeps embedded images in an `images/` subfolder and links them
  **relatively**. Some mobile Markdown apps do not resolve such paths, so
  inline images may not show on mobile even though the text syncs fine.
- Make sure your sync client includes subfolders, such as `images/`, and the
  hidden `.scribedog` folder.
- Do not edit the same file on two devices at once. That is how sync
  conflicts happen.
- ScribeDog notices when a note changed on disk while you were editing it and
  asks before overwriting. See
  [Saving](notes-and-vault.md#saving-never-overwrites-an-outside-edit-unnoticed).

## Backups

Your vault is a folder of files, so any backup tool works. Add a version
history on top if you like: see [Version history](notes-and-vault.md#version-history).

[Back to the documentation index](README.md)
