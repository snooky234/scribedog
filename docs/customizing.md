# Customizing

[Documentation](README.md) / Customizing

## Themes

ScribeDog ships with light and dark themes and four more:

| Theme | For |
|---|---|
| Light, Dark | The everyday pair |
| Sepia | Warm tones for long writing sessions |
| Fjord | A cool dark theme |
| Fireside | A warm dark theme |
| Midnight | True black for OLED screens |

There is also an optional **paper-white page inside the dark UI**. It helps
you judge long or layout-heavy documents.

<img src="images/scribe-dog-light-theme.png" alt="ScribeDog light theme" width="700">

## Your own themes

The **theme builder** lives under **Settings, Appearance**. It starts from
any built-in theme.

You pick a handful of base colours:

- background
- surface
- text
- muted text
- chrome
- accent

Hover, selection, borders and shadows follow on their own. A live preview
shows every colour before you use the theme, including the paper sheet and
Zen mode. Zen mode can get a background and text colour of its own.

An **Advanced** section covers status, highlight, diff and code colours.

<img src="images/scribe-dog-themebuilder.png" alt="ScribeDog theme builder" width="700">

Themes can be exported and imported as a small JSON file, or through the
clipboard.

## Languages

The interface comes in 10 languages: English, German, Spanish, French,
Italian, Portuguese, Russian, Ukrainian, Japanese and Chinese.

## Keyboard shortcuts

Press `Ctrl+#` for the cheat sheet. **Every shortcut in it can be remapped**:

1. Click a key combination.
2. Press the one you want.
3. It is saved right away.

Conflicts are caught before they are assigned. A binding has to include
`Ctrl` or `Alt`, because `Shift` alone would swallow ordinary typing.

Your overrides are stored in a `shortcuts.json` file in the app config
folder. They are app-wide, not per vault. In the portable build the file lives
in the `.scribedog` folder next to the executable.

## Settings

Settings are grouped by what they belong to: **Application**, **AI** and
**Folder**. The entries that live in the open folder say so at the top.

Every setting has a one-line hint. A longer explanation sits behind the (i)
next to its label.

## Toolbar and window

- A one-click formatting toolbar with active-state highlighting. Extra
  options, such as spell check, auto-save and page lines, sit in its options
  menu.
- Window size and maximized state are remembered across restarts.

## Hiding the AI features

If you never want AI, switch off **Show AI features** in the application
settings. The AI buttons, the chat and the AI settings pages disappear.

[Back to the documentation index](README.md)
