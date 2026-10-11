# AI

The AI features of the desktop app (rewrite, insert, grammar check, the chat
with its vault agent, custom assistants) work in the web app as well. What
differs is where the requests go.

## Cloud providers

OpenAI, Anthropic and Mistral work in the browser. Enter the API key in
Settings → AI as you would on the desktop; from there on it differs from the
desktop in two ways worth knowing.

**The key stays on the server.** It is encrypted with a key derived from your
login password and kept in `.scribedog/server/secrets.json`. The browser never
receives it back: the settings field shows "stored" instead of a value, and
requests to the provider are sent by the server, which fills the key in on
the way out. So someone who copies the data folder gets your notes (they are
plain Markdown on purpose) but not your API keys, and a browser extension or
a stray script in the page has nothing to find.

**The server talks to the provider, not the browser.** Browsers block direct
calls to another site's API, and sending the key to the tab to try would give
up what the paragraph above buys. The server only forwards to the hosts in
its allowlist, by default the three providers over https; anything else is
refused, so this cannot become a way to reach something else on your network.
If you use your own gateway in front of a provider, add its host to
`SCRIBEDOG_LLM_ALLOWED_HOSTS` (see
[A model server elsewhere in your network](#a-model-server-elsewhere-in-your-network)
for how the list is written).

The AI settings themselves live in the browser, so each device keeps its own
provider and model choice. The API key is stored once on the server and works
from every device.

## The chat agent

Everything the desktop agent does, the web app does too: it reads and
searches your notes, proposes new notes and edits, and every proposal waits
for your review before it touches a file. The pieces it keeps between
sessions live in the vault, next to the notes: open proposals in
`.scribedog/staged-changes.json`, the checkpoints behind the undo button in
`.scribedog/checkpoints/`, and the chat history in
`.scribedog/chat-sessions.json`. So they follow the vault, not the browser:
open the same server from another device, or from the desktop app, and the
pending proposals and the undo history are there.

You can hand the chat files and images: drag them onto the panel, paste an
image from the clipboard, or use the image button below the input field. Files
become the chat's primary source, images are shown to the model itself, so a
model with vision support can read a screenshot and write what it says into a
note. Both belong to the one chat you attached them to and are kept in the
browser tab only, not in the vault: they are gone when you reload the page or
switch to another chat, while the conversation itself stays. The turn keeps the
names, so an older chat still shows what it was asked about.

Each step of an agent run is one request through the server to the provider,
and each note the agent reads is one request to the server, so a long run
over many notes takes a little longer over Wi-Fi than on the desktop; it does
not need anything else.

Small models sometimes answer a request to write something by putting the
text in the chat and saying they wrote it into the note, without actually
doing it. The app catches that: it asks the model once more what its reply
was, and puts the text into the document as a proposal after all. That second
question takes a moment on a local model, and the chat says "Checking the
reply" while it runs, so a proposal that appears a little later is not
something going wrong.

## A model on your own device

Ollama, Jan.ai and LM Studio work too, with one difference to the desktop
app: the *browser* talks to them, not the server. "localhost" in the API URL
is therefore the device you are sitting at, not the server, and the model
server there has to accept requests from a web page. Two things decide
whether that works, and the app tells you which one is in the way when a
request fails.

**The model server has to allow this page's origin.** Browsers only let a
page call another server if that server says so (CORS), and the local model
servers only say so for pages served from localhost unless told otherwise.
The settings dialog shows the exact origin to allow (`https://<host>` as you
open ScribeDog, with the port if it is not 443):

| Server | What to do |
| --- | --- |
| Ollama | Start it with `OLLAMA_ORIGINS=https://<host>` in its environment (on Windows, set the variable in the user's environment and restart Ollama from the tray). Without it Ollama refuses the page (403). |
| Jan.ai | Settings, Local API Server: keep CORS on and add `<host>` (host name and port, no scheme) to *Trusted Hosts*. |
| LM Studio | In the server settings, enable CORS. |

**A stored API key does not reach it.** The server keeps keys to itself,
and here the browser sends the request, so it has nothing to send. If the
model server on your device asks for a key, enter the device's network
address instead of `localhost` (see the next section; the server then sends
the request and the key), or use the desktop app.

**Over a public address, the browser asks once.** Chrome and Edge (since 142)
treat a page loaded from the internet reaching into your local network as
something you have to allow: a prompt appears on the first request, and the
answer is remembered per site (it is in the site settings if you want to
change it). Pages loaded from a home network address are not asked. Firefox
has no such prompt. Safari has not been tested.

A phone without a model server simply picks a cloud provider in its own
settings.

## A model server elsewhere in your network

Ollama, Jan.ai or LM Studio can run on another machine, say the PC with the
big graphics card. A page served over https may not call a plain http
address, so the ScribeDog server forwards these requests, but only to
addresses you allow.

### Setting it up

1. **Open the model server to the network.** Jan.ai: Local API Server, set
   *Server Host* to `0.0.0.0`. Ollama: start it with `OLLAMA_HOST=0.0.0.0`.
   LM Studio: enable *Serve on Local Network*. Allow the port in that
   machine's firewall.

2. **Allow the address** in the server's `.env`:

   ```env
   SCRIBEDOG_LLM_ALLOWED_HOSTS=default,http://192.168.1.50:1337
   ```

   `default` keeps OpenAI, Anthropic and Mistral. Without it, only the
   model server is allowed.

3. **Check that `docker-compose.yml` passes it on:**

   ```bash
   grep LLM_ALLOWED_HOSTS docker-compose.yml
   ```

   No output means your file is older than this setting. This adds the line
   to every ScribeDog service, also in a setup with several instances:

   ```bash
   sed -i 's/^\( *\)SCRIBEDOG_BASE_PATH: .*/&\n\1SCRIBEDOG_LLM_ALLOWED_HOSTS: ${SCRIBEDOG_LLM_ALLOWED_HOSTS:-}/' docker-compose.yml
   ```

4. **Apply it** with `docker compose up -d`. A plain `docker compose restart`
   keeps the old values.

5. **Enter the address** in Settings → AI as the API URL, e.g.
   `http://192.168.1.50:1337`. If the model server asks for an API key, enter
   it in the API key field; it is stored encrypted on the server like a cloud
   key.

### If it does not work

| The app says | Check |
| --- | --- |
| "The ScribeDog server is not allowed to reach …" | The server does not know the address. `docker compose config \| grep LLM_ALLOWED_HOSTS` has to show your line; if not, step 3 or 4 is missing. |
| "… could not be reached" | `docker compose exec scribedog wget -qO- http://192.168.1.50:1337/v1/models` (with several instances `scribedog-1`). No answer: step 1. |
| OpenAI is refused now | `default,` is missing in front of your entries. |

### Which addresses are allowed

| Entry | Meaning |
| --- | --- |
| `default` | OpenAI, Anthropic and Mistral, over https |
| `gateway.example.com` | That host over https, e.g. your own gateway |
| `http://192.168.1.50:1337` | Exactly this address and port, over plain http |
| `http://jan.fritz.box:1337` | A name in your network; each request checks it resolves to one |

Plain http works only inside your own network: `10.x.x.x`, `172.16.x.x` to
`172.31.x.x`, `192.168.x.x`, or names ending in `.local`, `.lan`,
`.home.arpa`, `.internal` or `.fritz.box`. Anything else stops the server at
start, since it would send your notes unencrypted across the internet.
"Your network" is the server's network, so this also works when you open
ScribeDog from outside your home.

**In the desktop app** none of this applies: with a [server vault](desktop-app.md)
the app talks to the model on your computer directly, as it does with a local
folder, and the API keys stay in the operating system's credential store.

## What stays desktop only

The knowledge base (the vault search index with embeddings) is desktop only,
and only for local folders: its index lives in the desktop app and reads the
notes from disk. The agent's own `search_files` and `read_file` tools do not
need it.

Dictation with Whisper is desktop only as well; see
[Phones and tablets](phones-and-tablets.md) for what to use in the browser.

## Hiding the AI features

If you have no model to talk to, switch off Settings → Application → Show AI
features. The AI buttons in the toolbar, the chat, the AI entries in menus
and shortcuts and the AI pages of the settings disappear, and the knowledge
base stops updating in the background. Your AI settings and a stored API key
stay where they are, so switching it back on finds everything as it was.

Like the rest of the AI settings, the switch is kept per browser: hiding the
AI on your phone leaves it visible on your laptop.
