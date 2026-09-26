# FAQ

## Setting up

**Do I need a domain?**
No. On a home network, `SCRIBEDOG_SITE_ADDRESS` can be the box's name or IP
and Caddy signs the certificate with its own CA; import that CA once per
device (see [Getting started](getting-started.md)). A domain only matters if
you want Let's Encrypt or reach the server from the internet.

**The browser says the connection is not private.**
That is Caddy's local CA, which the browser does not know yet. Accept the
warning, or import `scribedog-ca.crt` so it stops; the file is behind
"Download certificate" in Settings, Account. Details in
[Getting started](getting-started.md).

**I can reach the app on the server but not from my laptop.**
Caddy answers only for the addresses in `SCRIBEDOG_SITE_ADDRESS`. Add the
name or IP your laptop uses, run `docker compose up -d`, and check that
ports 443 (and 80) are open on the box's firewall.

**Can I use my existing nginx or Traefik?**
Yes. Proxy to the container's port 3000, forward the WebSocket upgrade for
`/api/events`, do not strip a path prefix, and set `SCRIBEDOG_TRUST_PROXY`
to the number of proxies. See [Configuration](configuration.md).

**Can two people use one server?**
Each person gets their own instance under a path prefix, with their own
password and folder; [`examples/multi-instance/`](../examples/multi-instance/)
is a ready compose file. There are no shared vaults or accounts, on purpose.

## The password and signing in

**I forgot the password.**
Delete `.scribedog/server/auth.json`, set `SCRIBEDOG_INIT_PASSWORD` and
restart. Notes are untouched; stored AI API keys have to be entered again;
desktop apps sign in again. See [Security](security.md).

**Why am I locked out after a few wrong tries?**
Brute-force protection: a minute after five failures, then five, then
fifteen. Wait, or fix the password. The numbers are configurable.

**How long do I stay signed in?**
In the browser, 60 days of use; every visit extends it. The desktop app's
access key does not expire until it is revoked.

**Does changing the password sign out my phone?**
Yes, every browser and every desktop app except the one you changed it on.
To sign out one device only, revoke it in the device list instead.

## The desktop app

**Can I use the desktop app with the server?**
Yes: "Add server vault…" in the vault menu. Notes stay on the server; AI,
dictation, import and export run on your computer, and the file tree's
context menu can save a note or a folder from the server as Markdown. See
[The desktop app as a client](desktop-app.md).

**The desktop app says the server cannot be reached, but the browser works.**
Usually the certificate: the desktop app trusts the operating system's
certificate store, and accepting a warning in the browser does not put the CA
there. Import `scribedog-ca.crt` (Settings, Account, "Download certificate"
in the browser) into the system store. On Linux, the app does not use
Firefox's store.

**Can I add a server over plain HTTP?**
Only `localhost`. Everything else must be HTTPS, because the password and the
access key would otherwise cross the network in clear text.

**Where is my access key stored?**
In the operating system's credential store (Windows Credential Manager,
macOS Keychain, Linux Secret Service), never in a file the app writes. The
server keeps only a fingerprint of it.

**I lost a laptop that had the server added.**
Revoke its key: Settings → Account in the browser, or Settings → Servers in
another desktop app. Its next request is refused. The password stays.

**Why is the knowledge base greyed out for a server vault?**
Its index runs inside the desktop app and reads the notes from your disk. A
server vault is not on your disk. The chat agent's own search works.

**Can I open the same vault in the browser and the desktop app at once?**
Yes, and each sees the other's changes live. Just do not type in the same
note in both at the same time: there is no locking, and the later save wins.
See [Your data and backups](data-and-backups.md).

**How do I get my colour theme from the browser into the desktop app?**
Custom themes (Settings → Appearance → theme builder) are stored in the
browser, not on the server, so another browser or the desktop app does not
have them yet. Open the theme in the theme builder and export it, as a file
(the browser downloads a small `.scribedog-theme.json`) or to the clipboard.
In the desktop app, open the theme builder and import the file or paste it.
The same way works between two browsers. Clearing the browser's site data
deletes the themes stored there, so keep an exported copy of the ones you
care about.

## Notes and data

**Where are my notes?**
In `./scribedog-data` next to the compose file, as plain `.md` files.
Everything the app knows is in that folder. See
[Your data and backups](data-and-backups.md).

**Can I edit the files directly on the server?**
Yes, with any editor, over SSH, with a sync tool. Open browsers and desktop
apps see the change within a second.

**How do I back up?**
Back up the folder with restic, kopia or whatever you use, encrypted and with
history, from a cron job on the host. Backing up while the app runs is fine.

