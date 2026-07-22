# Changelog

All notable changes to ScribeDog are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

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
