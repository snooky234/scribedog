# Setting up AI

[Documentation](README.md) / Setting up AI

The AI features are optional. ScribeDog works as a plain Markdown editor
without them. Everything is configured in the **AI settings** dialog:
provider, API address, model, context length and thinking mode. The settings
are stored on your device.

## Local or cloud?

| | Local | Cloud |
|---|---|---|
| Where the model runs | On your computer | At the provider |
| Your text leaves the device | No | Yes, to that provider |
| Account and API key | Not needed (optional, if your runner asks for one) | Your own API key |
| Cost | Free | Pay per use |

If privacy is the point for you, use a local model. Cloud providers are
strictly opt-in and never used automatically.

## Local models

ScribeDog does not ship a model of its own. It talks to one running on your
computer, served by a small helper app called a **model runner**. The runner
downloads models for you and offers them at a local address such as
`http://localhost:11434`. ScribeDog sends your text there and streams the
answer back. Nothing goes to the internet.

You need exactly one of these:

| Runner | Good for | Default address |
|---|---|---|
| [Ollama](https://ollama.com/) | The simplest and most popular option. Models come with one command or one click. | `http://localhost:11434` |
| [Jan.ai](https://jan.ai/) | A friendly desktop app with a model browser and its own chat window. | `http://localhost:1337` |
| [LM Studio](https://lmstudio.ai/) | The most control over parameters, quantization and VRAM use. | `http://localhost:1234` |

### Set it up

1. Install one runner from its website.
2. Pick a model in the runner and let it download. Something like Gemma 3/4
   or Qwen 3 is a good start, and a model of about 4 to 8 GB is a sensible
   first choice.
3. Make sure the runner is running.
4. In ScribeDog, open **AI settings**, choose the provider (the matching
   default address is filled in for you) and select the model.
5. Select some text and press `Ctrl+E` to try it.

> **Good to know:** Modern open models work well on a mid-range gaming GPU
> with 6 GB of VRAM, and smaller variants run on laptops without a dedicated
> GPU. That is enough to rewrite paragraphs, fix tone and grammar, draft a
> letter or summarize notes.

### A runner on another computer

The runner does not have to run on the computer you write on. If the PC with
the graphics card sits elsewhere in your home, run the runner there and enter
its network address in **AI settings**, for example
`http://192.168.1.50:1337` for Jan.ai. Two things on that computer:

- The runner has to listen on the network, not only on its own machine.
  Jan.ai: set the server host to `0.0.0.0` in the Local API Server settings.
  Ollama: start it with `OLLAMA_HOST=0.0.0.0`. LM Studio: enable "Serve on
  Local Network".
- Its firewall has to let the port through.

ScribeDog accepts addresses in your own network (`192.168.x.x`, `10.x.x.x`,
`172.16.x.x` to `172.31.x.x`, or a name ending in `.local`, `.lan`,
`.home.arpa`, `.internal` or `.fritz.box`). Plain http to an address on the
internet is refused, since it would carry your text unencrypted.

### An API key for the runner

A runner does not need a key out of the box. If you set one up, for example
the API key in Jan.ai's Local API Server settings, an LM Studio token, or an
Ollama behind a reverse proxy that checks one, enter it in the **API key**
field in **AI settings**. ScribeDog sends it as a bearer token, the same way
as to a cloud provider.

The key is stored per provider in your operating system credential store, so
your Jan.ai key and your OpenAI key never get mixed up. The knowledge base
keeps its own key next to its own connection. On the way to a runner in your
network the key travels over plain http, just like your text.

### Which model size?

| Model size | What to expect |
|---|---|
| Small (for example Gemma 4 E4B) | Often writes good text. Follows instructions *about* the text less reliably. Use it with select and rewrite (`Ctrl+E`). |
| About 9B and up (for example Qwen 3.5 9B, Gemma 4 12B) | Handles the [AI chat](ai-chat.md) and its tools reliably. |
| Cloud models | Handle the chat tools well. |

A typical slip of a small model: if your prompt is in a different language
than the selected passage, it may translate the passage instead of keeping it.
A slightly larger model avoids that.

The agentic chat depends on the model calling tools correctly. Below roughly
9B parameters it tends to call them wrongly or not at all. For such models,
stay with select and rewrite. It asks nothing of the model beyond writing
text.

## Cloud providers

1. In **AI settings**, choose **OpenAI**, **Anthropic** or **Mistral**.
2. Paste an API key that you created in the provider dashboard.

The key is stored in your operating system credential store and sent only to
that provider. There is no ScribeDog server in between. The settings dialog
shows a notice whenever a cloud provider is selected.

> **Note:** With a cloud provider, the selected text is sent to that
> provider under its own terms and privacy policy. That includes the whole
> document if you enable "include document as context". Read those terms
> before sending anything sensitive.

## Thinking output

Some models print their reasoning before the answer. ScribeDog filters it out
automatically. Only the final answer reaches your document.

[Back to the documentation index](README.md)
