# Changelog

All notable changes to ScribeDog are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

## [0.17.0] - 2026-09-26

### Highlights
- Tablet layout for touch screens up to 1400px
- Switch to hide the AI features
- Reorder table rows and columns by keyboard and drag grips
- Bullet, numbered and checklists inside table cells
- Size table columns to their content
- Chat-only switch that takes every tool away
- Render Mermaid diagrams in code blocks, exports and agent edits
- Drag & drop reorder the working set list
- Move a selected image with Ctrl+Shift+Up/Down

### Improvements
- Render inline code as a grey pill without backticks

### Bug Fixes
- Make the theme builder dialog usable on phones
- Keep the list item when deleting an empty line inside it
- Mark folder notes with a folder icon in the working set
- Stop StarterKit's link extension from opening note links in a new tab
- Keep cut images until pasted and fix their paths on paste
- Delete the images of a folder's notes when the folder is deleted
- Clear the tree selection when the tree unmounts
- Drop deleted vaults from the recent vault list
- Reconcile empty folders on refresh and guard write targets against the vault
- Overlay the chat panel instead of resizing the grid in Zen mode

## [0.16.0] - 2026-09-22

### Highlights
- Add theme builder for custom themes, added four new built-in themes: Sepia, Fjord, Fireside, and Midnight
- Support Pandoc's {.unlisted} heading attribute
- Add touch buttons to insert a line above/below an image

### Bug Fixes
- Keep h4-h6 at body size in editor, export, and print

## [0.15.1] - 2026-09-22

### Bug Fixes
- The emoji picker showed a bare grid with no search and no categories in the installed app, and inline styles were refused elsewhere in the editor. Tauri adds a nonce to the app's content security policy, and a nonce makes the browser ignore the "unsafe-inline" that lets a stylesheet be applied from script. Only the desktop builds were affected; the browser edition never sees that policy

## [0.15.0] - 2026-09-22

### Highlights
- Tables in the editor: insert, edit, add and remove rows and columns, with a guard that stops content the Markdown export cannot represent from being silently lost
- Icons for files and folders: pick an emoji from a row's context menu, or click an icon in the path above a note. Icons are stored in the vault (`.scribedog/icons.json`), not in the notes, so setting one is not an edit: no unsaved changes, no new version, nothing in an export or a diff. They travel with the folder and follow a file when it is renamed or moved inside ScribeDog
- Open a folder in the system file manager from its context menu in the tree

### Improvements
- New files and folders are named in the file tree now, next to the siblings whose names they have to differ from, instead of in the path above the editor. On a phone the file list stays open, so creating several notes in a row no longer means reopening it every time. A new folder opens its folder note once the name is confirmed, so Escape leaves it as "New folder" instead of pulling you into a document
- The path above a note scrolls instead of being cut off. Truncating could only ever show one end of it, and the folders it hid are what says where a note lives; on a phone renaming has moved to the file tree with it

### Bug Fixes
- Image selection and stray blank lines in the editor
- The banner that pauses saving when a note cannot be written as Markdown showed no text

## [0.14.1] - 2026-09-21

### Bug Fixes
- Closing the window with the title bar button works again. 0.14.0 intercepted the close request to write the hot-exit drafts first, but lacked the permission to close the window afterwards, so the app could only be ended from the task manager

## [0.14.0] - 2026-09-21

### Highlights
- Hot exit: unsaved edits survive a restart. Dirty notes are kept as drafts in `.scribedog/drafts/` (in the browser edition: in local storage) and come back exactly as left when the vault is opened again; switching notes, opening another vault and closing the window no longer ask about unsaved edits
- "In progress" list above the file tree: pin notes (double-click, Enter, context menu) or, with a setting, let edited notes join automatically; close entries with the cross, middle-click or the new remappable Ctrl+W; the list is stored per vault and restored on open
- Save-time conflict check: a manual save over a file changed outside the app stops and asks (overwrite or cancel), and the disk version goes into the history first; an auto-save never overwrites, it leaves the note dirty until the next manual save
- URLs inside code blocks are clickable