**Are the notes encrypted?**
Not by ScribeDog: they are plain Markdown on purpose. Use full-disk
encryption or gocryptfs below the folder if the box's location calls for it.
API keys and password are protected (encrypted, hashed).

**What is the `.scribedog-foldernote.md` file in some of my folders?**
A folder note: the folder's own text, written once you turn folder notes on
under Settings → Open folder. It is a normal Markdown file, so search,
version history and backups treat it like any other note; only the file tree
shows it on the folder row. Switching the setting off leaves the files where
they are.

**Can I give files and folders their own icons?**
Yes. Right-click a row in the file tree and pick **Change icon** (the same
entry removes one again); on the desktop you can also click an icon in the
path above the note. The icons are stored in the vault, in
`.scribedog/icons.json`, not in the notes themselves, so setting one is not
an edit: no unsaved changes, no new version, and nothing shows up in an
export or in Git. Copy the folder somewhere else and the icons come along;
rename a file outside ScribeDog and its icon is gone, the same way its place
in a manual sort order is.

**What is the "In progress" list above the file tree?**
The notes you pinned as the ones you are working on (double-click, Enter or
the context menu in the tree); it stays hidden until you pin the first one.
A setting adds every note you edit as well, if you want that. The cross
closes an entry; a note with unsaved changes asks whether to save or discard
first. The list is stored in the vault
(`.scribedog/open-files.json`), so it is the same in every browser and
desktop app that opens this vault; only the unsaved drafts themselves stay
in the browser they were typed in. In the browser, Ctrl+W closes the tab,
as it always does, not the entry; use the cross or the context menu.

**Why is a note marked as changed after I reopen the tab?**
You typed into it and did not save. The app keeps such unsaved edits as a
draft in the browser and brings them back when you open the vault again, so
nothing is lost by closing the tab. Save the note to keep the edits; the
draft belongs to this browser, so on another device the note shows its
saved content until you do.

**Will images show up on my phone?**
Yes: the web app resolves the relative image paths itself, unlike some
third-party Markdown apps used with a sync folder.

**How do I get a note out of the browser?**
Right-click it in the file tree (long-press on a phone). **Export…** renders
it as PDF, DOCX, ODT or HTML and the browser downloads the file; for a
folder or a selection you get one ZIP with one document per note, or one
merged document if you tick "Merge into one file" (EPUB is offered there
too, since a book is one file). **Download as Markdown** saves the note as
the `.md` it is; it is also in the editor's ⋮ menu next to Print. For a
folder, or the whole vault from the vault name at the top, **Download as
ZIP (Markdown files)** gives you the folder as it is on the server: notes,
images and subfolders, without the `.scribedog` metadata.
The rendering happens in the browser, so a very large folder export takes a
moment; the Markdown ZIP comes straight from the server.

**Can I import files in the browser?**
Not yet; the import runs in the desktop app, also with a server vault. In
the browser, paste the text or upload the file to the server folder (SSH,
a sync tool) and it shows up in the tree.

## AI

**Which AI providers work in the browser?**
OpenAI, Anthropic and Mistral through the server (the key never reaches the
browser), and Ollama, Jan.ai or LM Studio running on the device you browse
from, if they allow the page's origin. See [AI](ai.md).

**Can the server use the Ollama on my home server?**
Not yet: the server only forwards to the cloud providers, and a browser
reaches a local model server directly. The desktop app with a server vault
uses the model on your computer, as always.

**I don't use AI. Can I get rid of the buttons?**
Yes: Settings → Application → Show AI features. It hides the toolbar
buttons, the chat and the AI settings pages in that browser; your AI
configuration is kept. See [AI](ai.md#hiding-the-ai-features).

**Where are my API keys?**
Encrypted on the server, under a key derived from your password. The browser
sees a placeholder that says "stored". A password reset (not a change) makes
them unreadable; enter them again then.

**Is there dictation?**
Not in the web app; use the system's dictation (Win+H, the macOS dictation
key, the keyboard microphone on phones), which types straight into the
editor. The desktop app's Whisper dictation works with a server vault.

## Updating

**How do I update?**
Set the new version in `SCRIBEDOG_IMAGE`, then `docker compose pull` and
`docker compose up -d`, or `git pull` and `docker compose up -d --build`.
Nobody is signed out. See [Updating](updating.md).

**The server refuses to start after I went back to an older version.**
The data folder was written by a newer server and its layout moved on. Start
the newer version again, or restore a backup from before the upgrade.

**Do the desktop app and the server have to match?**
Keep them at the same version where you can. The release notes say when a
release needs both updated together.
