# Voice input

[Documentation](README.md) / Voice input

Dictate into a note or into an AI prompt. Speech recognition runs **entirely
on your device** with [whisper.cpp](https://github.com/ggerganov/whisper.cpp).
No cloud service is involved and no audio ever leaves your computer.

<img src="images/scribe-dog-voice-input.png" alt="ScribeDog offline voice dictation" width="700">

## Dictate into a note

1. Press `Ctrl+Shift+W` and speak.
2. Press `Enter` to transcribe, or `Esc` to cancel.
3. The text is inserted at the cursor as normal, editable text.

One `Ctrl+Z` undoes the whole insertion.

## Dictate an AI prompt

Press `Ctrl+Shift+E`. The AI dialog opens and starts recording right away.
You can also use the microphone button in the dialog.

The transcript lands in the prompt field and stays editable until you send
it. See [AI writing](ai-writing.md).

## The speech model

- The multilingual model is about 465 MB.
- It is downloaded **once**, on first use, with a progress dialog. It works
  much like setting up a local language model.
- It covers all 10 interface languages and more.

## With a server vault

Whisper runs in the desktop app only. The desktop app keeps dictating on your
own computer when it opens a [server vault](../server/docs/desktop-app.md).

The browser version has no microphone button. On phones and tablets, use the
dictation your device already has. The
[server guide](../server/docs/phones-and-tablets.md#dictation) lists the options.

[Back to the documentation index](README.md)
