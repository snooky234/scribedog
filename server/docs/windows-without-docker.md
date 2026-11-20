# On one Windows PC, without Docker

The server edition can also run straight on Node.js, as a small local web
app on one Windows computer. No Docker, no WSL, no installer and no
administrator rights: you build it once, start it from a batch file, and
open ScribeDog in the browser.

## Who this is for

This is meant for a computer where the desktop app cannot run, typically a
managed work PC where SmartScreen or a company policy blocks unsigned
programs and Docker or WSL are not available either. If you can start the
desktop app, use that instead: it has everything this setup has and more
(see [What is different](#what-is-different)).

> **One person, one computer.** The server listens on `127.0.0.1` only, so
> no other device can reach it, and it runs over plain HTTP. That is fine
> because nothing leaves the computer. Do not open it to the network this
> way; for that, use the [Docker setup](getting-started.md) with HTTPS.

## What you need

- **Node.js 22 or newer.** The "Windows Binary (.zip)" from
  [nodejs.org](https://nodejs.org/en/download) needs no installation: unpack
  it anywhere, e.g. `C:\Tools\node`. The installer works too, if you are
  allowed to run it.
- **The ScribeDog source code.** On the
  [releases page](https://github.com/snooky234/scribedog/releases), open the
  version you want and download *Source code (zip)* under Assets, or clone
  the repository with Git and check out that version's tag.
- **Access to the npm registry** for the build. Behind a company proxy, tell
  npm about it first: `npm config set proxy http://proxy:port` and
  `npm config set https-proxy http://proxy:port`.
- **A folder for your notes**, e.g. `C:\Users\<you>\Documents\Notes`. It has
  to exist before the first start.

## Build it

Unpack the source code, e.g. to `C:\Tools\scribedog`. Open a command prompt
(`cmd`) and run:

```bat
set PATH=C:\Tools\node;%PATH%
cd /d C:\Tools\scribedog
npm install
npm run build:web
cd server
npm install
npm run build
```

The first line is only needed if you unpacked Node.js from the zip; with the
installer, Node.js is already on the path. `npm run build:web` builds the web
app into `dist-web`, `npm run build` the server into `server\dist`. Neither
needs Rust or anything else the desktop app's build needs. It takes a few
minutes.

## Start it

Create `start.bat`, for example next to the source folder, and adjust the
three paths:

```bat
@echo off
set PATH=C:\Tools\node;%PATH%
set SCRIBEDOG_VAULT_PATH=C:\Users\%USERNAME%\Documents\Notes
set SCRIBEDOG_INIT_PASSWORD=choose-a-password
set SCRIBEDOG_HOST=127.0.0.1
set SCRIBEDOG_PORT=3000
set SCRIBEDOG_COOKIE_SECURE=false
set SCRIBEDOG_TRUST_PROXY=false
cd /d C:\Tools\scribedog\server
node dist\server\index.js
```

What the settings do:

| Setting | Why |
| --- | --- |
| `SCRIBEDOG_VAULT_PATH` | Your notes folder. |
| `SCRIBEDOG_INIT_PASSWORD` | The password, eight characters or more. Only read on the very first start; after that it is stored (as a hash) in the notes folder and you should delete this line from the file. |
| `SCRIBEDOG_HOST=127.0.0.1` | Only this computer can connect. Leave this as it is. |
| `SCRIBEDOG_PORT` | Any free port. The app is then at `http://127.0.0.1:<port>/`. |
| `SCRIBEDOG_COOKIE_SECURE=false` | Plain HTTP needs a cookie without the `Secure` flag. On `127.0.0.1` the server logs this as fine for local use; on any other host it warns. |
| `SCRIBEDOG_TRUST_PROXY=false` | There is no reverse proxy in front, so the server must not believe a forwarded address. |

Two optional lines change how the browser tab looks, for example
`set SCRIBEDOG_TITLE_FORMAT={doc}` for only the note's name and
`set SCRIBEDOG_FAVICON=C:\Tools\scribedog-icon.png` for your own icon
(`.svg`, `.png` or `.ico`). Here the path is simply one on this computer. See
[Tab title and icon](configuration.md#tab-title-and-icon) for the details.

Double-click `start.bat`. A console window opens and, after a moment, logs
`ScribeDog Server ready`. Open <http://127.0.0.1:3000/> and sign in. On the
first start with an empty folder, the server creates a `Welcome.md`.

The console window is the server: closing it stops ScribeDog. Your notes are
saved as you type, so nothing is lost when you close it.

## Start with Windows

**The simple way.** Press <kbd>Win</kbd>+<kbd>R</kbd>, enter
`shell:startup` and put a shortcut to `start.bat` into the folder that
opens. In the shortcut's properties, set *Run* to *Minimized*. The server
then starts with every sign-in, with its window in the taskbar.

**Without a window.** A batch file always shows a console. To hide it,
create `start-hidden.vbs` next to `start.bat`:

```vbs
CreateObject("Wscript.Shell").Run """C:\Tools\start.bat""", 0, False
```

and put a shortcut to that file into the startup folder instead. To stop
the server, end `node.exe` in Task Manager. Some company policies block
`.vbs` files; if this one does nothing, go back to the minimized window.

Bookmark `http://127.0.0.1:3000/` in your browser. Right after signing in to
Windows, the page may need a few seconds before it answers.

## What is different

Everything the web app does works here: the file tree, editing, images,
version history, live updates when a file changes on disk, export, links to
documents and the AI features. Compared to the desktop app:

| | This setup | Desktop app |
| --- | --- | --- |
| Knowledge base | not available | yes |
| Built-in dictation | not available, use Windows' own voice typing (<kbd>Win</kbd>+<kbd>H</kbd>) | yes |
| Importing files | not available | yes |
| Opening any folder | one notes folder, set in `start.bat` | any folder |
| Updates | rebuild by hand | built in |

## AI

Cloud providers work as described in [AI](ai.md). A model server on the same
computer (Ollama, Jan.ai, LM Studio) is reached by the browser, and since
the page itself comes from `127.0.0.1`, the model servers usually accept it
without extra configuration. If a request fails, the settings dialog says
why; [A model on your own device](ai.md#a-model-on-your-own-device) has the
details.

## Updating

Back up the notes folder first (see [Backups](data-and-backups.md#backups)).
Then stop the server, replace the source folder with the new version (keep
your `start.bat` outside of it) and run the [build](#build-it) again. Your
notes folder is not touched by any of this; the password and your sessions
stay valid.

## If it does not start

| Log line | What to do |
| --- | --- |
| `Vault path "..." does not exist` | Create the folder, or fix the path in `start.bat`. |
| `'node' is not recognized` | The `PATH` line in `start.bat` does not point at the folder with `node.exe`. |
| `EADDRINUSE` | The port is taken. Pick another `SCRIBEDOG_PORT` and use it in the address. |
| `failed to start` with `ENOENT` and `index.html` | The web app is missing: `npm run build:web` did not run or failed. `dist-web` must exist next to the `server` folder. |
