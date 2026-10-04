# The desktop app as a client

The ScribeDog desktop app can open a vault that lives on a ScribeDog server,
the same way it opens a folder on your disk. Your notes stay on the server;
everything else, including AI with a local model, dictation, import and
export, keeps running on your computer. The browser is not involved.

This is the way to use one set of notes from your desk and from your phone
without a sync tool: the desktop app and the phone's browser both talk to
the same server.

## Adding a server

1. In the desktop app, open the vault menu at the top of the sidebar (the
   name of the open folder) and choose **Add server vault…**.
2. Enter the server address as you open it in the browser, for example
   `https://notes.example.com` or `https://192.168.1.10/anna` if the
   instance runs under a path prefix. HTTPS is required; only `localhost`
   may use plain HTTP.
3. Enter the server's password. It is used once, to obtain an access key
   for this computer, and is not stored.
4. Optionally give the vault a name for the sidebar, and check the device
   name (how this computer appears in the server's list of signed-in
   devices; "ScribeDog on Windows" by default).
5. **Add.** The vault opens, and from now on it is in the vault menu next to
   your local folders, marked with a server icon. The app reopens it at
   startup like any other last-used vault.

The access key is kept in the operating system's credential store (Windows
Credential Manager, macOS Keychain, Linux Secret Service), where the desktop
app also keeps API keys. It does not expire; it ends when you disconnect, when
you revoke it from another device, or when the server's password changes.
See [Security](security.md) for what a key can and cannot do.

## The certificate

The desktop app checks the server's certificate against the operating
system's certificate store, the same store the browsers use (Firefox
excepted). With a Let's Encrypt certificate nothing needs doing. With Caddy's
local CA, import `scribedog-ca.crt` into the system store once, as described
in [Getting started](getting-started.md); accepting the warning in a browser
is not enough for the app. There is no option to skip the check.

## Working with a server vault

Everything works as with a local folder: the file tree, creating, renaming,
moving and deleting notes and folders, images, sort order, the version
history, the chat agent with its proposals and checkpoints, export and
import. Every read and write is a request to the server, so a large vault
over Wi-Fi feels a little slower than a local folder, and a vault with many
notes takes a moment to open.

**Changes from elsewhere show up live.** When you edit a note in the browser,
or a sync tool writes into the folder on the server, the desktop app sees the
change within a second, the way it does for a local folder.

**Shared vaults are in the vault menu.** When the server you are connected to
has [shared vaults](multiuser.md#shared-vaults), the menu behind the vault
name lists them indented under that server, next to your local folders, with
**New shared vault…** and **Manage vaults…** below. Opening one makes it the
vault the app works in, with its own version history and its own last opened
note.

**The same note in two places is safe, but not live.** If the desktop app and
a browser tab both have a note open and both save, the later save merges the
earlier one in when the edits sit at different places, and asks when they
touch the same lines. Nothing is overwritten unnoticed. You do not see the
other side typing, though; see
[Editing from more than one place](data-and-backups.md#editing-from-more-than-one-place).

**The notes are on the server, so the file tree offers two extra entries**
that a local folder does not need: **Download as Markdown** on a note (also
in the editor's ⋮ menu) saves it as the `.md` file it is, through a save
dialog, and **Download as ZIP (Markdown files)** on a folder, or on the
vault name for the whole vault, saves the folder as it is on the server:
notes, images and subfolders, without the `.scribedog` metadata. That ZIP
is packed by the server (`GET /api/export/zip`), so it is quick even over a
slow connection. The rendered export (PDF, DOCX, ODT, HTML, EPUB) works as
for a local folder and writes into a folder you pick.

**The knowledge base is not available for a server vault.** Its search index
runs inside the desktop app and reads the notes from your disk, which a
server vault is not on. The settings tab says so. The chat agent's own
search and read tools work as usual.

## Signing in again

If the server refuses the access key, because it was revoked in the browser
or the server's password was changed, the app asks for the password instead
of failing quietly, also while it is sitting idle with the vault open. Enter
the password and work continues where it was; unsaved edits are kept.

## Disconnecting, and the device list

**Vault menu → Manage vaults…** lists every server the app knows, under
**Connected servers**, next to the folders and shared vaults. **Edit** on a
server opens it:

- **Display name** is what the sidebar and the vault menu call this server.
  Only this computer sees it; the server is not renamed.
- **Signed-in devices** is the server's own list (every desktop app that
  holds an access key), with when each was added and last used, and a
  **Revoke** button per device. This computer is marked. Revoking a device
  ends its access without changing the password, which is what to do when a
  laptop is lost.
- **Disconnect** revokes this computer's own key on the server, deletes it
  from the credential store and removes the server from the list. Nothing on
  the server changes; adding the server again picks up where it left off,
  including the last opened note.

The same device list is in the browser under **Settings → Account**, so a
lost laptop can be signed out from a phone.

## What stays on your computer

The server holds the notes and everything that belongs to the vault (images,
version history, the agent's proposals and checkpoints, chat sessions). The
desktop app keeps on your computer what is about the app rather than the
vault: the list of servers, the AI settings and API keys, the theme and
language, keyboard shortcuts, the Whisper model. Two desktop apps on two
computers therefore share the notes but not the settings. Custom colour
themes move by export and import in the theme builder (see the
[FAQ](faq.md#the-desktop-app)).
