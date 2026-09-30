# Building from source

[Documentation](README.md) / Building from source

You need [Node.js](https://nodejs.org/) and the
[Rust and Tauri toolchain](https://tauri.app/start/prerequisites/) for your
platform.

## Commands

```bash
# Install dependencies
npm install

# Start the app in development mode
npm run tauri dev

# Type-check and build the frontend
npm run build

# Run the unit tests
npm test

# Build the installers for the current platform
# (Windows: NSIS and MSI, Linux: AppImage and .deb)
npm run tauri build
```

`npm run dev` starts only the Vite frontend, without the native shell. That
is fine for pure UI work.

## Extra requirements for the Rust side

The voice feature uses `whisper-rs`, which needs LLVM and libclang at build
time.

- **Windows:** install LLVM **21 or older**, for example
  `winget install LLVM.LLVM --version 18.1.8`. LLVM 22 generates bindings that
  fail the layout checks of `whisper-rs-sys`.
- **Linux:** `libasound2-dev`, `libclang-dev` and `cmake`.

## Tech stack

| Layer | Technology |
|---|---|
| App shell | [Tauri 2](https://tauri.app/) |
| UI | React 18, TypeScript, Vite |
| Editor engine | [TipTap](https://tiptap.dev/) (ProseMirror) with `tiptap-markdown` |
| Styling | Tailwind CSS, shadcn/ui, lucide-react icons |
| State and i18n | Zustand, i18next (10 languages) |
| AI providers | Ollama, Jan.ai, LM Studio (local), OpenAI, Anthropic, Mistral (cloud) |

## Server Edition

The same frontend also builds for the browser (`npm run build:web`) and is
served by the server in `/server`. See the
[Server Edition guide](../server/docs/README.md) and its
[development page](../server/docs/development.md).

## Contributing

Issues and pull requests are welcome. If you want to add an AI provider, the
adapter design in `src/lib` keeps that contained.

[Back to the documentation index](README.md)