### Bug Fixes
- Keep the toolbar in view after a large paste
- Undo/redo from a touch screen no longer raises the on-screen keyboard when the editor wasn't focused

## [0.13.1] - 2026-09-20

### Bug Fixes
- Stop code block controls from covering the first line: the copy and language buttons now sit as two small badges on the block's top edge and only show while the caret is inside the block

## [0.13.0] - 2026-09-20

### Highlights
- Highlight text with a marker (`==text==`): toolbar button, Ctrl+Shift+H, or a marker mode for the pointer; the highlight goes into every export
- Auto-save (off by default): saves the note after a pause in typing and on the way out of a note
- Paste Markdown: pasted plain text with Markdown markers becomes headings, lists, tables and bold right away; Ctrl+Shift+V pastes the raw text
- Check spelling and grammar of the whole document without selecting text first (Ctrl+Shift+X)
- Zen mode text zoom: pinch on touch screens, Ctrl+wheel on the desktop, remembered separately from the document font size

### Improvements
- Show the note title as a breadcrumb; with folder notes on, each crumb opens that folder's note
- File tree: hide the .md extension, drop the file icons, add "New folder" to the context menu
- Heading numbering: choose whether numbers show everywhere or only in the outline, and whether the `{-}` marker is always visible or only in the heading being edited (#47)
- Add undo and redo buttons to the toolbar
- Phone layout: group the AI actions into one menu and move the AI quick settings into Settings
- Swipe from the left edge to open the file list on phones, swipe back to close it
- Download the server certificate from Settings, Account in the browser, with a short explanation and a link to the install guide
- Slightly lighter default text in the dark theme
- Grammar check now tolerates the loose JSON of small local models (prose around the array, fences mid-sentence, list-shaped answers)
- AI error messages can be dismissed with an X
- Disable page pinch zoom on phones and tablets; the layout is built for the width it has

### Bug Fixes
- Fix code blocks hanging the tab on Android
- Fix the on-screen keyboard opening on Android when ticking a checkbox or tapping an image
- Fix extra spacing below indented checkboxes that sometimes remained after removing them
- Fix Ctrl+Shift+Up/Down not moving a list item past a blockquote, image or paragraph next to the list

## [0.12.2] - 2026-09-19

### Bug Fixes
- Fix the app failing to load a note (and then failing to start at all) once it contains an image whose file name is purely numeric, such as photos from a phone camera

## [0.12.1] - 2026-09-19

### Highlights
- Add image picker on mobile/web and rework phone toolbar
- Serve the CA certificate over HTTPS for direct download

### Improvements
- Make docker-compose.yml's data dir fallback generic
- Rename person slots and make base paths env-driven

### Bug Fixes
- Keep context menu closed on Android double-tap selection

## [0.12.0] - 2026-09-18

### Highlights
- Add ScribeDog Server Edition: run ScribeDog as a self-hosted web app with a full file API, live updates, and a PUID/PGID Docker entrypoint
- Open a vault on a ScribeDog server directly from the desktop app, next to local folders
- Let a remote vault download notes and folders directly
- Enable folder notes
- Add automatic heading numbering

### Improvements
- Restructure the settings dialog into grouped settings pages
- Add a duplicate-file action to the file tree context menu
- Add a selection context menu with copy variants / copy a selection as Markdown or bare text on touch
- Add a paper-white surface option for dark theme

### Bug Fixes
- Fix outline active-heading detection at the scroll limit
- Scale default text opacity per theme
- Keep inline marks when only part of a block is serialized
- Pick a certificate for browsers that open the site by IP
- Keep a note ending in a code block clean on open

## [0.11.0] - 2026-09-12

### Highlights
- Add a live outline to the details panel: jump to any heading with a click or the keyboard, tracks the section you're in as you type or scroll

## [0.10.1] - 2026-09-11

### Bug Fixes
- Report skipped plan steps instead of always marking them done

## [0.10.0] - 2026-09-02

### Highlights
- Add a portable Windows build (ScribeDog_X.Y.Z_portable.zip) alongside the installer: no installation, no admin rights, no registry entries or Start Menu shortcuts.

## [0.9.1] - 2026-08-25

### Bug Fixes
- Fix AI chat failing with Ollama after a tool was used ("Value looks like object, but can't find closing '}' symbol")

## [0.9.0] - 2026-08-05

### Highlights
- Add a vault-wide chat agent with staged changes, checkpoints, and file tools (read, write, edit, rename, delete, search) across the whole vault, not just the open document

## [0.8.3] - 2026-07-30

### Bug Fixes
- Fix local AI connections (Ollama, Jan.ai, LM Studio) returning 403 in the installed app, while working fine in development

## [0.8.2] - 2026-07-30

### Highlights
- Enable find/replace without an open file, with cumulative folder match badges when searching across the vault
- Default the file tree to Manual sort order, so drag & drop works right away — the starting order is the familiar folders-first alphabetical one

### Improvements
- Add spacing to the shortcuts-settings dialog

### Bug Fixes
- Normalize pasted slices with stray hard breaks

## [0.8.1] - 2026-07-29

### Highlights
- Add fuzzy/approximate text matching with punctuation tolerance
- Add theme boot and enhance import/drag-drop UX
- Add retrieval-augmented generation with indexing

### Improvements
- Consolidate shortcuts into settings dialog

## [0.8.0] - 2026-07-28

### Highlights
- RAG: retrieval-augmented generation with document indexing and search
- RAG: knowledge base folder controls and file attachments
- Chat: handle links in AI-generated answers

## [0.7.1] - 2026-07-27

### Highlights
- Add details panel showing document stats (word count, reading time), links, and backlinks
- Improve PDF export quality with manuscript rendering and expanded font support

## [0.7.0] - 2026-07-26

### Highlights
- Add AI chat panel with agent tools and context management
- Add request timeout and running indicator for active session
- Add document versioning with diff preview and restore
- Add document links, navigation history, and customizable shortcuts

## [0.6.0] - 2026-07-23

### Highlights
- Add zen mode for distraction-free writing

## [0.5.4] - 2026-07-23

### Highlights
- Add code language picker for syntax highlighting

### Bug Fixes
- Write grammar-check explanations in the app UI language
- Honor the image display width in PDF, DOCX and ODT export
- Stop moving a file from deleting its images
- Never rewrite image paths that point outside the vault
- Persist rewritten image paths when moving an opened file

## [0.5.3] - 2026-07-22

### Bug Fixes
- Voice transcription is roughly 4x faster — whisper.cpp was being built
  without optimizations in release binaries

## [0.5.2] - 2026-07-20

### Improvements
- AI thinking mode is now disabled by default

## [0.5.1] - 2026-07-19

Improve voice transcription performance and language handling.

## [0.5.0] - 2026-07-19

### Highlights
- Add voice input with model download and streaming transcription
- Add custom assistants management with templates and settings
- Add zoom control, find/replace panel, and improved UI toggles

## [0.4.1] - 2026-07-19

### Highlights
- Add document printing with print-optimized styling
- Add file selection and batch delete/export operations

## [0.4.0] - 2026-07-18

### Highlights
- Add document import for PDF, DOCX, HTML with image extraction
- Add export to PDF, DOCX, ODT, HTML with emoji and sans-serif styling

## [0.3.0] - 2026-07-14

### Highlights
- Add AI-powered spelling and grammar check
- Add support for 10 languages: English, German, Spanish, French, Italian, Japanese, Portuguese, Russian, Ukrainian, and Chinese

## [0.2.0] - 2026-07-13

### Highlights
- Add AI diff review interface for before-accept workflow
- Add drag-and-drop file organization with vault metadata

## [0.1.0] - 2026-07-12

### Highlights
- Initial release of ScribeDog
