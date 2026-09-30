# Privacy

[Documentation](README.md) / Privacy

ScribeDog is offline by default. Your notes are plain files on your disk, and
nothing is sent anywhere unless you set it up.

## What is sent, and when

| What | When | Where to |
|---|---|---|
| Update check (Windows) | At startup, can be switched off | GitHub. A version comparison, no usage data. |
| AI requests | Only when you trigger an AI action | The endpoint **you** configured |

Nothing else is sent. There is no telemetry and no analytics. There is no
ScribeDog account, and no ScribeDog server sits between you and your AI
provider.

## AI providers

- **Local providers** (Ollama, Jan.ai, LM Studio): the only network call is
  to the local endpoint you configure. With a local model, no byte leaves
  your computer.
- **Cloud providers** (OpenAI, Anthropic, Mistral): bring your own key. Your
  text goes to that provider, under its terms and privacy policy. The
  settings dialog shows a clear notice whenever a cloud provider is selected.

Cloud endpoints must use HTTPS and need an API key. Local endpoints must
resolve to your own machine.

## API keys

Keys are stored in your operating system credential store: the Windows
Credential Manager or the Linux Secret Service. They are not written to disk
in plain text, and they are sent only to the provider you chose.

## The knowledge base

It is **off until you switch it on**, and only then may the AI read notes
beyond the open document. You choose the folders, and unticked folders stay
out. Search by words runs locally. Only the passages found for your question
are sent to the model you configured. Details: [Knowledge base](knowledge-base.md).

## File access

The app can only reach the folder you opened. Its file permissions are scoped
to that folder, and its network permissions to your configured AI endpoint.

## Open source

ScribeDog is MIT licensed. Every release is built from this repository by
GitHub Actions, so you can check what went into it.

## Your data without ScribeDog

Everything ScribeDog writes is a plain `.md` file in a folder you picked.
There is no database and no proprietary container. Open the same folder in
any other editor and keep working.

[Back to the documentation index](README.md)
