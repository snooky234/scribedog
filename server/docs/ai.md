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
up what the paragraph above buys. The server only forwards to the three
provider hosts over https; anything else is refused, so this cannot become a
way to reach something else on your network. If you use your own gateway in
front of a provider, add its host to `SCRIBEDOG_LLM_ALLOWED_HOSTS`.

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

Each step of an agent run is one request through the server to the provider,
and each note the agent reads is one request to the server, so a long run
over many notes takes a little longer over Wi-Fi than on the desktop; it does
not need anything else.

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

**Over a public address, the browser asks once.** Chrome and Edge (since 142)
treat a page loaded from the internet reaching into your local network as
something you have to allow: a prompt appears on the first request, and the
answer is remembered per site (it is in the site settings if you want to
change it). Pages loaded from a home network address are not asked. Firefox
has no such prompt. Safari has not been tested.

A phone without a model server simply picks a cloud provider in its own
settings.

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
